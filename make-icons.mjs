#!/usr/bin/env node
// make-icons.mjs
//
// Generates the PWA icons for Life Dashboard into public/.
//
// The project has no image tooling, so the mark is rasterised by hand:
// signed-distance fields for the rounded rect and the heatmap cells, and a
// small PNG encoder on top of node:zlib. Deterministic — same bytes every run.
//
//   node make-icons.mjs
//
// Output (all in public/):
//   icon-192.png, icon-512.png                  "any" purpose, rounded square
//   icon-192-maskable.png, icon-512-maskable.png full bleed, content in the
//                                              40% safe zone Android masks to

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(ROOT, 'public');

/* ---------- palette: mirrors the tokens in src/styles.css ---------- */
const BG = [0x08, 0x08, 0x08];
const SURFACE_3 = [0x16, 0x16, 0x16];
const HAIRLINE = [0x2c, 0x2c, 0x2c];
const JADE = [0x7e, 0xc8, 0xa3]; // --accent-habits
const CELL_EMPTY = [0x1c, 0x1c, 0x1c];

/* ---------- the habit heatmap: 7 days x 7 weeks, 5 intensity levels ---------- */
const LEVELS = [
  [0, 1, 0, 2, 1, 3, 2],
  [1, 2, 1, 3, 2, 4, 3],
  [0, 2, 3, 2, 4, 3, 4],
  [1, 3, 2, 4, 3, 2, 3],
  [2, 4, 3, 2, 3, 4, 2],
  [1, 2, 3, 4, 4, 3, 1],
  [2, 3, 4, 3, 2, 1, 0],
];

const LEVEL_ALPHA = [0, 0.3, 0.52, 0.74, 1];

const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Coverage from a signed distance: negative inside, positive outside.
// The 0.5 offset turns the distance into a one-pixel antialiased edge.
const coverage = (d) => clamp01(0.5 - d);

function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  return (
    Math.min(Math.max(qx, qy), 0) +
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) -
    r
  );
}

/* ---------- canvas ---------- */
// Straight (non-premultiplied) RGBA, 8 bits per channel.
function createCanvas(size) {
  return { size, data: new Float64Array(size * size * 4) };
}

function blend(canvas, x, y, rgb, alpha) {
  if (alpha <= 0) return;
  const i = (y * canvas.size + x) * 4;
  const d = canvas.data;
  const da = d[i + 3] / 255;
  const oa = alpha + da * (1 - alpha);
  if (oa <= 0) return;
  d[i] = (rgb[0] * alpha + d[i] * da * (1 - alpha)) / oa;
  d[i + 1] = (rgb[1] * alpha + d[i + 1] * da * (1 - alpha)) / oa;
  d[i + 2] = (rgb[2] * alpha + d[i + 2] * da * (1 - alpha)) / oa;
  d[i + 3] = oa * 255;
}

/* ---------- the mark ---------- */
function renderIcon(size, { maskable }) {
  const canvas = createCanvas(size);
  const S = size;

  // Background plate. Maskable icons are full bleed; "any" icons get the
  // rounded-square silhouette launchers expect.
  const plateRadius = maskable ? 0 : 0.22 * S;
  const plateHalf = S / 2;

  // Background wash: a soft radial gradient from --surface-3 down to --bg,
  // with a faint jade tint behind the brand area, matching the app header.
  const glowX = 0.5 * S;
  const glowY = 0.3 * S;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const d = sdRoundRect(px, py, plateHalf, plateHalf, plateHalf, plateHalf, plateRadius);
      const a = coverage(d);
      if (a <= 0) continue;

      const dist = Math.hypot(px - glowX, py - glowY);
      const base = mix(SURFACE_3, BG, clamp01(dist / (0.85 * S)));
      const glow = Math.pow(1 - clamp01(dist / (0.55 * S)), 2) * 0.1;
      blend(canvas, x, y, mix(base, JADE, glow), a);
    }
  }

  // Hairline edge on the "any" plate, so it reads as a tile in a launcher
  // that does not mask it.
  if (!maskable) {
    const inset = Math.max(1, S * 0.012);
    const r = plateRadius;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const outer = coverage(sdRoundRect(px, py, plateHalf, plateHalf, plateHalf, plateHalf, r));
        const inner = coverage(
          sdRoundRect(
            px,
            py,
            plateHalf,
            plateHalf,
            plateHalf - inset,
            plateHalf - inset,
            Math.max(0, r - inset),
          ),
        );
        const edge = outer - inner;
        if (edge > 0) blend(canvas, x, y, HAIRLINE, edge * 0.9);
      }
    }
  }

  // The heatmap grid. Maskable icons keep the content inside the 40% safe
  // zone (a circle of radius 0.4 * S) so no launcher mask can clip it.
  const gridWidth = maskable ? 0.52 * S : 0.66 * S;
  const gapRatio = 0.18;
  const cell = gridWidth / (7 + 6 * gapRatio);
  const gap = cell * gapRatio;
  const gridLeft = (S - gridWidth) / 2;
  const gridTop = (S - gridWidth) / 2;

  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 7; col++) {
      const level = LEVELS[row][col];
      const color =
        level === 0 ? CELL_EMPTY : mix(BG, JADE, LEVEL_ALPHA[level]);

      const cx = gridLeft + col * (cell + gap) + cell / 2;
      const cy = gridTop + row * (cell + gap) + cell / 2;
      const half = cell / 2;
      const radius = cell * 0.3;

      const x0 = Math.max(0, Math.floor(cx - half - 2));
      const x1 = Math.min(S - 1, Math.ceil(cx + half + 2));
      const y0 = Math.max(0, Math.floor(cy - half - 2));
      const y1 = Math.min(S - 1, Math.ceil(cy + half + 2));

      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const d = sdRoundRect(x + 0.5, y + 0.5, cx, cy, half, half, radius);
          const a = coverage(d);
          if (a > 0) blend(canvas, x, y, color, a);
        }
      }
    }
  }

  return canvas;
}

/* ---------- PNG encoder ---------- */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(canvas) {
  const { size, data } = canvas;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0 (None)
    for (let x = 0; x < stride; x++) {
      const v = data[y * stride + x];
      raw[y * (stride + 1) + 1 + x] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- main ---------- */
mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  { name: 'icon-192.png', size: 192, maskable: false },
  { name: 'icon-512.png', size: 512, maskable: false },
  { name: 'icon-192-maskable.png', size: 192, maskable: true },
  { name: 'icon-512-maskable.png', size: 512, maskable: true },
];

for (const target of targets) {
  const png = encodePng(renderIcon(target.size, { maskable: target.maskable }));
  writeFileSync(join(OUT_DIR, target.name), png);
  console.log(`wrote public/${target.name} (${target.size}x${target.size}, ${png.length} bytes)`);
}
