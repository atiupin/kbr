#!/usr/bin/env python3
"""Build build/KBR.EXE from pristine build/KBU2.EXE by applying res/patches.csv.

    python3 tools/apply_patches.py          # no arguments

Not a universal patcher: it reads one file and writes one. The SHA-256 gate in
paths.py refuses any other KBU2.EXE, so every manifest offset is provably correct
against that exact image -- no per-patch address arithmetic.

Manifest (res/patches.csv): CSV, header `type,offset,expect,write`, one patch per
row. Blank and `#` lines are skipped, so `#` carries the section comments (there is
no label column). UTF-8 in, CP866 out, with `\\xNN` for raw byte NN and `\\\\` for a
literal backslash (see encode_text).

    type    "bytes" | "string" | "reloc"
    offset  file offset (reloc: one or more ref offsets, space-separated)
    expect  what must be there now  (hex for bytes, the original English otherwise)
    write   what to write           (hex for bytes, the translation otherwise)

Quote expect/write ("Gold:  ") so significant leading and trailing spaces stay
visible -- UI strings are padded to fixed widths.

bytes : hex, equal length, overwritten in place.

string: CP866 text written in place, NUL-terminated. `expect` must be the complete
        original (its NUL is verified), so its length is the slot budget; a longer
        `write` is rejected and belongs in a `reloc` row.

reloc : `offset` is NOT the string -- it is the REF, the file offset of the 2-byte
        near pointer reaching it, found once with tools/find_ref.py. `expect` is
        still the original English: the pointer is dereferenced and the string it
        lands on must match. Stronger than pinning the pointer's raw bytes, and it
        keeps the English readable instead of hidden behind a hex word.

        A reloc row declares where the string is REACHED FROM, not that the pool
        must be used. If `write` fits the original slot the build inlines it (in
        place, refs untouched); only genuine overflows are appended to the pool at
        DS POOL_DSOFF with every ref repointed. The row therefore survives rewording
        in either direction, and each build prints which way each row went.

        Inlining also fixes paths a reloc misses: find_ref.py cannot see computed or
        indexed access (nor a pointer table's first/last slot), so a string reached
        both ways would keep showing English on the computed path.

        One row per string, not per ref -- a string reached from several places needs
        all its pointers moved together:
            reloc,0x0185CB 0x018F02,"lost!","потеряно!"

The automation is one-directional: a `string` row that overflows is an error, never
an automatic reloc. Upgrading needs refs the row does not carry, and could silently
repoint inside the copy-protection block -- the edit that hangs the game (see PROT_LO).

Every reloc ref MUST come from find_ref.py, which validates that the site is a real
code immediate or pointer-table slot. A hand-picked offset can land on a 2-byte value
that merely happens to equal the string's DS offset; that mistake (a ref inside a
counter table) silently corrupted game data and crashed the puzzle map.

Pool placement is measured, not assumed -- see the POOL_* constants.
"""

import csv
import hashlib
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from paths import KBU2 as INPUT, KBR as OUTPUT, PATCHES_CSV as MANIFEST, KBU2_SHA256  # noqa: E402

ENCODING = "cp866"

# DGROUP layout of KBU2.EXE.
DS_BASE = 0x15690        # file offset of DS:0000 -- near offset 0 lives here
BSSEND  = 0xB64C         # _end: heap floor / top of BSS (c0 constant, verified)

# Pool placement, from the MEMDUMP.BIN measurement (heavy session, puzzle map open):
# near-heap high-water DS 0xb6cf (~131 B above _end), stack low-water DS 0xfe2c (~467 B
# below the top) -- a 17.8 KB cold band at DS 0xb6d0..0xfe2c. The pool sits mid-band, so
# the climbing heap and descending stack each have KB of slack. c0's BSS wipe stops at
# _end, so the pool's file-loaded bytes survive startup untouched.
#
# DGROUP is left FLOATING (_heaplen stays 0): capping it to force c0's fixed branch was
# tried and reverted -- it buys nothing (the heap barely grows) and costs stack headroom.
#
# To re-measure: reach the screen, Debug -> Start DOSBox-X Debugger (pauses the CPU),
# then `MEMDUMPBIN 0000:0000 100000` writes tmp/MEMDUMP.BIN. Find DGROUP by searching for
# the "Turbo C++ - Copyright 1990 Borla..." literal at DS 0x0004 (so DS:0000 = hit - 4).
# Heap high-water is the highest nonzero byte above _end, stack low-water the lowest
# below 0xffff; DOSBox boots RAM zeroed, so untouched really means untouched.
POOL_DSOFF     = 0xD6D0                    # pool base, mid cold band
POOL_SIZE      = 0x1000                    # 4 KB budget (whole-text overflow est. ~2.4-4 KB)
POOL_END_DSOFF = POOL_DSOFF + POOL_SIZE    # hard cap; keeps clear of the stack's descent

