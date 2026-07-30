#!/usr/bin/env python3
"""Find the REF of a string in pristine build/KBU2.EXE -- the file offset of the 2-byte
near pointer that points at it -- so it can be pasted into a `reloc` row of
res/patches.csv. This is a run-once discovery aid; the build (apply_patches.py)
never scans, it just applies the offsets you record here.

    python3 tools/find_ref.py 0x16e0b            # by the string's file offset
    python3 tools/find_ref.py "as for treason"   # by a literal substring

Background: game text is reached through 2-byte NEAR offsets (DS-relative). A
ref sits either in a DGROUP pointer table or inside a code instruction as an
immediate operand. It prints a ready-to-paste line:

    reloc,<ref_offset>,"<the original English>","<your Russian text>"

Most box/bio lines have exactly one ref. If several are found the string is
referenced from several places and all its pointers must move together, so they
go in ONE row with the refs space-separated -- which is what the pasted line
already contains. If none are found it is reached by computed/indexed access, or
sits in a table too short to prove itself (see find_refs), and can't be repointed
this way -- "not repointable by this tool", never "not a pointer".

A `table-entry` verdict says nothing about liveness. Tables are read base+index,
often from SEVERAL bases into one array (DS 0x3252 is indexed from both 0x324e and
0x3252), so no immediate ever equals a slot's own DS offset -- grepping for one
cannot prove a slot dead. Only a screenshot settles it.
"""

import hashlib
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from paths import KBU2, KBU2_SHA256                          # noqa: E402

ENCODING = "cp866"

# DGROUP layout of KBU2.EXE (mirror of apply_patches.py).
DS_BASE = 0x15690        # file offset of DS:0000
IMAGE_END = 0x1BA20      # end of the original loaded image = DS offset 0x6390
# Opcodes that load a 16-bit immediate (Turbo C passing a near string pointer):
# mov ax/cx/dx/bx/si/di, imm16 ; push imm16
LOAD_OPS = frozenset({0xB8, 0xB9, 0xBA, 0xBB, 0xBE, 0xBF, 0x68})
# Copy-protection segment: refs here are genuine pointers, but repointing any of them
# hangs the game much later (cause unknown -- see apply_patches.py / README.md).
# Reported, never offered as a paste-ready reloc row.
PROT_LO, PROT_HI = 0xBFE0, 0xCCA7


def string_len(data, dsoff):
    """Length of the NUL-terminated printable string at DS offset `dsoff`, else None.

    The EMPTY string counts (length 0). Tables here pad an unused slot with a
    pointer to the NUL that ends the previous string, and `chains` below has to
    step through such a slot to reach the entries on the far side of it -- the
    artifact table at 0x183a8 is three quarters padding of exactly that kind."""
    fo = DS_BASE + dsoff
    if not (DS_BASE <= fo < IMAGE_END):
        return None
    end = data.find(b"\x00", fo)
    if end < 0 or end - fo > 64:
        return None
    if not all(32 <= c < 127 for c in data[fo:end]):
        return None
    return end - fo


def chains(data, i):
    """True if slots `i` and `i+2` are CONSECUTIVE entries of a pointer table.

    Not "both look like strings" -- that test is far too weak, it promotes any
    coincidental byte pair to a ref, and a slot in a descending counter table
    (file 0x18855) passes it. This asks the arithmetic question instead:

        table[k+1] == table[k] + len(string k) + 1

    i.e. the next slot points exactly one past the NUL of this slot's string.
    Compilers emit string literals in the order the table lists them, so every
    real table walks its block that way, and forging a link needs two adjacent
    words that happen to be the offsets of two adjacent strings."""
    if not (DS_BASE <= i and i + 4 <= IMAGE_END):
        return False
    a, b = struct.unpack_from("<HH", data, i)
    n = string_len(data, a)
    return n is not None and b == a + n + 1


