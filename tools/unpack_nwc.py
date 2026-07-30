#!/usr/bin/env python3
"""Strip the outer New World Computing packer from game/KB.EXE and emit
build/KBU1.EXE -- the inner (still EXEPACK-packed) EXE.

    python3 tools/unpack_nwc.py            # game/KB.EXE -> build/KBU1.EXE

How the NWC layer works
-----------------------
KB.EXE = [ 1177-byte NWC stub ][ inner MZ header ][ LZW stream ]

At runtime the stub reopens its own file, seeks past itself, reads the inner
EXE's MZ header, then streams the payload in 8 KB chunks and LZW-expands it
into memory (`int 21h/AH=3Fh` in a refill routine -- hence "disk-streaming
packer"). The compression is the SAME codec as the .CC archives: variable-width
LZW, LSB-first bit packing, 9->12 bits, clear=0x100, end=0x101, first code
0x102, GIF-style width growth. So tools/cc.py's validated decoder decodes it
unchanged -- the only real work here is locating the stream and rebuilding a
loadable EXE around it.

Stub layout used below (offsets are into the stub image, i.e. file offset minus
the outer header size), all read straight out of the disassembly:

    +0x4b   uint16  file offset of the inner MZ header (0x699 in our copy:
                    exactly the outer header 0x200 + the 1177-byte stub)
    +0x4d   asciiz  "KB.EXE" -- the fallback name it reopens when the DOS
                    version is too old for the PSP environment path

The inner MZ header is an ordinary DOS header; the stub takes CS:IP, SS:SP and
the memory sizing from it, and its e_lfarlc/e_crlc describe a relocation table
of its own. In our copy e_crlc is **0** (the EXEPACK stub self-relocates, which
is why KBU1.EXE also shows 0 relocations), so no fixups are applied. A copy
with a nonzero count would need them applied before the image is meaningful --
that is refused rather than silently mishandled.
"""

import hashlib
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cc import lzw_decode                                    # noqa: E402
from paths import KB_EXE as INPUT, KBU1 as OUTPUT            # noqa: E402

BASE_PTR = 0x4B          # stub offset holding the inner header's file offset
# The image we expect from the copy this project was reversed against. A
# mismatch is not fatal here -- apply_patches.py's KBU2.EXE hash gate is the real
# check -- but it is worth saying loudly, because every offset in patches.csv
# assumes this exact build of the game.
KNOWN_IMAGE_SHA256 = "06ca56b4d1ca737b050178cd394cc9e52e9879c860dcf51c45ff457cc5236c4a"

MZ = struct.Struct("<14H")   # e_magic..e_ovno


def die(msg):
    sys.exit(f"error: {msg}")


def mz_fields(data, off):
    """Return the 14 standard MZ header words at `off`."""
    if data[off:off + 2] != b"MZ":
        die(f"no MZ signature at {off:#x}")
    return MZ.unpack_from(data, off)


def unpack(src_path=INPUT, dst_path=OUTPUT):
    try:
        d = open(src_path, "rb").read()
    except FileNotFoundError:
        die(f"{src_path} not found -- put your original KB.EXE in game/ "
            f"(see game/README.md)")

    # ---- outer EXE: the stub ------------------------------------------------
    _, _, _, _, cparhdr, *_ = mz_fields(d, 0)
    stub = cparhdr * 16                       # file offset of the stub image
    base = struct.unpack_from("<H", d, stub + BASE_PTR)[0]

    # ---- inner EXE: header, then the LZW stream right after it --------------
    (_, cblp, cp, crlc, in_cparhdr, minalloc, maxalloc,
     ss, sp, _csum, ip, cs, _lfarlc, _ovno) = mz_fields(d, base)
    if crlc:
        die(f"inner EXE declares {crlc} relocations; this unpacker only handles "
            f"the relocation-free layout of the copy it was written for")

    img_len = (cp - 1) * 512 + cblp - in_cparhdr * 16
    image = lzw_decode(d[base + in_cparhdr * 16:], img_len)
    if len(image) != img_len:
        die(f"LZW stream ended early: {len(image)} of {img_len} bytes")

    digest = hashlib.sha256(image).hexdigest()
    if digest != KNOWN_IMAGE_SHA256:
        print(f"warning: unpacked image hash {digest}\n"
              f"         differs from the known-good copy -- patches.csv offsets "
              f"assume that build; apply_patches.py will refuse a mismatch.",
              file=sys.stderr)

    # ---- rebuild a loadable EXE around the image ---------------------------
    # A 2-paragraph (32-byte) header, which is the layout unpack_exepack.py
    # expects. No relocations (crlc was verified 0 above), entry/stack taken
    # from the inner header.
    total = 32 + len(image)
    hdr = bytearray(32)
    MZ.pack_into(hdr, 0, 0x5A4D, total % 512, (total + 511) // 512, 0, 2,
                 minalloc, maxalloc, ss, sp, 0, ip, cs, 0x1C, 0)
    os.makedirs(os.path.dirname(dst_path), exist_ok=True)
    open(dst_path, "wb").write(bytes(hdr) + image)
    print(f"wrote {dst_path}: {total} bytes, image {len(image)} "
          f"(from {len(d)} packed), entry {cs:04x}:{ip:04x}, SS:SP {ss:04x}:{sp:04x}")


if __name__ == "__main__":
    unpack(*(sys.argv[1:3] or []))
