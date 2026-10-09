#!/usr/bin/env node
/**
 * Generate a build-time allocation palette from the logos actually shown by Basalt.
 * Run from the repository: node scripts/generate-asset-logo-colors.mjs
 * Reuse downloaded source bytes with --offline; no runtime image analysis is needed.
 * Uses sharp already installed with Next.js, without adding a dependency.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
const sharp = require("sharp");
const cacheDir = process.env.ASSET_LOGO_CACHE_DIR || join(tmpdir(), "basalt-asset-logo-palette-v1");
const outputPath = join(root, "app/lib/data/asset-logo-colors.json");
const manifestPath = join(root, "docs/assets/logo-palette-2026-10-09/manifest.json");
const offline = process.argv.includes("--offline");
const MAX_BYTES = 2_000_000;
const MAX_PIXELS = 4_000_000;
const CONCURRENCY = 8;
const TIMEOUT_MS = 8_000;
const ALLOWED_HOSTS = new Set(["xstocks-metadata.backed.fi", "assets.parqet.com"]);
const TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"]);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hex = (rgb) => `#${rgb.map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
const rounded = (number) => Math.round(number * 10000) / 10000;

function safeUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname) || url.username || url.password || (url.port && url.port !== "443")) throw new Error("Logo URL is outside the allowlist");
  return url.toString();
}

function luminance(rgb) {
  const channels = rgb.map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

const darkLuminance = luminance([17, 17, 17]);
const contrast = (rgb) => (luminance(rgb) + 0.05) / (darkLuminance + 0.05);

/** A restrained white mix preserves hue while keeping dark logo colors visible. */
function visibleColor(rgb) {
  rgb = rgb.map((channel) => Math.round(channel));
  if (contrast(rgb) >= 3) return { rgb, amount: 0 };
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 24; iteration++) {
    const amount = (low + high) / 2;
    const candidate = rgb.map((channel) => channel + (255 - channel) * amount);
    if (contrast(candidate) < 3) low = amount;
    else high = amount;
  }
  return { rgb: rgb.map((channel) => Math.ceil(channel + (255 - channel) * high)), amount: rounded(high) };
}

function hue(red, green, blue, max, min) {
  const delta = max - min;
  if (!delta) return 0;
  let value = max === red ? (green - blue) / delta : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
  return (value * 60 + 360) % 360;
}

/**
 * Ignore transparent pixels. When real color is present, discard neutral paper,
 * white lettering and black facets. Select the largest 50-degree hue neighborhood
 * by alpha-weighted image area, then average its RGB pixels with alpha weights.
 * Faceted issuer logos keep their dominant brand hue rather than averaging all
 * hues into brown. Multicolor logos use their largest visible color family.
 */
export function extractColor(rgba) {
  const chromatic = [];
  const neutralSum = [0, 0, 0];
  let opaqueArea = 0;
  let chromaticArea = 0;
  for (let index = 0; index < rgba.length; index += 4) {
    const weight = rgba[index + 3] / 255;
    if (weight < 0.05) continue;
    const rgb = [rgba[index], rgba[index + 1], rgba[index + 2]];
    const max = Math.max(...rgb);
    const min = Math.min(...rgb);
    const saturation = max === 0 ? 0 : (max - min) / max;
    const lightness = (max + min) / 510;
    opaqueArea += weight;
    for (let channel = 0; channel < 3; channel++) neutralSum[channel] += rgb[channel] * weight;
    if (saturation >= 0.18 && max >= 31 && lightness <= 0.92) {
      chromatic.push({ rgb, weight, hue: hue(...rgb, max, min) });
      chromaticArea += weight;
    }
  }
  if (opaqueArea === 0) throw new Error("Image has no visible pixels");
  let source = "neutral";
  let selectedArea = opaqueArea;
  let mean = neutralSum.map((sum) => sum / opaqueArea);
  if (chromaticArea >= opaqueArea * 0.01) {
    let bestArea = -1;
    let bestSum = null;
    for (let center = 0; center < 360; center += 10) {
      let area = 0;
      const sum = [0, 0, 0];
      for (const pixel of chromatic) {
        const difference = Math.abs(pixel.hue - center);
        if (Math.min(difference, 360 - difference) > 25) continue;
        area += pixel.weight;
        for (let channel = 0; channel < 3; channel++) sum[channel] += pixel.rgb[channel] * pixel.weight;
      }
      if (area > bestArea) { bestArea = area; bestSum = sum; }
    }
    if (bestArea > 0) {
      mean = bestSum.map((sum) => sum / bestArea);
      selectedArea = bestArea;
      source = "dominant-hue";
    }
  }
  const dominantColor = hex(mean);
  const displayed = visibleColor(mean);
  return {
    color: hex(displayed.rgb), dominantColor, method: source,
    chromaticCoverage: rounded(chromaticArea / opaqueArea),
    selectedCoverage: rounded(selectedArea / opaqueArea),
    visibilityLift: displayed.amount,
  };
}

