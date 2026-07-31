/**
 * The one place that knows where things live: put a path here, not in a
 * command. Paths are absolute and derived from this file's own location, so
 * every command works from any working directory.
 *
 * OUT is the exception to the layout, and temporary. A reference build owns
 * build/ for as long as the two exist side by side, so this build writes into
 * build/ts/ and the harness compares the two directories file by file; the day
 * there is one build, OUT is BUILD.
 */

import { dirname, join } from "node:path";

export const CLI = import.meta.dirname;
export const ROOT = dirname(CLI);
export const GAME = join(ROOT, "game");
export const BUILD = join(ROOT, "build");
export const OUT = join(BUILD, "ts");
export const RES = join(ROOT, "res");

// --- inputs: the user's own copy, never modified -----------------------------
export const KB_EXE = join(GAME, "KB.EXE");
export const GAME_CC = { 256: join(GAME, "256.CC"), 416: join(GAME, "416.CC") } as const;

// --- the build chain: KB.EXE -> KBU1 -> KBU2 -> KBR --------------------------
export const KBU1 = join(OUT, "KBU1.EXE"); // minus the outer NWC packer
export const KBU2 = join(OUT, "KBU2.EXE"); // flat, unpacked: the edit base
export const KBR = join(OUT, "KBR.EXE"); // KBU2 + patches.csv: our build
export const BUILD_CC = { 256: join(OUT, "256.CC"), 416: join(OUT, "416.CC") } as const;
export const FONT_BIN = join(OUT, "font.bin"); // the font member alone, for the web bundle

// --- hand-written build inputs (tracked) -------------------------------------
export const PATCHES_CSV = join(RES, "patches.csv");
export const FONT_PNG = join(RES, "font.png");
export const GATE_PICKER_ASM = join(RES, "gate_picker.asm");
export const NAME_TABLES_ASM = join(RES, "name_tables.asm");
export const DOSBOX_CONF = join(RES, "dosbox.conf");
