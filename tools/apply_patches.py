#!/usr/bin/env python3
"""Build KBR.EXE from pristine KBU.EXE by applying tools/patches.json.

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
live -- there is no per-row label column). The file is UTF-8; string `write`
values are transcoded to CP866 at apply time.
    type    "bytes" | "string"
    offset  file offset, e.g. 0xC40A
    expect  what must currently be at offset  (hex for bytes, text for string)
    write   what to write there               (hex for bytes, text for string)

House rule: quote the expect/write columns ("Gold:  ") so significant leading
and trailing spaces stay visible -- game UI strings are padded to fixed widths.
(This flat format has no place for embedded newlines; a string that needs one
would use a `\\n` escape, decoded on load -- none exist yet.)

bytes : expect/write are hex and must be equal length (overwrite in place).
string: expect/write are CP866 text. `write` must be no longer (encoded) than
        `expect` -- same-or-shorter is safe -- and a NUL terminator is written
        after it. `expect` must be the complete original string (its own NUL is
        verified), so its length is the slot budget: a longer translation is
        rejected here and will need repointing later.
"""

import csv
import hashlib
import os
import sys

ENCODING = "cp866"
TARGET_SHA256 = "a0ad8832b6a9afa7b28c7d0054a13e286d7952a558eaa12a38f6146e77339d49"

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
INPUT = os.path.join(ROOT, "KBU.EXE")
OUTPUT = os.path.join(ROOT, "KBR.EXE")
MANIFEST = os.path.join(HERE, "patches.csv")


def die(msg):
    sys.exit(f"error: {msg}")


def resolve(patch, idx):
    """Return (offset, expect_bytes, payload_bytes, label) for one patch.

    payload_bytes is exactly what gets written at offset (for strings that is
    the encoded text plus a NUL terminator). expect_bytes is what must already
    be there -- for strings, verified together with the original NUL below.
    """
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
        return off, expect, payload, label

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
                f"{len(expect)}B -- needs repointing")
        return off, expect, text + b"\x00", label

    die(f"{label}: unknown type {typ!r} (want 'bytes' or 'string')")


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


def check_overlaps(resolved):
    spans = sorted((off, off + max(len(expect), len(payload)), label)
                   for off, expect, payload, label in resolved)
    for (a_lo, a_hi, a), (b_lo, b_hi, b) in zip(spans, spans[1:]):
        if b_lo < a_hi:
            die(f"patches overlap: {a!r} [{a_lo:#x},{a_hi:#x}) and "
                f"{b!r} [{b_lo:#x},{b_hi:#x})")


def main():
    patches = load_manifest()

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

    resolved = [resolve(p, i) for i, p in enumerate(patches, 1)]
    check_overlaps(resolved)

    for off, expect, _payload, label in resolved:
        got = bytes(data[off:off + len(expect)])
        if got != expect:
            die(f"{label}: expected {expect.hex()} at {off:#x}, found {got.hex()}")

    for off, _expect, payload, _label in resolved:
        data[off:off + len(payload)] = payload

    open(OUTPUT, "wb").write(bytes(data))
    print(f"applied {len(resolved)} patch(es): KBU.EXE -> KBR.EXE")
    for off, _e, _payload, label in resolved:
        print(f"  {off:#08x}  {label}")


if __name__ == "__main__":
    main()
