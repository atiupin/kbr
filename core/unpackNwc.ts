/**
 * Strips the outer NWC packer: the shipped KB.EXE -> a plain EXEPACKed image.
 *
 * KB.EXE = [ 1177-byte NWC stub ][ inner MZ header ][ LZW stream ]
 *
 * At runtime the stub reopens its own file, seeks past itself, reads the inner
 * EXE's MZ header, then streams the payload in 8 KB chunks and LZW-expands it
 * into memory (`int 21h/AH=3Fh` in a refill routine -- hence "disk-streaming
 * packer"). The compression is the same codec as the .CC archives, so lzw.ts
 * decodes it unchanged; the only real work here is locating the stream and
 * rebuilding a loadable EXE around it.
 *
 * Stub layout, offsets into the stub image (file offset minus the outer header
 * size), read straight out of the disassembly:
 *
 *     +0x4b   uint16  file offset of the inner MZ header (0x699 in our copy:
 *                     exactly the outer header 0x200 + the 1177-byte stub)
 *     +0x4d   asciiz  "KB.EXE" -- the fallback name it reopens when the DOS
 *                     version is too old for the PSP environment path
 *
 * The inner MZ header is an ordinary DOS header; the stub takes CS:IP, SS:SP and
 * the memory sizing from it, and its e_lfarlc/e_crlc describe a relocation table
 * of its own. In our copy e_crlc is 0 (the EXEPACK stub self-relocates, which is
 * why the output also declares 0 relocations), so no fixups are applied. A copy
 * with a nonzero count would need them applied before the image is meaningful --
 * that is refused rather than silently mishandled.
 */

import { concat, setU16s, u16, u16s } from "./bytes.ts";
import { lzwDecode } from "./lzw.ts";
import { sha256 } from "./sha256.ts";

/** Stub offset holding the inner header's file offset. */
const BASE_PTR = 0x4b;

/**
 * The image the copy this project was reversed against expands to. A mismatch
 * is not fatal here -- the KBU2 hash gate is the real check -- but it is worth
 * saying loudly, because every offset in patches.csv assumes this exact build of
 * the game.
 */
const KNOWN_IMAGE_SHA256 = "06ca56b4d1ca737b050178cd394cc9e52e9879c860dcf51c45ff457cc5236c4a";

const MZ_MAGIC = 0x5a4d;

/** The 14 standard MZ header words at `off`: e_magic..e_ovno. */
const mzFields = (data: Uint8Array, off: number): number[] => {
  if (u16(data, off) !== MZ_MAGIC) throw new Error(`no MZ signature at 0x${off.toString(16)}`);
  return u16s(data, off, 14);
};

export interface NwcResult {
  image: Uint8Array;
  warnings: string[];
}

export const unpackNwc = (kbExe: Uint8Array): NwcResult => {
  const outerCparhdr = mzFields(kbExe, 0)[4];
  const base = u16(kbExe, outerCparhdr * 16 + BASE_PTR);

  const [, cblp, cp, crlc, cparhdr, minalloc, maxalloc, ss, sp, , ip, cs] = mzFields(kbExe, base);
  if (crlc !== 0) {
    throw new Error(
      `inner EXE declares ${crlc} relocations; this unpacker only handles the ` +
        `relocation-free layout of the copy it was written for`,
    );
  }

  const imgLen = (cp - 1) * 512 + cblp - cparhdr * 16;
  const image = lzwDecode(kbExe.subarray(base + cparhdr * 16), imgLen);
  if (image.length !== imgLen) {
    throw new Error(`LZW stream ended early: ${image.length} of ${imgLen} bytes`);
  }

  const digest = sha256(image);
  const warnings =
    digest === KNOWN_IMAGE_SHA256
      ? []
      : [
          `unpacked image hash ${digest} differs from the known-good copy -- ` +
            `patches.csv offsets assume that build, and the patcher will refuse a mismatch`,
        ];

  // A 2-paragraph (32-byte) header, the layout unpackExepack expects. No
  // relocations (crlc was verified 0 above), entry and stack from the inner
  // header.
  const total = 32 + image.length;
  const hdr = new Uint8Array(32);
  // prettier-ignore
  setU16s(hdr, 0, [MZ_MAGIC, total % 512, Math.ceil(total / 512), 0, 2,
                   minalloc, maxalloc, ss, sp, 0, ip, cs, 0x1c, 0]);
  return { image: concat([hdr, image]), warnings };
};
