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

/** Concatenate and inflate the IDAT chunks of a PNG: the raw filtered scanlines. */
function pngPixels(buf) {
  let off = 8; // skip the signature
  const parts = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') parts.push(buf.subarray(off + 8, off + 8 + len));
    if (type === 'IEND') break;
    off += 12 + len;
  }
  if (parts.length === 0) throw new Error('no IDAT');
  return inflateSync(Buffer.concat(parts));
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
