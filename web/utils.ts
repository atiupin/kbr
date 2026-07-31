import { unzipSync, zipSync } from "fflate";

import { FONT_ID, rebuild } from "../core/cc.ts";
import { sheetToMember } from "../core/font.ts";
import fontPng from "../res/font.png";

/**
 * Keyed by DOS basename, so a copy nested in a folder or spelled `kb.exe` still resolves.
 */
export const readZip = (data: Uint8Array): Map<string, Uint8Array> => {
  const files = new Map<string, Uint8Array>();

  for (const [path, bytes] of Object.entries(unzipSync(data))) {
    const name = path.slice(path.lastIndexOf("/") + 1).toUpperCase();
    if (name !== "" && !files.has(name)) files.set(name, bytes);
  }

  return files;
};

/**
 * Store-only, dated from local calendar fields so the bytes never shift with the time zone.
 */
export const writeZip = (files: Map<string, Uint8Array>): Uint8Array =>
  zipSync(Object.fromEntries(files), { level: 0, mtime: new Date(1990, 0, 1) });

export const requireFile = (files: Map<string, Uint8Array>, name: string): Uint8Array => {
  const bytes = files.get(name);
  if (bytes === undefined) throw new Error(`the zip has no ${name}`);
  return bytes;
};

/** Colour management and premultiplication off: core/font.ts reads the pixels as stored. */
export const patchFont = async (archive: Uint8Array): Promise<Uint8Array> => {
  const bitmap = await createImageBitmap(
    new Blob([fontPng as BlobPart], { type: "image/png" }),
    {
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
    },
  );

  const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d");
  if (ctx === null)
    throw new Error("the browser gave no 2D context, so the sheet cannot be read");

  ctx.drawImage(bitmap, 0, 0);
  const { width, height, data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  const rgba = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

  return rebuild(archive, new Map([[FONT_ID, sheetToMember({ width, height, rgba })]]));
};
