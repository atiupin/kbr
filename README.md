# King's Bounty — Russian Translation (KBR)

Fan translation of the original 1990 DOS King's Bounty into Russian. This project ships
without any game data. You have to find your own game files and run them through the
[online patcher](https://atiupin.github.io/kbr/) or the CLI.

Made by [Aleksandr Tiupin](https://t.me/luna_game). Font design by
[Dmitry Sivukhin](https://t.me/dmitrysivukhin).

King's Bounty © 1990 New World Computing; the trademark and the rights to the original game
belong to their present holders. This is an unofficial fan project, not affiliated with or
endorsed by them.

## Project Layout

```
game/    *** the user's pristine originals *** — never modified, untracked (not ours to
         distribute).
build/   *** generated *** — the whole build chain's output, and the RUN DIR (DOSBox mounts
         it as C:, so it is also where the user's saves land).
res/     *** hand-written build INPUTS *** — the patch manifest (i.e. the translation
         itself), the glyph sheet, `gate_picker.asm` and `name_tables.asm` (injected code
         and data, each explained in its own header), and `dosbox.conf`, the config
         shipped to players.
core/    *** the format work *** — pure functions over bytes: no I/O, no platform, so the
         command line and the browser share one implementation.
cli/     *** the shell around core *** — paths, files, argv, printing. Every command lives
         here; `cli/main.ts` is the only entry point.
web/     *** the browser shell around core *** — bare HTML, one stylesheet and the one
         script that become the static page a player patches their own copy on.
bundle/  *** generated *** — that page, built: a plain static directory, and what CI serves
         at https://atiupin.github.io/kbr/. `bundle.mjs` in the root is what builds it, a
         tool beside the project and no part of `kbr`.
ghidra/  *** analysis, not the build *** — `ghidra.py`, the diagnostic front-end and the
         one thing here still written in Python, and the `scripts/*.java` it runs.
tmp/     *** scratch, gitignored *** — the Ghidra project DB and its dumps, DOSBox captures.
```

## Tools

Every command in the project. `npm run kbr` with no arguments prints the same list; each
module's own header is the reference for what it does.

```
# the whole build — this is the one to run
npm run build                              game/KB.EXE + res/ -> build/
npm run bundle                             the browser patcher -> bundle/, a static dir
npm run dev                                the same bundle, watched and served on :8000

# translating
npm run kbr find-ref <offset | "text">     the refs pointing at a string; prints a reloc row
npm run kbr addr <0xoffset | seg:off>      file offset <-> Ghidra address
npm run kbr asm-selftest                   prove the assembler still matches Turbo C

# CC archives — one-offs; the build makes the fonts itself
npm run kbr cc-list <archive.CC>
npm run kbr cc-extract <archive.CC> <id-hex> <out.bin>
npm run kbr cc-replace <archive.CC> <id-hex> <in.bin> <out.CC>
npm run kbr font-export <archive.CC> <out.png> [glyphs]
npm run kbr font-import <in.png> <archive.CC> <out.CC>

# the code itself
npm run typecheck                          nothing is emitted, so this is what "build" means
npm run format                             Prettier owns the layout of every source file

# analysis — diagnostic only, never part of a build (see "Ghidra" below)
ghidra/ghidra.py run <Script.java> [args]   headless script on KBU2.EXE, output de-noised
ghidra/ghidra.py import <file> [opts]       import a binary into the project

# the scripts `run` takes, in ghidra/scripts/
FindStringUsers.java "<text>" [dsbase]     what code references a string (Ghidra can't)
DumpAsm.java <seg:off>                     one function's assembly, symbols resolved
DumpDecomp.java [outdir]                   decompiled C for every function + a string map
```

## Build

Needs your own copy of the game in `game/`: `KB.EXE`, `256.CC` and `416.CC` (nothing reads
the `KB!.COM` launcher — the patch disables the protection itself).

`npm install`, then `npm run build`: the four chain steps in their only valid order, no
arguments and nothing to configure. Node runs the TypeScript sources directly — nothing is
ever compiled or emitted. Every path comes from **`cli/paths.ts`**, which is the one place
that knows the layout: put a path there, not in a command.

A build carries its own gate, so nothing checks it afterwards: the patcher refuses any base
but the **pinned `KBU2.EXE`** — which is what proves the two unpack steps — and checks every
manifest row against that image as it applies it.

The build ends at `build/` and stages no distributable. What a player gets is a zip the web
patcher hands back, built from their own copy in their own browser.

To test: `dosbox-x -conf dosbox-x.conf` from the repo root (C: is `build/`), then `KBR`.
That config is the development one — it keeps the debugger usable; what players get is
`res/dosbox.conf`.

## Translating

The text sits in one contiguous block in `KBU2.EXE` at fixed offsets: **~2,650 words of
prose**, ~740 phrase lines, plus menus/items/spells. Extracts are not kept in the repo (they
are game data) — re-extract with `strings` / `find-ref`. **Encoding is CP866**, one byte per
Cyrillic letter, so the byte budget equals the character count.

The **memory slot** limit is handled automatically: write a `string` row when you have the
string's offset, a `reloc` row when you have its refs from `find-ref`, and the build picks
in-place or pool by measuring. Never hand-convert a fitting `reloc` row — it already
inlines, and says so.

What still bites is the **on-screen box width**: a string can fit in memory and still
overflow its UI field.

Two hard rules, both enforced by the tools:

- **Every `reloc` ref must come from `find-ref`, never hand-picked.** A 2-byte value that
  merely _happens_ to equal a string's DS offset looks like a pointer; repointing it
  corrupts whatever it really was, and the failure surfaces far from the edit.
- **⛔ Never `reloc` a ref inside the copy-protection block (file `0xBFE0`–`0xCCA7`).**
  Repointing one immediate there hangs the game minutes later on an unrelated screen. **The
  rule is solid; the mechanism is UNKNOWN** — heap/stack exhaustion, pool placement and
  sum/XOR checks are all ruled out, so re-testing them is wasted effort.

`find-ref` validates a table slot by _chaining_ — the next slot must point exactly one past
this one's NUL — and accepts a run of three, so a table's **first and last entry are
reachable** too. A two-entry table still isn't: "no ref found" means "not repointable by
this tool", not "not a pointer" — check the neighbouring slots before assuming computed
access.

## Ghidra

Nothing in the build calls Ghidra. What it is for is diagnostic: finding what code touches a
string a patch broke, or reading the disassembly around a `bytes` row you are about to
write. Always drive it through `ghidra/ghidra.py`, which presets the paths and explains
every flag in its docstring.

**Ghidra cannot resolve string xrefs here** — it can't statically pin DS in segmented real
mode, so only 3 of 877 strings link to code. Don't ask it "who prints this string"; use
`FindStringUsers.java` or a DOSBox-X breakpoint.

The project DB in `tmp/` is scratch: game-derived, no hand-made annotation, kept only as a
warm cache. Delete it freely, then rebuild (needs `build/KBU2.EXE`; the program must end up
named **`KBU2.EXE`**, which is what `-process` selects):

```
ghidra/ghidra.py import build/KBU2.EXE                       # then let auto-analysis run
ghidra/ghidra.py run DumpDecomp.java tmp/decomp
```

## Constraints

- `build/KBU2.EXE` is the single source of truth — regenerate `KBR.EXE` with
  `npm run build`, never hand-hack headers. Keep `game/` untouched; the run-dir `.CC` copies
  are rebuilt from it by the same command.
- **Nothing game-derived is tracked in git** — no binaries, no disassembly, no extracted
  text. The repo carries only hand-written things.
- **`core/` runs anywhere.** Pure functions over `Uint8Array`: no `node:` imports, no DOM,
  no I/O, no process access — everything platform-shaped lives in `cli/`, so the browser
  front-end is additive and never forces a change inside. A dependency is welcome anywhere,
  core included, as long as it runs in both a browser and Node.
