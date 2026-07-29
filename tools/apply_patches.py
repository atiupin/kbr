#!/usr/bin/env python3
"""Build build/KBR.EXE from pristine build/KBU2.EXE by applying res/patches.csv.

    python3 tools/apply_patches.py          # no arguments

Not a universal patcher: one input, one output. The SHA-256 gate in paths.py refuses
any other KBU2.EXE, so every manifest offset is provably correct against that image.

Manifest (res/patches.csv): CSV, header `type,offset,expect,write`, one patch per row.
Blank and `#` lines are skipped, so `#` carries the section comments. UTF-8 in, CP866
out, with `\\xNN` for raw byte NN and `\\\\` for a literal backslash (see encode_text).
Quote expect/write ("Gold:  ") to keep significant leading and trailing spaces visible.
Rows are shape-checked before anything is applied; errors name the manifest line.

    type    "bytes" | "string" | "reloc"
    offset  file offset (reloc: one or more ref offsets, space-separated)
    expect  what must be there now  (hex for bytes, the original English otherwise)
    write   what to write           (hex for bytes, the translation otherwise)

bytes : hex, equal length, overwritten in place.

        NO ACCIDENTAL CODE MOTION. Rewriting an instruction is fine (a flipped branch,
        a changed immediate); MOVING one drags two things with it. The MZ relocation
        table pins every far call's segment word BY FILE OFFSET and DOS adds the load
        segment to it, so a slid `9a` is never fixed up while the loader corrupts
        whatever took its place -- reordering the recruit line's calls at 0xACCD drew a
        header and nothing else until a second row moved the entries. A slid `b8` that
        a `reloc` row names moves that row's ref too. Both are legal when declared:
        repoint the relocation entries in their own `bytes` row and give the `reloc`
        row the ref's new offset. check_relocations rejects an undeclared slide.
        Prefer moving the OUTPUT to moving code -- the drawing calls take absolute
        columns -- and reorder only when the print order itself is the bug.

string: CP866 written in place, NUL-terminated. `expect` is the complete original (its
        NUL is verified), so its length is the slot budget. A longer `write` is an
        error, never an automatic reloc: upgrading needs refs the row does not carry,
        and could silently repoint inside the copy-protection block (see PROT_LO).

reloc : `offset` is NOT the string -- it is the REF, the file offset of the 2-byte near
        pointer reaching it, from tools/find_ref.py. `expect` is still the English: the
        pointer is dereferenced and what it lands on must match.

        The row says where the string is REACHED FROM, not that the pool must be used.
        A `write` that fits the original slot is inlined there with the refs untouched;
        only overflows go to the pool at DS POOL_DSOFF, every ref repointed. Inlining
        also covers what find_ref.py cannot see (computed or indexed access, a pointer
        table's first/last slot), which would otherwise keep showing English.

        One row per string, not per ref -- all its pointers must move together:
            reloc,0x0185CB 0x018F02,"lost!","потеряно!"

Every reloc ref MUST come from find_ref.py, which proves the site is a real code
immediate or table slot. A hand-picked 2-byte value that merely happens to equal the
string's DS offset repoints something else: that mistake (a ref inside a counter table)
corrupted game data and crashed the puzzle map.
"""

import csv
import hashlib
import os
import re
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from paths import KBU2 as INPUT, KBR as OUTPUT, PATCHES_CSV as MANIFEST, KBU2_SHA256  # noqa: E402

ENCODING = "cp866"

COLUMNS = ("type", "offset", "expect", "write")
KINDS = ("bytes", "string", "reloc")
OFFSET_RE = re.compile(r"0x[0-9a-fA-F]+\Z")
HEX_RE = re.compile(r"[0-9a-fA-F]+\Z")

# DGROUP layout of KBU2.EXE.
DS_BASE = 0x15690        # file offset of DS:0000
BSSEND  = 0xB64C         # _end: heap floor / top of BSS (c0 constant, verified)

# Pool placement, measured from MEMDUMP.BIN (heavy session, puzzle map open): heap
# high-water DS 0xb6cf, stack low-water DS 0xfe2c -- a 17.8 KB cold band. The pool sits
# mid-band, so heap and stack each keep KB of slack, and c0's BSS wipe stops at _end, so
# its file-loaded bytes survive startup. DGROUP is left FLOATING (_heaplen 0): capping it
# was tried and reverted, it buys nothing and costs stack headroom.
#
# To re-measure: DOSBox-X debugger, `MEMDUMPBIN 0000:0000 100000`. DS:0000 sits 4 bytes
# below the "Turbo C++ - Copyright 1990 Borla..." literal; RAM boots zeroed, so the
# highest nonzero byte above _end and the lowest below 0xffff are the real water marks.
POOL_DSOFF     = 0xD000                    # pool base, mid cold band
POOL_SIZE      = 0x1800                    # 6 KB; the 4 KB first cut ran out mid-translation
POOL_END_DSOFF = POOL_DSOFF + POOL_SIZE    # hard cap; clear of the stack's descent

