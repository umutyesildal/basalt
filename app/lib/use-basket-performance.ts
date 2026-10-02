"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { BasketPerformanceResponse } from "@/lib/basket-performance";

type Snapshot = { status: "loading" | "ready" | "error"; data: BasketPerformanceResponse | null };
const initial: Snapshot = { status: "loading", data: null };
let snapshot = initial;
let expiresAt = 0;
let pending: Promise<void> | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const publish = (next: Snapshot) => { snapshot = next; listeners.forEach((listener) => listener()); };
const onVisible = () => { if (document.visibilityState === "visible") void load(); };

function scheduleRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
  if (listeners.size) refreshTimer = setTimeout(onVisible, Math.max(1_000, expiresAt - Date.now()));
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  if (listeners.size === 1) {
    document.addEventListener("visibilitychange", onVisible);
    if (expiresAt) scheduleRefresh();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      document.removeEventListener("visibilitychange", onVisible);
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = null;
    }
  };
};

function load(force = false): Promise<void> {
  if (pending) return pending;
  if (!force && Date.now() < expiresAt) { scheduleRefresh(); return Promise.resolve(); }
  if (!snapshot.data) publish({ status: "loading", data: null });
  pending = (async () => {
    try {
      const response = await fetch("/api/basket-performance", { signal: AbortSignal.timeout(75_000) });
      if (!response.ok) throw new Error("Market data unavailable");
      const data: BasketPerformanceResponse = await response.json();
      if (!Array.isArray(data.items)) throw new Error("Invalid market data");
      publish({ status: "ready", data });
    } catch {
      publish({ status: "error", data: null });
    } finally {
      expiresAt = Date.now() + (snapshot.data?.status === "ready" ? 300_000 : 30_000);
      pending = null;
      scheduleRefresh();
    }
  })();
  return pending;
}

/** All visible cards share one request, cache and refresh timer. */
export function useBasketPerformance() {
  const state = useSyncExternalStore(subscribe, () => snapshot, () => initial);
  useEffect(() => { void load(); }, []);
  return { ...state, retry: () => { void load(true); } };
}
