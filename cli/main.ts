/**
 * argv in, exit code out -- the only entry point, and the only place that ends
 * the process. Commands report through report.ts and signal failure by throwing;
 * anything thrown, from here or from core, prints one line and exits 1.
 */

import { findRefs } from "../core/findRef.ts";
import { fileToSegOff, segOffToFile } from "../core/addr.ts";
import { decodeMember, readToc, rebuild } from "../core/cc.ts";
import { u32 } from "../core/bytes.ts";
import { build } from "./build.ts";
import { fontBake, fontExport, fontImport } from "./font.ts";
import { read, rel, write } from "./io.ts";
import { line } from "./report.ts";
import { selftest } from "./selftest.ts";
import { verify } from "./verify.ts";
import * as paths from "./paths.ts";

const USAGE = `kbr <command> [args]

  build                      the whole chain: game/KB.EXE -> build/ts/
  verify                     every artifact against the reference build, by sha256
  asm-selftest               reassemble two shipped routines, demand byte equality

  find-ref <offset|"text">   what points at a string; a reloc row, paste-ready
  addr <0xoffset|seg:off>    file offset <-> Ghidra address

  cc-list <archive.CC>       every member: id, offset, packed and decoded size
  cc-extract <archive.CC> <id-hex> <out.bin>
  cc-replace <archive.CC> <id-hex> <in.bin> <out.CC>
  font-export <archive.CC> <out.png> [glyphs]
  font-import <in.png> <archive.CC> <out.CC>
  font-bake                  res/font.png -> the raw font member, for the web bundle
`;

const cmdFindRef = (args: string[]): void => {
  const [target] = args;
  if (target === undefined) throw new Error("find-ref needs an offset or a substring");
  const image = read(paths.KBU2);
  const strOff = target.startsWith("0x") ? Number.parseInt(target, 16) : Number.NaN;
  if (Number.isNaN(strOff)) throw new Error("find-ref by substring: not implemented yet");
  for (const ref of findRefs(image, strOff)) line(`0x${ref.offset.toString(16)}  ${ref.kind}`);
};

const cmdAddr = (args: string[]): void => {
  const [target] = args;
  if (target === undefined) throw new Error("addr needs a file offset or seg:off");
  if (target.includes(":")) {
    const [seg, off] = target.split(":").map((n) => Number.parseInt(n, 16));
    line(`0x${segOffToFile({ seg, off }).toString(16)}`);
  } else {
    const at = fileToSegOff(Number.parseInt(target, 16));
    line(`${at.seg.toString(16)}:${at.off.toString(16)}`);
  }
};

const arg = (args: string[], i: number, what: string): string => {
  const value = args[i];
  if (value === undefined) throw new Error(`missing argument: ${what}`);
  return value;
};

const cmdCcList = (args: string[]): void => {
  const path = arg(args, 0, "archive.CC");
  const archive = read(path);
  const entries = readToc(archive);
  line(`${rel(path)}: ${entries.length} members`);
  for (const e of entries.toSorted((a, b) => a.size - b.size)) {
    const declen = u32(archive, e.offset);
    line(
      `id=0x${e.id.toString(16).padStart(4, "0")}` +
        `  off=${String(e.offset).padStart(7)}` +
        `  comp=${String(e.size).padStart(6)}` +
        `  declen=${String(declen).padStart(6)}`,
    );
  }
};

const cmdCcExtract = (args: string[]): void => {
  const [path, id, out] = [
    arg(args, 0, "archive.CC"),
    Number.parseInt(arg(args, 1, "id-hex"), 16),
    arg(args, 2, "out.bin"),
  ];
  const raw = decodeMember(read(path), id);
  write(out, raw);
  line(`${rel(out)}  (${raw.length} bytes)`);
};

const cmdCcReplace = (args: string[]): void => {
  const [path, id, input, out] = [
    arg(args, 0, "archive.CC"),
    Number.parseInt(arg(args, 1, "id-hex"), 16),
    arg(args, 2, "in.bin"),
    arg(args, 3, "out.CC"),
  ];
  write(out, rebuild(read(path), new Map([[id, read(input)]])));
  line(rel(out));
};

const cmdFontExport = (args: string[]): void => {
  const glyphs = args[2];
  fontExport(
    arg(args, 0, "archive.CC"),
    arg(args, 1, "out.png"),
    glyphs === undefined ? undefined : Number.parseInt(glyphs, 10),
  );
};

const cmdFontImport = (args: string[]): void =>
  fontImport(arg(args, 0, "in.png"), arg(args, 1, "archive.CC"), arg(args, 2, "out.CC"));

const COMMANDS = new Map<string, (args: string[]) => void>([
  ["build", build],
  ["verify", verify],
  ["asm-selftest", selftest],
  ["find-ref", cmdFindRef],
  ["addr", cmdAddr],
  ["cc-list", cmdCcList],
  ["cc-extract", cmdCcExtract],
  ["cc-replace", cmdCcReplace],
  ["font-export", cmdFontExport],
  ["font-import", cmdFontImport],
  ["font-bake", fontBake],
]);

const main = (argv: string[]): void => {
  const [name, ...args] = argv;
  const command = name === undefined ? undefined : COMMANDS.get(name);
  if (command === undefined) {
    console.log(USAGE);
    if (name !== undefined) throw new Error(`unknown command: ${name}`);
    return;
  }
  command(args);
};

try {
  main(process.argv.slice(2));
} catch (err) {
  console.error(`\nerror: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
