/**
 * Assembles 16-bit real-mode 8086, for patches that need new code rather than a new
 * constant.
 *
 * Hand-encoding a 200-byte routine into a `bytes` row is a one-way door: every later edit
 * reflows the whole blob. This is the smallest assembler that covers what a patch routine
 * needs — no macros, no expressions, no segment arithmetic.
 *
 * `relocs` lists the offsets, relative to the start of `code`, of `callf` segment words.
 * Each one MUST get an MZ relocation entry, or DOS leaves it holding a link-time segment
 * and the call lands in whatever is loaded there.
 *
 * Encoding follows Turbo C's choices wherever the ISA offers one, so reassembled game code
 * comes out byte-identical and SELFTEST_CASES means something: accumulator short forms for
 * `ax`/`al` even when the immediate would fit in a byte, the sign-extended 0x83 form for
 * every other register, and `8b` (mov r, r/m) for register-to-register moves.
 *
 * 8086 only: `push <imm>` is rejected rather than encoded as the 80186 form 0x68, which the
 * game's target CPU has no opcode for.
 *
 * Syntax
 *     label:                  defines a label
 *     mov ax,[bp+6]           registers ax cx dx bx sp bp si di / al cl dl bl ah ch dh bh
 *     mov byte [di+8],1       `byte`/`word` sizes an immediate store
 *     callf 0x1168:0x03ca     far call, records a reloc
 *     jz done                 rel8 jumps; `jmp` widens to rel16 when it must
 *     db 0x41,"A)"            raw bytes, CP866 for strings
 *     dw 0x2e65               raw words
 */

import { encodeCp866 } from "./cp866.ts";

export interface Assembled {
  code: Uint8Array;
  /** Offsets into `code` holding a segment value the patcher must relocate. */
  relocs: number[];
  symbols: Map<string, number>;
}

const R16: readonly string[] = ["ax", "cx", "dx", "bx", "sp", "bp", "si", "di"];
const R8: readonly string[] = ["al", "cl", "dl", "bl", "ah", "ch", "dh", "bh"];

// ALU group order is the opcode's /r field and its base opcode: op*8 gives the r/m form.
const ALU: readonly string[] = ["add", "or", "adc", "sbb", "and", "sub", "xor", "cmp"];

/** The base registers a 16-bit r/m addresses, keyed by the rm field's meaning. */
// prettier-ignore
const RM16 = new Map<string, number>([
  ["bx+si", 0], ["bx+di", 1], ["bp+si", 2], ["bp+di", 3],
  ["si", 4], ["di", 5], ["bp", 6], ["bx", 7],
]);

// prettier-ignore
const JCC = new Map<string, number>([
  ["jo", 0x0], ["jno", 0x1],
  ["jb", 0x2], ["jc", 0x2], ["jnae", 0x2], ["jnb", 0x3], ["jnc", 0x3], ["jae", 0x3],
  ["jz", 0x4], ["je", 0x4], ["jnz", 0x5], ["jne", 0x5],
  ["jbe", 0x6], ["jna", 0x6], ["ja", 0x7], ["jnbe", 0x7],
  ["js", 0x8], ["jns", 0x9], ["jp", 0xa], ["jnp", 0xb],
  ["jl", 0xc], ["jnge", 0xc], ["jge", 0xd], ["jnl", 0xd],
  ["jle", 0xe], ["jng", 0xe], ["jg", 0xf], ["jnle", 0xf],
]);

// prettier-ignore
const NO_OPERAND = new Map<string, number>([
  ["nop", 0x90], ["cbw", 0x98], ["cwd", 0x99], ["ret", 0xc3], ["retf", 0xcb],
  ["clc", 0xf8], ["stc", 0xf9], ["pushf", 0x9c], ["popf", 0x9d],
  ["xlat", 0xd7],   // al = ds:[bx+al], the whole point of a lookup patch
]);

const SHIFT = new Map<string, number>([
  ["shl", 4],
  ["shr", 5],
  ["sar", 7],
]);

// prettier-ignore
const UNARY = new Map<string, number>([
  ["not", 2], ["neg", 3], ["mul", 4], ["imul", 5], ["div", 6], ["idiv", 7],
]);

