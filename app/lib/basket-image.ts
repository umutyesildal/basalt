import { getBasketCover } from "@/lib/basket-covers";
import { allocationColor } from "@/lib/allocation-colors";
import { getConceptAsset, getConceptAssetName } from "@/lib/concept-assets";
import { validateConceptBasket, type ConceptBasket } from "@/lib/concept-basket";
import { getBasketSharePerformance } from "@/lib/basket-share-performance";
import type { BasketPerformanceResponse } from "@/lib/basket-performance";
import { formatBpsAsPercent, formatPercent } from "@/lib/format";
import { basketImageGrid, basketImageStacks, wrapImageText } from "./basket-image-layout";

// Fixed export colors are the canonical dark Basalt brand, independent of the
// viewer's theme. Canvas cannot inherit semantic CSS variables automatically.
const INK = "#0A0A0B", PAPER = "#F6F6F4", YELLOW = "#FCEE0A", MUTED = "#AAA9A3", RULE = "#303032";
const POSITIVE = "#50D69A", NEGATIVE = "#FF818A";
const WIDTH = 1600, PAD = 88;
type Asset = ConceptBasket["assets"][number];
type Fonts = { display: string; body: string; mono: string };

function fontFamilies(): Fonts {
  const style = getComputedStyle(document.documentElement);
  return {
    display: style.getPropertyValue("--font-display").trim() || "sans-serif",
    body: style.getPropertyValue("--font-sans").trim() || "sans-serif",
    mono: style.getPropertyValue("--font-mono").trim() || "monospace",
  };
}

async function loadLogo(asset: Asset): Promise<HTMLImageElement | null> {
  if (!getConceptAsset(asset.symbol, asset.mint)?.logoUrl) return null;
  const params = new URLSearchParams({ symbol: asset.symbol });
  if (asset.mint) params.set("mint", asset.mint);
  const url = `/api/basket-image/logo?${params}`;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5500);
  try {
    // Same-origin catalog-only logo endpoint avoids third-party CORS taint.
    // Unavailable marks fall back to ticker chips without blocking download.
    const response = await fetch(url, { mode: "cors", credentials: "omit", signal: controller.signal });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!blob.type.startsWith("image/") || blob.size > 2_000_000) return null;
    const imageUrl = URL.createObjectURL(blob);
    try {
      return await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        const decodeTimeout = window.setTimeout(() => { image.src = ""; reject(new Error("Logo timeout")); }, 2000);
        image.onload = () => { window.clearTimeout(decodeTimeout); resolve(image); };
        image.onerror = () => { window.clearTimeout(decodeTimeout); reject(new Error("Logo unavailable")); };
        image.src = imageUrl;
      });
    } finally { URL.revokeObjectURL(imageUrl); }
  } catch { return null; }
  finally { window.clearTimeout(timeout); }
}

function line(ctx: CanvasRenderingContext2D, x: number, y: number, end: number) {
  ctx.strokeStyle = RULE; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(end, y); ctx.stroke();
}

function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, font: string, color = PAPER) {
  ctx.font = font; ctx.fillStyle = color; ctx.textBaseline = "top"; ctx.fillText(value, x, y);
}

function fitText(ctx: CanvasRenderingContext2D, value: string, width: number) {
  if (ctx.measureText(value).width <= width) return value;
  const characters = Array.from(value);
  while (characters.length && ctx.measureText(characters.join("") + "…").width > width) characters.pop();
  return characters.join("") + "…";
}

function assetMark(ctx: CanvasRenderingContext2D, asset: Asset, bitmap: HTMLImageElement | null, x: number, y: number, size: number, fonts: Fonts) {
  ctx.save(); ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = bitmap ? PAPER : allocationColor(asset.symbol, asset.mint); ctx.fillRect(x, y, size, size);
  if (bitmap) ctx.drawImage(bitmap, x, y, size, size);
  else {
    ctx.textAlign = "center";
    text(ctx, asset.symbol.slice(0, 2), x + size / 2, y + size * .27, `600 ${size * .35}px ${fonts.mono}`, INK);
  }
  ctx.restore();
}