# Copy-protection segment (Ghidra 19fe:0000-0cc7). `reloc` rows MUST NOT repoint a ref
# in here. THE RULE IS SOLID; THE MECHANISM IS UNKNOWN -- distrust any explanation.
#
# One repointed immediate plays for minutes, then hangs in an INT 6 loop on entering the
# king's castle. Bisected: repointing to another string INSIDE the original image still
# hangs, and swapping two immediates -- byte-sum AND XOR unchanged -- still hangs, so it
# is no simple checksum. Falsified: heap exhaustion, stack exhaustion, pool placement.
#
# Not "any byte here is fatal": our own flip at 0xC40A is exactly what KB!.COM patches at
# runtime, so nothing can guard it. The fence is conservative and costs nothing -- every
# string reached from here is protection UI that fits its own slot as a `string` row.
# Rejected at parse time: an inlined reloc is harmless today, one rewording from fatal.
PROT_LO, PROT_HI = 0xBFE0, 0xCCA7          # file offsets, inclusive


def die(msg):
    sys.exit(f"error: {msg}")


def encode_text(text, label, column):
    """Encode one manifest text field to CP866. `\\xNN` writes raw byte NN, `\\\\` a
    literal backslash. The escape is for glyphs cp866 will not round-trip: the movement
    menu's arrows are bytes 0x18-0x1b, which the codec maps to the C0 controls."""
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
    """Turn one shape-checked manifest row into a dict describing the edit. `kind` is
    one of 'bytes' | 'string' | 'reloc'; the remaining keys depend on kind (see main)."""
    label = f"patch {idx}"
    typ = patch["type"]
    offs = [int(tok, 0) for tok in patch["offset"].split()]
    off = offs[0]

    if typ == "bytes":
        expect = bytes.fromhex(patch["expect"].replace(" ", ""))
        payload = bytes.fromhex(patch["write"].replace(" ", ""))
        if len(expect) != len(payload):
            die(f"{label}: bytes expect/write differ in length "
                f"({len(expect)} vs {len(payload)})")
        return {"kind": "bytes", "off": off, "expect": expect,
                "payload": payload, "label": label}

    expect = encode_text(patch["expect"], label, "expect")
    text = encode_text(patch["write"], label, "write")

    if typ == "string":
        if len(text) > len(expect):
            die(f"{label}: translation is {len(text)}B but the slot holds "
                f"{len(expect)}B -- use a 'reloc' row")
        return {"kind": "string", "off": off, "expect": expect,
                "payload": text + b"\x00", "label": label}

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


def check_row(where, row):
    """Reject any row whose columns are not what its `type` says they are. The text
    columns go through encode_text only to validate here; resolve() encodes for real."""
    typ, offsets, expect, write = (row[c] for c in COLUMNS)

    if typ not in KINDS:
        die(f"{where}: type {typ!r} -- want one of {', '.join(KINDS)}")

    toks = offsets.split()
    if not toks:
        die(f"{where}: offset is empty")
    if typ != "reloc" and len(toks) > 1:
        die(f"{where}: {len(toks)} offsets, but only 'reloc' rows may list several")
    for tok in toks:
        if not OFFSET_RE.match(tok):
            die(f"{where}: offset {tok!r} -- want 0x-prefixed hex, e.g. 0x0185e3")

    if not expect:
        die(f"{where}: expect is empty -- it is what pins the row to the right bytes")

    if typ == "bytes":
        for col, val in (("expect", expect), ("write", write)):
            packed = val.replace(" ", "")
            if not packed or not HEX_RE.match(packed) or len(packed) % 2:
                die(f"{where}: bytes {col} {val!r} -- want whole hex bytes, "
                    f'e.g. "72" or "eb 0d 90"')
    else:
        encode_text(expect, where, "expect")
        encode_text(write, where, "write")      # empty is legal -- it blanks the string


def load_manifest():
    """Read res/patches.csv into one shape-checked dict per patch row.

    A line at a time, in strict mode: strict rejects text after a closing quote, which
    default csv folds into the field instead, and per-line keeps an unbalanced quote
    from swallowing the rows below it. Safe because no field spans a newline."""
    try:
        with open(MANIFEST, newline="", encoding="utf-8") as f:
            lines = [(n, ln) for n, ln in enumerate(f, 1)
                     if ln.strip() and not ln.lstrip().startswith("#")]
    except FileNotFoundError:
        die(f"manifest not found: {MANIFEST}")

    rows = []
    for lineno, raw in lines:
        where = f"{MANIFEST} line {lineno}"
        try:
            fields = next(csv.reader([raw], strict=True))
        except csv.Error as e:
            die(f"{where}: not parsable as CSV -- {e}\n       {raw.strip()}")
        if len(fields) != len(COLUMNS):
            die(f"{where}: {len(fields)} field(s), want {len(COLUMNS)} "
                f"({','.join(COLUMNS)})\n       {raw.strip()}")
        rows.append((where, fields))

    if not rows:
        die(f"manifest {MANIFEST}: no patches found")
    where, header = rows.pop(0)
    if tuple(header) != COLUMNS:
        die(f"{where}: header is {','.join(header)}, want {','.join(COLUMNS)}")
    if not rows:
        die(f"manifest {MANIFEST}: no patches found")

    patches = []
    for where, fields in rows:
        row = dict(zip(COLUMNS, fields))
        check_row(where, row)
        patches.append(row)
    return patches


