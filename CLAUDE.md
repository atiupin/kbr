# King's Bounty — Russian Translation (KBR)

Fan translation of the **original 1990 DOS King's Bounty** (New World Computing) into Russian,
by **binary patching** the unpacked EXE. Unpacking, the copy protection and the Cyrillic font are
all solved; what remains is translating text and shipping an installer.

## Project layout

```
game/    *** the user's pristine originals *** — never modified, untracked (not ours to
         distribute). KB.EXE · KB!.COM · 256.CC / 416.CC (one archive per display mode).
build/   *** generated *** — also the RUN DIR (DOSBox mounts it as C:). Everything here is
         rebuildable EXCEPT *.DAT, which are the user's in-game saves: DOSBox writes them
         where it finds them, they are gitignored, and nothing regenerates them. So
         `rm -rf build` DESTROYS PLAY PROGRESS — delete the generated files by name instead.
           KBU1.EXE    intermediate (KB.EXE minus the outer packer)
           KBU2.EXE    *** the translation base *** — flat, editable, keep pristine; its
                       SHA-256 gates every tool that reads it
           KBR.EXE     *** our build *** — KBU2 + res/patches.csv; the runnable/testable copy
           256.CC 416.CC  working copies carrying the Cyrillic font, so they differ from game/
           *.DAT       *** the user's saves — NOT regenerable, never delete ***
           decomp/     Ghidra output
res/     *** hand-written build INPUTS *** — patches.csv (the patch manifest, i.e. the
         translation itself) and font.png (the Cyrillic-extended glyph sheet).
tools/   *** the build *** — SCRIPTS ONLY, hand-written Python, stdlib only: paths.py (the
         shared layout), unpack_nwc.py, unpack_exepack.py, apply_patches.py, cc.py,
         find_ref.py, addr.py
           ghidra.py   the analysis front-end (diagnostic only — the build never calls it)
           ghidra/     its *.java analysis scripts. No game data.
tmp/     *** scratch, gitignored *** — the Ghidra project DB (regenerable), DOSBox captures.
```