class AsmError extends Error {}

/** A memory operand: base-register pair as its rm field, or null for a bare address. */
interface Mem {
  base: number | null;
  disp: number;
}

type Operand =
  | { kind: "r16"; reg: number }
  | { kind: "r8"; reg: number }
  | { kind: "mem"; mem: Mem }
  | { kind: "imm"; value: number };

const w16 = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff];

const regForm = (op: number, reg: number, rm: number): number[] => [
  op,
  0xc0 | (reg << 3) | rm,
];

const memModrm = (mem: Mem, reg: number, out: number[]): void => {
  if (mem.base === null) {
    out.push(0x06 | (reg << 3), ...w16(mem.disp));
  } else if (mem.disp === 0 && mem.base !== 6) {
    // rm=6 has no no-displacement form — that slot encodes a bare address instead.
    out.push((reg << 3) | mem.base);
  } else if (mem.disp >= -0x80 && mem.disp <= 0x7f) {
    out.push(0x40 | (reg << 3) | mem.base, mem.disp & 0xff);
  } else {
    out.push(0x80 | (reg << 3) | mem.base, ...w16(mem.disp));
  }
};

type Symbols = Map<string, number>;

const parseNum = (tok: string, symbols: Symbols, need: boolean): number => {
  const t = tok.trim();
  if (/^-?0x[0-9a-fA-F]+$/.test(t)) return Number.parseInt(t, 16);
  if (/^-?\d+$/.test(t)) return Number.parseInt(t, 10);
  const value = symbols.get(t);
  if (value !== undefined) return value;
  if (need) throw new AsmError(`undefined symbol or bad number: ${JSON.stringify(t)}`);
  return 0;
};

const parseOperand = (tok: string, symbols: Symbols, need: boolean): Operand => {
  const t = tok.trim();
  const low = t.toLowerCase();
  if (R16.includes(low)) return { kind: "r16", reg: R16.indexOf(low) };
  if (R8.includes(low)) return { kind: "r8", reg: R8.indexOf(low) };
  const bracketed = /^\[([^\]]+)\]$/.exec(t);
  if (bracketed === null) return { kind: "imm", value: parseNum(t, symbols, need) };

  // Only the base-register part folds case; the displacement may be a symbol.
  const inner = bracketed[1].trim();
  // a base pair first: [bx+si] is not bx plus si
  const bare = RM16.get(inner.toLowerCase());
  if (bare !== undefined) return { kind: "mem", mem: { base: bare, disp: 0 } };
  const split = /^([a-zA-Z+]+?)\s*([+-])\s*(\S+)$/.exec(inner);
  const base = split === null ? undefined : RM16.get(split[1].toLowerCase());
  if (split !== null && base !== undefined) {
    const disp = parseNum(split[3], symbols, need);
    return { kind: "mem", mem: { base, disp: split[2] === "-" ? -disp : disp } };
  }
  return { kind: "mem", mem: { base: null, disp: parseNum(inner, symbols, need) } };
};

/** Splits on commas that are outside brackets and outside a string. */
const splitOperands = (rest: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  let quote: string | null = null;
  for (const ch of rest) {
    if (quote !== null) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "[") depth++;
    else if (ch === "]") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim() !== "") parts.push(cur);
  return parts.map((p) => p.trim());
};

const stripSize = (ops: string[]): { size: string | null; ops: string[] } => {
  const m = /^(byte|word)\s+(.*)$/i.exec(ops[0]);
  if (m === null) return { size: null, ops };
  return { size: m[1].toLowerCase(), ops: [m[2], ...ops.slice(1)] };
};

/**
 * Where a branch goes, for sizing as much as for emission. An unseen label sizes as `pc`,
 * not 0 — guessing 0 makes every forward jump look like a huge backward one and widens it
 * to rel16. Literal addresses are known on the first pass and must not get that treatment,
 * or they size short instead.
 */
const branchTarget = (tok: string, symbols: Symbols, pc: number, need: boolean): number => {
  const t = tok.trim();
  const named = /^[A-Za-z_][\w.]*$/.test(t);
  if (named && !symbols.has(t) && !need) return pc;
  return parseNum(t, symbols, need);
};

