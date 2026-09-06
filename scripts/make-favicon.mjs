/**
 * Generates app/favicon.ico from the Delta mark.
 *
 * The mark is rasterised here rather than pulled through an image library so
 * the icon can be regenerated from source with no extra dependencies. Shapes
 * are drawn with signed-distance fields, which gives clean antialiasing at the
 * small sizes a favicon actually renders at.
 *
 * Run: node scripts/make-favicon.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

/* ----------------------------- the mark, in 64x64 space ------------------- */

const TRIANGLE = [
  [32, 11],
  [55, 52],
  [9, 52],
];
const STROKE_HALF = 3.75;

const BARS = [
  { x: 19.5, y: 40, w: 6, h: 8, r: 3 },
  { x: 29, y: 33.5, w: 6, h: 14.5, r: 3 },
  { x: 38.5, y: 27, w: 6, h: 21, r: 3 },
];

/** Gradient stops, sampled along the top-left → bottom-right diagonal. */
const STOPS = [
  { at: 0, rgb: [0x3b, 0x5b, 0xf5] },
  { at: 0.45, rgb: [0x2a, 0xa9, 0xc4] },
  { at: 1, rgb: [0x4f, 0xe0, 0x8a] },
];

function gradientAt(t) {
  const clamped = Math.min(1, Math.max(0, t));
  for (let i = 1; i < STOPS.length; i++) {
    const a = STOPS[i - 1];
    const b = STOPS[i];
    if (clamped <= b.at) {
      const local = (clamped - a.at) / (b.at - a.at);
      return a.rgb.map((c, k) => Math.round(c + (b.rgb[k] - c) * local));
    }
  }
  return STOPS[STOPS.length - 1].rgb;
}

/** Distance from a point to a line segment. */
function distanceToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby)));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

/** Signed distance to a rounded rectangle: negative inside. */
function distanceToRoundedRect(px, py, { x, y, w, h, r }) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const dx = Math.abs(px - cx) - (w / 2 - r);
  const dy = Math.abs(py - cy) - (h / 2 - r);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - r;
}

/** Coverage of the mark at a point, 0..1, in 64-space. */
function coverage(px, py, aa) {
  // The delta, drawn as a ribbon with round joins.
  let ribbon = Infinity;
  for (let i = 0; i < 3; i++) {
    const [ax, ay] = TRIANGLE[i];
    const [bx, by] = TRIANGLE[(i + 1) % 3];
    ribbon = Math.min(ribbon, distanceToSegment(px, py, ax, ay, bx, by));
  }
  let alpha = Math.min(1, Math.max(0, (STROKE_HALF - ribbon) / aa + 0.5));

  // The three rising bars.
  for (const bar of BARS) {
    const d = distanceToRoundedRect(px, py, bar);
    alpha = Math.max(alpha, Math.min(1, Math.max(0, -d / aa + 0.5)));
  }

  return alpha;
}

/* ------------------------------- rasterising ------------------------------ */

function renderRGBA(size) {
  const scale = 64 / size;
  // Antialiasing width in 64-space: roughly one output pixel.
  const aa = scale;
  const out = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = (x + 0.5) * scale;
      const py = (y + 0.5) * scale;

      const alpha = coverage(px, py, aa);
      const i = (y * size + x) * 4;
      if (alpha <= 0) continue;

      // Project onto the diagonal the gradient runs along.
      const t = (px - 10 + (py - 10)) / (2 * 46);
      const [r, g, b] = gradientAt(t);

      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = Math.round(alpha * 255);
    }
  }

  return out;
}

/* -------------------------------- PNG / ICO ------------------------------- */

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePNG(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Raw scanlines, each prefixed with filter type 0.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function encodeICO(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // icon
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = 6 + images.length * 16;

  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0; // palette
    entry[3] = 0;
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bpp
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }

  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

/* ---------------------------------- run ----------------------------------- */

const sizes = [16, 32, 48, 64];
const images = sizes.map((size) => ({ size, png: encodePNG(renderRGBA(size), size) }));
const ico = encodeICO(images);

writeFileSync('app/favicon.ico', ico);
console.log(`app/favicon.ico written — ${sizes.join(', ')}px, ${ico.length} bytes`);
