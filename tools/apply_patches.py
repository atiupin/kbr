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
        whatever took its place. A slid `b8` that a `reloc` row names moves that row's
        ref too. Both are legal when declared:
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
string's DS offset repoints something else -- a slot inside a counter table, say --
and the corruption surfaces far from the edit.

Two stages are not manifest-driven, both assembled by asm16.py and injected after the pool:
res/gate_picker.asm (see inject_gate_picker) and res/name_tables.asm (see inject_name_tables).
They are code and code-addressed data, not translation, and carry relocation bookkeeping and
resolved DS addresses the four-column manifest cannot express. Deleting either file is not
how to turn it off -- the stages are part of the build; revert them through git.
"""

import csv
import hashlib
import os
import re
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from asm16 import AsmError, assemble  # noqa: E402
from paths import (KBU2 as INPUT, KBR as OUTPUT, PATCHES_CSV as MANIFEST,  # noqa: E402
                   GATE_PICKER_ASM, NAME_TABLES_ASM, KBU2_SHA256)

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
# buys nothing and costs stack headroom.
#
# To re-measure: DOSBox-X debugger, `MEMDUMPBIN 0000:0000 100000`. DS:0000 sits 4 bytes
# below the "Turbo C++ - Copyright 1990 Borla..." literal; RAM boots zeroed, so the
# highest nonzero byte above _end and the lowest below 0xffff are the real water marks.
#
# That reading holds only on a FRESHLY STARTED DOSBox running the game ONCE. DOS clears
# nothing on load, so a later run leaves earlier builds' pool tails standing above its own
# image end -- byte-exact translated strings, layered, each build's image covering the head
# of the one before. They read as live writes past the pool and are nothing of the sort.
POOL_DSOFF     = 0xD000                    # pool base, mid cold band
POOL_SIZE      = 0x1800                    # 6 KB
POOL_END_DSOFF = POOL_DSOFF + POOL_SIZE    # hard cap; clear of the stack's descent

# Copy-protection segment (Ghidra 19fe:0000-0cc7). `reloc` rows MUST NOT repoint a ref
# in here. THE RULE IS SOLID; THE MECHANISM IS UNKNOWN -- distrust any explanation.
#
# One repointed immediate plays for minutes, then hangs in an INT 6 loop on entering the
# king's castle. It is not a simple checksum: repointing to another string inside the
# original image hangs too, and so does swapping two immediates, which leaves both the
# byte sum and the XOR unchanged. Heap exhaustion, stack exhaustion and pool placement
# are all ruled out -- re-testing those is wasted effort.
#
# Not "any byte here is fatal": our own flip at 0xC40A is exactly what KB!.COM patches at
# runtime, so nothing can guard it. The fence is conservative and costs nothing -- every
# string reached from here is protection UI that fits its own slot as a `string` row.
# Rejected at parse time: an inlined reloc is harmless today, one rewording from fatal.
PROT_LO, PROT_HI = 0xBFE0, 0xCCA7          # file offsets, inclusive

# --- Town/Castle Gate destination picker (res/gate_picker.asm) ----------------------------
# Why the gate needs a window of its own is in that file's header; what matters here is
# placement. The routine lands at CODE_DSOFF, the pool's hard cap: the pool bump-allocates
# upward and can never reach it, so string growth and code never compete. DGROUP is the
# routine's code segment as well as its data segment, so its labels are DS offsets.
CODE_DSOFF = POOL_END_DSOFF                # 0xE800, paragraph-aligned, just above the pool

# The gate's header/list/prompt/decode block. Everything from the box being drawn to the
# key being turned into a slot index; the tail that resolves coordinates is left alone.
STUB_AT, STUB_END = 0xF7C1, 0xF8C4
GATE_RESUME = 0xF900                       # past the visited re-check, now unreachable
GATE_EXIT = 0xF979                         # pop si / mov sp,bp / pop bp / retf
STUB_PAD = 0x90

STUB_SRC = """
    push si
    callf {seg:#06x}:{off:#06x}
    pop  cx
    cmp  al,0xff
    jz   cancelled
    mov  [bp-1],al
    jmp  {resume:#06x}
cancelled:
    xor  ax,ax
    push ax
    mov  ax,1
    push ax
    callf 0x1168:0x0d4d
    pop  cx
    pop  cx
    jmp  {exit:#06x}
"""


# --- Cyrillic hero names (res/name_tables.asm) --------------------------------------------
# Neither site can be a manifest row: both need the DS address of a table that only exists
# once the tables are placed. What each table is for is in that file's header.
#
# NAME_AT is the accept path of the name field's key loop. It is rewritten whole because the
# mapping must happen before the byte is BOTH stored and echoed, and because loading the key
# into AL once -- the original re-reads [bp-1] at every test -- is what pays for the xlat.
#
# FNAME_AT is the save-file name builder's per-character test, "A-Z, or else '_'". The table
# answers that for every byte, so the test collapses into a lookup plus a jump to the store
# the block already ends with. Only the first 6 bytes are rewritten and the rest is left as
# dead code, which keeps the relocation entry at 0x8FED pinning the word it always pinned.
# Overwriting that word means re-aiming the entry, and the replacement has no far call to
# re-aim it at; jumping over it costs nothing since nothing there runs any more.
TABLES_DSOFF = 0xEC00                      # clear of the gate picker below, the stack above
NAME_AT, NAME_END = 0x6750, 0x6776
NAME_REJECT = 0x677D                       # the key loop's "not accepted" tail
FNAME_AT = 0x8FE0
FNAME_PINNED = 0x8FED                      # relocation target, must stay where it is
FNAME_STORE = 0x8FFF                       # mov [si+0x6438],al -- reached with AL already set

NAME_SRC = """
    mov  al,[bp-1]
    cmp  al,0x20
    jb   {reject:#06x}
    cmp  al,0x7f
    ja   {reject:#06x}
    cmp  si,[bp+8]
    jge  {reject:#06x}
    or   si,si
    jnz  map
    cmp  al,0x20
    je   {reject:#06x}
map:
    mov  bx,{keymap:#06x}
    xlat
    mov  bx,[bp+6]
    mov  [bx+si],al
    inc  si
    mov  ah,0
"""

FNAME_SRC = """
    mov  bx,{translit:#06x}
    xlat
    jmp  {store:#06x}
"""


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


def mz_reloc_table(data):
    """-> (entry count, header size in bytes, table file offset)."""
    nrel, = struct.unpack_from("<H", data, 0x06)
    hdr = struct.unpack_from("<H", data, 0x08)[0] * 16
    tbl, = struct.unpack_from("<H", data, 0x18)
    return nrel, hdr, tbl


def reloc_target(data, ent, hdr):
    off, seg = struct.unpack_from("<HH", data, ent)
    return hdr + seg * 16 + off


def set_reloc_entry(data, ent, target, hdr):
    """Aim one entry at a file offset. Existing entries all use seg=0, which only reaches
    the first 64K; the injected routine is past that, so the offset is split."""
    seg, off = divmod(target - hdr, 16)
    if seg > 0xFFFF:
        die(f"relocation target {target:#x} is past the addressable image")
    struct.pack_into("<HH", data, ent, off, seg)


def check_relocations(orig, data):
    """Gate the "no code motion" rule instead of trusting it: a relocation target's word
    may not change.

      entry untouched -> the word must still be what pristine KBU2 had there
      entry repointed -> its new target must be a far call's segment word (`9a` +3)
      entry appended  -> same, and it must fit in the header's own spare slots

    Repointing is how deliberate code motion declares itself; the `9a` proves the entry
    landed on a call and not on an arbitrary word. The table may grow into the zeros
    between its end and the end of the header, which shifts nothing; it may not move."""
    nrel, hdr, tbl = mz_reloc_table(data)
    orig_nrel, orig_hdr, orig_tbl = mz_reloc_table(orig)
    if (hdr, tbl) != (orig_hdr, orig_tbl):
        die("the MZ relocation table itself moved -- unsupported")
    if nrel < orig_nrel:
        die(f"the relocation table shrank ({orig_nrel} -> {nrel}) -- unsupported")
    if tbl + 4 * nrel > hdr:
        die(f"the relocation table ({nrel} entries) ran past the end of the header")

    for i in range(orig_nrel, nrel):
        target = reloc_target(data, tbl + 4 * i, hdr)
        if data[target - 3] != 0x9A:
            die(f"appended relocation entry {i} aims at {target:#x}, which is not a "
                f"far call's segment word (no 9a at {target - 3:#x})")

    for i in range(orig_nrel):
        ent = tbl + 4 * i
        target = reloc_target(data, ent, hdr)
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


def retarget_relocations(data, lo, hi, sites):
    """Re-aim every entry pointing into [lo,hi) at one of `sites`, then append the rest.

    Both halves matter. An entry left pointing into overwritten code has DOS add the load
    segment to whatever byte pair took its place -- silent corruption far from the edit.
    A new far call with no entry keeps its link-time segment and calls into whatever the
    loader put there."""
    nrel, hdr, tbl = mz_reloc_table(data)
    dead = [tbl + 4 * i for i in range(nrel) if lo <= reloc_target(data, tbl + 4 * i, hdr) < hi]
    if len(dead) > len(sites):
        die(f"{len(dead)} relocation entries point into [{lo:#x},{hi:#x}) but the "
            f"replacement has only {len(sites)} far calls to re-aim them at.\n"
            f"       Removing an entry means compacting the table, which this does not do.")

    todo = list(sites)
    for ent in dead:
        set_reloc_entry(data, ent, todo.pop(0), hdr)

    room = (hdr - (tbl + 4 * nrel)) // 4
    if len(todo) > room:
        die(f"{len(todo)} new relocation entries needed but only {room} free slots "
            f"before the header ends -- growing the table would shift the whole image")
    for k, site in enumerate(todo):
        set_reloc_entry(data, tbl + 4 * (nrel + k), site, hdr)
    struct.pack_into("<H", data, 0x06, nrel + len(todo))
    return len(dead), len(todo)


def inject_gate_picker(data):
    """Assemble res/gate_picker.asm into the image and hand the gate spell over to it."""
    try:
        source = open(GATE_PICKER_ASM, encoding="utf-8").read()
    except FileNotFoundError:
        die(f"gate picker source not found: {GATE_PICKER_ASM}")
    try:
        code, code_relocs, _ = assemble(source, org=CODE_DSOFF)
    except AsmError as e:
        die(f"{GATE_PICKER_ASM}: {e}")

    # DGROUP's own paragraph, image-relative; DOS adds the load segment via the entry.
    dgroup_para, slack = divmod(DS_BASE - mz_reloc_table(data)[1], 16)
    if slack:
        die(f"DGROUP is not paragraph-aligned (DS_BASE {DS_BASE:#x}) -- "
            f"the injected routine cannot be reached by a far call")

    stub_src = STUB_SRC.format(seg=dgroup_para, off=CODE_DSOFF,
                               resume=GATE_RESUME, exit=GATE_EXIT)
    try:
        stub, stub_relocs, _ = assemble(stub_src, org=STUB_AT)
    except AsmError as e:
        die(f"gate stub: {e}")
    if STUB_AT + len(stub) > STUB_END:
        die(f"gate stub is {len(stub)}B but the block it replaces is "
            f"{STUB_END - STUB_AT}B")

    data[STUB_AT:STUB_END] = stub + bytes([STUB_PAD]) * (STUB_END - STUB_AT - len(stub))

    code_at = DS_BASE + CODE_DSOFF
    if len(data) > code_at:
        die(f"the overflow pool reached {len(data) - DS_BASE:#x}, past the code region "
            f"at DS {CODE_DSOFF:#06x} -- lower POOL_SIZE or move CODE_DSOFF")
    data.extend(b"\x00" * (code_at - len(data)))
    data.extend(code)

    sites = [STUB_AT + r for r in stub_relocs] + [code_at + r for r in code_relocs]
    for site in sites:                       # the entry is only ever correct on a `9a` +3
        if data[site - 3] != 0x9A:
            die(f"internal: reloc site {site:#x} is not a far call's segment word")
    reaimed, added = retarget_relocations(data, STUB_AT, STUB_END, sites)
    return {"code": len(code), "stub": len(stub),
            "sites": len(sites), "reaimed": reaimed, "added": added}


def inject_name_tables(data):
    """Place res/name_tables.asm in DGROUP and point the two name sites at it."""
    try:
        source = open(NAME_TABLES_ASM, encoding="utf-8").read()
    except FileNotFoundError:
        die(f"name tables not found: {NAME_TABLES_ASM}")
    try:
        tables, tbl_relocs, symbols = assemble(source, org=TABLES_DSOFF)
    except AsmError as e:
        die(f"{NAME_TABLES_ASM}: {e}")
    if tbl_relocs:
        die(f"{NAME_TABLES_ASM}: data only -- a far call there would need its own "
            f"relocation entry")
    for want in ("keymap", "translit"):
        if want not in symbols:
            die(f"{NAME_TABLES_ASM}: no {want}: label")

    # Both tables are indexed by the raw byte, so a label IS its xlat base -- and a row of
    # the wrong length would silently shift every entry past it instead of failing.
    keymap, translit = symbols["keymap"], symbols["translit"]
    for lo, hi, want, name in ((keymap, translit, 0x80, "keymap"),
                               (translit, TABLES_DSOFF + len(tables), 0x100, "translit")):
        if hi - lo != want:
            die(f"{NAME_TABLES_ASM}: {name} spans {hi - lo}B, want {want}B -- "
                f"it must cover its whole index range, 16 bytes to the row")

    at = DS_BASE + TABLES_DSOFF
    if len(data) > at:
        die(f"the image reached DS {len(data) - DS_BASE:#06x}, past the name tables at "
            f"DS {TABLES_DSOFF:#06x} -- raise TABLES_DSOFF")
    data.extend(b"\x00" * (at - len(data)))
    data.extend(tables)

    try:
        entry, _, _ = assemble(NAME_SRC.format(reject=NAME_REJECT, keymap=keymap), org=NAME_AT)
        fname, _, _ = assemble(FNAME_SRC.format(translit=translit, store=FNAME_STORE),
                               org=FNAME_AT)
    except AsmError as e:
        die(f"name site: {e}")
    if NAME_AT + len(entry) > NAME_END:
        die(f"the name entry block is {len(entry)}B but the accept path it replaces is "
            f"{NAME_END - NAME_AT}B")
    if FNAME_AT + len(fname) > FNAME_PINNED:
        die(f"the file name block is {len(fname)}B and would reach the relocation target "
            f"at {FNAME_PINNED:#x}")

    data[NAME_AT:NAME_END] = entry + bytes([STUB_PAD]) * (NAME_END - NAME_AT - len(entry))
    data[FNAME_AT:FNAME_AT + len(fname)] = fname
    return {"tables": len(tables), "entry": len(entry), "fname": len(fname),
            "keymap": keymap, "translit": translit}


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

    # After the pool: the routine sits at the pool's cap, so it must be placed once the
    # pool has stopped growing. Measure the pool first -- injection pads the file out to
    # the code region, which would otherwise read as a full pool.
    pool_used = max(0, len(data) - (DS_BASE + POOL_DSOFF))
    picker = inject_gate_picker(data)
    names = inject_name_tables(data)
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
        print(f"  overflow pool: DS {POOL_DSOFF:#06x}..{POOL_DSOFF + pool_used:#06x} "
              f"({pool_used}B used / {POOL_SIZE}B)")
    print(f"  gate picker: {picker['code']}B at DS {CODE_DSOFF:#06x}, "
          f"{picker['stub']}B stub at {STUB_AT:#x} (block is {STUB_END - STUB_AT}B); "
          f"{picker['sites']} far call(s): {picker['reaimed']} entry re-aimed, "
          f"{picker['added']} appended")
    print(f"  name tables: {names['tables']}B at DS {TABLES_DSOFF:#06x} "
          f"(keymap {names['keymap']:#06x}, translit {names['translit']:#06x}); "
          f"{names['entry']}B at {NAME_AT:#x} (block is {NAME_END - NAME_AT}B), "
          f"{names['fname']}B at {FNAME_AT:#x}")
    print(f"  image grown to {len(data)} bytes")


if __name__ == "__main__":
    main()
