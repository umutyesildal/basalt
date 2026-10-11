"use client";

import { useEffect, useRef, useState } from "react";

import { Dialog } from "@base-ui/react/dialog";
import { useWallet } from "@solana/wallet-adapter-react";

import { Button } from "@/components/ui/button";
import {
  fetchProfile,
  putMeProfile,
  SocialApiError,
  type ProfilePatch,
  type SocialProfile,
} from "@/lib/social-api";
import { useSocialAuth } from "@/lib/social-auth";

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

/**
 * Edit-profile modal: handle / display name / avatar URL / bio / visibility,
 * saved with PUT /me/profile (absent field = unchanged; explicit null clears —
 * empty inputs are sent as null here so clearing works). HANDLE_TAKEN renders
 * inline; wallet sign-in is requested transparently on save via useSocialAuth.
 *
 * Shared by the profile page ("Edit profile") and the thesis composer's
 * PROFILE_REQUIRED recovery ("Claim a handle first").
 */
type ProfileEditorProps = {
  open: boolean;
  onClose: () => void;
  onSaved?: (profile: SocialProfile) => void;
  title?: string;
  submitLabel?: string;
  mode?: "profile" | "claim";
};

/** Wallet changes discard the previous wallet's form and pending callbacks. */
export function ProfileEditorModal(props: ProfileEditorProps) {
  const { publicKey } = useWallet();
  return <ProfileEditorSession key={publicKey?.toBase58() ?? "disconnected"} {...props} />;
}