def find_refs(data, str_off):
    """Return [(ref_off, kind)] for the string at file offset `str_off`.

    Conservative by design: a false ref corrupts whatever it lands on, so a site
    is only reported when it is structurally a pointer -- an immediate operand of
    a known load instruction, or a slot whose neighbours are themselves string
    pointers and which is ordered like a real table.

    Conservative is not the same as sound, and `code-immediate` is the weaker of
    the two tests: it only asks whether the PRECEDING BYTE is a load opcode, and
    nothing here tracks instruction boundaries. A jump whose displacement happens
    to equal a load opcode fakes one -- DS 0x47eb is reported at file 0x5240,
    where the vouching 0xbf is the displacement of a `jz`, not a `mov di`, and
    repointing it would rewrite a branch target. So when a string reports BOTH a
    table entry and a lone code-immediate, disassemble the code site before
    trusting it (tools/ghidra/FindStringUsers.java scans decoded instructions and
    settles it); a table entry needs no such check, the chain already validated it.

    A slot is accepted when it sits in a run of THREE chained slots, in any of the
    three positions -- which is what reaches a table's first and last entry. TWO
    chained slots are not enough: an arithmetic ramp fakes one link whenever its
    step equals a string length there, as the menu table at 0x18cc8 (step 9) does,
    offering `DS 0x102` -- two bytes into ' Controls ' -- as a pointer. Its second
    link fails, so the run test rejects it."""
    dsoff = str_off - DS_BASE
    needle = struct.pack("<H", dsoff)
    refs = []
    i = data.find(needle)
    while i >= 0:
        if i < DS_BASE:                                      # code immediate
            if data[i - 1] in LOAD_OPS:
                refs.append((i, "code-immediate"))
        elif (chains(data, i) and chains(data, i + 2)          # run starts here
                or chains(data, i - 2) and chains(data, i)     # ...or i is inside
                or chains(data, i - 4) and chains(data, i - 2)):   # ...or ends here
            refs.append((i, "table-entry"))
        i = data.find(needle, i + 1)
    return refs


def main(argv):
    if len(argv) != 2:
        sys.exit(__doc__)
    data = open(KBU2, "rb").read()
    if hashlib.sha256(data).hexdigest() != KBU2_SHA256:
        sys.exit(f"error: {KBU2} is not pristine -- offsets would be wrong")

    arg = argv[1]
    try:
        str_off = int(arg, 0)
    except ValueError:                                       # literal substring
        try:
            needle = arg.encode(ENCODING)
        except UnicodeEncodeError:
            needle = arg.encode("latin1", "replace")
        hits = []
        i = data.find(needle, DS_BASE)
        while 0 <= i < IMAGE_END:
            start = data.rfind(b"\x00", DS_BASE, i) + 1      # back up to string start
            hits.append(start)
            i = data.find(needle, i + 1)
        hits = sorted(set(hits))
        if not hits:
            sys.exit(f"no string containing {arg!r} found in the text region")
        if len(hits) > 1:
            print(f"note: {len(hits)} strings contain {arg!r}:")
            for h in hits:
                s = data[h:data.find(b'\x00', h)].decode("latin1")
                print(f"  {h:#08x}  {s!r}")
            print("re-run with the exact file offset you want.\n")
        str_off = hits[0]

    text = data[str_off:data.find(b"\x00", str_off)].decode("latin1")
    dsoff = str_off - DS_BASE
    print(f"string @ {str_off:#08x} (DS {dsoff:#06x}): {text!r}\n")

    refs = find_refs(data, str_off)
    if not refs:
        print("no ref found -- reached by computed/indexed access, not repointable")
        return
    usable = []
    for ref_off, kind in refs:
        ptr = struct.unpack_from("<H", data, ref_off)[0]
        print(f"ref @ {ref_off:#08x}  [{kind}]  currently -> DS {ptr:#06x}")
        if PROT_LO <= ref_off <= PROT_HI:
            print("  !! inside the copy-protection block -- DO NOT repoint this ref.")
            print("     The block is integrity-checked and retaliates on a long delay")
            print("     (game hangs much later, INT 6 in the graphics loader).")
            print("     Translate in place with a 'string' row instead.")
            continue
        usable.append(ref_off)
    if not usable:
        return
    if len(usable) > 1:
        print(f"\n{len(usable)} refs: this string is used from several places. All its "
              f"pointers must move together, so they go in ONE row:")
    # `expect` is the original English -- apply_patches.py follows the pointer and
    # checks the string it lands on, so the manifest stays readable and verified.
    print(f'\n  reloc,{" ".join(f"{r:#08x}" for r in usable)},'
          f'"{text.replace(chr(34), chr(34) * 2)}","<Russian>"')


if __name__ == "__main__":
    main(sys.argv)
