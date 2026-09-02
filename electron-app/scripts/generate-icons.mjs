// Generates the app's PNG icons (tray + window) from scratch using only Node's built-in
// zlib - no external image tooling or network fetch required. Re-run with
// `node scripts/generate-icons.mjs` after tweaking the palette/shapes below.

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, '..', 'assets');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

/** Encodes an RGBA byte array (width*height*4) into a PNG file buffer. */
function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type: RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type: None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idatData = deflateSync(raw);

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdrData),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

class Canvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = Buffer.alloc(width * height * 4); // starts fully transparent
  }

  setPixel(x, y, [r, g, b, a]) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    // Simple alpha-over blend so overlapping shapes anti-alias reasonably against transparent bg.
    const srcA = a / 255;
    const dstA = this.data[i + 3] / 255;
    const outA = srcA + dstA * (1 - srcA);
    if (outA <= 0) return;
    for (let c = 0; c < 3; c++) {
      const src = [r, g, b][c];
      const dst = this.data[i + c];
      this.data[i + c] = Math.round((src * srcA + dst * dstA * (1 - srcA)) / outA);
    }
    this.data[i + 3] = Math.round(outA * 255);
  }

  fillCircle(cx, cy, radius, color, edgeSoftness = 1) {
    const rSq = radius * radius;
    for (let y = Math.floor(cy - radius - 1); y <= cy + radius + 1; y++) {
      for (let x = Math.floor(cx - radius - 1); x <= cx + radius + 1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= radius) {
          const edgeAlpha = Math.min(1, (radius - dist) / edgeSoftness + 1);
          this.setPixel(x, y, [color[0], color[1], color[2], Math.round((color[3] ?? 255) * edgeAlpha)]);
        }
      }
    }
  }

  fillRoundedRect(x0, y0, w, h, radius, color) {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const dx = x < x0 + radius ? x0 + radius - x : x > x0 + w - radius ? x - (x0 + w - radius) : 0;
        const dy = y < y0 + radius ? y0 + radius - y : y > y0 + h - radius ? y - (y0 + h - radius) : 0;
        if (dx > 0 && dy > 0 && dx * dx + dy * dy > radius * radius) continue;
        this.setPixel(x, y, color);
      }
    }
  }

  toPng() {
    return encodePng(this.width, this.height, this.data);
  }
}

// --- Palette (matches the sweet-spot green from levelClassifier.js) ---
const BG = [18, 18, 20, 255];
const GREEN = [48, 209, 88, 255];
const WHITE = [245, 245, 247, 255];

function drawMicGlyph(canvas, size) {
  const cx = size / 2;
  const capsuleW = size * 0.26;
  const capsuleH = size * 0.4;
  const capsuleTop = size * 0.18;

  canvas.fillRoundedRect(
    Math.round(cx - capsuleW / 2),
    Math.round(capsuleTop),
    Math.round(capsuleW),
    Math.round(capsuleH),
    Math.round(capsuleW / 2),
    WHITE,
  );

  // Stand: a short vertical line + base, drawn as thin rounded rects.
  const standTop = capsuleTop + capsuleH - size * 0.02;
  const standH = size * 0.16;
  canvas.fillRoundedRect(Math.round(cx - size * 0.02), Math.round(standTop), Math.round(size * 0.04), Math.round(standH), Math.round(size * 0.02), WHITE);
  canvas.fillRoundedRect(Math.round(cx - size * 0.12), Math.round(standTop + standH - size * 0.02), Math.round(size * 0.24), Math.round(size * 0.04), Math.round(size * 0.02), WHITE);

  // Sweet-spot indicator dot, bottom-right - the whole point of the app in one glyph.
  canvas.fillCircle(size * 0.76, size * 0.76, size * 0.14, GREEN, 1.5);
}

function buildIcon(size) {
  const canvas = new Canvas(size, size);
  canvas.fillRoundedRect(0, 0, size, size, Math.round(size * 0.22), BG);
  drawMicGlyph(canvas, size);
  return canvas.toPng();
}

writeFileSync(path.join(ASSETS_DIR, 'tray-icon.png'), buildIcon(32));
writeFileSync(path.join(ASSETS_DIR, 'app-icon.png'), buildIcon(256));

console.log('Generated assets/tray-icon.png (32x32) and assets/app-icon.png (256x256).');
