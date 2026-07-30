#!/usr/bin/env python3
"""Assemble 16-bit real-mode 8086 for patches that need new code, not a new constant.

    python3 tools/asm16.py selftest      # reassemble a shipped routine, demand byte equality

Hand-encoding a 200-byte routine into a `bytes` row is a one-way door: every later edit
reflows the whole blob. This is the smallest assembler that covers what a patch routine
needs -- no macros, no expressions, no segment arithmetic.

assemble(source, org=0) -> (bytes, relocs, symbols). `relocs` lists the file-relative
offsets of `callf` segment words: each one MUST get an MZ relocation entry, or DOS leaves
it holding a link-time segment and the call lands in whatever is loaded there.

Encoding follows Turbo C's choices where the ISA offers a choice, so reassembled game code
comes out byte-identical and the selftest is meaningful: accumulator short forms for
`ax`/`al` even when the immediate would fit in a byte, the sign-extended 0x83 form for
every other register, and `8b` (mov r, r/m) for register-to-register moves.

8086 only: `push <imm>` is rejected rather than encoded as the 80186 form 0x68, which the
game's target CPU has no opcode for.

Syntax
    label:                  defines a label
    mov ax,[bp+6]           registers ax cx dx bx sp bp si di / al cl dl bl ah ch dh bh
    mov byte [di+8],1       `byte`/`word` sizes an immediate store
    callf 0x1168:0x03ca     far call, records a reloc
    jz done                 rel8 jumps; `jmp` widens to rel16 when it must
    db 0x41,"A)"            raw bytes, CP866 for strings
    dw 0x2e65               raw words
"""

import re
import sys
from collections import namedtuple

R16 = ("ax", "cx", "dx", "bx", "sp", "bp", "si", "di")
R8 = ("al", "cl", "dl", "bl", "ah", "ch", "dh", "bh")

# ALU group order is the opcode's /r field and its base opcode: op*8 gives the r/m form.
ALU = ("add", "or", "adc", "sbb", "and", "sub", "xor", "cmp")

# 16-bit r/m: index is the rm field, value the base registers it addresses.
RM16 = {"bx+si": 0, "bx+di": 1, "bp+si": 2, "bp+di": 3, "si": 4, "di": 5, "bp": 6, "bx": 7}

JCC = {"jo": 0x0, "jno": 0x1, "jb": 0x2, "jc": 0x2, "jnae": 0x2,
       "jnb": 0x3, "jnc": 0x3, "jae": 0x3, "jz": 0x4, "je": 0x4,
       "jnz": 0x5, "jne": 0x5, "jbe": 0x6, "jna": 0x6, "ja": 0x7, "jnbe": 0x7,
       "js": 0x8, "jns": 0x9, "jp": 0xA, "jnp": 0xB,
       "jl": 0xC, "jnge": 0xC, "jge": 0xD, "jnl": 0xD,
       "jle": 0xE, "jng": 0xE, "jg": 0xF, "jnle": 0xF}

NO_OPERAND = {"nop": 0x90, "cbw": 0x98, "cwd": 0x99, "ret": 0xC3, "retf": 0xCB,
              "clc": 0xF8, "stc": 0xF9, "pushf": 0x9C, "popf": 0x9D,
              "xlat": 0xD7}      # al = ds:[bx+al], the whole point of a lookup patch


class AsmError(Exception):
    pass


Pass = namedtuple("Pass", "code relocs symbols boundaries targets")


class Mem:
    """A memory operand: base register pair (or None for a bare address) plus displacement."""

    def __init__(self, base, disp):
        self.base = base
        self.disp = disp

    def modrm(self, reg, out):
        """Emit the modrm byte for `reg` against this operand, plus its displacement."""
        if self.base is None:
            out.append(0x06 | (reg << 3))
            out += w16(self.disp)
            return
        rm = RM16[self.base]
        # rm=6 has no no-displacement form -- that slot encodes a bare address instead.
        if self.disp == 0 and rm != 6:
            out.append((reg << 3) | rm)
        elif -0x80 <= self.disp <= 0x7F:
            out.append(0x40 | (reg << 3) | rm)
            out.append(self.disp & 0xFF)
        else:
            out.append(0x80 | (reg << 3) | rm)
            out += w16(self.disp)


