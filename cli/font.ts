/**
 * The font commands: res/font.png <-> the 0x9bb2 member of a CC archive, and the
 * build step that writes both run-dir archives.
 *
 * res/font.png is the editable sheet: its top 8 rows are the game's original
 * glyphs and its bottom 8 the Cyrillic. font-export and font-import round-trip
 * it, so an image editor's own save is a valid input -- which is why reading
 * goes through pngjs: the sheet can come back palette, greyscale, 16-bit or
 * interlaced, and pngjs normalizes all of it to the 8-bit RGBA core/font.ts
 * wants.
 *
 * Files and messages only: core/font.ts knows what a glyph is. It stays in the
 * shell because a browser decodes images itself -- the web patcher carries a
 * pre-baked font member and will never load any of this.
 */

import { PNG } from "pngjs";

import { FONT_ID, decodeMember, rebuild } from "../core/cc.ts";
import { fontToSheet, sheetToMember } from "../core/font.ts";
import type { Sheet } from "../core/font.ts";
import { read, rel, write } from "./io.ts";
import { line } from "./report.ts";
import * as paths from "./paths.ts";

const readSheet = (path: string): Sheet => {
  const src = read(path);
  const { width, height, data } = PNG.sync.read(
    Buffer.from(src.buffer, src.byteOffset, src.byteLength),
  );
  return { width, height, rgba: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
};

const writeSheet = (path: string, { width, height, rgba }: Sheet): void => {
  const png = new PNG({ width, height });
  png.data.set(rgba);
  write(path, PNG.sync.write(png));
};

export const fontImport = (pngPath: string, ccPath: string, outPath: string): void => {
  const font = sheetToMember(readSheet(pngPath));
  write(outPath, rebuild(read(ccPath), new Map([[FONT_ID, font]])));
  line(`${rel(outPath)}  (font ${font.length} bytes)`);
};

/**
 * Whatever the member holds: 256 glyphs for ours, 128 for a pristine archive.
 * Exporting 128 from a 256-glyph font drops the Cyrillic half and writes a sheet
 * too short to import back, so `glyphs` overrides -- which is how a stock archive
 * yields a 256-cell sheet with a blank upper half to draw into.
 */
export const fontExport = (ccPath: string, pngPath: string, glyphs?: number): void => {
  const font = decodeMember(read(ccPath), FONT_ID);
  const count = glyphs ?? font.length / 8;
  writeSheet(pngPath, fontToSheet(font, count));
  line(`${rel(pngPath)}  (${count} glyphs)`);
};

/** THE BUILD STEP: res/font.png + the pristine archives -> both run-dir archives. */
export const fontBuild = (): void => {
  for (const mode of [256, 416] as const) {
    fontImport(paths.FONT_PNG, paths.GAME_CC[mode], paths.BUILD_CC[mode]);
  }
};

/** The font member on its own, for the web bundle to carry instead of a PNG decoder. */
export const fontBake = (): void => {
  const font = sheetToMember(readSheet(paths.FONT_PNG));
  write(paths.FONT_BIN, font);
  line(`${rel(paths.FONT_BIN)}  (${font.length} bytes)`);
};
