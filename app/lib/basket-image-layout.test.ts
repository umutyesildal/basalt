import assert from "node:assert/strict";
import test from "node:test";
import { basketImageFilename, basketImageGrid, basketImageStacks, wrapImageText } from "./basket-image-layout";

const graphemes = (value: string) => Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value), ({ segment }) => segment);
const measure = (value: string) => graphemes(value).length * 10;

test("image text wraps an unbroken 240-character Unicode thesis without losing content", () => {
  const thesis = "界".repeat(240);
  const lines = wrapImageText(thesis, 130, measure);
  assert.ok(lines.length > 1);
  assert.equal(lines.join(""), thesis);
  assert.ok(lines.every((line) => measure(line) <= 130));
});

test("image text keeps emoji families, flags and combining marks together", () => {
  const units = ["👨‍👩‍👧‍👦", "🇹🇷", "e\u0301", "👩🏽‍💻", "界"];
  const value = units.join("").repeat(12);
  const lines = wrapImageText(value, 30, measure);
  assert.equal(lines.join(""), value);
  assert.deepEqual(lines.flatMap(graphemes), graphemes(value));
  assert.ok(lines.every((line) => measure(line) <= 30));
});

test("image text normalizes pasted newlines and whitespace without empty lines", () => {
  const lines = wrapImageText("  First\n\nsecond\tthird\r\n  ", 120, measure);
  assert.deepEqual(lines, ["First second", "third"]);
  assert.deepEqual(wrapImageText(" \n\t ", 120, measure), []);
});

test("image text removes non-printing pasted control characters", () => {
  const lines = wrapImageText("AI\u0000 picks\u0007 for\u001f everyone\u007f", 1000, measure);
  assert.deepEqual(lines, ["AI picks for everyone"]);
});

test("image text preserves an individual grapheme even when it exceeds the width", () => {
  assert.deepEqual(wrapImageText("👨‍👩‍👧‍👦", 1, measure), ["👨‍👩‍👧‍👦"]);
});

for (const count of [2, 20]) {
  test(`${count}-asset posters reserve space between every row and the footer`, () => {
    for (const contentBottom of [350, 900, 1600]) {
      const grid = basketImageGrid(count, contentBottom);
      assert.ok(grid.top - 54 > contentBottom, "holdings separator must clear the full thesis");
      assert.ok(grid.rows * grid.columns >= count, "every asset needs a grid cell");
      assert.ok((grid.rows - 1) * grid.columns < count, "there must not be an empty final row");
      assert.ok(grid.height >= 1000);
      assert.ok(grid.height - 92 > grid.bottom + 40, "footer rule must clear the holdings ledger");
      assert.ok(grid.height - 60 > grid.bottom + 70, "domain must clear the holdings ledger");
    }
  });
}

test("all supported asset counts fit inside the poster's calculated height", () => {
  for (let count = 2; count <= 20; count++) {
    const grid = basketImageGrid(count, 1000);
    const lastRow = Math.floor((count - 1) / grid.columns);
    const lastRowBottom = grid.top + lastRow * grid.rowHeight + 81;
    assert.ok(lastRowBottom < grid.height - 92);
  }
});

test("download filenames discard path separators, control characters and punctuation", () => {
  const filename = basketImageFilename('../../"Growth & Income"\u0000');
  assert.equal(filename, "basalt-growth-income.png");
  assert.match(filename, /^basalt-[a-z0-9-]+\.png$/);
  assert.ok(!filename.includes(".."));
});

test("download filenames normalize accents, bound length and handle non-Latin names", () => {
  assert.equal(basketImageFilename("Café Déjà Vu"), "basalt-cafe-deja-vu.png");
  assert.equal(basketImageFilename("投資 🚀"), "basalt-stock-basket.png");
  const long = basketImageFilename("A".repeat(200));
  assert.ok(long.length <= "basalt-".length + 64 + ".png".length);
  assert.match(long, /^basalt-[a-z0-9-]+\.png$/);
});


test("stack heights reflect actual weights including a tiny allocation", () => {
  const stacks = basketImageStacks([{ weightBps: 9999 }, { weightBps: 1 }]);
  assert.equal(stacks[0].height, 242);
  assert.ok(Math.abs(stacks[1].height / stacks[0].height - 1 / 9999) < 1e-16);
  for (const stack of stacks) {
    assert.ok(stack.width > 0 && stack.height > 0);
    assert.ok(stack.left >= 1010 && stack.left + stack.width <= 1485);
  }
});

test("small baskets retain order, centered columns and source indices for exact logos", () => {
  const assets = [2000, 5000, 3000].map((weightBps, index) => ({ weightBps, mint: `mint-${index}` }));
  const stacks = basketImageStacks(assets);
  assert.deepEqual(stacks.map(({ asset }) => asset), assets);
  assert.deepEqual(stacks.map(({ index }) => index), [0, 1, 2]);
  const firstCenter = stacks[0].left + stacks[0].width / 2;
  const lastCenter = stacks[2].left + stacks[2].width / 2;
  assert.equal((firstCenter + lastCenter) / 2, 1010 + 475 / 2);
});

test("large basket illustrations show six largest allocations without mutating the ledger", () => {
  const assets = Array.from({ length: 20 }, (_, index) => ({ weightBps: index + 1 }));
  const before = structuredClone(assets);
  const stacks = basketImageStacks(assets);
  assert.equal(stacks.length, 6);
  assert.deepEqual(stacks.map(({ index }) => index), [19, 18, 17, 16, 15, 14]);
  assert.deepEqual(assets, before);
  for (let index = 1; index < stacks.length; index++) assert.ok(stacks[index].left > stacks[index - 1].left + stacks[index - 1].width);
});