interface Encoded {
  bytes: number[];
  relocs: number[];
}

const plain = (bytes: number[]): Encoded => ({ bytes, relocs: [] });

/**
 * Encodes one instruction, with reloc offsets relative to its own first byte. Branch
 * destinations are appended to `targets` so the caller can check they land on an
 * instruction boundary.
 */
const encode = (
  mnem: string,
  ops: string[],
  symbols: Symbols,
  pc: number,
  need: boolean,
  targets: number[],
): Encoded => {
  const bare = NO_OPERAND.get(mnem);
  if (bare !== undefined) return plain([bare]);

  if (mnem === "callf") {
    const m = /^(\S+)\s*:\s*(\S+)$/.exec(ops[0]);
    if (m === null) throw new AsmError("callf wants seg:off");
    const seg = parseNum(m[1], symbols, need);
    const off = parseNum(m[2], symbols, need);
    // DOS fixes up the segment word
    return { bytes: [0x9a, ...w16(off), ...w16(seg)], relocs: [3] };
  }

  const cc = JCC.get(mnem);
  if (cc !== undefined) {
    const target = branchTarget(ops[0], symbols, pc, need);
    targets.push(target);
    const rel = target - (pc + 2);
    if (need && (rel < -0x80 || rel > 0x7f)) {
      throw new AsmError(`${mnem} out of rel8 range (${rel})`);
    }
    return plain([0x70 | cc, rel & 0xff]);
  }

  if (mnem === "jmp") {
    const target = branchTarget(ops[0], symbols, pc, need);
    targets.push(target);
    const short = target - (pc + 2);
    if (short >= -0x80 && short <= 0x7f) return plain([0xeb, short & 0xff]);
    return plain([0xe9, ...w16(target - (pc + 3))]);
  }

  if (mnem === "push" || mnem === "pop") {
    const op = parseOperand(ops[0], symbols, need);
    if (op.kind === "r16") return plain([(mnem === "push" ? 0x50 : 0x58) + op.reg]);
    if (op.kind === "mem") {
      const out = [mnem === "push" ? 0xff : 0x8f];
      memModrm(op.mem, mnem === "push" ? 6 : 0, out);
      return plain(out);
    }
    throw new AsmError(
      `${mnem} takes a word register or memory; 8086 has no push-immediate`,
    );
  }

  if (mnem === "inc" || mnem === "dec") {
    const sized = stripSize(ops);
    const op = parseOperand(sized.ops[0], symbols, need);
    const field = mnem === "inc" ? 0 : 1;
    if (op.kind === "r16") return plain([(mnem === "inc" ? 0x40 : 0x48) + op.reg]);
    if (op.kind === "r8") return plain(regForm(0xfe, field, op.reg));
    if (op.kind === "imm") throw new AsmError(`${mnem} takes a register or memory`);
    const out = [sized.size === "byte" ? 0xfe : 0xff];
    memModrm(op.mem, field, out);
    return plain(out);
  }

  const shift = SHIFT.get(mnem);
  if (shift !== undefined) {
    const op = parseOperand(ops[0], symbols, need);
    if (op.kind !== "r16" && op.kind !== "r8")
      throw new AsmError(`${mnem} takes a register`);
    if (parseNum(ops[1], symbols, need) !== 1)
      throw new AsmError("only shift-by-1 is supported");
    return plain(regForm(op.kind === "r16" ? 0xd1 : 0xd0, shift, op.reg));
  }

  const unary = UNARY.get(mnem);
  if (unary !== undefined) {
    const op = parseOperand(ops[0], symbols, need);
    if (op.kind !== "r16" && op.kind !== "r8")
      throw new AsmError(`${mnem} takes a register`);
    return plain(regForm(op.kind === "r16" ? 0xf7 : 0xf6, unary, op.reg));
  }

  if (mnem === "mov") return plain(encMov(ops, symbols, need));
  if (ALU.includes(mnem)) return plain(encAlu(mnem, ops, symbols, need));

  throw new AsmError(`unsupported mnemonic ${JSON.stringify(mnem)}`);
};

