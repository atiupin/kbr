/**
 * find-ref: what points at a string, and the manifest row to paste.
 *
 * A run-once discovery aid. The build never scans — it just applies the offsets recorded
 * here, against the one image they mean anything against, which is why this command refuses
 * to run on anything but the pinned KBU2.
 */

import { DS_BASE, KBU2_SHA256 } from "../core/applyPatches.ts";
import { encodeCp866 } from "../core/cp866.ts";
import {
  findRefs,
  findStrings,
  hexOffset,
  inProtection,
  relocRow,
  stringAt,
} from "../core/findRef.ts";
import { sha256 } from "../core/sha256.ts";
import { exists, read, rel } from "./io.ts";
import { line } from "./report.ts";
import * as paths from "./paths.ts";

const NUMBER_RE = /^(0x[0-9a-fA-F]+|[0-9]+)$/;

const pristine = (): Uint8Array => {
  if (!exists(paths.KBU2))
    throw new Error(`${rel(paths.KBU2)} is not built -- run npm run build`);
  const image = read(paths.KBU2);
  if (sha256(image) !== KBU2_SHA256) {
    throw new Error(`${rel(paths.KBU2)} is not pristine -- the offsets would be wrong`);
  }
  return image;
};

/**
 * The string the argument names: its own file offset, or the one substring search finds.
 */
const resolve = (image: Uint8Array, target: string): number => {
  if (NUMBER_RE.test(target)) return Number(target);

  const hits = findStrings(image, encodeCp866(target));
  if (hits.length === 0) {
    throw new Error(`no string containing ${JSON.stringify(target)} in the text region`);
  }
  if (hits.length > 1) {
    line(`note: ${hits.length} strings contain ${JSON.stringify(target)}:`);
    for (const hit of hits)
      line(`  ${hexOffset(hit)}  ${JSON.stringify(stringAt(image, hit))}`);
    line("re-run with the exact file offset you want.\n");
  }
  return hits[0];
};

export const findRef = (args: string[]): void => {
  const [target] = args;
  if (target === undefined) throw new Error("find-ref needs a file offset or a substring");

  const image = pristine();
  const strOff = resolve(image, target);
  const text = stringAt(image, strOff);
  const dsoff = (strOff - DS_BASE).toString(16).padStart(4, "0");
  line(`string @ ${hexOffset(strOff)} (DS 0x${dsoff}): ${JSON.stringify(text)}\n`);

  const refs = findRefs(image, strOff);
  if (refs.length === 0) {
    line("no ref found -- reached by computed/indexed access, not repointable");
    return;
  }

  const usable: number[] = [];
  for (const ref of refs) {
    line(`ref @ ${hexOffset(ref.offset)}  [${ref.kind}]`);
    if (inProtection(ref.offset)) {
      line("  !! inside the copy-protection block -- DO NOT repoint this ref.");
      line("     The block retaliates on a long delay: the game hangs much later,");
      line("     in an INT 6 loop, on a screen with nothing to do with this string.");
      line("     Translate in place with a 'string' row instead.");
      continue;
    }
    usable.push(ref.offset);
  }
  if (usable.length === 0) return;
  if (usable.length > 1) {
    line(
      `\n${usable.length} refs: this string is used from several places, so all its ` +
        `pointers must move together and go in ONE row:`,
    );
  }
  line(`\n  ${relocRow(usable, text)}`);
};