def w16(v):
    return [v & 0xFF, (v >> 8) & 0xFF]


def modrm_reg(reg, rm, out):
    out.append(0xC0 | (reg << 3) | rm)


def parse_num(tok, symbols, need):
    tok = tok.strip()
    if re.fullmatch(r"-?0x[0-9a-fA-F]+", tok):
        return int(tok, 16)
    if re.fullmatch(r"-?\d+", tok):
        return int(tok, 10)
    if tok in symbols:
        return symbols[tok]
    if need:
        raise AsmError(f"undefined symbol or bad number: {tok!r}")
    return 0


def parse_operand(tok, symbols, need):
    """-> ('r16', n) | ('r8', n) | ('mem', Mem) | ('imm', value)."""
    tok = tok.strip()
    low = tok.lower()
    if low in R16:
        return "r16", R16.index(low)
    if low in R8:
        return "r8", R8.index(low)
    m = re.fullmatch(r"\[([^\]]+)\]", tok)
    if m:
        # Only the base-register part folds case; the displacement may be a symbol.
        inner = m.group(1).strip()
        if inner.lower() in RM16:          # a base pair first: [bx+si] is not bx plus si
            return "mem", Mem(inner.lower(), 0)
        mm = re.fullmatch(r"([a-zA-Z+]+?)\s*([+-])\s*(\S+)", inner)
        if mm and mm.group(1).lower() in RM16:
            disp = parse_num(mm.group(3), symbols, need)
            return "mem", Mem(mm.group(1).lower(), -disp if mm.group(2) == "-" else disp)
        return "mem", Mem(None, parse_num(inner, symbols, need))
    return "imm", parse_num(tok, symbols, need)


def split_operands(rest):
    """Split on commas that are not inside brackets or a string."""
    parts, depth, cur, quote = [], 0, "", None
    for ch in rest:
        if quote:
            cur += ch
            if ch == quote:
                quote = None
            continue
        if ch in "\"'":
            quote = ch
        elif ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    if cur.strip():
        parts.append(cur)
    return [p.strip() for p in parts]