**`tools/` is code, `res/` is the data it consumes, `build/` is generated (and is the run
dir), `game/` is untouchable, `tmp/` is scratch.**

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
AnnotateKbCom.java [eol-max]               disassemble and annotate KB!.COM
```

## Build

Run the four build-chain commands above in order. **Pure Python 3 stdlib** — no dependencies,
no DOS utilities, no DOSBox. Every step takes no arguments and reads its paths from
**`tools/paths.py`**, which is the one place that knows the layout — put a path there, not in
a script.

To test: `dosbox-x -conf dosbox-x.conf` (C: is `build/`), then `KBR`.

## Where the details live

Each solved topic is documented **in the script that owns it**, next to the code that enforces
it — read those, and put new findings there rather than here.

| topic                                          | read                                     |
| ---------------------------------------------- | ---------------------------------------- |
| where every file lives, the KBU2 hash gate     | `paths.py`                               |
| the two packer layers, EXEPACK, LZW            | `unpack_nwc.py` / `unpack_exepack.py`    |
| CC archive format, the font, PNG I/O           | `cc.py`                                  |
| patch manifest, `reloc` pool, protection guard | `apply_patches.py` docstring + constants |
| ref discovery and why it is conservative       | `find_ref.py`                            |
| file offset ↔ Ghidra address                   | `addr.py`                                |
| what a Ghidra script does                      | its first comment line                   |

## Translating

The text sits in one contiguous block in `KBU2.EXE` at fixed offsets: **~2,650 words of prose**,
~740 phrase lines, plus menus/items/spells. Extracts are not kept in the repo (they are game
data) — re-extract with `strings` / `find_ref.py`. **Encoding is CP866**, one byte per Cyrillic
letter, so the byte budget equals the character count.

The **memory slot** limit is solved and automatic: write a `string` row when you have the string's
offset, a `reloc` row when you have its refs from `find_ref.py`, and the build picks in-place or
pool by measuring. Never hand-convert a fitting `reloc` row — it already inlines, and says so.

What still bites is the **on-screen box width**: a string can fit in memory and still overflow its
UI field. Tight menus and labels are the worst; prose looks pre-wrapped to ~28–30 char lines.

Two hard rules, both enforced by the tools, both learned the expensive way:

- **Every `reloc` ref must come from `find_ref.py`, never hand-picked.** A 2-byte value that
  merely _happens_ to equal a string's DS offset looks like a pointer; repointing it corrupts
  whatever it really was, and the failure surfaces far from the edit.
- **⛔ Never `reloc` a ref inside the copy-protection block (file `0xBFE0`–`0xCCA7`).** Repointing
  one immediate there hangs the game minutes later on an unrelated screen. **The rule is solid;
  the mechanism is UNKNOWN** — heap/stack exhaustion, pool placement and sum/XOR checks are all
  falsified. Distrust any explanation. It costs nothing: that block's strings are protection UI
  text that fits its own slot.

`find_ref.py` has one blind spot: it accepts a table slot only when both neighbours validate, so a
pointer table's **first and last entry** report "no ref found" — as does any slot beside a string the
tool cannot validate. That means "not repointable by this tool", not "not a pointer" — check the
neighbouring slots before assuming computed access.

## Copy protection (solved)

`KB!.COM` is not a hardware check — it is a loader-patcher that flips one branch byte in the game
at runtime, so the protection is real but the shipping launcher disables it. We do the same
statically with one manifest row, `bytes,0xC40A,72,EB` (`JC`→`JMP`), which makes `KBR.EXE` run
standalone; the hash gate on `KBU2.EXE` proves the offset. The prompt routine that asks for a
manual word never compares the answer, and its strings are now translated into a note saying the
check is disabled. Full trace and the annotated `KB!.COM` listing:
`git show a44da0b:dumps/kbcom_annotated.asm`.

## Ghidra

Analysis is done — nothing in the build calls Ghidra. What is left is diagnostic: finding what
code touches a string a patch broke. Always drive it through `tools/ghidra.py`, which presets
the paths and explains every flag in its docstring.

**Ghidra cannot resolve string xrefs here** — it can't statically pin DS in segmented real mode,
so only 3 of 877 strings link to code. Don't ask it "who prints this string"; use
`FindStringUsers.java` or a DOSBox-X breakpoint.

The project DB in `tmp/` is scratch: game-derived, no hand-made annotation, kept only as a warm
cache. Delete it freely, then rebuild (needs `build/KBU2.EXE`; the program must end up named
**`KBU2.EXE`**, which is what `-process` selects):

```
tools/ghidra.py import build/KBU2.EXE                       # then let auto-analysis run
tools/ghidra.py import 'game/KB!.COM' -loader BinaryLoader \
    -loader-baseAddr 1000:0100 -processor 'x86:LE:16:Real Mode' -cspec default
tools/ghidra.py run AnnotateKbCom.java                     # decline auto-analysis on the .COM
tools/ghidra.py run DumpDecomp.java build/decomp
```

## Status

- [~] **Translation** — underway in `res/patches.csv`: title screen + credits, protection prompt,
  new-game/difficulty menus, load-game picker, character classes, army screen (25 unit names,
  army-size prefixes, stat labels, morale), dwelling screen, character screen, king's castle,
  menu bar and its options and controls menus, town screen, the 14 spell names, the villain
  names and all 17 contract screens. Place names (towns, castles, continents) are still English
  on purpose — one later pass, which also picks up the "Saharia" left in three contract lines.
- [ ] **Patcher** — ownership-gated installer producing the translated build.

## Conventions

- `build/KBU2.EXE` is the single source of truth — regenerate `KBR.EXE` with the script, never
  hand-hack headers. Keep `game/` untouched; rebuild the run-dir `.CC` copies from it with `cc.py`.
- **Nothing game-derived is tracked in git** — no binaries, no disassembly, no extracted text. The
  repo carries only hand-written things.
- **The build stays pure Python 3 stdlib.** Reach for a dependency only if something genuinely
  cannot be written here — reversing the format has twice been the cheaper answer (the NWC packer
  instead of CUP386, PNG I/O instead of Pillow).
- **Document a finding in the script that owns it**, not in this file. This file says what the
  project is, where things live, and which rules must not be broken.

## Commit Guidelines

- NEVER commit unless the user explicitly asks for it
- All development is ongoing in the `master` branch — only commit there, never create or commit to other branches
- Use imperative mood: "Add feature" not "Added feature" or "Adds feature"
- Keep first line under 70 characters
- Start with a type prefix: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`
- All messages should be one-liners, not extended descriptions
- One logical change per commit — separate refactoring from feature changes, don't mix formatting-only changes with functional changes
