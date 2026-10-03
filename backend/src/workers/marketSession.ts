/** NYSE cash session calendar verified 2026-10-03. Fail closed outside published years.
 * Source: https://www.nyse.com/trade/hours-calendars (2026,2027,2028).
 * Applies to quote refresh scheduling only, never to transfers or redemptions.
 */
export interface MarketSession {
  market: "NYSE";
  timezone: "America/New_York";
  status: "open" | "closed";
  isOpen: boolean;
  reason: "regular-session" | "pre-open" | "after-hours" | "weekend" | "holiday" | "calendar-unavailable";
  sessionDate: string;
  opensAt: string | null;
  closesAt: string | null;
  nextOpenAt: string | null;
  earlyClose: boolean;
  calendarThrough: "2028-12-31";
}
const HOLIDAYS = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
  // NYSE does not observe the Saturday2028NewYear holiday on2027-12-31.
  "2028-01-17", "2028-02-21", "2028-04-14", "2028-05-29", "2028-06-19", "2028-07-04", "2028-09-04", "2028-11-23", "2028-12-25",
]);
const EARLY_CLOSES = new Set(["2026-11-27", "2026-12-24", "2027-11-26", "2028-07-03", "2028-11-24"]);
const formatter = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
function parts(date: Date): Record<string, number> {
  return Object.fromEntries(formatter.formatToParts(date).filter(part => part.type !== "literal").map(part => [part.type, Number(part.value)]));
}
function dateKey(year: number, month: number, day: number): string { return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`; }
function supported(year: number): boolean { return year >= 2026 && year <= 2028; }
function weekend(year: number, month: number, day: number): boolean {
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); return dow === 0 || dow === 6;
}
/** Resolve a NewYork wall-clock time with the runtime's IANA DST rules. Sessions never intersect DST transition hours. */
function localTime(year: number, month: number, day: number, hour: number, minute: number): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let utc = wall;
  for (let i = 0; i < 2; i++) {
    const value = parts(new Date(utc));
    const observedWall = Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute, value.second);
    utc += wall - observedWall;
  }
  return utc;
}
export function getNyseMarketSession(now: Date = new Date()): MarketSession {
  const unavailable: MarketSession = { market: "NYSE", timezone: "America/New_York", status: "closed", isOpen: false,
    reason: "calendar-unavailable", sessionDate: "", opensAt: null, closesAt: null, nextOpenAt: null, earlyClose: false, calendarThrough: "2028-12-31" };
  if (!Number.isFinite(now.getTime())) return unavailable;
  const { year, month, day } = parts(now);
  const key = dateKey(year, month, day);
  if (!supported(year)) return { ...unavailable, sessionDate: key };
  const isWeekend = weekend(year, month, day);
  const holiday = HOLIDAYS.has(key);
  const earlyClose = EARLY_CLOSES.has(key);
  const open = !isWeekend && !holiday ? localTime(year, month, day, 9, 30) : null;
  const close = open !== null ? localTime(year, month, day, earlyClose ? 13 : 16, 0) : null;
  const isOpen = open !== null && close !== null && now.getTime() >= open && now.getTime() < close;
  let nextOpen: number | null = open !== null && now.getTime() < open ? open : null;
  if (nextOpen === null) {
    for (let offset = 1; offset <= 10; offset++) {
      const next = new Date(Date.UTC(year, month - 1, day + offset));
      const y = next.getUTCFullYear(), m = next.getUTCMonth() + 1, d = next.getUTCDate();
      if (!supported(y)) break;
      if (!weekend(y, m, d) && !HOLIDAYS.has(dateKey(y, m, d))) { nextOpen = localTime(y, m, d, 9, 30); break; }
    }
  }
  return { ...unavailable, sessionDate: key, status: isOpen ? "open" : "closed", isOpen, earlyClose,
    reason: isWeekend ? "weekend" : holiday ? "holiday" : isOpen ? "regular-session" : open !== null && now.getTime() < open ? "pre-open" : "after-hours",
    opensAt: open === null ? null : new Date(open).toISOString(), closesAt: close === null ? null : new Date(close).toISOString(),
    nextOpenAt: nextOpen === null ? null : new Date(nextOpen).toISOString() };
}
