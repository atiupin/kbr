/**
 * Holds the assembler to the game's own bytes: each case reassembles a routine that is
 * already in KBU2.EXE, and the only passing result is byte equality at its own offset.
 */

import { SELFTEST_CASES, assemble } from "../core/asm16.ts";
import { equal } from "../core/bytes.ts";
import { read } from "./io.ts";
import { heading, line } from "./report.ts";
import * as paths from "./paths.ts";

const byte = (v: number): string => `0x${v.toString(16).padStart(2, "0")}`;

/** Byte-per-column, so a difference at +0x2b is countable by eye. */
const dump = (b: Uint8Array): string =>
  [...b].map((v) => v.toString(16).padStart(2, "0")).join(" ");

export const selftest = (): void => {
  heading("assembler against the shipped routines");

  const image = read(paths.KBU2);
  let bad = 0;
  for (const test of SELFTEST_CASES) {
    const want = image.subarray(test.at, test.at + test.length);
    const { code, relocs } = assemble(test.source, test.at);
    const at = `0x${test.at.toString(16)}`;
    if (equal(code, want)) {
      const fixups = relocs.map((r) => `0x${r.toString(16)}`).join(" ");
      line(`ok   ${test.name}: ${code.length} bytes byte-identical at ${at}  relocs [${fixups}]`);
      continue;
    }
    bad++;
    line(`FAIL ${test.name} at ${at}`);
    line(`  want ${dump(want)}`);
    line(`  got  ${dump(code)}`);
    const common = Math.min(want.length, code.length);
    const i = [...want.subarray(0, common)].findIndex((v, k) => v !== code[k]);
    if (i !== -1) {
      const which = `want ${byte(want[i])}, got ${byte(code[i])}`;
      line(`  first difference at +0x${i.toString(16)}: ${which}`);
    }
  }

  if (bad > 0) throw new Error(`${bad} of ${SELFTEST_CASES.length} routines do not reassemble`);
};
