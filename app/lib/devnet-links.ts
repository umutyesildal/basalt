/** Carry idea copy into the fixed four-token devnet workspace, never asset backing or USD amounts. */
export function devnetCreateHref(draft: { name?: string; thesis?: string; managementFeeBps?: number } = {}): string {
  const params = new URLSearchParams();
  if (draft.name?.trim()) params.set("name", draft.name.trim().slice(0, 60));
  if (draft.thesis?.trim()) params.set("thesis", draft.thesis.trim().slice(0, 240));
  if (Number.isInteger(draft.managementFeeBps) && draft.managementFeeBps! >= 0 && draft.managementFeeBps! <= 300) params.set("managementBps", String(draft.managementFeeBps));
  const query = params.toString();
  return `/create/onchain${query ? `?${query}` : ""}`;
}
