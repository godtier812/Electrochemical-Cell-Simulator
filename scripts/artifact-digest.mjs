/**
 * Print `relative/path  sha256` for every file under a root, hashing PNGs by
 * their decoded pixels rather than their file bytes.
 *
 * The distinction matters. png.ts compresses IDAT with node:zlib, which is a
 * native library: different Node builds emit different compressed bytes for
 * identical input. Comparing files therefore reports a difference whenever the
 * Node version moves, even though every pixel is the same. Comparing decoded
 * pixels asks the question actually worth asking — did the image change — and
 * is stable across Node versions and platforms.
 *
 *   node scripts/artifact-digest.mjs <root>
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';

/**
 * The decoded pixels of an 8-bit, non-interlaced PNG: inflate the IDAT chunks,
 * then undo each scanline's filter. Unfiltering matters as much as inflating —
 * the encoder chooses a filter per row, and two encodings of the same image
 * that chose differently must still hash the same.
 */
function pngPixels(buf) {
  let off = 8; // skip the signature
  const parts = [];
  let width = 0;
  let height = 0;
  let bpp = 0;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'IHDR') {
      width = buf.readUInt32BE(off + 8);
      height = buf.readUInt32BE(off + 12);
      const depth = buf[off + 16];
      const colour = buf[off + 17];
      const interlace = buf[off + 20];
      const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colour];
      if (depth !== 8 || !channels || interlace !== 0) {
        throw new Error(`unsupported PNG: depth ${depth}, colour type ${colour}, interlace ${interlace}`);
      }
      bpp = channels;
    }
    if (type === 'IDAT') parts.push(buf.subarray(off + 8, off + 8 + len));
    if (type === 'IEND') break;
    off += 12 + len;
  }
  if (parts.length === 0 || !bpp) throw new Error('no IHDR or IDAT');
  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * bpp;
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? px[dst + i - bpp] : 0;
      const b = y > 0 ? px[dst - stride + i] : 0;
      const c = y > 0 && i >= bpp ? px[dst - stride + i - bpp] : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = b;
      else if (filter === 3) pred = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`bad filter ${filter} on row ${y}`);
      px[dst + i] = (raw[src + i] + pred) & 0xff;
    }
  }
  return px;
}

function* walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    if (name === '.DS_Store') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

const root = process.argv[2];
if (!root) {
  console.error('usage: node scripts/artifact-digest.mjs <root>');
  process.exit(2);
}

for (const file of walk(root)) {
  const buf = readFileSync(file);
  let payload = buf;
  if (file.endsWith('.png')) {
    try {
      payload = pngPixels(buf);
    } catch {
      // Not a PNG we can parse; fall back to raw bytes rather than skipping it,
      // so a corrupt or unexpected file still shows up as a difference.
      payload = buf;
    }
  }
  const rel = relative(root, file).split(sep).join('/');
  console.log(`${rel}  ${createHash('sha256').update(payload).digest('hex')}`);
}