# Copy-protection segment (Ghidra 19fe:0000-0cc7). `reloc` rows MUST NOT repoint a ref
# in here. THE RULE IS SOLID; THE MECHANISM IS UNKNOWN -- distrust any explanation.
#
# Symptom: one repointed immediate plays the title screen, the whole town and a contract
# through normally, then hangs in an INT 6 loop on entering the king's castle -- a wild
# far jump to 0070:000E with DS=A000, dying mid-graphics thousands of instructions later.
#
# Bisected (builds differing only in the named bytes): repointing to another string
# INSIDE the original image still hangs, and swapping two immediates -- byte-sum AND XOR
# unchanged -- still hangs. So it reacts to being modified at all, and it is no simple
# sum/XOR checksum. Falsified: heap exhaustion, stack exhaustion, pool placement (the
# pool was intact at the crash). No checksum routine, flag or sabotage code was found.
#
# NOT "any byte here is fatal": our own protection flip (`bytes` at 0xC40A, JC->JMP)
# lives here and is fine -- it is exactly what NWC's KB!.COM patches at runtime, so
# nothing can guard it without breaking the shipping loader. The guard is for `reloc`
# only, and the range is a conservative fence around the segment, not a measured bound.
#
# Costs nothing: every string reached from here is protection UI text that fits its own
# slot as a `string` row. Rejection happens at PARSE time, before the inline/pool
# decision -- an inlined row would be harmless today, but it sits one rewording away
# from fatal, so the trap stays out of the manifest entirely.
PROT_LO, PROT_HI = 0xBFE0, 0xCCA7          # file offsets, inclusive


def die(msg):
    sys.exit(f"error: {msg}")


def encode_text(text, label, column):
    """Encode one manifest text field to CP866. `\\xNN` writes raw byte NN, `\\\\` a
    literal backslash, everything else is plain CP866.

    The escape exists for glyphs cp866 will not round-trip: the movement menu draws its
    arrows with bytes 0x18-0x1b, which the codec maps to the C0 controls of the same
    value. Writing them literally would put invisible control bytes in the CSV.
    """
    out = bytearray()
    lit = []
    i = 0

    def flush():
        if lit:
            try:
                out.extend("".join(lit).encode(ENCODING))
            except UnicodeEncodeError as e:
                die(f"{label}: {column} is not encodable in {ENCODING} ({e})")
            del lit[:]

    while i < len(text):
        if text[i] != "\\":
            lit.append(text[i])
            i += 1
            continue
        esc = text[i + 1:i + 2]
        if esc == "\\":
            lit.append("\\")
            i += 2
        elif esc == "x":
            digits = text[i + 2:i + 4]
            if len(digits) != 2 or any(c not in "0123456789abcdefABCDEF" for c in digits):
                die(f"{label}: bad \\x escape in {column} ({text[i:i + 4]!r} -- want \\xNN)")
            flush()
            out.append(int(digits, 16))
            i += 4
        else:
            die(f"{label}: stray backslash in {column} "
                f"-- write \\\\ for a literal one, \\xNN for a raw byte")
    flush()
    return bytes(out)


