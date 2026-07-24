#!/usr/bin/env python3
"""Build KBR.EXE from pristine KBU.EXE by applying tools/patches.csv.

This is not a universal patcher. It reads exactly one file -- KBU.EXE in the
repo root (with the SHA-256 baked in below) -- and writes exactly one file,
KBR.EXE next to it. Run it with no arguments:

    python3 tools/apply_patches.py

The hash gate refuses any KBU.EXE whose bytes differ, so every offset in the
manifest is provably correct against that exact image -- no per-patch address
arithmetic is needed.

Manifest (tools/patches.csv): a CSV with header `type,offset,expect,write`, one
patch per row. Blank lines and lines whose first non-space char is `#` are
ignored, so `#` lines serve as section comments (which is where descriptions
live -- there is no per-row label column). The file is UTF-8; string `write`/
`expect` values are transcoded to CP866 at apply time.
    type    "bytes" | "string" | "reloc"
    offset  file offset, e.g. 0xC40A
    expect  what must currently be at offset  (hex for bytes/reloc, text for string)
    write   what to write there               (hex for bytes, text for string/reloc)

House rule: quote the expect/write columns ("Gold:  ") so significant leading
and trailing spaces stay visible -- game UI strings are padded to fixed widths.

bytes : expect/write are hex and must be equal length (overwrite in place).

string: expect/write are CP866 text. `write` must be no longer (encoded) than
        `expect` -- same-or-shorter is safe -- and a NUL terminator is written
        after it. `expect` must be the complete original string (its own NUL is
        verified), so its length is the slot budget: a longer translation is
        rejected here and belongs in a `reloc` row instead.

reloc : for a translation that OVERFLOWS its original slot. `offset` is NOT the
        string -- it is the REF: the file offset of the 2-byte near pointer that
        points at the string. `expect` is the 2 bytes currently there (the old
        pointer, hex); `write` is the replacement text. The engine appends the
        text to the overflow pool at DS POOL_DSOFF and rewrites the pointer at
        `offset` to aim there; the original slot is untouched. Find a ref once
        with tools/find_ref.py.

Pool safety: measured, not assumed. A full-session memory dump (puzzle map open)
put the near-heap high-water at DS 0xb6cf and the stack low-water at DS 0xfe2c --
a 17.8 KB cold band -- so the pool sits mid-band with KB of slack either side.
See the POOL_* constants below and CLAUDE.md "String repointing -> Pool safety".

Every `reloc` row's ref MUST come from tools/find_ref.py, which validates that
the site is a real code immediate or pointer-table slot. A hand-picked offset can
land on a 2-byte value that merely happens to equal the string's DS offset --
that mistake (a ref inside a counter table) silently corrupted game data and
crashed the puzzle map.
"""

import csv
import hashlib
import os
import struct
import sys

ENCODING = "cp866"
TARGET_SHA256 = "a0ad8832b6a9afa7b28c7d0054a13e286d7952a558eaa12a38f6146e77339d49"

# DGROUP layout of KBU.EXE (see CLAUDE.md "String repointing").
DS_BASE = 0x15690        # file offset of DS:0000 -- near offset 0 lives here
BSSEND  = 0xB64C         # _end: heap floor / top of BSS (c0 constant, verified)

# Overflow-pool placement, from the MEMDUMP.BIN measurement (heavy session with
# the puzzle map open): the game's near memory demand is tiny -- near-heap
# high-water DS 0xb6cf (~131 B above _end) and stack low-water DS 0xfe2c (~467 B
# below the top), leaving a 17.8 KB cold band at DS 0xb6d0..0xfe2c. The pool sits
# mid-band, so the climbing heap and the descending stack each have several KB of
# slack before they could reach it. c0's BSS wipe stops at _end (0xb64c), so the
# pool's file-loaded bytes survive startup untouched.
#
# DGROUP is left FLOATING (_heaplen stays 0): capping it to force c0's fixed
# branch was tried and reverted -- it buys nothing here (the heap barely grows)
# and costs the stack its headroom.
POOL_DSOFF     = 0xD6D0                    # pool base, mid cold band
POOL_SIZE      = 0x1000                    # 4 KB budget (whole-text overflow est. ~2.4-4 KB)
POOL_END_DSOFF = POOL_DSOFF + POOL_SIZE    # hard cap; keeps clear of the stack's descent

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
INPUT = os.path.join(ROOT, "KBU.EXE")
OUTPUT = os.path.join(ROOT, "KBR.EXE")
MANIFEST = os.path.join(HERE, "patches.csv")


def die(msg):
    sys.exit(f"error: {msg}")


