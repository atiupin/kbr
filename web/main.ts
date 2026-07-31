/**
 * The browser shell: a zip of the player's own copy in, a zip that runs out,
 * through the same core/ chain the command line runs -- cli/build.ts is these
 * same steps against the filesystem.
 *
 * Nothing is fetched and nothing is sent: res/ is bundled into this script, the
 * zip comes from the File the page was handed, and the result goes back as an
 * object URL. The patch path makes no network call at all.
 */

import { KBU2_SHA256, applyPatches } from "../core/applyPatches.ts";
import { sha256 } from "../core/sha256.ts";
import { unpackExepack } from "../core/unpackExepack.ts";
import { unpackNwc } from "../core/unpackNwc.ts";

import { patchFont, readZip, requireFile, writeZip } from "./utils.ts";
import dosboxConf from "../res/dosbox.conf";
import gatePickerAsm from "../res/gate_picker.asm";
import nameTablesAsm from "../res/name_tables.asm";
import patchesCsv from "../res/patches.csv";

/** The run dir, a folder inside the zip so unpacking never scatters files. */
const DIR = "KBR";

const log = document.getElementById("log") as HTMLPreElement;
const out = document.getElementById("out") as HTMLParagraphElement;
const input = document.getElementById("file") as HTMLInputElement;

const say = (text: string): void => {
  log.textContent += `${text}\n`;
};

const patch = async (zip: Uint8Array): Promise<Uint8Array> => {
  const files = readZip(zip);
  say("архив распакован");

  const nwc = unpackNwc(requireFile(files, "KB.EXE"));
  for (const warning of nwc.warnings) say(`внимание: ${warning}`);
  say("распакован NWC");

  const kbu2 = unpackExepack(nwc.image);
  say("распакован EXEPACK");

  // applyPatches gates on this hash as well; checking it here is what turns the
  // build's byte-level complaint into the one thing a player can act on.
  if (sha256(kbu2) !== KBU2_SHA256) {
    throw new Error("this is not the release the patch targets");
  }

  const patched = applyPatches({ base: kbu2, patchesCsv, gatePickerAsm, nameTablesAsm });
  const { rows, pooled, inlined } = patched.summary;
  say(`${rows} строк(и) перевода: ${pooled} в пул, ${inlined} на месте`);

  const [cc256, cc416] = await Promise.all(
    ([256, 416] as const).map((mode) => patchFont(requireFile(files, `${mode}.CC`))),
  );
  say("кириллический шрифт встроен в 256.CC и 416.CC");

  return writeZip(
    new Map([
      [`${DIR}/KBR.EXE`, patched.image],
      [`${DIR}/256.CC`, cc256],
      [`${DIR}/416.CC`, cc416],
      [`${DIR}/dosbox.conf`, new TextEncoder().encode(dosboxConf)],
    ]),
  );
};

const offer = (zip: Uint8Array): void => {
  const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: "application/zip" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${DIR}.zip`;
  link.textContent = `Скачать ${DIR}.zip (${zip.length} байт)`;
  out.replaceChildren(link);
};

input.addEventListener("change", async () => {
  const file = input.files?.[0];
  if (file === undefined) return;
  log.textContent = "";
  out.replaceChildren();
  try {
    offer(await patch(new Uint8Array(await file.arrayBuffer())));
  } catch (error) {
    say(`ошибка: ${error instanceof Error ? error.message : String(error)}`);
  }
});
