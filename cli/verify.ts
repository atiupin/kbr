/**
 * What a build can still be held to when it is the only build there is.
 *
 * KBU2.EXE is the gate. Its bytes are a property of the game image rather than of
 * the code that produced them, so the pinned sha256 proves the whole unpack chain
 * at once, and with it that every offset in res/patches.csv still means what it
 * says. Nothing downstream has an external reference: the patcher verifies its own
 * work against the pristine image, the assembler has `asm-selftest`, and both .CC
 * archives are a deterministic function of inputs this repo does not carry. Those
 * are checked for existence and their digests printed, so a change nobody intended
 * is at least visible between two runs.
 */

import { KBU2_SHA256 } from "../core/applyPatches.ts";
import { sha256 } from "../core/sha256.ts";
import { exists, read, rel } from "./io.ts";
import { heading, item } from "./report.ts";
import * as paths from "./paths.ts";

interface Artifact {
  name: string;
  path: string;
  /** Set where the bytes are pinned independently of any build. */
  pin?: string;
}

const ARTIFACTS: readonly Artifact[] = [
  { name: "KBU1.EXE", path: paths.KBU1 },
  { name: "KBU2.EXE", path: paths.KBU2, pin: KBU2_SHA256 },
  { name: "KBR.EXE", path: paths.KBR },
  { name: "256.CC", path: paths.BUILD_CC[256] },
  { name: "416.CC", path: paths.BUILD_CC[416] },
];

export const verify = (): void => {
  heading("the build");

  let failed = 0;
  for (const a of ARTIFACTS) {
    if (!exists(a.path)) {
      failed++;
      item("missing", a.name, `${rel(a.path)} not built`);
      continue;
    }
    const digest = sha256(read(a.path));
    if (a.pin === undefined) {
      item("built", a.name, digest);
    } else if (digest === a.pin) {
      item("pinned", a.name, digest);
    } else {
      failed++;
      item("NOT PINNED", a.name, `${digest} is not the image patches.csv describes`);
    }
  }

  if (failed > 0) throw new Error(`${failed} of ${ARTIFACTS.length} artifacts did not check out`);
};