async function logoBytes(url) {
  const key = sha256(url);
  const bytesPath = join(cacheDir, `${key}.image`);
  const metadataPath = join(cacheDir, `${key}.json`);
  try {
    const bytes = await readFile(bytesPath);
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    if (metadata.url !== url || metadata.sha256 !== sha256(bytes) || bytes.length > MAX_BYTES) throw new Error("Invalid cached bytes");
    return { ...metadata, bytes };
  } catch (error) {
    if (offline) throw new Error("No verified source bitmap in offline cache");
  }
  const response = await fetch(url, { credentials: "omit", redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
  const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (!response.ok || !response.body || !TYPES.has(contentType) || Number(response.headers.get("content-length")) > MAX_BYTES) {
    await response.body?.cancel();
    throw new Error(`Unsupported logo response ${response.status} ${contentType ?? "missing type"}`);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) { await reader.cancel(); throw new Error("Logo exceeds byte limit"); }
    chunks.push(value);
  }
  if (!size) throw new Error("Empty logo response");
  const bytes = Buffer.concat(chunks);
  const metadata = { url, sha256: sha256(bytes), sourceRetrievedAt: new Date().toISOString(), contentType, bytes: size };
  await writeFile(bytesPath, bytes);
  await writeFile(metadataPath, JSON.stringify(metadata));
  return { ...metadata, bytes };
}

async function main() {
  const snapshotBytes = await readFile(join(root, "app/lib/data/xstocks.snapshot.json"));
  const snapshot = JSON.parse(snapshotBytes);
  const legacy = await readFile(join(root, "app/lib/concept-assets.ts"), "utf8");
  const legacySymbols = [...legacy.matchAll(/logoUrl\("([A-Z0-9.:-]+)"\)/g)].map((match) => match[1]);
  const legacyUrls = legacySymbols.map((symbol) => {
    const clean = symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    const bare = clean.length > 1 && clean.endsWith("X") ? clean.slice(0, -1) : clean;
    return `https://assets.parqet.com/logos/symbol/${bare}?fallback=transparent`;
  });
  const urls = [...new Set([...snapshot.data.map((asset) => asset.logoUrl).filter(Boolean), ...legacyUrls].map(safeUrl))].sort();
  await mkdir(cacheDir, { recursive: true });
  const results = new Map();
  const failures = [];
  let next = 0;
  let completed = 0;
  async function worker() {
    for (;;) {
      const index = next++;
      if (index >= urls.length) return;
      const url = urls[index];
      try {
        const source = await logoBytes(url);
        const { data, info } = await sharp(source.bytes, { limitInputPixels: MAX_PIXELS, failOn: "error" })
          .resize(96, 96, { fit: "inside", withoutEnlargement: true })
          .toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        if (info.channels !== 4) throw new Error("Expected RGBA pixels");
        results.set(url, { ...extractColor(data), sha256: source.sha256, sourceRetrievedAt: source.sourceRetrievedAt, contentType: source.contentType });
      } catch (error) {
        failures.push({ url, reason: error instanceof Error ? error.message : String(error) });
      }
      completed++;
      if (completed % 100 === 0 || completed === urls.length) console.log(`${completed}/${urls.length} logos processed (${failures.length} unavailable)`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    algorithm: "alpha-weighted dominant 50-degree hue neighborhood; neutral backgrounds excluded when chromatic coverage >=1%; RGB weighted mean; minimal white mix for contrast >=3 against #111111",
    algorithmVersion: 1,
    source: { snapshot: "app/lib/data/xstocks.snapshot.json", snapshotSha256: sha256(snapshotBytes), issuerAssets: snapshot.data.length, legacyAssets: legacySymbols.length, requestedUrls: urls.length },
    colors: Object.fromEntries([...results.entries()].sort(([a], [b]) => a.localeCompare(b))),
    failures: failures.sort((a, b) => a.url.localeCompare(b.url)),
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(Object.fromEntries(Object.entries(manifest.colors).map(([url, result]) => [url, result.color])), null, 2)}\n`);
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Saved ${results.size} colors to ${outputPath}`);
  console.log(`Source bytes retained at ${cacheDir}; use --offline to reproduce the color calculations.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
