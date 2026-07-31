/**
 * The browser shell: a KB.EXE in, a patched KBR.EXE out, the same core/ chain
 * the command line runs. Nothing is fetched and nothing is sent -- res/ is
 * bundled as text and the file is read through FileReader.
 */

import { applyPatches } from "../core/applyPatches.ts";
import { unpackExepack } from "../core/unpackExepack.ts";
import { unpackNwc } from "../core/unpackNwc.ts";
import gatePickerAsm from "../res/gate_picker.asm";
import nameTablesAsm from "../res/name_tables.asm";
import patchesCsv from "../res/patches.csv";

const log = document.getElementById("log") as HTMLPreElement;
const out = document.getElementById("out") as HTMLParagraphElement;
const input = document.getElementById("file") as HTMLInputElement;

const say = (text: string): void => {
  log.textContent += `${text}\n`;
};

const patch = (kbExe: Uint8Array): Uint8Array => {
  const nwc = unpackNwc(kbExe);
  for (const warning of nwc.warnings) say(`warning: ${warning}`);
  say("распакован NWC");

  const kbu2 = unpackExepack(nwc.image);
  say("распакован EXEPACK");

  const patched = applyPatches({
    base: kbu2,
    patchesCsv,
    gatePickerAsm,
    nameTablesAsm,
  });
  const { rows, pooled, inlined } = patched.summary;
  say(`${rows} строк(и) перевода: ${pooled} в пул, ${inlined} на месте`);
  return patched.image;
};

const offer = (image: Uint8Array): void => {
  const url = URL.createObjectURL(
    new Blob([image as BlobPart], { type: "application/octet-stream" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "KBR.EXE";
  link.textContent = `Скачать KBR.EXE (${image.length} байт)`;
  out.replaceChildren(link);
};

input.addEventListener("change", async () => {
  const file = input.files?.[0];
  if (file === undefined) return;
  log.textContent = "";
  out.replaceChildren();
  try {
    offer(patch(new Uint8Array(await file.arrayBuffer())));
  } catch (error) {
    say(`ошибка: ${error instanceof Error ? error.message : String(error)}`);
  }
});
