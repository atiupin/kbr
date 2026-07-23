#!/usr/bin/env python3
"""Apply the copy-protection bypass to KBU.EXE statically.

This reproduces, at rest, exactly what KB!.COM does in memory at runtime.

KB!.COM is not a hardware check -- it is a loader-patcher. It hooks INT 16h,
EXECs KB.EXE as a child, and on the first INT 16h with AH=0 issued from the
game's keyboard-wrapper function it:

  1. verifies a 10-byte signature at the caller (the wrapper's prologue),
  2. verifies a 7-byte signature at caller_linear + 0x9615,
  3. overwrites one byte there: 0x72 (JC) -> 0xEB (JMP short),

turning the protection branch unconditional. Without KB!.COM that byte stays
0x72, the check runs, and the game exits.

Both signatures occur exactly once in KBU.EXE, and the launcher's own address
arithmetic independently predicts the patch offset -- see CLAUDE.md.

Usage:
    python3 tools/patch_protection.py KBU.EXE -o KBR.EXE       # apply
    python3 tools/patch_protection.py KBR.EXE -o KBU2.EXE --revert
    python3 tools/patch_protection.py KBU.EXE --check          # report only
"""

import argparse
import sys

SIG_WRAPPER = bytes.fromhex("558bec8a6606cd16740f")  # keyboard wrapper prologue
# The check signature straddles the very byte we patch, so it cannot be matched
# literally -- a patched file would no longer contain it, breaking --check and
# --revert. Match the invariant part and treat the branch byte as a wildcard.
SIG_CHECK_PREFIX = bytes.fromhex("4e8bdfac99")       # ...then <branch> 05
JC, JMP = 0x72, 0xEB
PATCH_IN_SIG = 5                                     # branch byte's index
DELTA = 0x9615                                       # 0x8FE paragraphs + 0x635


def find_unique(data, sig, what):
    hits, i = [], data.find(sig)
    while i != -1:
        hits.append(i)
        i = data.find(sig, i + 1)
    if len(hits) != 1:
        sys.exit(f"error: expected exactly one {what} signature, found {len(hits)}")
    return hits[0]


def find_check(data):
    """Locate the check signature in either the original or patched state."""
    hits, i = [], data.find(SIG_CHECK_PREFIX)
    while i != -1:
        if data[i + PATCH_IN_SIG] in (JC, JMP) and data[i + PATCH_IN_SIG + 1] == 0x05:
            hits.append(i)
        i = data.find(SIG_CHECK_PREFIX, i + 1)
    if len(hits) != 1:
        sys.exit(f"error: expected exactly one protection-check signature, found {len(hits)}")
    return hits[0]


def locate(data):
    wrapper = find_unique(data, SIG_WRAPPER, "keyboard-wrapper")
    check = find_check(data)
    patch = check + PATCH_IN_SIG
    predicted = wrapper + 6 + DELTA          # +6 lands on the 'CD 16' bytes
    if predicted != patch:
        sys.exit(f"error: launcher arithmetic predicts 0x{predicted:X} but the "
                 f"check signature puts the branch at 0x{patch:X}")
    return wrapper, check, patch


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input")
    ap.add_argument("-o", "--output")
    ap.add_argument("--revert", action="store_true",
                    help="restore JC (undo the bypass)")
    ap.add_argument("--check", action="store_true",
                    help="report current state and exit without writing")
    args = ap.parse_args()

    data = bytearray(open(args.input, "rb").read())
    wrapper, check, patch = locate(data)
    cur = data[patch]

    print(f"keyboard wrapper signature : 0x{wrapper:X}")
    print(f"protection check signature : 0x{check:X}")
    print(f"branch byte                : 0x{patch:X} = 0x{cur:02X} "
          f"({'JC  - protection ACTIVE' if cur == JC else 'JMP - already bypassed' if cur == JMP else 'UNEXPECTED'})")

    if args.check:
        return
    if cur not in (JC, JMP):
        sys.exit(f"error: refusing to write, unexpected byte 0x{cur:02X}")

    want = JC if args.revert else JMP
    if cur == want:
        print("nothing to do (already in the requested state)")
        if not args.output:
            return
    data[patch] = want

    out = args.output or args.input
    open(out, "wb").write(bytes(data))
    print(f"wrote {out}: 0x{patch:X} 0x{cur:02X} -> 0x{want:02X}")


if __name__ == "__main__":
    main()
