/** Pure layout helpers shared by the poster renderer and edge-case checks. */
export function wrapImageText(text: string, width: number, measure: (text: string) => number): string[] {
  const words = text.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate) <= width) { line = candidate; continue; }
    if (line) { lines.push(line); line = ""; }
    if (measure(word) <= width) { line = word; continue; }
    const characters = segmenter ? Array.from(segmenter.segment(word), ({ segment }) => segment) : Array.from(word);
    for (const character of characters) {
      if (line && measure(line + character) > width) { lines.push(line); line = ""; }
      line += character;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function basketImageGrid(assetCount: number, contentBottom: number) {
  const columns = assetCount > 10 ? 3 : 2;
  const rows = Math.ceil(assetCount / columns);
  const top = Math.max(744, contentBottom + 68);
  const rowHeight = 94;
  const bottom = top + rows * rowHeight;
  return { columns, rows, top, rowHeight, bottom, height: Math.max(1000, bottom + 150) };
}

export function basketImageFilename(name: string): string {
  const slug = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "stock-basket";
  return `basalt-${slug}.png`;
}


/** Keep the visual readable; every holding still appears in the full ledger. */
export function basketImageStacks<T extends { weightBps: number }>(assets: readonly T[]) {
  const indexed = assets.map((asset, index) => ({ asset, index }));
  const shown = assets.length > 6
    ? indexed.sort((a, b) => b.asset.weightBps - a.asset.weightBps || a.index - b.index).slice(0, 6)
    : indexed;
  const slot = 475 / shown.length;
  const width = Math.min(94, slot - 16);
  const maxWeight = Math.max(...shown.map(({ asset }) => asset.weightBps));
  return shown.map(({ asset, index }, position) => ({
    asset, index, width,
    left: 1010 + position * slot + (slot - width) / 2,
    height: 242 * asset.weightBps / maxWeight,
    facet: Math.min(20, width / 4),
    baseline: 550,
  }));
}
