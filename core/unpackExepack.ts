/**
 * Strips EXEPACK, rebuilding the relocation table: the result is the edit base.
 * Flat and uncompressed, every string at a fixed offset, editable in place.
 *
 * The packer stub is identified by the signature "RB" at its CS:0x10, and by its
 * error string "Packed file is corrupt". Its 18-byte header at CS:0000 holds the
 * real entry CS:IP, SS:SP and the decompressed length.
 *
 * Decompression reads records BACKWARD from stub CS:0000, expanding the image
 * upward in place. Any trailing 0xFF padding is skipped first, then each record
 * is
 *     [cmd][len_hi][len_lo]
 * with `cmd & 0xFE` selecting the operation -- 0xB0 = fill (one fill byte
 * follows below the record), 0xB2 = copy a literal run -- and `cmd & 1` marking
 * the last record.
 *
 * EXEPACK self-relocates at runtime from its own table, which is why the input
 * runs at any load address despite declaring 0 relocations in its DOS header.
 * That table sits right after the "Packed file is corrupt" string as 16
 * sections, each a uint16 count followed by that many uint16 offsets; section i
 * contributes segment base i*0x1000. It is decoded here and written out as a
 * real DOS relocation table, which is what makes the output an ordinary loadable
 * EXE.
 */

import { concat, equal, find, fromLatin1, setU16s, u16, u16s } from "./bytes.ts";

/**
 * Image offset of the packer stub's CS:0000, where the EXEPACK header sits: the
 * stub's entry is CS:IP = 1935:0012, IP 0x12 being just past that 18-byte header.
 */
const STUB = 0x19350;

const CORRUPT_MSG = "Packed file is corrupt";

export const unpackExepack = (packed: Uint8Array): Uint8Array => {
  // The load image exactly as the DOS header declares it, never the file size:
  // the declared length is what DOS would load, and what the EXEPACK offsets
  // below assume. Any tail past it is not part of the image.
  const [cblp, cp, , cparhdr] = u16s(packed, 2, 4);
  const img = packed.subarray(cparhdr * 16, (cp - 1) * 512 + cblp);

  const [realIp, realCs, , , realSp, realSs, destLen] = u16s(img, STUB, 8);
  if (!equal(img.subarray(STUB + 16, STUB + 18), fromLatin1("RB"))) {
    throw new Error(`EXEPACK 'RB' signature not found at 0x${(STUB + 16).toString(16)}`);
  }

  // Packed bytes live low and expand in place upward.
  const dest = new Uint8Array(destLen * 16);
  dest.set(img.subarray(0, STUB));
  let src = STUB;
  while (src > 0 && img[src - 1] === 0xff) src--; // 0xFF padding before the first record
  let dst = dest.length;
  for (;;) {
    const cmd = img[src - 1];
    const length = img[src - 3] | (img[src - 2] << 8);
    src -= 3;
    if ((cmd & 0xfe) === 0xb0) {
      const fill = img[src - 1];
      src -= 1;
      dest.fill(fill, dst - length, dst);
      dst -= length;
    } else if ((cmd & 0xfe) === 0xb2) {
      dest.copyWithin(dst - length, src - length, src);
      src -= length;
      dst -= length;
    } else {
      throw new Error(`bad EXEPACK opcode 0x${cmd.toString(16).padStart(2, "0")}`);
    }
    if (cmd & 1) break; // low bit set = last record
  }

  const msg = find(img, fromLatin1(CORRUPT_MSG));
  if (msg === -1) throw new Error(`"${CORRUPT_MSG}" not found; no EXEPACK relocation table`);
  let p = msg + CORRUPT_MSG.length;
  const relocs: { seg: number; off: number }[] = [];
  for (let section = 0; section < 16; section++) {
    const count = u16(img, p);
    p += 2;
    for (let i = 0; i < count; i++) {
      relocs.push({ seg: section * 0x1000, off: u16(img, p) });
      p += 2;
    }
  }

  const relocBytes = new Uint8Array(relocs.length * 4);
  relocs.forEach((r, i) => setU16s(relocBytes, i * 4, [r.off, r.seg]));
  const hdrSize = Math.ceil((0x1c + relocBytes.length) / 512) * 512;
  const total = hdrSize + dest.length;
  const minalloc = Math.max(0x200, Math.floor((realSs * 16 + realSp - dest.length) / 16) + 0x200);
  const hdr = new Uint8Array(hdrSize);
  // prettier-ignore
  setU16s(hdr, 0, [0x5a4d, total % 512, Math.ceil(total / 512), relocs.length, hdrSize / 16,
                   minalloc, 0xffff, realSs, realSp, 0, realIp, realCs, 0x1c, 0]);
  hdr.set(relocBytes, 0x1c);
  return concat([hdr, dest]);
};
