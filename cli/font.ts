/**
 * res/font.png <-> the 0x9bb2 font member, and the build step that writes both
 * run-dir archives.
 *
 * Lives in the shell by design: a browser has an image decoder of its own and
 * the web bundle carries a pre-baked font member, so none of this belongs in
 * core.
 */

export interface Png {
  width: number;
  height: number;
  /** Row-major RGBA, 4 bytes per pixel. */
  rgba: Uint8Array;
}

export const pngRead = (_path: string): Png => {
  throw new Error("pngRead: not implemented yet");
};

export const pngWrite = (_path: string, _png: Png): void => {
  throw new Error("pngWrite: not implemented yet");
};

/** THE BUILD STEP: res/font.png + the pristine archives -> both run-dir archives. */
export const fontBuild = (): void => {
  throw new Error("fontBuild: not implemented yet");
};
