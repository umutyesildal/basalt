/** Local, decorative Notionists portraits. No wallet is sent to an avatar API. */
export function avatarArt(wallet: string): string {
  let hash = 2166136261;
  for (const character of wallet) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `/images/avatars/notionist-${String((hash >>> 0) % 24).padStart(2, "0")}.svg`;
}
