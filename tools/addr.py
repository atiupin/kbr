#!/usr/bin/env python3
"""Translate between KBU.EXE file offsets and Ghidra segment:offset addresses.

Three coordinate systems are in play:

  file offset    what xxd / a hex editor shows      (image offset + 0x2000 header)
  image offset   position within the loaded program image
  Ghidra linear  what Ghidra shows                  (image offset + 0x10000 base)

so:  file = Ghidra_linear - 0xE000

Usage:
    python3 tools/addr.py 0xC40A            # file offset  -> Ghidra address
    python3 tools/addr.py 19fe:042a         # Ghidra addr  -> file offset
    python3 tools/addr.py 0xC40A --seg 19fe # express relative to a chosen segment
"""

import argparse

HEADER = 0x2000      # DOS header size (e_cparhdr * 16)
BASE = 0x10000       # Ghidra image base for this program
SKEW = BASE - HEADER # 0xE000


def show(file_off, seg=None):
    image = file_off - HEADER
    linear = file_off + SKEW
    print(f"file offset    0x{file_off:X}   (xxd -s 0x{file_off:X} KBU.EXE)")
    print(f"image offset   0x{image:X}")
    print(f"Ghidra linear  0x{linear:X}")
    if seg is None:
        seg = linear >> 4
        off = linear & 0xF
    else:
        off = linear - seg * 16
        if not 0 <= off <= 0xFFFF:
            print(f"  (offset {off:#x} out of range for segment {seg:04x})")
            return
    print(f"Ghidra address {seg:04x}:{off:04x}   (press G in the Listing, type this)")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("address", help="file offset (0xC40A) or Ghidra address (19fe:042a)")
    ap.add_argument("--seg", help="segment to express the result in, e.g. 19fe")
    args = ap.parse_args()

    if ":" in args.address:
        s, o = args.address.split(":")
        seg, off = int(s, 16), int(o, 16)
        show(seg * 16 + off - SKEW, seg)
    else:
        show(int(args.address, 16),
             int(args.seg, 16) if args.seg else None)


if __name__ == "__main__":
    main()
