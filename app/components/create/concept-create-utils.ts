import { formatGroupedAmountInput, parseGroupedAmountInput } from "@/lib/format";

export function equalWeights(count: number): number[] {
  if (count < 1) return [];
  const base = Math.floor(10_000 / count);
  const remainder = 10_000 - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

/** Keep each selected asset positive and preserve the exact allocation total. */
export function distributeWeights(weights: number[], total = 10_000): number[] {
  if (weights.length === 0) return [];
  const distributable = Math.max(0, total - weights.length);
  const ratios = weights.map((weight) => Math.max(0, weight - 1));
  const ratioTotal = ratios.reduce((sum, value) => sum + value, 0);
  const source = ratioTotal > 0 ? ratios : weights.map(() => 1);
  const sourceTotal = source.reduce((sum, value) => sum + value, 0);
  const extras = source.map((value) => Math.floor((value / sourceTotal) * distributable));
  let remainder = distributable - extras.reduce((sum, value) => sum + value, 0);
  for (let index = 0; remainder > 0; index = (index + 1) % extras.length) {
    extras[index] += 1;
    remainder -= 1;
  }
  return extras.map((value) => value + 1);
}

export function canScrollDown({ scrollHeight, clientHeight, scrollTop }: {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
}): boolean {
  return scrollHeight - clientHeight - scrollTop > 2;
}

/** Existing share links may contain more precision than the two-decimal editor. */
export function initialAmountDraft(amount: number): string {
  return formatGroupedAmountInput(amount) || amount.toLocaleString("en-US", { maximumSignificantDigits: 21 });
}

export function parseCreateAmount(draft: string, originalAmount: number): number | null {
  return parseGroupedAmountInput(draft) ?? (draft === initialAmountDraft(originalAmount) ? originalAmount : null);
}

/** Regroup an edited amount without moving its caret to the end. */
export function formatAmountEdit(value: string, selectionStart: number | null): { value: string; caret: number } | null {
  const raw = value.replace(/,/g, "");
  if (!/^\d{0,7}(?:\.\d{0,2})?$/.test(raw)) return null;
  const formatted = formatGroupedAmountInput(raw);
  const rawCaret = value.slice(0, selectionStart ?? value.length).replace(/,/g, "").length;
  let caret = 0;
  let characters = 0;
  while (caret < formatted.length && characters < rawCaret) {
    if (formatted[caret] !== ",") characters += 1;
    caret += 1;
  }
  return { value: formatted, caret };
}