function drawBrand(ctx: CanvasRenderingContext2D, fonts: Fonts) {
  ctx.save(); ctx.translate(PAD - 6, 66); ctx.scale(2.6, 2.6);
  ctx.strokeStyle = YELLOW; ctx.lineWidth = 1.7; ctx.lineJoin = "miter";
  for (const path of ["M4.3 3.7 L6.5 2.5 L8.7 3.7 L8.7 21.5 L4.3 21.5 Z", "M9.8 10.7 L12 9.5 L14.2 10.7 L14.2 21.5 L9.8 21.5 Z", "M15.3 15.7 L17.5 14.5 L19.7 15.7 L19.7 21.5 L15.3 21.5 Z"]) ctx.stroke(new Path2D(path));
  ctx.restore();
  text(ctx, "B", PAD + 68, 65, `600 54px ${fonts.display}`, YELLOW);
  const bWidth = ctx.measureText("B").width;
  text(ctx, "asalt", PAD + 68 + bWidth, 65, `600 54px ${fonts.display}`);
  ctx.textAlign = "right";
  text(ctx, "STOCK BASKET", WIDTH - PAD - 124, 86, `400 18px ${fonts.mono}`, MUTED);
  ctx.textAlign = "left";
  line(ctx, PAD, 156, WIDTH - PAD);
}

function polygon(ctx: CanvasRenderingContext2D, points: number[][], color: string, opacity = 1) {
  ctx.save(); ctx.globalAlpha = opacity; ctx.fillStyle = color;
  ctx.beginPath(); points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath(); ctx.fill(); ctx.restore();
}

function drawSculpture(ctx: CanvasRenderingContext2D, assets: Asset[], logos: (HTMLImageElement | null)[], fonts: Fonts) {
  const stacks = basketImageStacks(assets);
  for (const { asset, index, left: x, width, height, facet, baseline } of stacks) {
    const top = baseline - height, half = width / 2;
    const color = allocationColor(asset.symbol, asset.mint);
    // Both sides share the same vertical extent, including very small weights.
    polygon(ctx, [[x, top], [x + half, top + facet], [x + half, baseline + facet], [x, baseline]], color, .9);
    polygon(ctx, [[x + half, top + facet], [x + width, top], [x + width, baseline], [x + half, baseline + facet]], color, .64);
    polygon(ctx, [[x, top], [x + half, top - facet], [x + width, top], [x + half, top + facet]], color);
    ctx.save(); ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.globalAlpha = .65;
    for (let y = top + 38; y < baseline - 1; y += 38) {
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + half, y + facet); ctx.lineTo(x + width, y); ctx.stroke();
    }
    ctx.restore();
    const size = Math.min(48, width - 12);
    assetMark(ctx, asset, logos[index], x + (width - size) / 2, top - facet - size - 20, size, fonts);

  }
}

async function loadCover(coverId?: string): Promise<HTMLImageElement> {
  const cover = getBasketCover(coverId);
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timeout = window.setTimeout(() => { image.src = ""; reject(new Error("Cover unavailable")); }, 6000);
    image.onload = () => { window.clearTimeout(timeout); resolve(image); };
    image.onerror = () => { window.clearTimeout(timeout); reject(new Error("Cover unavailable")); };
    image.src = cover.src;
  });
}

