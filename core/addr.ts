/**
 * Three coordinate systems are in play:
 *
 *     file offset    what a hex editor shows    (image offset + the header)
 *     image offset   position within the loaded program image
 *     Ghidra linear  what Ghidra shows          (image offset + the image base)
 *
 * so file = linear - 0xE000.
 */

const HEADER = 0x2000; // DOS header size of KBU2.EXE (e_cparhdr * 16)
const BASE = 0x10000; // Ghidra's image base for this program
const SKEW = BASE - HEADER;

export interface Address {
  file: number;
  image: number;
  linear: number;
  seg: number;
  off: number;
}

/**
 * `seg` expresses the result in a chosen segment; the default is the paragraph it sits in.
 */
export const fromFile = (file: number, seg?: number): Address => {
  const linear = file + SKEW;
  const base = seg ?? linear >>> 4;
  const off = linear - base * 16;
  if (off < 0 || off > 0xffff) {
    throw new RangeError(
      `offset 0x${off.toString(16)} is out of range for segment ${base.toString(16)}`,
    );
  }
  return { file, image: file - HEADER, linear, seg: base, off };
};

export const fromSegOff = (seg: number, off: number): Address =>
  fromFile(seg * 16 + off - SKEW, seg);
