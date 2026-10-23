// Draws the app icons so the home-screen install looks like an app.
// Usage: node tools/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const BG = [232, 168, 124];
const DARK = [74, 51, 42];
const LIGHT = [253, 246, 238];

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function png(width, height, pixels) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Unit-square shape tests, so one description scales to any icon size.
function inEllipse(x, y, cx, cy, rx, ry, degrees) {
  const t = (-degrees * Math.PI) / 180;
  const dx = x - cx;
  const dy = y - cy;
  const px = dx * Math.cos(t) - dy * Math.sin(t);
  const py = dx * Math.sin(t) + dy * Math.cos(t);
  return (px * px) / (rx * rx) + (py * py) / (ry * ry) <= 1;
}

function inCircle(x, y, cx, cy, r) {
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function inRoundedRect(x, y, inset, radius) {
  const lo = inset;
  const hi = 1 - inset;
  if (x < lo || x > hi || y < lo || y > hi) return false;
  const cx = Math.min(Math.max(x, lo + radius), hi - radius);
  const cy = Math.min(Math.max(y, lo + radius), hi - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius;
}

function sample(x, y, bleed) {
  // Background plate: full bleed for maskable icons, rounded for the rest.
  const onPlate = bleed ? true : inRoundedRect(x, y, 0.02, 0.21);
  if (!onPlate) return null;

  const scale = bleed ? 0.66 : 0.78;
  const bx = 0.5 + (x - 0.5) / scale;
  const by = 0.54 + (y - 0.54) / scale;

  if (inCircle(bx, by, 0.425, 0.555, 0.036) || inCircle(bx, by, 0.575, 0.555, 0.036)) {
    return LIGHT;
  }
  if (
    inCircle(bx, by, 0.5, 0.61, 0.225) ||
    inEllipse(bx, by, 0.36, 0.26, 0.073, 0.18, -12) ||
    inEllipse(bx, by, 0.64, 0.26, 0.073, 0.18, 12)
  ) {
    return DARK;
  }
  return BG;
}

function render(size, bleed) {
  const pixels = Buffer.alloc(size * size * 4);
  const steps = 3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0, hits = 0;
      for (let sy = 0; sy < steps; sy++) {
        for (let sx = 0; sx < steps; sx++) {
          const colour = sample(
            (x + (sx + 0.5) / steps) / size,
            (y + (sy + 0.5) / steps) / size,
            bleed
          );
          hits++;
          if (colour) {
            r += colour[0];
            g += colour[1];
            b += colour[2];
            a += 255;
          }
        }
      }
      const i = (y * size + x) * 4;
      const opaque = a / 255;
      pixels[i] = opaque ? Math.round(r / opaque) : 0;
      pixels[i + 1] = opaque ? Math.round(g / opaque) : 0;
      pixels[i + 2] = opaque ? Math.round(b / opaque) : 0;
      pixels[i + 3] = Math.round(a / hits);
    }
  }
  return png(size, size, pixels);
}

for (const [name, size, bleed] of [
  ['icons/icon-180.png', 180, true],
  ['icons/icon-192.png', 192, false],
  ['icons/icon-512.png', 512, false],
  ['icons/icon-maskable-512.png', 512, true],
]) {
  writeFileSync(name, render(size, bleed));
  console.log(`wrote ${name}`);
}
