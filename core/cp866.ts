/**
 * CP866, the encoding of every string in the game image and of the font that draws them.
 *
 * One byte per Cyrillic letter, so a translated string's byte budget is exactly its
 * character count. The low half is ASCII; only the top 128 need a table.
 */

/** The characters bytes 0x80..0xFF stand for, in order; 0xFF is a no-break space. */
const HIGH =
  "АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ" +
  "абвгдежзийклмноп░▒▓│┤╡╢╖╕╣║╗╝╜╛┐" +
  "└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀" +
  "рстуфхцчшщъыьэюяЁёЄєЇїЎў°∙·√№¤■ ";

const BYTE_OF = new Map<string, number>();
for (let i = 0; i < HIGH.length; i++) BYTE_OF.set(HIGH[i], 0x80 + i);

export const decodeCp866 = (bytes: Uint8Array): string => {
  let text = "";
  for (const byte of bytes) text += byte < 0x80 ? String.fromCharCode(byte) : HIGH[byte - 0x80];
  return text;
};

export const encodeCp866 = (text: string): Uint8Array => {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const byte = code < 0x80 ? code : BYTE_OF.get(text[i]);
    if (byte === undefined) throw new RangeError(`${JSON.stringify(text[i])} has no CP866 byte`);
    out[i] = byte;
  }
  return out;
};
