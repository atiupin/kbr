/**
 * The 0x9bb2 font member <-> a glyph sheet.
 *
 * The member is a flat glyph bitmap: 8 rows per glyph, one byte per row, MSB the leftmost
 * pixel. Glyphs 0x00-0x1F are UI symbols the game draws (cursor arrows, box corners,
 * checkmarks) and are in use, not free; 0x20-0x7F are ASCII. The stock member stops there
 * at 1024 bytes, leaving 0x80-0xFF — where CP866 puts every Cyrillic letter — undefined, so
 * this project extends it to 2048 bytes. That needed no patch anywhere: the CC loader
 * mallocs each member by its declen, and the glyph blitter indexes the font unsigned. CP866
 * spends 0xB0-0xDF and 0xF2-0xFF on box drawing and blocks, which no Russian text reaches;
 * those 62 cells are free to draw new glyphs in, reachable from the manifest as \xNN.
 *
 * A sheet is raw RGBA because decoding an image file is the shell's job; the packing, the
 * geometry and which half of the member is ours are not, and live here.
 */

/** Glyphs per sheet row: the sheet is a 1:1 sprite rip, no scaling, gaps or grid. */
const COLS = 16;

/** Lit pixels are opaque white; the background is transparent. */
const INK = [255, 255, 255, 255];

export interface Sheet {
  width: number;
  height: number;
  /** Row-major RGBA, 4 bytes per pixel. */
  rgba: Uint8Array;
}

export const fontToSheet = (font: Uint8Array, glyphs: number): Sheet => {
  const width = COLS * 8;
  const height = Math.ceil(glyphs / COLS) * 8;
  const rgba = new Uint8Array(width * height * 4);
  for (let ch = 0; ch < glyphs; ch++) {
    const ox = (ch % COLS) * 8;
    const oy = Math.floor(ch / COLS) * 8;
    for (let r = 0; r < 8; r++) {
      const byte = ch * 8 + r < font.length ? font[ch * 8 + r] : 0;
      for (let c = 0; c < 8; c++) {
        if ((byte >> (7 - c)) & 1) rgba.set(INK, ((oy + r) * width + ox + c) * 4);
      }
    }
  }
  return { width, height, rgba };
};

export const sheetToFont = ({ width, height, rgba }: Sheet, glyphs: number): Uint8Array => {
  const need = Math.ceil(glyphs / COLS) * 8;
  if (width < COLS * 8 || height < need) {
    throw new Error(
      `sheet is ${width}x${height}; need at least ${COLS * 8}x${need} for ${glyphs} ` +
        `glyphs (1:1, ${COLS} glyphs per row, no grid)`,
    );
  }
  const font = new Uint8Array(glyphs * 8);
  for (let ch = 0; ch < glyphs; ch++) {
    const ox = (ch % COLS) * 8;
    const oy = Math.floor(ch / COLS) * 8;
    for (let r = 0; r < 8; r++) {
      let byte = 0;
      for (let c = 0; c < 8; c++) {
        const p = ((oy + r) * width + ox + c) * 4;
        // lit = opaque and not black, so any ink colour works
        if (rgba[p + 3] >= 128 && rgba[p] + rgba[p + 1] + rgba[p + 2] >= 128)
          byte |= 1 << (7 - c);
      }
      font[ch * 8 + r] = byte;
    }
  }
  return font;
};

/**
 * The member a sheet becomes: 2048 bytes, or the stock 1024 when nothing was drawn above
 * 0x7F.
 */
export const sheetToMember = (sheet: Sheet): Uint8Array => {
  const font = sheetToFont(sheet, 256);
  return font.subarray(1024).some((b) => b !== 0) ? font : font.subarray(0, 1024);
};
