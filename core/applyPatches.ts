/**
 * The edit base + the manifest + the injected asm -> the patched game.
 *
 * The step that decides, per string, between writing in place and moving it to
 * the pool, and the only one allowed to repoint a reference.
 */

export interface PatchInputs {
  /** The unpacked, flat image every offset in the manifest is measured against. */
  base: Uint8Array;
  /** res/patches.csv as text; the strict reader that parses it is ours. */
  patchesCsv: string;
  gatePickerAsm: string;
  nameTablesAsm: string;
}

export const applyPatches = (_inputs: PatchInputs): Uint8Array => {
  throw new Error("applyPatches: not implemented yet");
};
