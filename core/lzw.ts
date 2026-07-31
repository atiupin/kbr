/**
 * The NWC variable-width LZW codec: LSB-first, 9->12 bits, clear 0x100, end
 * 0x101, first dictionary code 0x102.
 *
 * Its own module because two unrelated things are the same stream -- the members
 * of a CC archive, and the outer layer KB.EXE ships packed in.
 */

export const lzwDecode = (_stream: Uint8Array, _declen: number): Uint8Array => {
  throw new Error("lzwDecode: not implemented yet");
};

export const lzwEncode = (_data: Uint8Array): Uint8Array => {
  throw new Error("lzwEncode: not implemented yet");
};
