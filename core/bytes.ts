/**
 * The struct/find layer every other core module sits on.
 *
 * Two guarantees this code leans on and JavaScript does not give for free: a
 * read past the end raises instead of yielding NaN, and a write is checked
 * against the field's width. Without them an off-by-one in a header offset
 * surfaces as a corrupt image many stages later.
 *
 * Byte strings are Uint8Array throughout. latin1 is the one text codec that
 * belongs here -- the transparent byte<->char mapping for eyeballing raw data;
 * CP866, the game's actual encoding, lives with the patcher.
 */

const check = (b: Uint8Array, off: number, width: number): void => {
  if (!Number.isInteger(off) || off < 0 || off + width > b.length) {
    throw new RangeError(`offset ${off} (${width} bytes) outside 0..${b.length}`);
  }
};

const fits = (v: number, width: number): void => {
  const max = width === 1 ? 0xff : width === 2 ? 0xffff : width === 3 ? 0xffffff : 0xffffffff;
  if (!Number.isInteger(v) || v < 0 || v > max) {
    throw new RangeError(`${v} does not fit in ${width} unsigned byte(s)`);
  }
};

export const u8 = (b: Uint8Array, off: number): number => {
  check(b, off, 1);
  return b[off];
};

export const u16 = (b: Uint8Array, off: number): number => {
  check(b, off, 2);
  return b[off] | (b[off + 1] << 8);
};

export const u24 = (b: Uint8Array, off: number): number => {
  check(b, off, 3);
  return b[off] | (b[off + 1] << 8) | (b[off + 2] << 16);
};

export const u32 = (b: Uint8Array, off: number): number => {
  check(b, off, 4);
  return (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0;
};

export const u16be = (b: Uint8Array, off: number): number => {
  check(b, off, 2);
  return (b[off] << 8) | b[off + 1];
};

export const u32be = (b: Uint8Array, off: number): number => {
  check(b, off, 4);
  return ((b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3]) >>> 0;
};

/** A run of little-endian u16s: the MZ header and the EXEPACK trailer are read that way. */
export const u16s = (b: Uint8Array, off: number, n: number): number[] => {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(u16(b, off + i * 2));
  return out;
};

export const setU8 = (b: Uint8Array, off: number, v: number): void => {
  check(b, off, 1);
  fits(v, 1);
  b[off] = v;
};

export const setU16 = (b: Uint8Array, off: number, v: number): void => {
  check(b, off, 2);
  fits(v, 2);
  b[off] = v & 0xff;
  b[off + 1] = v >>> 8;
};

export const setU24 = (b: Uint8Array, off: number, v: number): void => {
  check(b, off, 3);
  fits(v, 3);
  b[off] = v & 0xff;
  b[off + 1] = (v >>> 8) & 0xff;
  b[off + 2] = (v >>> 16) & 0xff;
};

export const setU32 = (b: Uint8Array, off: number, v: number): void => {
  check(b, off, 4);
  fits(v, 4);
  b[off] = v & 0xff;
  b[off + 1] = (v >>> 8) & 0xff;
  b[off + 2] = (v >>> 16) & 0xff;
  b[off + 3] = (v >>> 24) & 0xff;
};

export const setU32be = (b: Uint8Array, off: number, v: number): void => {
  check(b, off, 4);
  fits(v, 4);
  b[off] = (v >>> 24) & 0xff;
  b[off + 1] = (v >>> 16) & 0xff;
  b[off + 2] = (v >>> 8) & 0xff;
  b[off + 3] = v & 0xff;
};

export const packU16 = (v: number): Uint8Array => {
  const b = new Uint8Array(2);
  setU16(b, 0, v);
  return b;
};

export const packU32 = (v: number): Uint8Array => {
  const b = new Uint8Array(4);
  setU32(b, 0, v);
  return b;
};

export const packU32be = (v: number): Uint8Array => {
  const b = new Uint8Array(4);
  setU32be(b, 0, v);
  return b;
};

/** First index of `needle` at or after `from`, or -1. */
export const find = (hay: Uint8Array, needle: Uint8Array, from = 0): number => {
  if (needle.length === 0) return Math.min(Math.max(from, 0), hay.length);
  const last = hay.length - needle.length;
  for (let i = Math.max(from, 0); i <= last; i++) {
    let j = 0;
    while (j < needle.length && hay[i + j] === needle[j]) j++;
    if (j === needle.length) return i;
  }
  return -1;
};

export const findByte = (hay: Uint8Array, byte: number, from = 0): number =>
  hay.indexOf(byte, from);

/** Every index at which `needle` occurs, overlaps included. */
export const findAll = (hay: Uint8Array, needle: Uint8Array, from = 0): number[] => {
  const hits: number[] = [];
  for (let i = find(hay, needle, from); i !== -1; i = find(hay, needle, i + 1)) hits.push(i);
  return hits;
};

/** The NUL-terminated string at `off`; throws when the run is unterminated. */
export const cstring = (b: Uint8Array, off: number): Uint8Array => {
  const end = findByte(b, 0, off);
  if (end === -1) throw new RangeError(`no NUL after offset ${off}`);
  return b.subarray(off, end);
};

export const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

export const equal = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

export const latin1 = (b: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
};

export const fromLatin1 = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 0xff) throw new RangeError(`U+${c.toString(16).toUpperCase()} is not a latin1 char`);
    out[i] = c;
  }
  return out;
};

export const hex = (b: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
};