def check_overlaps(inplace):
    """Only in-place writes can collide (pool appends are bump-allocated) -- including
    inlined `reloc` rows, whose slot can land on a `string` row."""
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


def check_relocations(orig, data):
    """Gate the "no code motion" rule instead of trusting it: a relocation target's word
    may not change.

      entry untouched -> the word must still be what pristine KBU2 had there
      entry repointed -> its new target must be a far call's segment word (`9a` +3)

    Repointing is how deliberate code motion declares itself; the `9a` proves the entry
    landed on a call and not on an arbitrary word."""
    nrel, = struct.unpack_from("<H", data, 0x06)
    hdr = struct.unpack_from("<H", data, 0x08)[0] * 16
    tbl, = struct.unpack_from("<H", data, 0x18)
    if (nrel, hdr, tbl) != tuple(x[0] for x in (struct.unpack_from("<H", orig, 0x06),
                                                (struct.unpack_from("<H", orig, 0x08)[0] * 16,),
                                                struct.unpack_from("<H", orig, 0x18))):
        die("the MZ relocation table itself moved or changed size -- unsupported")

    for i in range(nrel):
        ent = tbl + 4 * i
        off, seg = struct.unpack_from("<HH", data, ent)
        target = hdr + seg * 16 + off
        if data[ent:ent + 4] != orig[ent:ent + 4]:          # repointed on purpose
            if data[target - 3] != 0x9A:
                die(f"relocation entry {i} at {ent:#x} was repointed to {target:#x}, "
                    f"which is not a far call's segment word (no 9a at {target - 3:#x})")
        elif data[target:target + 2] != orig[target:target + 2]:
            die(f"a patch changed the word at {target:#x}, which relocation entry {i} "
                f"({ent:#x}) pins.\n"
                f"       DOS fixes up that word at load time: moving code out from under "
                f"an entry\n"
                f"       breaks the call that moved AND corrupts what took its place. "
                f"See 'NO CODE MOTION'\n"
                f"       in this script's docstring.")


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

    # every bytes/string expect, against the pristine image
    for p in patches:
        if p["kind"] == "reloc":
            continue
        end = p["off"] + len(p["expect"])
        need = end + 1 if p["kind"] == "string" else end     # a string needs its NUL too
        if need > len(data):
            die(f"{p['label']}: {p['off']:#x}+{len(p['expect'])}B runs past the end of "
                f"the image ({len(data)} bytes)")
        got = bytes(data[p["off"]:end])
        if got != p["expect"]:
            die(f"{p['label']}: expected {p['expect'].hex()} at {p['off']:#x}, "
                f"found {got.hex()}")
        if p["kind"] == "string" and data[end] != 0:
            die(f"{p['label']}: original string at {p['off']:#x} is not "
                f"NUL-terminated at its expected length")

    # `bytes` rows land first, so a row that deliberately moves a `b8 <dsoff>` is resolved
    # at the ref's NEW offset -- pristine would still show the pre-motion instruction there.
    # `expect` is unchanged, so a wrong offset is still caught; it now just has to name
    # where the ref ends up. The in-place pass below rewrites these identically.
    for p in patches:
        if p["kind"] == "bytes":
            data[p["off"]:p["off"] + len(p["payload"])] = p["payload"]

    relocs = [p for p in patches if p["kind"] == "reloc"]
    for p in relocs:
        for ref in p["offs"]:
            src, got = deref(data, ref, p["label"])
            if got != p["expect"]:
                die(f"{p['label']}: ref {ref:#x} points at "
                    f"{got.decode(ENCODING)!r}, not {p['expect'].decode(ENCODING)!r}")
            if p.setdefault("src", src) != src:
                die(f"{p['label']}: its refs point at different strings "
                    f"({p['src']:#x} and {src:#x}) -- one row per string")
    check_reloc_sources(relocs)

    # The pool is for overflows only; a translation that fits goes in the slot with the
    # refs left alone. The freed tail keeps stale English, past our NUL and never read.
    for p in relocs:
        p["inlined"] = len(p["text"]) - 1 <= len(p["expect"])
    pooled = [p for p in relocs if not p["inlined"]]

    # bytes/string at their own offset, inlined relocs at the slot their refs point to
    inplace = [(p["off"], p["payload"], p["label"])
               for p in patches if p["kind"] in ("bytes", "string")]
    inplace += [(p["src"], p["text"], p["label"]) for p in relocs if p["inlined"]]
    check_overlaps(inplace)
    for off, payload, _ in inplace:
        data[off:off + len(payload)] = payload

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

    check_relocations(open(INPUT, "rb").read(), data)

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
