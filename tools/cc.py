#!/usr/bin/env python3
"""NWC "CC" archive tool for King's Bounty (256.CC / 416.CC).

Archive layout
--------------
    [uint16 count]
    count * 8-byte TOC entries:  [uint16 id][uint24 offset LE][uint16 size LE][1 pad]
    member data (first member begins right after the TOC, at 2 + count*8)

Each member is:
    [uint32 declen LE][ LZW stream ]

Compression is variable-width LZW, LSB-first bit packing, 9->12 bits, clear=0x100,
end=0x101, first dictionary code=0x102, GIF-style width growth (no early change),
CLEAR emitted when the dictionary fills. The stream starts with a CLEAR code.
This matches the game's decompressor (FUN_230a_02f1); the decoder was validated
against all 199 members of both archives (each decodes to exactly its declen).

The font is member id 0x9bb2 (present identically in both archives): 1024 bytes =
128 glyphs x 8 rows, 1 byte/row, MSB = leftmost pixel. Glyphs 0x00-0x1F are game
UI symbols; 0x20-0x7F are ASCII; 0x80-0xFF do not exist (the Cyrillic gap).

CLI
---
    cc.py list <archive.CC>
    cc.py extract <archive.CC> <id-hex> <out.bin>      # decoded (raw) bytes
    cc.py replace <archive.CC> <id-hex> <in.bin> <out.CC>
    cc.py font-export <archive.CC> <out.png> [--glyphs 128|256]
    cc.py font-import <in.png> <archive.CC> <out.CC>    # PNG -> font member 0x9bb2
"""
import struct
import sys

FONT_ID = 0x9bb2
CLEAR, END, FIRST, MAXBITS = 0x100, 0x101, 0x102, 12


# ---------------------------------------------------------------- TOC / archive
def read_toc(data):
    n = struct.unpack_from("<H", data, 0)[0]
    entries = []
    off = 2
    for _ in range(n):
        hid = struct.unpack_from("<H", data, off)[0]
        offset = data[off + 2] | (data[off + 3] << 8) | (data[off + 4] << 16)
        size = struct.unpack_from("<H", data, off + 5)[0]
        entries.append((hid, offset, size))
        off += 8
    return entries


def member_bytes(data, entry):
    _, offset, size = entry
    return data[offset:offset + size]