const encMov = (rawOps: string[], symbols: Symbols, need: boolean): number[] => {
  const { size, ops } = stripSize(rawOps);
  const d = parseOperand(ops[0], symbols, need);
  const s = parseOperand(ops[1], symbols, need);
  if (d.kind === "r16" && s.kind === "imm") return [0xb8 + d.reg, ...w16(s.value)];
  if (d.kind === "r8" && s.kind === "imm") return [0xb0 + d.reg, s.value & 0xff];
  // Turbo C's direction
  if (d.kind === "r16" && s.kind === "r16") return regForm(0x8b, d.reg, s.reg);
  if (d.kind === "r8" && s.kind === "r8") return regForm(0x8a, d.reg, s.reg);
  if ((d.kind === "r16" || d.kind === "r8") && s.kind === "mem") {
    // ax/al with a bare address has a one-byte-shorter form the compiler always takes.
    if (d.reg === 0 && s.mem.base === null) {
      return [d.kind === "r16" ? 0xa1 : 0xa0, ...w16(s.mem.disp)];
    }
    const out = [d.kind === "r16" ? 0x8b : 0x8a];
    memModrm(s.mem, d.reg, out);
    return out;
  }
  if (d.kind === "mem" && (s.kind === "r16" || s.kind === "r8")) {
    if (s.reg === 0 && d.mem.base === null) {
      return [s.kind === "r16" ? 0xa3 : 0xa2, ...w16(d.mem.disp)];
    }
    const out = [s.kind === "r16" ? 0x89 : 0x88];
    memModrm(d.mem, s.reg, out);
    return out;
  }
  if (d.kind === "mem" && s.kind === "imm") {
    if (size === null) throw new AsmError("store of an immediate needs `byte` or `word`");
    const out = [size === "byte" ? 0xc6 : 0xc7];
    memModrm(d.mem, 0, out);
    return [...out, ...(size === "byte" ? [s.value & 0xff] : w16(s.value))];
  }
  throw new AsmError(`unsupported mov form: ${ops.join(",")}`);
};

const encAlu = (
  mnem: string,
  rawOps: string[],
  symbols: Symbols,
  need: boolean,
): number[] => {
  const op = ALU.indexOf(mnem);
  const { size, ops } = stripSize(rawOps);
  const d = parseOperand(ops[0], symbols, need);
  const s = parseOperand(ops[1], symbols, need);
  if ((d.kind === "r16" || d.kind === "r8") && s.kind === "imm") {
    if (d.reg === 0) {
      // accumulator short form, full-width immediate
      if (d.kind === "r16") return [op * 8 + 5, ...w16(s.value)];
      return [op * 8 + 4, s.value & 0xff];
    }
    if (d.kind === "r16" && s.value >= -0x80 && s.value <= 0x7f) {
      return [...regForm(0x83, op, d.reg), s.value & 0xff];
    }
    const out = regForm(d.kind === "r16" ? 0x81 : 0x80, op, d.reg);
    return [...out, ...(d.kind === "r16" ? w16(s.value) : [s.value & 0xff])];
  }
  if (d.kind === "r16" && s.kind === "r16") return regForm(op * 8 + 3, d.reg, s.reg);
  if (d.kind === "r8" && s.kind === "r8") return regForm(op * 8 + 2, d.reg, s.reg);
  if ((d.kind === "r16" || d.kind === "r8") && s.kind === "mem") {
    const out = [op * 8 + (d.kind === "r16" ? 3 : 2)];
    memModrm(s.mem, d.reg, out);
    return out;
  }
  if (d.kind === "mem" && (s.kind === "r16" || s.kind === "r8")) {
    const out = [op * 8 + (s.kind === "r16" ? 1 : 0)];
    memModrm(d.mem, s.reg, out);
    return out;
  }
  if (d.kind === "mem" && s.kind === "imm") {
    if (size === null)
      throw new AsmError(`${mnem} of an immediate needs \`byte\` or \`word\``);
    const out = [size === "byte" ? 0x80 : 0x81];
    memModrm(d.mem, op, out);
    return [...out, ...(size === "byte" ? [s.value & 0xff] : w16(s.value))];
  }
  throw new AsmError(`unsupported ${mnem} form: ${ops.join(",")}`);
};

