/**
 * Minimal PNG encoder for build-time poster/OG generation (RGB, 8-bit).
 * Uses node:zlib for the IDAT deflate; no external dependencies.
 */
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** rgb: length nx*ny*3, row-major, top row first. */
export function encodePNG(rgb: Uint8Array, nx: number, ny: number): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, nx);
  dv.setUint32(4, ny);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  const raw = new Uint8Array(ny * (nx * 3 + 1));
  for (let y = 0; y < ny; y++) {
    raw[y * (nx * 3 + 1)] = 0; // filter: none
    raw.set(rgb.subarray(y * nx * 3, (y + 1) * nx * 3), y * (nx * 3 + 1) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  const sig = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
