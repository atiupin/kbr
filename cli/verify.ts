/**
 * The gate every build step is measured against: each artifact this build writes
 * must be identical, byte for byte, to the reference image of the same name in
 * build/.
 *
 * The comparison is sha256 on both sides -- never a size, never a timestamp --
 * and the reference is hashed live rather than pinned, so a legitimate change to
 * it cannot leave a stale expectation behind. The one pinned hash is KBU2's: it
 * is a property of the game image itself, not of any build that produced it.
 */

import { join } from "node:path";

import { KBU2_SHA256 } from "../core/applyPatches.ts";
import { sha256 } from "../core/sha256.ts";
import { exists, read, rel } from "./io.ts";
import { heading, item } from "./report.ts";
import * as paths from "./paths.ts";

interface Artifact {
  name: string;
  reference: string;
  ours: string;
  /** Set where the bytes are pinned independently of any build. */
  pin?: string;
}

const ARTIFACTS: readonly Artifact[] = [
  { name: "KBU1.EXE", reference: join(paths.BUILD, "KBU1.EXE"), ours: paths.KBU1 },
  {
    name: "KBU2.EXE",
    reference: join(paths.BUILD, "KBU2.EXE"),
    ours: paths.KBU2,
    pin: KBU2_SHA256,
  },
  { name: "KBR.EXE", reference: join(paths.BUILD, "KBR.EXE"), ours: paths.KBR },
  { name: "256.CC", reference: join(paths.BUILD, "256.CC"), ours: paths.BUILD_CC[256] },
  { name: "416.CC", reference: join(paths.BUILD, "416.CC"), ours: paths.BUILD_CC[416] },
];

export const verify = (): void => {
  heading("byte equality against the reference build");

  let matched = 0;
  let missing = 0;
  for (const a of ARTIFACTS) {
    if (!exists(a.ours)) {
      missing++;
      item("missing", a.name, `${rel(a.ours)} not built`);
      continue;
    }
    const digest = sha256(read(a.ours));
    if (a.pin !== undefined && digest !== a.pin) {
      item("PINNED", a.name, `${digest} is not the pinned image`);
      continue;
    }
    if (!exists(a.reference)) {
      item("no ref", a.name, `${rel(a.reference)} absent`);
      continue;
    }
    if (digest !== sha256(read(a.reference))) {
      item("DIFFERS", a.name, digest);
      continue;
    }
    matched++;
    item("ok", a.name, digest);
  }

  const total = ARTIFACTS.length;
  console.log(`\n  ${matched}/${total} match, ${missing} not built yet`);
  if (matched !== total) throw new Error(`${total - matched} of ${total} artifacts do not match`);
};