const encData = (mnem: string, rest: string, symbols: Symbols, need: boolean): number[] => {
  const out: number[] = [];
  for (const tok of splitOperands(rest)) {
    const str = /^"([\s\S]*)"$/.exec(tok);
    if (str !== null) out.push(...encodeCp866(str[1]));
    else if (mnem === "db") out.push(parseNum(tok, symbols, need) & 0xff);
    else out.push(...w16(parseNum(tok, symbols, need)));
  }
  return out;
};

type Line =
  | { kind: "label"; name: string }
  | { kind: "equ"; name: string; expr: string }
  | { kind: "insn"; mnem: string; rest: string };

const parseLines = (source: string): Line[] => {
  const lines: Line[] = [];
  for (const raw of source.split("\n")) {
    let line = raw.split(";")[0].trim();
    const equ = /^([A-Za-z_]\w*)\s+equ\s+(.+)$/.exec(line);
    if (equ !== null) {
      lines.push({ kind: "equ", name: equ[1], expr: equ[2].trim() });
      continue;
    }
    while (line !== "") {
      const label = /^([A-Za-z_.][\w.]*)\s*:(?!\s*[0-9a-fA-Fx])/.exec(line);
      if (label !== null) {
        lines.push({ kind: "label", name: label[1] });
        line = line.slice(label[0].length).trim();
        continue;
      }
      const sp = line.search(/\s/);
      lines.push({
        kind: "insn",
        mnem: (sp === -1 ? line : line.slice(0, sp)).toLowerCase(),
        rest: sp === -1 ? "" : line.slice(sp + 1).trim(),
      });
      break;
    }
  }
  return lines;
};

interface Pass {
  code: Uint8Array;
  relocs: number[];
  symbols: Symbols;
  boundaries: Set<number>;
  targets: number[];
}

/**
 * One layout or emission pass. `final` decides both whether bytes are kept and whether an
 * unresolved name is an error or a placeholder.
 */
const onePass = (
  lines: readonly Line[],
  org: number,
  symbols: Symbols,
  final: boolean,
): Pass => {
  const pass = new Map(symbols);
  const defined = new Set<string>();
  const boundaries = new Set<number>();
  const targets: number[] = [];
  const out: number[] = [];
  const relocs: number[] = [];
  let pc = org;
  for (const line of lines) {
    if (line.kind === "label" || line.kind === "equ") {
      // A redefinition is never intentional here and never visible in the output: the last
      // one wins, and every earlier branch to that name silently retargets.
      if (defined.has(line.name)) {
        throw new AsmError(
          `${JSON.stringify(line.name)} is defined twice -- ` +
            `branches to it would go to the later one`,
        );
      }
      defined.add(line.name);
    }
    if (line.kind === "label") {
      pass.set(line.name, pc);
      continue;
    }
    if (line.kind === "equ") {
      pass.set(line.name, parseNum(line.expr, pass, final));
      continue;
    }
    boundaries.add(pc);
    let chunk: Encoded;
    try {
      chunk =
        line.mnem === "db" || line.mnem === "dw"
          ? plain(encData(line.mnem, line.rest, pass, final))
          : encode(line.mnem, splitOperands(line.rest), pass, pc, final, targets);
    } catch (err) {
      if (!(err instanceof AsmError)) throw err;
      throw new AsmError(`${line.mnem} ${line.rest}: ${err.message}`);
    }
    if (final) {
      for (const r of chunk.relocs) relocs.push(pc - org + r);
      out.push(...chunk.bytes);
    }
    pc += chunk.bytes.length;
  }
  boundaries.add(pc);
  return { code: Uint8Array.from(out), relocs, symbols: pass, boundaries, targets };
};

/** Map compares by identity, and the fixed-point test needs the values. */
const sameSymbols = (a: Symbols, b: Symbols): boolean =>
  a.size === b.size && [...a].every(([name, at]) => b.get(name) === at);

