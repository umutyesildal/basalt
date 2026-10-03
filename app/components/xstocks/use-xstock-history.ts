"use client";

import { useEffect, useState } from "react";
import { fetchXStockHistory, mergeXStockHistories, nextXStockHistoryRefreshAt, type XStockHistory, type XStockHistoryRange } from "@/lib/xstock-history";

/** Cold visible jobs poll; completed history only wakes at the next UTC daily close. */
export function useXStockHistory(mintKey: string, range: XStockHistoryRange, refresh = 0) {
  const [history, setHistory] = useState<Map<string, XStockHistory>>(new Map());
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    const mints = mintKey ? mintKey.split(",") : [];
    let pending = [...mints];
    let lastRequestedDay = -1;
    let running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const visible = new Set(mints);
    const utcDay = () => Math.floor(Date.now() / 86_400_000);
    setHistory(previous => new Map([...previous].filter(([mint, row]) => visible.has(mint) && row.range === range)));
    setLoading(pending.length > 0);
    function schedule() {
      clearTimeout(timer);
      if (controller.signal.aborted || !mints.length) return;
      const delay = pending.length ? 8_000 : Math.max(1, nextXStockHistoryRefreshAt() - Date.now());
      timer = setTimeout(() => {
        if (lastRequestedDay !== utcDay()) pending = [...mints];
        void update();
      }, delay);
    }
    async function update() {
      if (running || controller.signal.aborted || !pending.length || document.hidden) return;
      running = true; setLoading(true);
      const requestedDay = utcDay();
      try {
        const rows = await fetchXStockHistory(pending, range, controller.signal);
        if (controller.signal.aborted) return;
        lastRequestedDay = requestedDay;
        setHistory(previous => mergeXStockHistories(previous, rows));
        pending = requestedDay !== utcDay() ? [...mints] : rows.filter(row => row.status === "loading" || row.refreshing).map(row => row.mint);
        setLoading(pending.length > 0);
      } finally { running = false; if (!controller.signal.aborted) schedule(); }
    }
    const onVisible = () => {
      if (document.hidden) return;
      if (lastRequestedDay !== utcDay()) pending = [...mints];
      if (pending.length) { clearTimeout(timer); void update(); }
    };
    void update();
    document.addEventListener("visibilitychange", onVisible);
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [mintKey, range, refresh]);
  return { history, loading };
}
