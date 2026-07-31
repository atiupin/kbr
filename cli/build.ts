/**
 * The whole build in one command: the chain's four steps in their only valid
 * order.
 *
 * It stops there rather than staging dist/. Until `verify` reports every
 * artifact byte-identical this output has no business in a player's run dir --
 * and that directory holds saves no build gets to overwrite on a hunch.
 */

import { applyPatches } from "../core/applyPatches.ts";
import { unpackExepack } from "../core/unpackExepack.ts";
import { unpackNwc } from "../core/unpackNwc.ts";
import { read, readText, rel, write } from "./io.ts";
import { fontBuild } from "./font.ts";
import { line, step } from "./report.ts";
import * as paths from "./paths.ts";

const emit = (path: string, data: Uint8Array): void => {
  write(path, data);
  line(`${rel(path)}  (${data.length} bytes)`);
};

export const build = (): void => {
  step(1, 4, "unpack the NWC packer");
  emit(paths.KBU1, unpackNwc(read(paths.KB_EXE)));

  step(2, 4, "unpack EXEPACK");
  emit(paths.KBU2, unpackExepack(read(paths.KBU1)));

  step(3, 4, "apply patches");
  emit(
    paths.KBR,
    applyPatches({
      base: read(paths.KBU2),
      patchesCsv: readText(paths.PATCHES_CSV),
      gatePickerAsm: readText(paths.GATE_PICKER_ASM),
      nameTablesAsm: readText(paths.NAME_TABLES_ASM),
    }),
  );

  step(4, 4, "build the Cyrillic-extended fonts");
  fontBuild();

  line("\nbuilt -- now run `npm run verify`");
};