def encode(mnem, ops, symbols, pc, need, targets=None):
    """Encode one instruction. Returns (bytes, reloc_offsets) relative to the instruction.
    Branch destinations are appended to `targets` so the caller can check they land on an
    instruction boundary."""
    relocs = []

    if mnem in NO_OPERAND:
        return [NO_OPERAND[mnem]], relocs

    if mnem == "callf":
        m = re.fullmatch(r"(\S+)\s*:\s*(\S+)", ops[0])
        if not m:
            raise AsmError("callf wants seg:off")
        seg = parse_num(m.group(1), symbols, need)
        off = parse_num(m.group(2), symbols, need)
        out = [0x9A] + w16(off) + w16(seg)
        relocs.append(3)                      # the segment word is what DOS fixes up
        return out, relocs

    if mnem in JCC or mnem == "jmp":
        # An unseen label sizes as pc, not 0 -- guessing 0 makes every forward jump look
        # like a huge backward one and widens it to rel16. Literal addresses are known on
        # the first pass and must not get that treatment, or they size short instead.
        tok = ops[0].strip()
        named = re.fullmatch(r"[A-Za-z_][\w.]*", tok)
        target = pc if named and tok not in symbols and not need \
            else parse_num(tok, symbols, need)
        if targets is not None:
            targets.append(target)
        if mnem == "jmp":
            rel = target - (pc + 2)
            if -0x80 <= rel <= 0x7F:
                return [0xEB, rel & 0xFF], relocs
            rel = target - (pc + 3)
            return [0xE9] + w16(rel), relocs
        rel = target - (pc + 2)
        if not -0x80 <= rel <= 0x7F and need:
            raise AsmError(f"{mnem} out of rel8 range ({rel})")
        return [0x70 | JCC[mnem], rel & 0xFF], relocs

    if mnem in ("push", "pop"):
        kind, val = parse_operand(ops[0], symbols, need)
        if kind == "r16":
            return [(0x50 if mnem == "push" else 0x58) + val], relocs
        if kind == "mem":
            out = [0xFF] if mnem == "push" else [0x8F]
            val.modrm(6 if mnem == "push" else 0, out)
            return out, relocs
        raise AsmError(f"{mnem} {ops[0]!r}: 8086 has no push-immediate")

    if mnem in ("inc", "dec"):
        size, ops = strip_size(ops)
        kind, val = parse_operand(ops[0], symbols, need)
        if kind == "r16":
            return [(0x40 if mnem == "inc" else 0x48) + val], relocs
        if kind == "r8":
            out = [0xFE]
            modrm_reg(0 if mnem == "inc" else 1, val, out)
            return out, relocs
        out = [0xFE if size == "byte" else 0xFF]
        val.modrm(0 if mnem == "inc" else 1, out)
        return out, relocs

    if mnem in ("shl", "shr", "sar"):
        kind, val = parse_operand(ops[0], symbols, need)
        if kind not in ("r16", "r8"):
            raise AsmError(f"{mnem} takes a register")
        if parse_num(ops[1], symbols, need) != 1:
            raise AsmError("only shift-by-1 is supported")
        out = [0xD1 if kind == "r16" else 0xD0]
        modrm_reg({"shl": 4, "shr": 5, "sar": 7}[mnem], val, out)
        return out, relocs

    if mnem in ("imul", "idiv", "mul", "div", "neg", "not"):
        kind, val = parse_operand(ops[0], symbols, need)
        if kind not in ("r16", "r8"):
            raise AsmError(f"{mnem} takes a register")
        out = [0xF7 if kind == "r16" else 0xF6]
        modrm_reg({"not": 2, "neg": 3, "mul": 4, "imul": 5, "div": 6, "idiv": 7}[mnem],
                  val, out)
        return out, relocs

    if mnem == "mov":
        return enc_mov(ops, symbols, pc, need), relocs

    if mnem in ALU:
        return enc_alu(mnem, ops, symbols, need), relocs

    raise AsmError(f"unsupported mnemonic {mnem!r}")


def strip_size(ops):
    m = re.fullmatch(r"(byte|word)\s+(.*)", ops[0], re.I)
    if m:
        return m.group(1).lower(), [m.group(2)] + ops[1:]
    return None, ops


def enc_mov(ops, symbols, pc, need):
    size, ops = strip_size(ops)
    dk, dv = parse_operand(ops[0], symbols, need)
    sk, sv = parse_operand(ops[1], symbols, need)
    if dk == "r16" and sk == "imm":
        return [0xB8 + dv] + w16(sv)
    if dk == "r8" and sk == "imm":
        return [0xB0 + dv, sv & 0xFF]
    if dk == "r16" and sk == "r16":
        out = [0x8B]                          # Turbo C's direction for reg,reg
        modrm_reg(dv, sv, out)
        return out
    if dk == "r8" and sk == "r8":
        out = [0x8A]
        modrm_reg(dv, sv, out)
        return out
    if dk in ("r16", "r8") and sk == "mem":
        # ax/al with a bare address has a one-byte-shorter form the compiler always takes.
        if dv == 0 and sv.base is None:
            return [0xA1 if dk == "r16" else 0xA0] + w16(sv.disp)
        out = [0x8B if dk == "r16" else 0x8A]
        sv.modrm(dv, out)
        return out
    if dk == "mem" and sk in ("r16", "r8"):
        if sv == 0 and dv.base is None:
            return [0xA3 if sk == "r16" else 0xA2] + w16(dv.disp)
        out = [0x89 if sk == "r16" else 0x88]
        dv.modrm(sv, out)
        return out
    if dk == "mem" and sk == "imm":
        if size is None:
            raise AsmError("store of an immediate needs `byte` or `word`")
        out = [0xC6 if size == "byte" else 0xC7]
        dv.modrm(0, out)
        return out + ([sv & 0xFF] if size == "byte" else w16(sv))
    raise AsmError(f"unsupported mov form: {ops}")


