#!/usr/bin/env python3
"""Find the REF of a string in pristine KBU.EXE -- the file offset of the 2-byte
near pointer that points at it -- so it can be pasted into a `reloc` row of
tools/patches.csv. This is a run-once discovery aid; the build (apply_patches.py)
never scans, it just applies the offsets you record here.

    python3 tools/find_ref.py 0x16e0b            # by the string's file offset
    python3 tools/find_ref.py "as for treason"   # by a literal substring

Background: game text is reached through 2-byte NEAR offsets (DS-relative). A
ref sits either in a DGROUP pointer table or inside a code instruction as an
immediate operand. For each ref found this prints a ready-to-paste line:

    reloc,<ref_offset>,"<pointer_bytes_hex>","<your Russian text>"

Most box/bio lines have exactly one ref. If several are printed, the string is
referenced from several places and each needs its own reloc row; if none are,
it is reached by computed/indexed access and can't be repointed this way.
"""

import hashlib
import struct
import sys

ENCODING = "cp866"
TARGET_SHA256 = "a0ad8832b6a9afa7b28c7d0054a13e286d7952a558eaa12a38f6146e77339d49"

# DGROUP layout of KBU.EXE (mirror of apply_patches.py).
DS_BASE = 0x15690        # file offset of DS:0000
IMAGE_END = 0x1BA20      # end of the original loaded image = DS offset 0x6390
# Opcodes that load a 16-bit immediate (Turbo C passing a near string pointer):
# mov ax/cx/dx/bx/si/di, imm16 ; push imm16
LOAD_OPS = frozenset({0xB8, 0xB9, 0xBA, 0xBB, 0xBE, 0xBF, 0x68})
# Copy-protection segment: refs here are real, but repointing them is fatal on a long
# delay (see apply_patches.py). Reported, never offered as a paste-ready reloc row.
PROT_LO, PROT_HI = 0xBFE0, 0xCCA7


def valid_stroff(data, dsoff):
    """True if DS offset `dsoff` points at a real string START.

    Requiring the START (a NUL immediately before it) is what makes this
    discriminating. Merely checking "printable bytes up to a NUL" accepts any
    offset that lands in the MIDDLE of a string, so arbitrary data validates and
    coincidental byte pairs get promoted to refs -- the bug that let a slot
    inside a descending counter table (file 0x18855, bytes `0c 0b`) pose as a
    pointer to DS 0x0b0c, corrupting the table when the build rewrote it."""
    fo = DS_BASE + dsoff
    if not (DS_BASE <= fo < IMAGE_END):
        return False
    if fo != DS_BASE and data[fo - 1] != 0:                  # must be a string START
        return False
    end = data.find(b"\x00", fo)
    if end < 0 or not (1 <= end - fo <= 64):
        return False
    return all(32 <= c < 127 for c in data[fo:end])


def find_refs(data, str_off):
    """Return [(ref_off, kind)] for the string at file offset `str_off`.

    Conservative by design: a false ref corrupts whatever it lands on, so a site
    is only reported when it is structurally a pointer -- an immediate operand of
    a known load instruction, or a slot whose neighbours are themselves string
    pointers and which is ordered like a real table."""
    dsoff = str_off - DS_BASE
    needle = struct.pack("<H", dsoff)
    refs = []
    i = data.find(needle)
    while i >= 0:
        if i < DS_BASE:                                      # code immediate
            if data[i - 1] in LOAD_OPS:
                refs.append((i, "code-immediate"))
        elif i + 3 < IMAGE_END:                              # candidate table entry
            prev = struct.unpack_from("<H", data, i - 2)[0]
            nxt = struct.unpack_from("<H", data, i + 2)[0]
            # Both neighbours must be string starts too: an isolated hit inside
            # non-pointer data fails, a genuine table's slots all pass.
            if valid_stroff(data, prev) and valid_stroff(data, nxt):
                # ...and the triple must be ordered like a table. Real pointer
                # tables run monotonically; a data run that merely resembles one
                # (e.g. the 0x14,0x13,0x12... ramp) is rejected by the strictness
                # of the string-start test above, and this catches the rest.
                if prev < dsoff < nxt or nxt < dsoff < prev:
                    refs.append((i, "table-entry"))
        i = data.find(needle, i + 1)
    return refs


def main(argv):
    if len(argv) != 2:
        sys.exit(__doc__)
    data = open("KBU.EXE", "rb").read()
    if hashlib.sha256(data).hexdigest() != TARGET_SHA256:
        sys.exit("error: KBU.EXE is not pristine -- offsets would be wrong")

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
    for ref_off, kind in refs:
        ptr = struct.unpack_from("<H", data, ref_off)[0]
        print(f"ref @ {ref_off:#08x}  [{kind}]  currently -> DS {ptr:#06x}")
        if PROT_LO <= ref_off <= PROT_HI:
            print("  !! inside the copy-protection block -- DO NOT repoint this ref.")
            print("     The block is integrity-checked and retaliates on a long delay")
            print("     (game hangs much later, INT 6 in the graphics loader).")
            print("     Translate in place with a 'string' row instead.")
            continue
        print(f'  reloc,{ref_off:#08x},"{data[ref_off]:02X}{data[ref_off+1]:02X}",'
              f'"<Russian>"')
    if len(refs) > 1:
        print(f"\n{len(refs)} refs: this string is used from several places -- "
              f"add one reloc row per ref.")


if __name__ == "__main__":
    main(sys.argv)