def resolve(patch, idx):
    """Parse one manifest row into a dict describing the edit. `kind` is one of
    'bytes' | 'string' | 'reloc'; the remaining keys depend on kind (see main)."""
    label = f"patch {idx}"
    typ = patch.get("type")
    try:
        offs = [int(tok, 0) for tok in str(patch["offset"]).split()]
    except KeyError:
        die(f"{label}: missing offset")
    except ValueError:
        die(f"{label}: bad offset {patch['offset']!r}")
    if not offs:
        die(f"{label}: missing offset")
    if typ != "reloc" and len(offs) != 1:
        die(f"{label}: only 'reloc' rows may list several offsets")
    off = offs[0]

    if typ == "bytes":
        try:
            expect = bytes.fromhex(patch["expect"].replace(" ", ""))
            payload = bytes.fromhex(patch["write"].replace(" ", ""))
        except (KeyError, ValueError) as e:
            die(f"{label}: bad bytes expect/write ({e})")
        if len(expect) != len(payload):
            die(f"{label}: bytes expect/write differ in length "
                f"({len(expect)} vs {len(payload)})")
        return {"kind": "bytes", "off": off, "expect": expect,
                "payload": payload, "label": label}

    if typ == "string":
        try:
            expect = encode_text(patch["expect"], label, "expect")
            text = encode_text(patch["write"], label, "write")
        except KeyError as e:
            die(f"{label}: missing {e}")
        if len(text) > len(expect):
            die(f"{label}: translation is {len(text)}B but the slot holds "
                f"{len(expect)}B -- use a 'reloc' row")
        return {"kind": "string", "off": off, "expect": expect,
                "payload": text + b"\x00", "label": label}

    if typ == "reloc":
        try:
            expect = encode_text(patch["expect"], label, "expect")
            text = encode_text(patch["write"], label, "write")
        except KeyError as e:
            die(f"{label}: missing {e}")
        for ref in offs:
            if PROT_LO <= ref <= PROT_HI:
                die(f"{label}: reloc ref {ref:#x} is inside the copy-protection block "
                    f"({PROT_LO:#x}-{PROT_HI:#x}).\n"
                    f"       That block is integrity-checked and retaliates on a delay -- "
                    f"the game runs, then hangs much later (INT 6 in the graphics loader).\n"
                    f"       Use a 'string' row instead: the protection UI text all fits "
                    f"its original slot.")
        return {"kind": "reloc", "off": off, "offs": offs, "expect": expect,
                "text": text + b"\x00", "label": label}

    die(f"{label}: unknown type {typ!r} (want 'bytes', 'string' or 'reloc')")


def load_manifest():
    try:
        with open(MANIFEST, newline="", encoding="utf-8") as f:
            rows = [ln for ln in f if ln.strip() and not ln.lstrip().startswith("#")]
    except FileNotFoundError:
        die(f"manifest not found: {MANIFEST}")
    patches = list(csv.DictReader(rows))
    if not patches:
        die(f"manifest {MANIFEST}: no patches found")
    return patches


def check_overlaps(inplace):
    """Overlap check over (offset, payload, label) triples. Pool appends are bump-
    allocated at the end and cannot overlap, so only in-place writes need it -- which
    includes inlined `reloc` rows, whose slot can collide with a `string` row."""
    spans = sorted((off, off + len(payload), label) for off, payload, label in inplace)
    for (a_lo, a_hi, a), (b_lo, b_hi, b) in zip(spans, spans[1:]):
        if b_lo < a_hi:
            die(f"patches overlap: {a!r} [{a_lo:#x},{a_hi:#x}) and "
                f"{b!r} [{b_lo:#x},{b_hi:#x})")


def deref(data, ref, label):
    """Follow the near pointer at file offset `ref` and return (string_file_offset,
    string_bytes) for the string it aims at."""
    if ref + 2 > len(data):
        die(f"{label}: ref {ref:#x} is past the end of the image")
    dsoff = struct.unpack_from("<H", data, ref)[0]
    fo = DS_BASE + dsoff
    end = data.find(b"\x00", fo) if fo < len(data) else -1
    if end < 0:
        die(f"{label}: ref {ref:#x} points at DS {dsoff:#06x} "
            f"(file {fo:#x}), which is not a NUL-terminated string")
    return fo, bytes(data[fo:end])


def check_reloc_sources(relocs):
    """One string, one row. Two rows repointing the same string mean its pointers
    were split across rows -- they must move together, so list every ref in one row."""
    seen = {}
    for p in relocs:
        prev = seen.setdefault(p["src"], p)
        if prev is not p:
            die(f"{p['label']} and {prev['label']} both repoint the string at "
                f"{p['src']:#x} ({p['expect'].decode(ENCODING)!r}).\n"
                f"       Merge them into one row listing both refs "
                f"(offset column: \"{prev['off']:#08x} {p['off']:#08x}\").")