def enc_alu(mnem, ops, symbols, need):
    op = ALU.index(mnem)
    size, ops = strip_size(ops)
    dk, dv = parse_operand(ops[0], symbols, need)
    sk, sv = parse_operand(ops[1], symbols, need)
    if dk in ("r16", "r8") and sk == "imm":
        if dv == 0:                           # accumulator short form, full-width immediate
            if dk == "r16":
                return [op * 8 + 5] + w16(sv)
            return [op * 8 + 4, sv & 0xFF]
        if dk == "r16" and -0x80 <= sv <= 0x7F:
            out = [0x83]
            modrm_reg(op, dv, out)
            return out + [sv & 0xFF]
        out = [0x81 if dk == "r16" else 0x80]
        modrm_reg(op, dv, out)
        return out + (w16(sv) if dk == "r16" else [sv & 0xFF])
    if dk == "r16" and sk == "r16":
        out = [op * 8 + 3]
        modrm_reg(dv, sv, out)
        return out
    if dk == "r8" and sk == "r8":
        out = [op * 8 + 2]
        modrm_reg(dv, sv, out)
        return out
    if dk in ("r16", "r8") and sk == "mem":
        out = [op * 8 + (3 if dk == "r16" else 2)]
        sv.modrm(dv, out)
        return out
    if dk == "mem" and sk in ("r16", "r8"):
        out = [op * 8 + (1 if sk == "r16" else 0)]
        dv.modrm(sv, out)
        return out
    if dk == "mem" and sk == "imm":
        if size is None:
            raise AsmError(f"{mnem} of an immediate needs `byte` or `word`")
        out = [0x80 if size == "byte" else 0x81]
        dv.modrm(op, out)
        return out + ([sv & 0xFF] if size == "byte" else w16(sv))
    raise AsmError(f"unsupported {mnem} form: {ops}")


def enc_data(mnem, rest, symbols, need):
    out = []
    for tok in split_operands(rest):
        m = re.fullmatch(r"\"(.*)\"", tok, re.S)
        if m:
            out += list(m.group(1).encode("cp866"))
        elif mnem == "db":
            out.append(parse_num(tok, symbols, need) & 0xFF)
        else:
            out += w16(parse_num(tok, symbols, need))
    return out


def assemble(source, org=0):
    """-> (code, offsets of the callf segment words, symbols)."""
    lines = []
    for raw in source.splitlines():
        line = raw.split(";")[0].strip()
        m = re.fullmatch(r"([A-Za-z_][\w]*)\s+equ\s+(.+)", line)
        if m:
            lines.append(("equ", (m.group(1), m.group(2).strip())))
            continue
        while line:
            m = re.match(r"([A-Za-z_.][\w.]*)\s*:(?!\s*[0-9a-fA-Fx])", line)
            if m:
                lines.append(("label", m.group(1)))
                line = line[m.end():].strip()
                continue
            parts = line.split(None, 1)
            lines.append(("insn", (parts[0].lower(), parts[1] if len(parts) > 1 else "")))
            break

    # A jump that widens moves every label after it, which can widen another -- so size to
    # a fixed point, then emit and demand nothing moved. A label that shifts between the
    # two is a silently wrong branch target.
    symbols = {}
    for _ in range(8):
        settled = one_pass(lines, org, symbols, False).symbols
        if settled == symbols:
            break
        symbols = settled
    else:
        raise AsmError("instruction sizes did not settle -- a jump is oscillating")

    final = one_pass(lines, org, symbols, True)
    moved = {k: (symbols[k], final.symbols[k])
             for k in final.symbols if symbols.get(k) != final.symbols[k]}
    if moved:
        raise AsmError(f"labels moved during emission, so a branch would be wrong: {moved}")

    # A branch into the middle of an instruction executes the operand bytes as opcodes.
    # Targets outside this source (the stub jumps into the game) cannot be checked here.
    stray = sorted({t for t in final.targets
                    if org <= t < org + len(final.code) and t not in final.boundaries})
    if stray:
        raise AsmError("branch target(s) not on an instruction boundary: "
                       + ", ".join(hex(t) for t in stray))
    return final.code, final.relocs, final.symbols


