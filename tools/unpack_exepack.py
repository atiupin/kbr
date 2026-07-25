#!/usr/bin/env python3
"""
Strip the Microsoft EXEPACK layer from build/KBU1.EXE and emit a flat
build/KBU2.EXE with a proper DOS relocation table.

Pipeline for the whole game (everything after the pristine game/ originals
lands in build/):
    game/KB.EXE  --(tools/unpack_nwc.py)-->  build/KBU1.EXE
                 --(this script)---------->  build/KBU2.EXE

Run with no arguments to use those default paths; pass src/dst to override.

KB.EXE is double-packed: an outer custom New World Computing packer (stripped
by unpack_nwc.py) wrapping an inner Microsoft EXEPACK layer (removed here).
KBU2.EXE is the flat, uncompressed translation base: every string sits at a
fixed offset, editable in place.

Validated: KBU2's decompressed image matches the live running game (dump1)
98.9% after relocation; the ~1% delta is runtime-mutated variables.

The EXEPACK format
------------------
The packer stub is identified by the signature "RB" at its CS:0x10, and by its
error string "Packed file is corrupt". Its 18-byte header at CS:0000 holds the
real entry CS:IP, SS:SP and the decompressed length.

Decompression reads records BACKWARD from stub CS:0000, expanding the image
upward in place. Any trailing 0xFF padding is skipped first, then each record is
    [cmd][len_hi][len_lo]
with `cmd & 0xFE` selecting the operation -- 0xB0 = fill (one fill byte follows
below the record), 0xB2 = copy a literal run -- and `cmd & 1` marking the last
record.

EXEPACK self-relocates at runtime from its own table, which is why KBU1.EXE
runs at any load address despite declaring 0 relocations in its DOS header. That
table sits right after the "Packed file is corrupt" string as 16 sections, each
a uint16 count followed by that many uint16 offsets; section i contributes
segment base i*0x1000. It is decoded here and written out as a real 1960-entry
DOS relocation table, which is what makes KBU2.EXE an ordinary loadable EXE.
"""
import os, struct, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from paths import KBU1, KBU2                                 # noqa: E402


def unpack(src_path=KBU1, dst_path=KBU2,
           validate=None, validate_base=0x8920, load_seg=0x892):
    d = open(src_path, "rb").read()
    # Take the load image exactly as the DOS header declares it -- KBU1's
    # header is 32 bytes and its image 107501 bytes, but reading the fields
    # keeps this honest if the file is ever regenerated differently. (CUP386's
    # output carried ~78 KB of dump tail past the declared end; the declared
    # length is what DOS would load, and what the EXEPACK offsets below assume.)
    cblp, cp, _crlc, cparhdr = struct.unpack_from("<4H", d, 2)
    img = bytearray(d[cparhdr * 16:(cp - 1) * 512 + cblp])

    # EXEPACK header lives at the packer stub's CS:0000. For KBU1 that's image
    # offset 0x19350 (stub entry CS:IP = 1935:0012; IP 0x12 = past the 18-byte hdr).
    cs0 = 0x19350
    (real_ip, real_cs, _mem_start, exepack_size,
     real_sp, real_ss, dest_len, skip_len) = struct.unpack_from("<8H", img, cs0)
    assert bytes(img[cs0 + 16:cs0 + 18]) == b"RB", "EXEPACK 'RB' signature not found"

    # ---- decompress EXEPACK RLE, reading records backward from cs0 ----
    dest = bytearray(dest_len * 16)
    dest[:cs0] = img[:cs0]              # packed bytes live low, expand in place upward
    src = cs0
    while src > 0 and img[src - 1] == 0xFF:   # skip 0xFF padding before first record
        src -= 1
    dst = len(dest)
    records = 0
    while True:
        cmd = img[src - 1]; length = img[src - 3] | (img[src - 2] << 8); src -= 3
        op = cmd & 0xFE
        if op == 0xB0:                 # fill: next byte repeated `length` times
            fill = img[src - 1]; src -= 1
            dest[dst - length:dst] = bytes([fill]) * length; dst -= length
        elif op == 0xB2:               # copy: `length` literal bytes
            dest[dst - length:dst] = dest[src - length:src]; src -= length; dst -= length
        else:
            raise ValueError(f"bad EXEPACK opcode 0x{cmd:02x}")
        records += 1
        if cmd & 1:                    # low bit set = last record
            break

    # ---- decode EXEPACK's own relocation table (16 sections after the error string) ----
    p = img.find(b"Packed file is corrupt") + 22
    relocs = []
    for section in range(16):
        cnt = struct.unpack_from("<H", img, p)[0]; p += 2
        for _ in range(cnt):
            off = struct.unpack_from("<H", img, p)[0]; p += 2
            relocs.append((section * 0x1000, off))

    out = bytes(dest)

    # ---- optional byte-level validation against a live memory dump ----
    if validate:
        try:
            gt = open(validate, "rb").read()[validate_base:validate_base + dest_len * 16]
            applied = bytearray(out)
            for seg, off in relocs:
                lin = seg * 16 + off
                w = (applied[lin] | (applied[lin + 1] << 8)) + load_seg & 0xffff
                applied[lin] = w & 0xff; applied[lin + 1] = w >> 8
            same = sum(1 for a, b in zip(applied, gt) if a == b)
            print(f"validation vs {validate}: {100 * same / len(gt):.2f}% match after relocation")
        except FileNotFoundError:
            pass

    # ---- write flat MZ with a real relocation table ----
    reloc_bytes = b"".join(struct.pack("<HH", off, seg) for seg, off in relocs)
    hdr_size = ((0x1C + len(reloc_bytes) + 511) // 512) * 512
    total = hdr_size + len(out)
    minalloc = max(0x200, (real_ss * 16 + real_sp - len(out)) // 16 + 0x200)
    hdr = bytearray(hdr_size)
    struct.pack_into("<14H", hdr, 0, 0x5A4D, total % 512, (total + 511) // 512,
                     len(relocs), hdr_size // 16, minalloc, 0xFFFF,
                     real_ss, real_sp, 0, real_ip, real_cs, 0x1C, 0)
    hdr[0x1C:0x1C + len(reloc_bytes)] = reloc_bytes
    open(dst_path, "wb").write(bytes(hdr) + out)
    print(f"wrote {dst_path}: {total} bytes, {len(relocs)} relocations, "
          f"{records} EXEPACK records, entry {real_cs:04x}:{real_ip:04x}, SS:SP {real_ss:04x}:{real_sp:04x}")

if __name__ == "__main__":
    unpack(*(sys.argv[1:3] or []))
