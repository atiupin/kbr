/**
 * argv in, exit code out -- the only entry point, and the only place that ends
 * the process. Commands report through report.ts and signal failure by throwing;
 * anything thrown, from here or from core, prints one line and exits 1.
 */

import { findRefs } from "../core/findRef.ts";
import { fileToSegOff, segOffToFile } from "../core/addr.ts";
import { build } from "./build.ts";
import { read } from "./io.ts";
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

const COMMANDS = new Map<string, (args: string[]) => void>([
  ["build", build],
  ["verify", verify],
  ["asm-selftest", selftest],
  ["find-ref", cmdFindRef],
  ["addr", cmdAddr],
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
