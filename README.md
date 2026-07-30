# King's Bounty — Russian Translation (KBR)

Fan translation of the **original 1990 DOS King's Bounty** (New World Computing) into Russian,
by **binary patching** the unpacked EXE.

## Project layout

```
game/    *** the user's pristine originals *** — never modified, untracked (not ours to
         distribute).
build/   *** generated *** — the whole build chain's output, and the RUN DIR (DOSBox mounts
         it as C:, so it is also where the user's saves land).
res/     *** hand-written build INPUTS *** — the patch manifest (i.e. the translation
         itself), the glyph sheet, the one patch that is new code rather than new text.
tools/   *** the build *** — SCRIPTS ONLY, hand-written Python, stdlib only, plus the
         diagnostic Ghidra front-end and its ghidra/*.java scripts.
tmp/     *** scratch, gitignored *** — the Ghidra project DB and its dumps, DOSBox captures.
```

## Tools

Every command in the project. Each script's own docstring is the reference — run it with no
arguments to print it.

```
# build chain, in order — no arguments, nothing to configure
tools/unpack_nwc.py                        KB.EXE -> KBU1.EXE    (outer NWC packer)
tools/unpack_exepack.py                    KBU1 -> KBU2.EXE      (EXEPACK; the edit base)
tools/apply_patches.py                     KBU2 + res/patches.csv -> KBR.EXE
tools/cc.py font-build                     res/font.png -> build/256.CC + 416.CC

# translating
tools/find_ref.py <offset | "substring">   the ref pointing at a string; prints a reloc row
tools/addr.py <0xoffset | seg:off>         file offset <-> Ghidra address
tools/asm16.py selftest                    prove the assembler still matches Turbo C

# CC archives — one-offs; font-build is the only one the build needs
tools/cc.py list <archive.CC>
tools/cc.py extract <archive.CC> <id-hex> <out.bin>
tools/cc.py replace <archive.CC> <id-hex> <in.bin> <out.CC>
tools/cc.py font-export <archive.CC> <out.png> [--glyphs 128|256]
tools/cc.py font-import <in.png> <archive.CC> <out.CC>

# analysis — diagnostic only, never part of a build (see "Ghidra" below)
tools/ghidra.py gui                        open the GUI on the project
tools/ghidra.py run <Script.java> [args]   headless script on KBU2.EXE, output de-noised
tools/ghidra.py import <file> [opts]       import a binary into the project

# the scripts `run` takes, in tools/ghidra/
FindStringUsers.java "<text>" [dsbase]     what code references a string (Ghidra can't)
DumpAsm.java <seg:off>                     one function's assembly, symbols resolved
DumpDecomp.java [outdir]                   decompiled C for every function + a string map
```

## Build

Needs your own copy of the game in `game/`: `KB.EXE`, `256.CC` and `416.CC` (nothing reads the
`KB!.COM` launcher — the patch disables the protection itself).

Run the four build-chain commands above in order. **Pure Python 3 stdlib**. Every step takes no
arguments and reads its paths from **`tools/paths.py`**, which is the one place that knows the
layout — put a path there, not in a script.

To test: `dosbox-x -conf dosbox-x.conf` from the repo root (C: is `build/`), then `KBR`.

## Translating

The text sits in one contiguous block in `KBU2.EXE` at fixed offsets: **~2,650 words of
prose**, ~740 phrase lines, plus menus/items/spells. Extracts are not kept in the repo (they
are game data) — re-extract with `strings` / `find_ref.py`. **Encoding is CP866**, one byte per
Cyrillic letter, so the byte budget equals the character count.

The **memory slot** limit is handled automatically: write a `string` row when you have the
string's offset, a `reloc` row when you have its refs from `find_ref.py`, and the build picks
in-place or pool by measuring. Never hand-convert a fitting `reloc` row — it already inlines,
and says so.

What still bites is the **on-screen box width**: a string can fit in memory and still overflow
its UI field.

Two hard rules, both enforced by the tools:

- **Every `reloc` ref must come from `find_ref.py`, never hand-picked.** A 2-byte value that
  merely _happens_ to equal a string's DS offset looks like a pointer; repointing it corrupts
  whatever it really was, and the failure surfaces far from the edit.
- **⛔ Never `reloc` a ref inside the copy-protection block (file `0xBFE0`–`0xCCA7`).**
  Repointing one immediate there hangs the game minutes later on an unrelated screen. **The
  rule is solid; the mechanism is UNKNOWN** — heap/stack exhaustion, pool placement and sum/XOR
  checks are all ruled out, so re-testing them is wasted effort.

`find_ref.py` validates a table slot by _chaining_ — the next slot must point exactly one past
this one's NUL — and accepts a run of three, so a table's **first and last entry are
reachable** too. A two-entry table still isn't: "no ref found" means "not repointable by this
tool", not "not a pointer" — check the neighbouring slots before assuming computed access.

## Ghidra

Nothing in the build calls Ghidra. What it is for is diagnostic: finding what code touches a
string a patch broke, or reading the disassembly around a `bytes` row you are about to write.
Always drive it through `tools/ghidra.py`, which presets the paths and explains every flag in
its docstring.

**Ghidra cannot resolve string xrefs here** — it can't statically pin DS in segmented real
mode, so only 3 of 877 strings link to code. Don't ask it "who prints this string"; use
`FindStringUsers.java` or a DOSBox-X breakpoint.

The project DB in `tmp/` is scratch: game-derived, no hand-made annotation, kept only as a warm
cache. Delete it freely, then rebuild (needs `build/KBU2.EXE`; the program must end up named
**`KBU2.EXE`**, which is what `-process` selects):

```
tools/ghidra.py import build/KBU2.EXE                       # then let auto-analysis run
tools/ghidra.py run DumpDecomp.java tmp/decomp
```

## Constraints

- `build/KBU2.EXE` is the single source of truth — regenerate `KBR.EXE` with the script, never
  hand-hack headers. Keep `game/` untouched; rebuild the run-dir `.CC` copies from it with
  `cc.py`.
- **Nothing game-derived is tracked in git** — no binaries, no disassembly, no extracted text.
  The repo carries only hand-written things.
- **The build stays pure Python 3 stdlib.** Reach for a dependency only if something genuinely
  cannot be written here; both the NWC packer and the PNG I/O are hand-written for that reason.