# ------------------------------------------------------------------------- LZW
def lzw_decode(stream, declen):
    """Decode one LZW stream to exactly declen bytes."""
    out = bytearray()
    bitpos = 0
    total = len(stream) * 8

    def read_code(width):
        nonlocal bitpos
        val = 0
        for i in range(width):
            val |= ((stream[bitpos // 8] >> (bitpos % 8)) & 1) << i
            bitpos += 1
        return val

    width = 9
    table = {i: bytes([i]) for i in range(256)}
    nxt = FIRST
    prev = None
    while len(out) < declen and bitpos + width <= total:
        code = read_code(width)
        if code == CLEAR:
            width, table, nxt, prev = 9, {i: bytes([i]) for i in range(256)}, FIRST, None
            continue
        if code == END:
            break
        if code in table:
            entry = table[code]
        elif code == nxt and prev is not None:
            entry = prev + prev[:1]
        else:
            break
        out += entry
        if prev is not None:
            table[nxt] = prev + entry[:1]
            nxt += 1
            if nxt >= (1 << width) and width < MAXBITS:
                width += 1
        prev = entry
    return bytes(out)


def lzw_encode(data):
    """Encode data to an LZW stream the game's decoder accepts.

    Mirrors lzw_decode's width schedule exactly, emits a leading CLEAR, and emits
    CLEAR when the dictionary fills so codes never exceed MAXBITS.
    """
    bits = bytearray()
    acc = 0
    nbits = 0

    def emit(code, width):
        nonlocal acc, nbits
        acc |= code << nbits
        nbits += width
        while nbits >= 8:
            bits.append(acc & 0xFF)
            acc >>= 8
            nbits -= 8

    def new_table():
        return {bytes([i]): i for i in range(256)}

    width = 9
    table = new_table()
    nxt = FIRST
    emit(CLEAR, width)
    if not data:
        emit(END, width)
        if nbits:
            bits.append(acc & 0xFF)
        return bytes(bits)

    w = data[0:1]
    for i in range(1, len(data)):
        k = data[i:i + 1]
        if w + k in table:
            w = w + k
            continue
        emit(table[w], width)
        # Add w+k to the dictionary. The decoder skips the add on the first code
        # after a CLEAR (its prev is None), so its nxt runs one behind the encoder;
        # bumping the width at nxt > 2^width (vs the decoder's >=) re-syncs them.
        table[w + k] = nxt
        nxt += 1
        if nxt > (1 << width) and width < MAXBITS:
            width += 1
        if nxt > (1 << MAXBITS):            # dictionary full -> reset like the decoder
            emit(CLEAR, width)
            width, table, nxt = 9, new_table(), FIRST
        w = k
    emit(table[w], width)
    emit(END, width)
    if nbits:
        bits.append(acc & 0xFF)
    return bytes(bits)


def decode_member(mb):
    declen = struct.unpack_from("<I", mb, 0)[0]
    return lzw_decode(mb[4:], declen)


def encode_member(raw):
    return struct.pack("<I", len(raw)) + lzw_encode(raw)


# ------------------------------------------------------------ archive rebuild
def rebuild(data, replacements):
    """Return a new archive with {id: raw_bytes} members re-encoded; all other
    members are copied verbatim (byte-for-byte) from the original."""
    entries = read_toc(data)
    n = len(entries)
    toc_size = 2 + n * 8
    body = bytearray()
    new_entries = []
    for hid, offset, size in entries:
        if hid in replacements:
            blob = encode_member(replacements[hid])
        else:
            blob = data[offset:offset + size]
        new_entries.append((hid, toc_size + len(body), len(blob)))
        body += blob
    out = bytearray()
    out += struct.pack("<H", n)
    for hid, offset, size in new_entries:
        out += struct.pack("<H", hid)
        out += bytes([offset & 0xFF, (offset >> 8) & 0xFF, (offset >> 16) & 0xFF])
        out += struct.pack("<H", size)
        out += b"\x00"
    out += body
    return bytes(out)


# ------------------------------------------------------------------ font <-> PNG
# Raw 1:1 sprite rip. 16 glyphs per row, each glyph 8x8, no scaling/gaps/grid.
# Transparent background; lit pixels are opaque white (RGBA). 256 glyphs -> 128x128.
COLS = 16
INK = (255, 255, 255, 255)
BG = (0, 0, 0, 0)


def font_to_png(font, path, glyphs):
    from PIL import Image
    rows = (glyphs + COLS - 1) // COLS
    img = Image.new("RGBA", (COLS * 8, rows * 8), BG)
    px = img.load()
    for ch in range(glyphs):
        ox, oy = (ch % COLS) * 8, (ch // COLS) * 8
        for r in range(8):
            byte = font[ch * 8 + r] if ch * 8 + r < len(font) else 0
            for c in range(8):
                if (byte >> (7 - c)) & 1:
                    px[ox + c, oy + r] = INK
    img.save(path)


def png_to_font(path, glyphs):
    from PIL import Image
    img = Image.open(path).convert("RGBA")
    font = bytearray(glyphs * 8)
    for ch in range(glyphs):
        ox, oy = (ch % COLS) * 8, (ch // COLS) * 8
        for r in range(8):
            byte = 0
            for c in range(8):
                r_, g_, b_, a_ = img.getpixel((ox + c, oy + r))
                # a pixel is "lit" if opaque and non-black (works for any ink color)
                if a_ >= 128 and (r_ + g_ + b_) >= 128:
                    byte |= 1 << (7 - c)
            font[ch * 8 + r] = byte
    return bytes(font)


# -------------------------------------------------------------------------- CLI
def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 1
    cmd = argv[1]
    if cmd == "list":
        data = open(argv[2], "rb").read()
        entries = read_toc(data)
        print(f"{argv[2]}: {len(entries)} members")
        for hid, offset, size in sorted(entries, key=lambda e: e[2]):
            declen = struct.unpack_from("<I", data, offset)[0]
            print(f"  id=0x{hid:04x}  off={offset:7d}  comp={size:6d}  declen={declen:6d}")
    elif cmd == "extract":
        data = open(argv[2], "rb").read()
        hid = int(argv[3], 16)
        entry = next(e for e in read_toc(data) if e[0] == hid)
        open(argv[4], "wb").write(decode_member(member_bytes(data, entry)))
        print(f"wrote {argv[4]}")
    elif cmd == "replace":
        data = open(argv[2], "rb").read()
        hid = int(argv[3], 16)
        raw = open(argv[4], "rb").read()
        open(argv[5], "wb").write(rebuild(data, {hid: raw}))
        print(f"wrote {argv[5]}")
    elif cmd == "font-export":
        glyphs = 256 if "--glyphs" in argv and argv[argv.index("--glyphs") + 1] == "256" else 128
        data = open(argv[2], "rb").read()
        entry = next(e for e in read_toc(data) if e[0] == FONT_ID)
        font = decode_member(member_bytes(data, entry))
        font_to_png(font + bytes(max(0, glyphs * 8 - len(font))), argv[3], glyphs)
        print(f"wrote {argv[3]} ({glyphs} glyphs)")
    elif cmd == "font-import":
        img_glyphs = 256  # honor a 256-glyph sheet; declen tracks actual size
        font = png_to_font(argv[2], img_glyphs)
        # trim trailing all-zero glyphs above 128 if the upper half is empty
        if font[1024:] == bytes(len(font) - 1024):
            font = font[:1024]
        data = open(argv[3], "rb").read()
        open(argv[4], "wb").write(rebuild(data, {FONT_ID: font}))
        print(f"wrote {argv[4]} (font {len(font)} bytes)")
    else:
        print(__doc__)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
