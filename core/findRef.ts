/**
 * What points at a string. An authoring aid, not a build step — but a hard dependency of
 * one: a `reloc` row's refs must come from here and nowhere else, because a 2-byte value
 * that merely happens to equal a string's DS offset looks exactly like a pointer.
 *
 * Game text is reached through 2-byte NEAR offsets (DS-relative). A ref sits either in a
 * DGROUP pointer table or inside a code instruction as an immediate operand. Most box/bio
 * lines have exactly one; several means the string is used from several places and all its
 * pointers must move together, so they belong in ONE manifest row.
 *
 * No ref found means "not repointable by this tool", never "not a pointer": the string is
 * reached by computed/indexed access, or sits in a table too short to prove itself. A
 * `table` verdict says nothing about liveness either — tables are read base+index, often
 * from several bases into one array, so no immediate ever equals such a slot's own DS
 * offset and grepping for one cannot prove a slot dead. Only a screenshot settles that.
 */

import { DS_BASE, PROT_HI, PROT_LO } from "./applyPatches.ts";
import { cstring, findAll, packU16, u16 } from "./bytes.ts";
import { decodeCp866 } from "./cp866.ts";

/** End of the original loaded image, i.e. DS offset 0x6390. Past it lies no game text. */
const IMAGE_END = 0x1ba20;

// Opcodes that load a 16-bit immediate, which is how Turbo C passes a near string pointer:
// mov ax/cx/dx/bx/si/di, imm16 ; push imm16.
const LOAD_OPS = new Set([0xb8, 0xb9, 0xba, 0xbb, 0xbe, 0xbf, 0x68]);

export interface Ref {
  /** File offset of the 2-byte DS offset. */
  offset: number;
  /** How the candidate was validated: a lone immediate, or a chained table slot. */
  kind: "immediate" | "table";
}

/**
 * Length of the NUL-terminated printable string at DS offset `dsoff`, else undefined.
 *
 * The EMPTY string counts (length 0). Tables here pad an unused slot with a pointer to the
 * NUL that ends the previous string, and `chains` has to step through such a slot to reach
 * the entries on the far side of it — the artifact table at 0x183a8 is three quarters
 * padding of exactly that kind.
 */
const stringLen = (image: Uint8Array, dsoff: number): number | undefined => {
  const from = DS_BASE + dsoff;
  if (from >= IMAGE_END) return undefined;
  const end = image.indexOf(0, from);
  if (end < 0 || end - from > 64) return undefined;
  for (let i = from; i < end; i++) if (image[i] < 32 || image[i] >= 127) return undefined;
  return end - from;
};

/**
 * True when the slots at `i` and `i + 2` are CONSECUTIVE entries of a pointer table.
 *
 * Not "both look like strings" — that test is far too weak, it promotes any coincidental
 * byte pair to a ref, and a slot in a descending counter table (file 0x18855) passes it.
 * This asks the arithmetic question instead:
 *
 *     table[k + 1] == table[k] + len(string k) + 1
 *
 * i.e. the next slot points exactly one past the NUL of this slot's string. Compilers emit
 * string literals in the order the table lists them, so every real table walks its block
 * that way, and forging a link needs two adjacent words that happen to be the offsets of
 * two adjacent strings.
 */
const chains = (image: Uint8Array, i: number): boolean => {
  if (i < DS_BASE || i + 4 > IMAGE_END) return false;
  const a = u16(image, i);
  const len = stringLen(image, a);
  return len !== undefined && u16(image, i + 2) === a + len + 1;
};

/**
 * Every ref pointing at the string at file offset `strOff`.
 *
 * Conservative by design: a false ref corrupts whatever it lands on, so a site is only
 * reported when it is structurally a pointer — an immediate operand of a known load
 * instruction, or a slot whose neighbours are themselves string pointers and which is
 * ordered like a real table.
 *
 * Conservative is not the same as sound, and `immediate` is the weaker of the two tests: it
 * only asks whether the PRECEDING BYTE is a load opcode, and nothing here tracks
 * instruction boundaries. A jump whose displacement happens to equal a load opcode fakes
 * one — DS 0x47eb is reported at file 0x5240, where the vouching 0xbf is the displacement
 * of a `jz`, not a `mov di`, and repointing it would rewrite a branch target. So when a
 * string reports BOTH a table entry and a lone immediate, disassemble the code site before
 * trusting it (ghidra/scripts/FindStringUsers.java scans decoded instructions and settles
 * it); a table entry needs no such check, the chain already validated it.
 *
 * A slot is accepted when it sits in a run of THREE chained slots, in any of the three
 * positions — which is what reaches a table's first and last entry. TWO chained slots are
 * not enough: an arithmetic ramp fakes one link whenever its step equals a string length
 * there, as the menu table at 0x18cc8 (step 9) does, offering DS 0x102 — two bytes into
 * ' Controls ' — as a pointer. Its second link fails, so the run test rejects it.
 */
export const findRefs = (image: Uint8Array, strOff: number): Ref[] => {
  const refs: Ref[] = [];
  for (const i of findAll(image, packU16(strOff - DS_BASE))) {
    if (i < DS_BASE) {
      if (i > 0 && LOAD_OPS.has(image[i - 1])) refs.push({ offset: i, kind: "immediate" });
    } else if (
      (chains(image, i) && chains(image, i + 2)) || // the run starts here
      (chains(image, i - 2) && chains(image, i)) || // ...or i is inside it
      (chains(image, i - 4) && chains(image, i - 2)) // ...or it ends here
    ) {
      refs.push({ offset: i, kind: "table" });
    }
  }
  return refs;
};

/**
 * Refs here are genuine pointers, but repointing one hangs the game much later on an
 * unrelated screen. Reported, never offered as part of a paste-ready row.
 */
export const inProtection = (offset: number): boolean =>
  offset >= PROT_LO && offset <= PROT_HI;

/** File offsets of the strings in the text region containing `needle`, ascending. */
export const findStrings = (image: Uint8Array, needle: Uint8Array): number[] => {
  const starts = new Set<number>();
  for (const i of findAll(image, needle, DS_BASE)) {
    if (i >= IMAGE_END) break;
    let start = i;
    while (start > DS_BASE && image[start - 1] !== 0) start--;
    starts.add(start);
  }
  return [...starts].sort((a, b) => a - b);
};

export const stringAt = (image: Uint8Array, strOff: number): string =>
  decodeCp866(cstring(image, strOff));

export const hexOffset = (offset: number): string =>
  `0x${offset.toString(16).padStart(6, "0")}`;

/** One manifest text column: the escapes the patcher reads, plus CSV quote doubling. */
const field = (text: string): string => {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === "\\") out += "\\\\";
    else if (ch === '"') out += '""';
    else if (code < 0x20 || code === 0x7f)
      out += `\\x${code.toString(16).padStart(2, "0")}`;
    else out += ch;
  }
  return out;
};

/**
 * The row to paste into res/patches.csv. `expect` is the original English: the patcher
 * follows every ref and checks the string it lands on, so the manifest stays readable and
 * verified at once.
 */
export const relocRow = (refs: readonly number[], expect: string): string =>
  `reloc,${refs.map(hexOffset).join(" ")},"${field(expect)}","<Russian>"`;