def fix_mz_header(data):
    """Rewrite the MZ page-count fields so DOS loads the grown image. minalloc is left
    as-is: the runtime's BSS/heap/stack now sit in the file-backed region as harmless
    zeros, and keeping it guarantees at least the original extra memory."""
    total = len(data)
    struct.pack_into("<H", data, 0x02, total % 512)          # bytes on last page
    struct.pack_into("<H", data, 0x04, (total + 511) // 512)  # pages (512B)


def main():
    patches = [resolve(p, i) for i, p in enumerate(load_manifest(), 1)]

    try:
        data = bytearray(open(INPUT, "rb").read())
    except FileNotFoundError:
        die(f"KBU2.EXE not found at {INPUT}")

    digest = hashlib.sha256(data).hexdigest()
    if digest != KBU2_SHA256:
        die(f"{INPUT} is not pristine KBU2.EXE\n"
            f"       expected sha256 {KBU2_SHA256}\n"
            f"       got             {digest}\n"
            f"       regenerate it with unpack_exepack.py.")

    # verify every patch's expect against the pristine image
    for p in patches:
        if p["kind"] == "reloc":
            # the ref is a pointer: follow it and check the string it lands on.
            for ref in p["offs"]:
                src, got = deref(data, ref, p["label"])
                if got != p["expect"]:
                    die(f"{p['label']}: ref {ref:#x} points at "
                        f"{got.decode(ENCODING)!r}, not {p['expect'].decode(ENCODING)!r}")
                if p.setdefault("src", src) != src:
                    die(f"{p['label']}: its refs point at different strings "
                        f"({p['src']:#x} and {src:#x}) -- one row per string")
            continue
        end = p["off"] + len(p["expect"])
        got = bytes(data[p["off"]:end])
        if got != p["expect"]:
            die(f"{p['label']}: expected {p['expect'].hex()} at {p['off']:#x}, "
                f"found {got.hex()}")
        if p["kind"] == "string" and data[end] != 0:
            die(f"{p['label']}: original string at {p['off']:#x} is not "
                f"NUL-terminated at its expected length")

    relocs = [p for p in patches if p["kind"] == "reloc"]
    check_reloc_sources(relocs)

    # A reloc row needs the pool only if its translation OVERFLOWS the slot. When it
    # fits, inline it: write the slot and leave the refs alone. `expect` was verified
    # against the slot above, so len(expect) is the budget. The freed tail keeps stale
    # English bytes, sitting past our NUL and never read.
    for p in relocs:
        p["inlined"] = len(p["text"]) - 1 <= len(p["expect"])
    pooled = [p for p in relocs if not p["inlined"]]

    # in-place edits: bytes/string at their own offset, inlined relocs at the slot their
    # refs point to (p["off"] is a ref there, not the string).
    inplace = [(p["off"], p["payload"], p["label"])
               for p in patches if p["kind"] in ("bytes", "string")]
    inplace += [(p["src"], p["text"], p["label"]) for p in relocs if p["inlined"]]
    check_overlaps(inplace)
    for off, payload, _ in inplace:
        data[off:off + len(payload)] = payload

    # the rest: append text to the overflow pool, rewrite each ref pointer
    if pooled:
        pool_base = DS_BASE + POOL_DSOFF
        if len(data) < pool_base:
            data.extend(b"\x00" * (pool_base - len(data)))
        for p in pooled:
            new_dsoff = POOL_DSOFF + (len(data) - pool_base)
            if new_dsoff + len(p["text"]) > POOL_END_DSOFF:
                die(f"{p['label']}: overflow pool exhausted "
                    f"(need DS {new_dsoff:#06x}+{len(p['text'])}B, "
                    f"cap {POOL_END_DSOFF:#06x})")
            data.extend(p["text"])
            for ref in p["offs"]:                               # all pointers move together
                struct.pack_into("<H", data, ref, new_dsoff)
            p["new_dsoff"] = new_dsoff
        fix_mz_header(data)

    open(OUTPUT, "wb").write(bytes(data))
    inlined = [p for p in relocs if p["inlined"]]
    print(f"applied {len(patches)} patch(es) "
          f"({len(pooled)} reloc, {len(inlined)} reloc inlined): "
          f"build/KBU2.EXE -> build/KBR.EXE")
    for p in patches:
        if p["kind"] != "reloc":
            print(f"  {p['off']:#08x}  {p['kind']:6}  {p['label']}")
        elif p["inlined"]:
            print(f"  {p['src']:#08x}  inline  {len(p['text']) - 1}B fits {len(p['expect'])}B "
                  f"slot  {p['label']}")
        else:
            refs = " ".join(f"{r:#08x}" for r in p["offs"])
            print(f"  {refs}  reloc   ref -> DS {p['new_dsoff']:#06x}  {p['label']}")
    if inlined:
        saved = sum(len(p["text"]) for p in inlined)
        print(f"  inlined {len(inlined)} of {len(relocs)} reloc row(s) into their own "
              f"slots: {saved}B of pool not spent")
    if pooled:
        used = len(data) - (DS_BASE + POOL_DSOFF)
        print(f"  overflow pool: DS {POOL_DSOFF:#06x}..{POOL_DSOFF + used:#06x} "
              f"({used}B used / {POOL_SIZE}B); image grown to {len(data)} bytes")


if __name__ == "__main__":
    main()
