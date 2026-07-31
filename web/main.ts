import { KBU2_SHA256, applyPatches } from "../core/applyPatches.ts";
import { sha256 } from "../core/sha256.ts";
import { unpackExepack } from "../core/unpackExepack.ts";
import { unpackNwc } from "../core/unpackNwc.ts";

import { bindPicker, clearScreen, logMessage, showDownloadBox } from "./screen.ts";
import { patchFont, readZip, requireFile, writeZip } from "./utils.ts";
import dosboxConf from "../res/dosbox.conf";
import gatePickerAsm from "../res/gate_picker.asm";
import nameTablesAsm from "../res/name_tables.asm";
import patchesCsv from "../res/patches.csv";

/** The run dir, a folder inside the zip so unpacking never scatters files. */
const DIR = "KBR";

const patch = async (zip: Uint8Array): Promise<Uint8Array> => {
  const files = readZip(zip);
  logMessage("ZIP распакован");

  const nwc = unpackNwc(requireFile(files, "KB.EXE"));
  for (const warning of nwc.warnings) logMessage(warning, "err");
  logMessage("NWC распакован");

  const kbu2 = unpackExepack(nwc.image);
  logMessage("EXEPACK распакован");

  if (sha256(kbu2) !== KBU2_SHA256) {
    throw new Error("this is not the release the patch targets");
  }

  const patched = applyPatches({ base: kbu2, patchesCsv, gatePickerAsm, nameTablesAsm });
  const { rows } = patched.summary;
  logMessage(`Переведено ${rows} строк`);

  const [cc256, cc416] = await Promise.all(
    ([256, 416] as const).map((mode) => patchFont(requireFile(files, `${mode}.CC`))),
  );

  logMessage("Кириллический шрифт встроен в ресурсы игры");

  return writeZip(
    new Map([
      [`${DIR}/KBR.EXE`, patched.image],
      [`${DIR}/256.CC`, cc256],
      [`${DIR}/416.CC`, cc416],
      [`${DIR}/dosbox.conf`, new TextEncoder().encode(dosboxConf)],
    ]),
  );
};

bindPicker(async (file) => {
  clearScreen();
  logMessage(`Файл ${file.name} (${Math.floor(file.size / 1024)} КБ)`);

  try {
    showDownloadBox(await patch(new Uint8Array(await file.arrayBuffer())));
    logMessage("ГОТОВО");
  } catch (error) {
    logMessage(`ОШИБКА: ${error instanceof Error ? error.message : String(error)}`, "err");
  }
});