def one_pass(lines, org, symbols, final):
    """One layout or emission pass. `final` also decides whether an unresolved name is an
    error or a placeholder."""
    symbols_pass = dict(symbols)
    defined, boundaries, targets = set(), set(), []
    pc, out, relocs = org, bytearray(), []
    for kind, item in lines:
        if kind in ("label", "equ"):
            # A redefinition is never intentional here and never visible in the output: the
            # last one wins, and every earlier branch to that name silently retargets.
            name = item if kind == "label" else item[0]
            if name in defined:
                raise AsmError(f"{name!r} is defined twice -- branches to it would go to "
                               f"the later one")
            defined.add(name)
        if kind == "label":
            symbols_pass[item] = pc
            continue
        if kind == "equ":
            symbols_pass[item[0]] = parse_num(item[1], symbols_pass, final)
            continue
        mnem, rest = item
        boundaries.add(pc)
        try:
            if mnem in ("db", "dw"):
                chunk, rel = enc_data(mnem, rest, symbols_pass, final), []
            else:
                chunk, rel = encode(mnem, split_operands(rest), symbols_pass, pc, final,
                                    targets)
        except AsmError as e:
            raise AsmError(f"{mnem} {rest}: {e}") from None
        if final:
            relocs += [(pc - org) + r for r in rel]
            out += bytes(chunk)
        pc += len(chunk)
    boundaries.add(pc)
    return Pass(bytes(out), relocs, symbols_pass, boundaries, targets)


# Reassembling shipped code byte-for-byte is the only check that this encoder makes the
# same choices as the compiler that built the image -- a wrong-but-valid encoding would
# pass every other test and silently shift every label in a real patch.
#
# The Town/Castle Gate list printer at 0xF97E: accumulator forms, far calls, forward jump.
PRINTER_SRC = """
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
"""

# The gate's visited-scan loop at 0xF7F3: indexed loads through bx, byte compares against
# a table, a backward branch. These are the forms a replacement routine is built from.
SCAN_SRC = """
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
"""

CASES = (("gate list printer", PRINTER_SRC, 0xF97E, 0x3A),
         ("gate visited scan", SCAN_SRC, 0xF7F3, 0x53))


def selftest():
    import os
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from paths import KBU2

    image = open(KBU2, "rb").read()
    bad = 0
    for name, src, at, length in CASES:
        want = image[at:at + length]
        got, relocs, _ = assemble(src, org=at)
        if got == want:
            print(f"ok   {name}: {len(got)} bytes byte-identical at {at:#x}"
                  f"  relocs {[hex(r) for r in relocs]}")
            continue
        bad = 1
        print(f"FAIL {name} at {at:#x}")
        print(f"  want {want.hex(' ')}")
        print(f"  got  {got.hex(' ')}")
        for i, (a, b) in enumerate(zip(want, got)):
            if a != b:
                print(f"  first difference at +{i:#x}: want {a:#04x}, got {b:#04x}")
                break
    return bad


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "selftest":
        sys.exit(selftest())
    sys.exit(__doc__)
