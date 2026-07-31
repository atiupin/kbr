/**
 * The NWC "CC" archive container: a u16 count, 8-byte TOC entries, then members
 * looked up by a hash of their filename rather than by index. Each member is a
 * u32 decoded length followed by an LZW stream, which lzw.ts owns.
 *
 * The PNG side of the font work is deliberately absent -- a browser already has
 * an image decoder, so it lives in the shell.
 */

export interface TocEntry {
  id: number;
  offset: number;
  size: number;
}

export const readToc = (_archive: Uint8Array): TocEntry[] => {
  throw new Error("readToc: not implemented yet");
};

export const decodeMember = (_archive: Uint8Array, _id: number): Uint8Array => {
  throw new Error("decodeMember: not implemented yet");
};

/** A new archive with the given members replaced, everything else byte-for-byte. */
export const rebuild = (
  _archive: Uint8Array,
  _replacements: Map<number, Uint8Array>,
): Uint8Array => {
  throw new Error("rebuild: not implemented yet");
};
