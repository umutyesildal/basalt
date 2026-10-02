import { afterEach, describe, expect, it, vi } from "vitest";

import { scheduleAfterWalletProviderEffects } from "../../app/lib/wallet-connect-scheduler";

afterEach(() => {
  vi.useRealTimers();
});

describe("wallet connection scheduling", () => {
  it("waits for the provider listener before an already-authorized adapter emits connect", () => {
    vi.useFakeTimers();

    let providerSubscribed = false;
    let providerConnected = false;
    let adapterConnected = false;

    const connectAlreadyAuthorizedWallet = vi.fn(() => {
      if (adapterConnected) return;
      adapterConnected = true;
      if (providerSubscribed) providerConnected = true;
    });

    const cancel = scheduleAfterWalletProviderEffects(connectAlreadyAuthorizedWallet);
    // WalletProviderBase installs this listener in its parent passive effect,
    // later in the same effect flush as the child request that schedules connect.
    providerSubscribed = true;

    expect(providerConnected).toBe(false);
    vi.runOnlyPendingTimers();

    expect(connectAlreadyAuthorizedWallet).toHaveBeenCalledOnce();
    expect(providerConnected).toBe(true);
    cancel();
  });

  it("cancels a deferred connect when selection changes before the timer fires", () => {
    vi.useFakeTimers();
    const connect = vi.fn();

    const cancel = scheduleAfterWalletProviderEffects(connect);
    cancel();
    vi.runOnlyPendingTimers();

    expect(connect).not.toHaveBeenCalled();
  });
});