function ProfileEditorSession({
  open,
  onClose,
  onSaved,
  title = "Edit profile",
  submitLabel = "Save profile",
  mode = "profile",
}: ProfileEditorProps) {
  const social = useSocialAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const attemptRef = useRef(0);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [savePhase, setSavePhase] = useState("Saving…");
  const claimOnly = mode === "claim";

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [handleTaken, setHandleTaken] = useState(false);

  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [bio, setBio] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [hadProfile, setHadProfile] = useState(false);

  // Reading a profile is public. Opening this form never asks for a signature.
  useEffect(() => {
    if (!open || !social.authWallet) return;
    const controller = new AbortController();
    let cancelled = false;
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    setLoading(true);
    setLoadError(null);
    setSaveError(null);
    setHandleTaken(false);
    fetchProfile(social.authWallet, controller.signal).then(({ profile: p }) => {
      if (cancelled) return;
      setHadProfile(p !== null);
      setHandle(p?.handle ?? "");
      setDisplayName(p?.displayName ?? "");
      setAvatarUrl(p?.avatarUrl ?? "");
      setBio(p?.bio ?? "");
      setIsPublic(p?.isPublic ?? true);
    }).catch(() => {
      if (!cancelled) setLoadError("Could not load your profile. Try again.");
    }).finally(() => {
      window.clearTimeout(timeout);
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeout);
      attemptRef.current++;
    };
  }, [open, social.authWallet, reloadVersion]);

  useEffect(() => {
    if (open && !loading && !loadError) inputRef.current?.focus();
  }, [open, loading, loadError]);

  const close = () => {
    // A late wallet signature after cancellation must not publish a profile.
    attemptRef.current++;
    setSaving(false);
    onClose();
  };

  const handleValid = HANDLE_RE.test(handle);
  const canSave = handleValid && !saving && !loading && !loadError && social.connected;

  const save = async () => {
    if (!canSave) return;
    const attempt = ++attemptRef.current;
    setSaving(true);
    setSavePhase(social.isAuthed ? "Saving…" : "Confirm in your wallet…");
    setSaveError(null);
    setHandleTaken(false);
    try {
      const token = await social.ensureAuth();
      if (attempt !== attemptRef.current) return;
      setSavePhase("Saving…");
      const patch: ProfilePatch = claimOnly ? { handle } : {
        handle: handle.trim() || null,
        displayName: displayName.trim() || null,
        avatarUrl: avatarUrl.trim() || null,
        bio: bio.trim() || null,
        isPublic,
      };
      const { profile } = await putMeProfile(token, patch);
      if (attempt !== attemptRef.current) return;
      onSaved?.(profile);
      onClose();
    } catch (err) {
      if (attempt !== attemptRef.current) return;
      if (err instanceof SocialApiError && err.code === "HANDLE_TAKEN") {
        setHandleTaken(true);
      } else if (err instanceof Error) {
        setSaveError(err.message);
      } else {
        setSaveError("Saving the profile failed.");
      }
    } finally {
      if (attempt === attemptRef.current) setSaving(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) close(); }} disablePointerDismissal>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-background/80 backdrop-blur-[2px]" />
        <Dialog.Popup
          initialFocus={inputRef}
          className="fixed left-1/2 top-1/2 z-50 max-h-[85dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-6 outline-none"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="font-display text-xl font-semibold">{title}</Dialog.Title>
              <Dialog.Description className="mt-2 text-sm leading-5 text-muted-foreground">
                {claimOnly ? "A name people can find you by." : hadProfile
                  ? "Shown on the feed, leaderboard and your profile page."
                  : "Add a name and a little about yourself."}
              </Dialog.Description>
            </div>
            <Dialog.Close render={<Button variant="ghost" size="icon-sm" aria-label="Close" />}>
              ×
            </Dialog.Close>
          </div>

          {loading ? (
            <p role="status" className="mt-4 text-sm text-muted-foreground">
              Loading your profile…
            </p>
          ) : loadError ? (
            <div role="alert" className="mt-4 space-y-2">
              <p className="text-sm text-foreground">{loadError}</p>
              <Button variant="outline" size="sm" onClick={() => setReloadVersion((version) => version + 1)}>
                Try again
              </Button>
            </div>
          ) : (
            <form
              className="mt-4 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (canSave) void save();
              }}
            >
              <Field label="Handle" hint="3 to 20 letters, numbers or underscores.">
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className="font-mono text-sm text-muted-foreground">
                    @
                  </span>
                  <input
                    ref={inputRef}
                    aria-label="Handle"
                    maxLength={20}
                    autoCapitalize="none"
                    disabled={saving}
                    value={handle}
                    onChange={(event) => {
                      setHandle(event.target.value.toLowerCase().replace(/^@/, "").trim());
                      setHandleTaken(false);
                    }}
                    placeholder="your_name"
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={handle.length > 0 && !handleValid ? true : undefined}
                    className="h-12 w-full rounded-lg border border-border bg-background px-3 font-mono text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  />
                </div>
                {handleTaken ? (
                  <p role="alert" className="mt-1 text-xs text-destructive">
                    That handle is taken. Try another.
                  </p>
                ) : handle.length > 0 && !handleValid ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Use 3 to 20 letters, numbers or underscores.
                  </p>
                ) : null}
              </Field>

              {!claimOnly && <fieldset disabled={saving} className="space-y-4">
                <Field label="Display name" hint="Optional. Shown instead of your handle.">
                  <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="satoshi"
                    maxLength={40}
                    className="h-9 w-full rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  />
                </Field>

                <Field label="Avatar URL" hint="Optional https image.">
                  <input
                    value={avatarUrl}
                    onChange={(event) => setAvatarUrl(event.target.value)}
                    placeholder="https://…"
                    type="url"
                    className="h-9 w-full rounded-lg border border-border bg-background px-2.5 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  />
                </Field>

                <Field label="Bio" hint="Optional, ~200 characters.">
                  <textarea
                    value={bio}
                    onChange={(event) => setBio(event.target.value)}
                    maxLength={280}
                    rows={3}
                    className="w-full resize-y rounded-lg border border-border bg-background px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  />
                </Field>

                <label className="flex items-start gap-2.5 rounded-xl border border-border bg-background p-3 text-sm">
                  <input
                    type="checkbox"
                    checked={!isPublic}
                    onChange={(event) => setIsPublic(!event.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
                  />
                  <span>
                    Hide my trades from the public feed and leaderboard
                    <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                      Your profile page stays reachable by link; public surfaces stop showing your
                      activity.
                    </span>
                  </span>
                </label>

              </fieldset>}

              {claimOnly && <p className="text-xs leading-5 text-muted-foreground">Confirm with a wallet signature. No transaction or fee.</p>}
              {saving && <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{savePhase}</p>}

              {saveError ? (
                <p role="alert" className="text-sm text-foreground">
                  {saveError}
                </p>
              ) : null}

              <div className="flex items-center justify-end gap-2 border-t border-border/60 pt-4">
                <Button type="button" variant="outline" className="min-h-10" onClick={close}>
                  Cancel
                </Button>
                <Button type="submit" className="min-h-10" disabled={!canSave}>
                  {saving ? savePhase : submitLabel}
                </Button>
              </div>
            </form>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="font-mono text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {hint ? <span className="ml-2 text-[11px] text-muted-foreground/80">{hint}</span> : null}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