export const assemble = (source: string, org = 0): Assembled => {
  const lines = parseLines(source);

  // A jump that widens moves every label after it, which can widen another — so size to a
  // fixed point, then emit and demand nothing moved. A label that shifts between the two is
  // a silently wrong branch target.
  let symbols: Symbols = new Map();
  let settled = false;
  for (let i = 0; i < 8 && !settled; i++) {
    const next = onePass(lines, org, symbols, false).symbols;
    settled = sameSymbols(next, symbols);
    symbols = next;
  }
  if (!settled)
    throw new AsmError("instruction sizes did not settle -- a jump is oscillating");

  const final = onePass(lines, org, symbols, true);
  const moved = [...final.symbols]
    .filter(([name, at]) => symbols.get(name) !== at)
    .map(([name, at]) => `${name} ${symbols.get(name)} -> ${at}`);
  if (moved.length > 0) {
    const list = moved.join(", ");
    throw new AsmError(`labels moved during emission, so a branch would be wrong: ${list}`);
  }

  // A branch into the middle of an instruction executes the operand bytes as opcodes.
  // Targets outside this source (the stub jumps into the game) cannot be checked here.
  const stray = [...new Set(final.targets)]
    .filter((t) => t >= org && t < org + final.code.length && !final.boundaries.has(t))
    .sort((a, b) => a - b);
  if (stray.length > 0) {
    const list = stray.map((t) => `0x${t.toString(16)}`).join(", ");
    throw new AsmError(`branch target(s) not on an instruction boundary: ${list}`);
  }
  return { code: final.code, relocs: final.relocs, symbols: final.symbols };
};

/**
 * Reassembling shipped code byte-for-byte is the only check that this encoder makes the
 * same choices as the compiler that built the image — a wrong-but-valid encoding would pass
 * every other test and silently shift every label in a real patch.
 */
export interface SelftestCase {
  name: string;
  source: string;
  /** File offset in KBU2.EXE of the routine this source must reproduce, and its length. */
  at: number;
  length: number;
}

/** The Town/Castle Gate list printer: accumulator forms, far calls, a forward jump. */
const PRINTER_SRC = `
    push bp
    mov  bp,sp
    push si
    mov  si,[bp+6]
    mov  ax,[bp+8]
    add  ax,0x41
    push ax
    callf 0x1168:0x05eb
    pop  cx
    mov  ax,0x2c
    push ax
    callf 0x1168:0x05eb
    pop  cx
    inc  si
    mov  ax,si
    cmp  ax,0xd
    jnz  done
    mov  ax,0x9d
    push ax
    mov  ax,0x2
    push ax
    callf 0x1168:0x0fb7
    pop  cx
    pop  cx
done:
    mov  ax,si
    pop  si
    pop  bp
    retf
`;

/**
 * The gate's visited-scan loop: indexed loads through bx, byte compares against a table, a
 * backward branch. These are the forms a replacement routine is built from.
 */
const SCAN_SRC = `
    mov  byte [bp-0x2],0x0
    mov  byte [bp-0x1],0x0
    jmp  next
body:
    or   si,si
    jz   castle
    mov  al,[bp-0x1]
    mov  ah,0x0
    mov  bx,ax
    mov  al,[bx+0x3007]
    mov  ah,0x0
    mov  bx,ax
    cmp  byte [bx+0x64e5],0x0
    jz   step
    jmp  emit
castle:
    mov  al,[bp-0x1]
    mov  ah,0x0
    mov  bx,ax
    cmp  byte [bx+0x64cb],0x0
    jz   step
emit:
    mov  al,[bp-0x1]
    mov  ah,0x0
    push ax
    mov  al,[bp-0x2]
    mov  ah,0x0
    push ax
    callf 0x0c2c:0x16be
    pop  cx
    pop  cx
    mov  [bp-0x2],al
step:
    inc  byte [bp-0x1]
next:
    cmp  byte [bp-0x1],0x1a
    jc   body
`;

export const SELFTEST_CASES: readonly SelftestCase[] = [
  { name: "gate list printer", source: PRINTER_SRC, at: 0xf97e, length: 0x3a },
  { name: "gate visited scan", source: SCAN_SRC, at: 0xf7f3, length: 0x53 },
];
