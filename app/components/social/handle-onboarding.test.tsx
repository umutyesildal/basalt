// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  wallet: "handle-test-wallet-1",
  ensureAuth: vi.fn(),
  fetchProfile: vi.fn(),
  putMeProfile: vi.fn(),
}));
vi.mock("@solana/wallet-adapter-react", () => ({
  useWallet: () => ({ connected: true, publicKey: { toBase58: () => mocks.wallet } }),
}));
vi.mock("@/lib/social-auth", () => ({
  useSocialAuth: () => ({ connected: true, authWallet: mocks.wallet, isAuthed: false, ensureAuth: mocks.ensureAuth }),
}));
vi.mock("@/lib/social-api", async (original) => ({
  ...await original<typeof import("@/lib/social-api")>(),
  fetchProfile: mocks.fetchProfile,
  putMeProfile: mocks.putMeProfile,
}));
vi.mock("@/components/social/avatar", () => ({ SocialAvatar: () => <span aria-hidden="true" /> }));

import { HandleOnboarding } from "./handle-onboarding";
import { ProfileEditorModal } from "./profile-editor";
import { SocialApiError } from "@/lib/social-api";

const originalProfile = {
  handle: "old_handle", displayName: "Original name", avatarUrl: "https://example.com/avatar.png",
  bio: "Original bio", isPublic: false, createdAt: "2026-10-10T00:00:00Z",
};
let walletId = 0;
beforeEach(() => {
  mocks.wallet = `handle-test-wallet-${++walletId}`;
  vi.clearAllMocks();
  mocks.fetchProfile.mockResolvedValue({ profile: null });
  mocks.ensureAuth.mockResolvedValue("test-token");
  mocks.putMeProfile.mockResolvedValue({ profile: { ...originalProfile, handle: "my_basket" } });
});
afterEach(cleanup);

async function openClaim() {
  const view = render(<HandleOnboarding />);
  fireEvent.click(screen.getByRole("button", { name: "Claim handle" }));
  const dialog = await screen.findByRole("dialog", { name: "Claim your handle" });
  await within(dialog).findByRole("textbox", { name: "Handle" });
  return { view, dialog };
}

describe("handle onboarding interaction", () => {
  it("keeps the dialog mounted after the nudge click, with one field and no wallet prompt", async () => {
    const { dialog } = await openClaim();
    expect(within(dialog).getAllByRole("textbox")).toHaveLength(1);
    expect(mocks.ensureAuth).not.toHaveBeenCalled();
    expect(mocks.fetchProfile).toHaveBeenCalledWith(mocks.wallet, expect.any(AbortSignal));
    expect(within(dialog).getByRole("button", { name: "Claim handle" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "Claim handle" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Claim handle" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("claims only the handle after signing, preserving existing profile and privacy fields", async () => {
    mocks.fetchProfile.mockResolvedValue({ profile: originalProfile });
    const { dialog } = await openClaim();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "@MY_BASKET" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Claim handle" }));
    await waitFor(() => expect(mocks.putMeProfile).toHaveBeenCalledWith("test-token", { handle: "my_basket" }));
    expect(mocks.ensureAuth).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(localStorage.getItem(`basalt:handle-claimed:${mocks.wallet}`)).toBe("1");
  });

  it("shows wallet waiting feedback and never publishes after cancelling a pending signature", async () => {
    let resolveSignature!: (token: string) => void;
    mocks.ensureAuth.mockReturnValue(new Promise<string>((resolve) => { resolveSignature = resolve; }));
    const { dialog } = await openClaim();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "my_basket" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Claim handle" }));
    expect(within(dialog).getByRole("status").textContent).toBe("Confirm in your wallet…");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await act(async () => resolveSignature("late-token"));
    expect(mocks.putMeProfile).not.toHaveBeenCalled();
  });

  it("renders rejected signatures and taken handles inline, and allows retry", async () => {
    const { dialog } = await openClaim();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "my_basket" } });
    mocks.ensureAuth.mockRejectedValueOnce(new Error("Signature request declined."));
    fireEvent.click(within(dialog).getByRole("button", { name: "Claim handle" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("Signature request declined.");
    mocks.putMeProfile.mockRejectedValueOnce(new SocialApiError("Taken", 409, "HANDLE_TAKEN"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Claim handle" }));
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toBe("That handle is taken. Try another."));
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "another_handle" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Claim handle" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("retries a failed public profile read without signing or losing the claim entry point", async () => {
    mocks.fetchProfile.mockRejectedValueOnce(new Error("Offline"));
    render(<HandleOnboarding />);
    fireEvent.click(screen.getByRole("button", { name: "Claim handle" }));
    const dialog = await screen.findByRole("dialog");
    expect((await within(dialog).findByRole("alert")).textContent).toContain("Could not load your profile");
    fireEvent.click(within(dialog).getByRole("button", { name: "Try again" }));
    await within(dialog).findByRole("textbox");
    expect(mocks.ensureAuth).not.toHaveBeenCalled();
  });

  it("abandons the old wallet's pending save when the connected wallet changes", async () => {
    let resolveSignature!: (token: string) => void;
    mocks.ensureAuth.mockReturnValueOnce(new Promise<string>((resolve) => { resolveSignature = resolve; }));
    const { view, dialog } = await openClaim();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "my_basket" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Claim handle" }));
    mocks.wallet = `handle-test-wallet-${++walletId}`;
    view.rerender(<HandleOnboarding />);
    await waitFor(() => expect(screen.getByRole("textbox").getAttribute("value")).toBe(""));
    await act(async () => resolveSignature("old-wallet-token"));
    expect(mocks.putMeProfile).not.toHaveBeenCalled();
  });

  it("returns keyboard focus to the claim button after Escape", async () => {
    render(<HandleOnboarding />);
    const trigger = screen.getByRole("button", { name: "Claim handle" });
    trigger.focus();
    fireEvent.click(trigger);
    const input = await screen.findByRole("textbox");
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("keeps the full editor available and loads it without a signature", async () => {
    mocks.fetchProfile.mockResolvedValue({ profile: originalProfile });
    const onClose = vi.fn();
    render(<ProfileEditorModal open onClose={onClose} />);
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("textbox", { name: /Display name/ });
    expect(within(dialog).getAllByRole("textbox")).toHaveLength(4);
    expect(mocks.ensureAuth).not.toHaveBeenCalled();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
