/**
 * The NWC "CC" archive container: a u16 count, 8-byte TOC entries, then members
 * looked up by a hash of their filename rather than by index. Each member is a
 * u32 decoded length followed by an LZW stream, which lzw.ts owns.
 *
 *     [u16 count]
 *     count * 8:  [u16 id][u24 offset][u16 size][1 pad]
 *     member data, the first member right after the TOC at 2 + count*8
 *
 * The id is what the loader computes from the requested filename
 * (hash = rol16(hash, 1) + upper(ch) per char), so a member has no name here and
 * ids are the only handle on one.
 *
 * The PNG side of the font work is deliberately absent -- a browser already has
 * an image decoder, so it lives in the shell.
 */

import { concat, packU32, setU16, setU24, u16, u24, u32 } from "./bytes.ts";
import { decodeLzw, encodeLzw } from "./lzw.ts";

/**
 * The font member, byte-identical in both archives -- glyph bitmaps are display
 * mode independent, so the two builds differ only in what surrounds it.
 */
export const FONT_ID = 0x9bb2;

export interface TocEntry {
  id: number;
  offset: number;
  size: number;
}

export const readToc = (archive: Uint8Array): TocEntry[] => {
  const count = u16(archive, 0);
  const entries: TocEntry[] = [];
  for (let i = 0; i < count; i++) {
    const at = 2 + i * 8;
    entries.push({
      id: u16(archive, at),
      offset: u24(archive, at + 2),
      size: u16(archive, at + 5),
    });
  }
  return entries;
};

const entryOf = (archive: Uint8Array, id: number): TocEntry => {
  const entry = readToc(archive).find((e) => e.id === id);
  if (entry === undefined) throw new Error(`no member 0x${id.toString(16)} in this archive`);
  return entry;
};

export const decodeMember = (archive: Uint8Array, id: number): Uint8Array => {
  const { offset, size } = entryOf(archive, id);
  const member = archive.subarray(offset, offset + size);
  const declen = u32(member, 0);
  const raw = decodeLzw(member.subarray(4), declen);
  if (raw.length !== declen) {
    throw new Error(
      `member 0x${id.toString(16)}: stream ended after ${raw.length} of ${declen} bytes`,
    );
  }
  return raw;
};

const encodeMember = (raw: Uint8Array): Uint8Array => concat([packU32(raw.length), encodeLzw(raw)]);

/** A new archive with the given members replaced, everything else byte-for-byte. */
export const rebuild = (archive: Uint8Array, replacements: Map<number, Uint8Array>): Uint8Array => {
  const entries = readToc(archive);
  const tocSize = 2 + entries.length * 8;

  const blobs = entries.map((e) => {
    const raw = replacements.get(e.id);
    return raw === undefined ? archive.subarray(e.offset, e.offset + e.size) : encodeMember(raw);
  });

  const toc = new Uint8Array(tocSize);
  setU16(toc, 0, entries.length);
  let at = tocSize;
  blobs.forEach((blob, i) => {
    const slot = 2 + i * 8;
    setU16(toc, slot, entries[i].id);
    setU24(toc, slot + 2, at);
    setU16(toc, slot + 5, blob.length);
    at += blob.length;
  });
  return concat([toc, ...blobs]);
};
