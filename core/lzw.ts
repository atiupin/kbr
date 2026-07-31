/**
 * The NWC variable-width LZW codec: LSB-first, 9->12 bits, clear 0x100, end
 * 0x101, first dictionary code 0x102.
 *
 * Its own module because two unrelated things are the same stream -- the members
 * of a CC archive, and the outer layer KB.EXE ships packed in.
 */

const CLEAR = 0x100;
const END = 0x101;
const FIRST = 0x102;
const MAXBITS = 12;

const singles: Uint8Array[] = Array.from({ length: 256 }, (_, i) => Uint8Array.of(i));

const extend = (entry: Uint8Array, byte: number): Uint8Array => {
  const grown = new Uint8Array(entry.length + 1);
  grown.set(entry);
  grown[entry.length] = byte;
  return grown;
};

/**
 * Decode one stream, stopping at `declen` bytes, the end code, or a code the
 * dictionary cannot explain -- a truncated or corrupt stream yields what it
 * decoded rather than throwing, so the caller decides what a short result means.
 */
export const lzwDecode = (stream: Uint8Array, declen: number): Uint8Array => {
  let out = new Uint8Array(Math.max(declen, 64));
  let len = 0;
  const emit = (entry: Uint8Array): void => {
    if (len + entry.length > out.length) {
      const grown = new Uint8Array(Math.max(out.length * 2, len + entry.length));
      grown.set(out.subarray(0, len));
      out = grown;
    }
    out.set(entry, len);
    len += entry.length;
  };

  let bitpos = 0;
  const total = stream.length * 8;
  const readCode = (width: number): number => {
    let val = 0;
    for (let i = 0; i < width; i++) {
      val |= ((stream[bitpos >> 3] >> (bitpos & 7)) & 1) << i;
      bitpos++;
    }
    return val;
  };

  let width = 9;
  let table = singles.slice();
  let next = FIRST;
  let prev: Uint8Array | undefined;
  while (len < declen && bitpos + width <= total) {
    const code = readCode(width);
    if (code === CLEAR) {
      width = 9;
      table = singles.slice();
      next = FIRST;
      prev = undefined;
      continue;
    }
    if (code === END) break;
    let entry: Uint8Array;
    if (table[code] !== undefined) {
      entry = table[code];
    } else if (code === next && prev !== undefined) {
      entry = extend(prev, prev[0]);
    } else {
      break;
    }
    emit(entry);
    if (prev !== undefined) {
      table[next] = extend(prev, entry[0]);
      next++;
      if (next >= 1 << width && width < MAXBITS) width++;
    }
    prev = entry;
  }
  return out.subarray(0, len);
};

export const lzwEncode = (_data: Uint8Array): Uint8Array => {
  throw new Error("lzwEncode: not implemented yet");
};
