/** Minimal complex arithmetic on {re, im} pairs. */

export interface C {
  re: number;
  im: number;
}

export const c = (re: number, im = 0): C => ({ re, im });

export const cadd = (a: C, b: C): C => c(a.re + b.re, a.im + b.im);

export const cmul = (a: C, b: C): C => c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);

export function cdiv(a: C, b: C): C {
  const d = b.re * b.re + b.im * b.im;
  return c((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
}

export const cinv = (a: C): C => cdiv(c(1), a);

export const cabs = (a: C): number => Math.hypot(a.re, a.im);

/** Principal square root. */
export function csqrt(a: C): C {
  const r = cabs(a);
  const re = Math.sqrt((r + a.re) / 2);
  const im = Math.sign(a.im || 1) * Math.sqrt(Math.max(0, (r - a.re) / 2));
  return c(re, im);
}

/** tanh(z) = (sinh 2x + i sin 2y) / (cosh 2x + cos 2y), overflow-safe. */
export function ctanh(a: C): C {
  const x = a.re;
  const y = a.im;
  if (Math.abs(x) > 20) return c(Math.sign(x), 0);
  const d = Math.cosh(2 * x) + Math.cos(2 * y);
  return c(Math.sinh(2 * x) / d, Math.sin(2 * y) / d);
}

/** tanh(√z)/√z — the finite-length Warburg kernel. */
export function tanhSqrtOverSqrt(z: C): C {
  const s = csqrt(z);
  if (cabs(s) < 1e-8) return c(1, 0); // limit z→0
  return cdiv(ctanh(s), s);
}