def resolve(patch, idx):
    """Parse one manifest row into a dict describing the edit. `kind` is one of
    'bytes' | 'string' | 'reloc'; the remaining keys depend on kind (see main)."""
    label = f"patch {idx}"
    typ = patch.get("type")
    try:
        off = int(str(patch["offset"]), 0)
    except KeyError:
        die(f"{label}: missing offset")
    except ValueError:
        die(f"{label}: bad offset {patch['offset']!r}")

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
            expect = patch["expect"].encode(ENCODING)
            text = patch["write"].encode(ENCODING)
        except KeyError as e:
            die(f"{label}: missing {e}")
        except UnicodeEncodeError as e:
            die(f"{label}: {patch['write']!r} is not encodable in {ENCODING} ({e})")
        if len(text) > len(expect):
            die(f"{label}: translation is {len(text)}B but the slot holds "
                f"{len(expect)}B -- use a 'reloc' row")
        return {"kind": "string", "off": off, "expect": expect,
                "payload": text + b"\x00", "label": label}

    if typ == "reloc":
        try:
            expect = bytes.fromhex(patch["expect"].replace(" ", ""))
        except (KeyError, ValueError) as e:
            die(f"{label}: bad reloc expect ({e}) -- want the 2 pointer bytes, hex")
        if len(expect) != 2:
            die(f"{label}: reloc expect is {len(expect)}B; it must be the 2-byte "
                f"pointer currently at the ref offset")
        try:
            text = patch["write"].encode(ENCODING)
        except KeyError as e:
            die(f"{label}: missing {e}")
        except UnicodeEncodeError as e:
            die(f"{label}: {patch['write']!r} is not encodable in {ENCODING} ({e})")
        return {"kind": "reloc", "off": off, "expect": expect,
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
    """Overlap check for in-place edits (reloc pool appends are bump-allocated at
    end and cannot overlap)."""
    spans = sorted((p["off"], p["off"] + len(p["payload"]), p["label"]) for p in inplace)
    for (a_lo, a_hi, a), (b_lo, b_hi, b) in zip(spans, spans[1:]):
        if b_lo < a_hi:
            die(f"patches overlap: {a!r} [{a_lo:#x},{a_hi:#x}) and "
                f"{b!r} [{b_lo:#x},{b_hi:#x})")


def fix_mz_header(data):
    """Rewrite the MZ page-count fields so DOS loads the grown image (including
    the appended overflow pool). minalloc is left as-is: the runtime's BSS/heap/
    stack now sit inside the file-backed region as zeros, harmless, and keeping
    minalloc guarantees at least the original amount of extra memory."""
    total = len(data)
    struct.pack_into("<H", data, 0x02, total % 512)          # bytes on last page
    struct.pack_into("<H", data, 0x04, (total + 511) // 512)  # pages (512B)


def main():
    patches = [resolve(p, i) for i, p in enumerate(load_manifest(), 1)]

    try:
        data = bytearray(open(INPUT, "rb").read())
    except FileNotFoundError:
        die(f"KBU.EXE not found at {INPUT}")

    digest = hashlib.sha256(data).hexdigest()
    if digest != TARGET_SHA256:
        die(f"{INPUT} is not pristine KBU.EXE\n"
            f"       expected sha256 {TARGET_SHA256}\n"
            f"       got             {digest}\n"
            f"       regenerate it with unpack_exepack.py.")

    check_overlaps([p for p in patches if p["kind"] in ("bytes", "string")])

    # verify every patch's expect against the pristine image
    for p in patches:
        end = p["off"] + len(p["expect"])
        got = bytes(data[p["off"]:end])
        if got != p["expect"]:
            die(f"{p['label']}: expected {p['expect'].hex()} at {p['off']:#x}, "
                f"found {got.hex()}")
        if p["kind"] == "string" and data[end] != 0:
            die(f"{p['label']}: original string at {p['off']:#x} is not "
                f"NUL-terminated at its expected length")

    # in-place edits (bytes/string): overwrite at offset
    for p in patches:
        if p["kind"] in ("bytes", "string"):
            data[p["off"]:p["off"] + len(p["payload"])] = p["payload"]

    # reloc: append text to the overflow pool, rewrite each ref pointer
    relocs = [p for p in patches if p["kind"] == "reloc"]
    if relocs:
        pool_base = DS_BASE + POOL_DSOFF
        if len(data) < pool_base:
            data.extend(b"\x00" * (pool_base - len(data)))
        for p in relocs:
            new_dsoff = POOL_DSOFF + (len(data) - pool_base)
            if new_dsoff + len(p["text"]) > POOL_END_DSOFF:
                die(f"{p['label']}: overflow pool exhausted "
                    f"(need DS {new_dsoff:#06x}+{len(p['text'])}B, "
                    f"cap {POOL_END_DSOFF:#06x})")
            data.extend(p["text"])
            struct.pack_into("<H", data, p["off"], new_dsoff)   # repoint the ref
            p["new_dsoff"] = new_dsoff
        fix_mz_header(data)

    open(OUTPUT, "wb").write(bytes(data))
    print(f"applied {len(patches)} patch(es) "
          f"({len(relocs)} reloc): KBU.EXE -> KBR.EXE")
    for p in patches:
        if p["kind"] == "reloc":
            print(f"  {p['off']:#08x}  reloc   ref -> DS {p['new_dsoff']:#06x}  {p['label']}")
        else:
            print(f"  {p['off']:#08x}  {p['kind']:6}  {p['label']}")
    if relocs:
        used = len(data) - (DS_BASE + POOL_DSOFF)
        print(f"  overflow pool: DS {POOL_DSOFF:#06x}..{POOL_DSOFF + used:#06x} "
              f"({used}B used / {POOL_SIZE}B); image grown to {len(data)} bytes")


if __name__ == "__main__":
    main()