/** A designed share poster, drawn directly from validated basket data. */
export async function createBasketImage(input: ConceptBasket, performanceData: BasketPerformanceResponse | null = null): Promise<Blob> {
  const validation = validateConceptBasket(input);
  if (!validation.ok) throw new Error("This basket cannot be turned into an image.");
  const basket = validation.value;
  const performance = getBasketSharePerformance(basket, performanceData);
  const fonts = fontFamilies();
  await Promise.all([document.fonts.load(`600 80px ${fonts.display}`), document.fonts.load(`400 30px ${fonts.body}`), document.fonts.load(`500 24px ${fonts.mono}`)]);
  await document.fonts.ready;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser could not create the image. Try another browser.");
  let titleSize = 84;
  ctx.font = `600 ${titleSize}px ${fonts.display}`;
  let titleLines = wrapImageText(basket.name, 820, (value) => ctx.measureText(value).width);
  while (titleLines.length > 3 && titleSize > 56) {
    titleSize -= 4; ctx.font = `600 ${titleSize}px ${fonts.display}`;
    titleLines = wrapImageText(basket.name, 820, (value) => ctx.measureText(value).width);
  }
  const titleBottom = 228 + titleLines.length * (titleSize + 10);
  ctx.font = `400 30px ${fonts.body}`;
  const thesisLines = wrapImageText(basket.thesis, 790, (value) => ctx.measureText(value).width);
  const thesisTop = titleBottom + 30;
  const contentBottom = thesisLines.length ? thesisTop + thesisLines.length * 44 : titleBottom;
  const performanceTop = contentBottom + 36;
  const grid = basketImageGrid(basket.assets.length, performance ? performanceTop + 94 : contentBottom);
  canvas.width = WIDTH; canvas.height = grid.height;
  ctx.fillStyle = INK; ctx.fillRect(0, 0, WIDTH, grid.height);
  drawBrand(ctx, fonts);
  text(ctx, "A POINT OF VIEW, IN ONE BASKET.", PAD, 195, `400 17px ${fonts.mono}`, YELLOW);
  titleLines.forEach((value, index) => text(ctx, value, PAD, 238 + index * (titleSize + 10), `600 ${titleSize}px ${fonts.display}`));
  thesisLines.forEach((value, index) => text(ctx, value, PAD, thesisTop + index * 44, `400 30px ${fonts.body}`, MUTED));
  if (performance) {
    text(ctx, "7D", PAD, performanceTop + 9, `500 24px ${fonts.mono}`, MUTED);
    text(ctx, formatPercent(performance.return7dPct, { signed: true }), PAD + 68, performanceTop, `600 46px ${fonts.mono}`, performance.return7dPct > 0 ? POSITIVE : performance.return7dPct < 0 ? NEGATIVE : PAPER);

  }

  const [cover, bitmaps] = await Promise.all([loadCover(basket.coverId), Promise.all(basket.assets.map(loadLogo))]);
  try {
    ctx.drawImage(cover, WIDTH - PAD - 96, 38, 96, 96);
    drawSculpture(ctx, basket.assets, bitmaps, fonts);
    line(ctx, PAD, grid.top - 54, WIDTH - PAD);
    text(ctx, `${basket.assets.length} HOLDINGS`, PAD, grid.top - 36, `400 17px ${fonts.mono}`, MUTED);
    const gap = 48, cellWidth = (WIDTH - PAD * 2 - gap * (grid.columns - 1)) / grid.columns;
    basket.assets.forEach((asset, index) => {
      const col = index % grid.columns, row = Math.floor(index / grid.columns);
      const x = PAD + col * (cellWidth + gap), y = grid.top + row * grid.rowHeight;
      const color = allocationColor(asset.symbol, asset.mint);
      ctx.fillStyle = color; ctx.fillRect(x, y + 7, 3, 54);
      assetMark(ctx, asset, bitmaps[index], x + 18, y + 12, 42, fonts);
      ctx.font = `500 23px ${fonts.body}`;
      text(ctx, fitText(ctx, getConceptAssetName(asset.symbol, asset.mint), cellWidth - 196), x + 78, y + 8, `500 23px ${fonts.body}`);
      ctx.font = `400 17px ${fonts.mono}`;
      text(ctx, fitText(ctx, asset.symbol, cellWidth - 196), x + 78, y + 42, `400 17px ${fonts.mono}`, MUTED);
      ctx.textAlign = "right";
      text(ctx, formatBpsAsPercent(asset.weightBps), x + cellWidth, y + 24, `500 24px ${fonts.mono}`);
      ctx.textAlign = "left";
      line(ctx, x, y + 81, x + cellWidth);
    });
    // The ledger already shows all weights. Keep the footer quiet.
    line(ctx, PAD, grid.height - 92, WIDTH - PAD);
    ctx.textAlign = "right";
    text(ctx, "basalt.markets", WIDTH - PAD, grid.height - 60, `400 18px ${fonts.mono}`, MUTED);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Couldn't save the image. Please try again.")), "image/png"));
  } finally { cover.src = ""; bitmaps.forEach((bitmap) => { if (bitmap) bitmap.src = ""; }); }
}
