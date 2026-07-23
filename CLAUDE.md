# King's Bounty — Russian Translation (KBR)

Fan translation of the **original 1990 DOS King's Bounty** (New World Computing) into Russian.

## Goal & constraints

- Translate all in-game text to Russian and render it with a Cyrillic font.
- The original 1990 game has **no official digital sale** (rights fragmented: NWC → 3DO,
  bankrupt 2003; the "King's Bounty" name later went to 1C for the unrelated 2008 remake).

## Project layout

```
game/         *** pristine originals *** — never modified; the patcher references them:
  KB.EXE        original packed game (double-packed; see below). Launched by KB!.COM.
  KB!.COM       launcher: hooks INT 16h, EXECs KB.EXE, patches out the doc-check. NOT a
                hardware check — see "Copy protection".
  256.CC 416.CC graphics archives (NWC "CC" format). 256=one display mode, 416=the other.
256.CC 416.CC working copies in the run dir — the game reads its .CC from the current
              directory, so KBR.EXE needs them here (identical to game/ for now).
KBU.EXE       *** the translation base *** — fully unpacked, flat, editable. Keep pristine.
KBR.EXE       *** our working copy *** — KBU + the manifest patches (currently just
              the one-byte protection flip). The runnable/testable build, regenerated
              from KBU by tools/apply_patches.py + tools/patches.csv (see below).
QWE.DAT       an in-game save sitting in the run dir (that is where KB reads/writes them).
dosbox-x.conf DOSBox-X config: mounts this dir as C:, PATH includes C:\TOOLS.

ghidra/       *** the Ghidra project (KBR.gpr) *** — holds hand-made annotations, so it is
              NOT disposable and deliberately not under build/. `tools/ghidra.sh gui`.
tools/        everything hand-written: DOS utils (CUP386.COM + its README.CUP manual,
              LOADFIX.COM), the Python tools (addr.py, unpack_exepack.py,
              apply_patches.py), the patch manifest patches.csv, ghidra.sh, and
              ghidra_scripts/ (Ghidra analysis scripts). Full inventory under "Tooling".
dumps/        extracted data + annotated listings (see "Dumps").
build/        generated, safe to delete: KB_NWC.EXE (CUP386 intermediate), decomp/ (Ghidra
              output).
saves/        user's in-game save files (KB saves are fixed 20,421 B).
```

Convention: **`tools/` is written by hand, `build/` is generated, `dumps/` is extracted from
the binaries, `ghidra/` is the analysis workspace.** Nothing precious lives in `build/`.

## The packing story (this was the hard part — now solved)

`KB.EXE` is **double-packed**:

```
KB.EXE = [ NWC custom disk-streaming packer  →  [ Microsoft EXEPACK  →  [ real game ] ] ]
```

Neither layer's _compressor_ was reversed — only the decompressors, which is all we need.

1. **Outer NWC layer** — a ~1.2 KB custom stub that streams the packed payload from disk
   (`int 21h/AH=3Fh`) and expands it. No standard packer signature. Removed with **CUP386**
   (generic code-tracing unpacker) inside DOSBox: `CUP386 KB.EXE KB_NWC.EXE /1 /x`.
   → produces `build/KB_NWC.EXE` (still EXEPACK-packed inside).
2. **Inner EXEPACK layer** — Microsoft EXEPACK, signature `"RB"` at the stub's `CS:0x10`,
   error string "Packed file is corrupt". EXEPACK self-relocates at runtime (its own reloc
   table lives in the packed tail), which is why `KB_NWC.EXE` runs at any load address despite
   showing **0 relocations** in its DOS header. Removed statically by `tools/unpack_exepack.py`.
   → produces `KBU.EXE`: flat image + a proper **1960-entry DOS relocation table**.

Rebuild KBU from scratch: `python3 tools/unpack_exepack.py build/KB_NWC.EXE KBU.EXE`
(re-derive KB_NWC by running the CUP386 command above in DOSBox-X.)

### Validation

`KBU.EXE` matched the live running game **98.9%** after relocation (the ~1% delta is runtime
variables). Confirmed by the user: `KBU` and `LOADFIX KBU` both run and reach deep game logic —
the unpack is sound.

### Dead end (do not repeat)

`KB_R.EXE` (deleted): I added a DOS reloc table (from a two-dump diff) onto the _still-EXEPACK-
packed_ image. DOS patched compressed bytes, then the EXEPACK stub double-fixed them → garbage
far calls → "cursor moves then hangs". The fix was to strip EXEPACK, not to add relocations to it.

## File-format reference

**CC archive** (`256.CC`, `416.CC`): `uint16` file count N; then N × 8-byte TOC entries:
`uint16` filename-hash ID, `uint24` offset (LE), `uint16` size (LE), 1 pad byte. First member
begins right after the TOC (`2 + N*8`). Holds graphics, not text. 256.CC=66 files, 416.CC=133.

**EXEPACK record format** (decompress reading _backward_ from stub CS:0000):
`[cmd][len_hi][len_lo]`; `cmd & 0xFE`: `0xB0`=fill (one fill byte follows below), `0xB2`=copy
literal run; `cmd & 1`=last record. Trailing `0xFF` padding skipped first. Reloc table = 16
sections after the "Packed file is corrupt" string, each `uint16 count` then that many
`uint16` offsets; section index i contributes segment base `i*0x1000`.

## Text findings

- Location in `KBU`: one contiguous block; strings sit at fixed offsets, editable in place.
- Volume: **~2,650 words of prose**, ~740 unique phrase lines, plus menus/items/spells.
  Extracted list: `dumps/game_text.txt` (readable) and `dumps/all_strings.txt` (raw).
- **Encoding: target CP866** (DOS Russian). Each Cyrillic letter = **1 byte**, same as ASCII —
  so byte budget = character count. Russian isn't heavier per letter, only per phrase.
- **Two length limits** when translating: (1) memory slot — don't overrun into the next string
  (same-or-shorter is safe; longer needs repointing to spare space); (2) on-screen box width —
  a string can fit in memory yet overflow its UI field. The tight menus/labels bite hardest;
  long prose looks pre-wrapped to ~28–30 char lines.

## Tooling

- **DOSBox-X** (`brew install --cask dosbox-x`; Gatekeeper quarantine stripped). Debug build
  with `MEMDUMPBIN [seg]:[off] [len]` → writes `MEMDUMP.BIN`. Launch:
  `/Applications/dosbox-x.app/Contents/MacOS/dosbox-x -conf dosbox-x.conf`.
  Memory snapshot: run to a screen, `Debug → Start DOSBox-X Debugger` (pauses CPU), then in the
  Terminal `MEMDUMPBIN 0000:0000 100000`.
- **CUP386 v3.4** (archive.org item `CUP386`; full manual in `tools/README.CUP`). Generic
  unpacker. **Gotcha: fails "unable to load source file" if given paths — use bare filenames in
  the same dir.** Tracers `/1` fast, `/3` V86, `/7` full emulator (slow, most robust); `/x` =
  force EXE output.
- **ndisasm** (`brew install nasm`) for 16-bit disassembly; objdump/lldb also present.
- **Ghidra 12.1.2** (`brew install ghidra`) — the analysis tool for this project. Drive it via
  **`tools/ghidra.sh`**, which presets the project, program and script paths:

  ```
  tools/ghidra.sh gui                          # open the GUI on ghidra/KBR.gpr
  tools/ghidra.sh list                         # what scripts exist
  tools/ghidra.sh run DumpAsm.java 1507:0009   # headless, output already de-noised
  tools/ghidra.sh import <file> [opts]         # add another binary to the project
  ```

  **Ghidra allows a single writer.** `run`/`import` refuse to start while the GUI holds the
  lock and say so; close it with File → Close Project (no need to quit). Homebrew's `ghidraRun`
  sets JAVA_HOME itself; only raw `analyzeHeadless` needs
  `export JAVA_HOME=/opt/homebrew/opt/openjdk@21`.
- **Ghidra GUI orientation**: Listing = disassembly, Decompiler = C-ish pseudocode, Window →
  Bytes = hex (cursor-linked to the Listing), Window → Defined Strings = all 877 strings.
  `G` = goto address, `D` = disassemble here. To use our scripts from the GUI, Script Manager →
  *Manage Script Directories* → add `tools/ghidra_scripts`.
- **`tools/ghidra_scripts/` inventory** (each is `-postScript`-style; run via `tools/ghidra.sh
  run <script> [args]` headless, or from the GUI Script Manager). `tools/ghidra.sh list` prints
  the same set:
  - **`DumpAsm.java <seg:off>`** — dumps one function's analyzed assembly listing with resolved
    symbols and call targets. De-noised output.
  - **`DumpDecomp.java <outdir>`** — dumps decompiled C for *every* function plus a string→
    referencing-function map. Source of `build/decomp/decompiled_all.c`.
  - **`DisasmRange.java <seg:off> <len>`** — force-disassembles a range auto-analysis left as raw
    data and prints it (e.g. the unanalyzed protection block `19fe:02ee`–`0cc7`).
  - **`FindStringUsers.java "<literal>"`** — recovers the string→code xrefs Ghidra can't resolve
    in 16-bit segmented real mode: finds the literal, then scans for any instruction loading its
    DS-relative offset as an immediate (`mov ax,OFFS` / `push OFFS`). The workaround for "only 3
    of 877 strings resolve to code".
  - **`AnnotateKbCom.java [cutoff]`** — disassembles and annotates `KB!.COM`, replacing the
    mess auto-analysis makes of a raw `.COM` (see "Importing `KB!.COM`" below). Companion:
    `dumps/kbcom_annotated.asm`.
  - **`ShowComments.java [startAddr] [length]`** — prints a program's comments to the terminal so
    annotation work can be checked without the GUI.
- **Comments truncate in the Listing by default.** The EOL comment field is narrow and clips
  with "..." rather than wrapping. Fix once, in Edit → Tool Options → **Listing Fields → EOL
  Comments Field**: tick **Enable Word Wrapping** and raise **Maximum Lines** (1 → 3+). Same
  options exist under *Pre-comments Field*. Our scripts also avoid the problem at the source:
  anything over 30 chars is written as a **pre-comment** (own lines above the instruction)
  instead of EOL — pass a different cutoff as the first script argument, e.g.
  `AnnotateKbCom.java 0` forces every comment into a pre-comment.
  Scripts print a version banner (`AnnotateKbCom v3 running on ...`); if the console does not
  show the expected version, Ghidra ran a stale copy — hit **Refresh** in the Script Manager.
- **`tools/addr.py`** converts between file offsets (`xxd`) and Ghidra `seg:off` addresses,
  both directions — `python3 tools/addr.py 0xC40A --seg 19fe` / `... 19fe:042a`.
- **Importing `KB!.COM` into Ghidra** (a `.COM` has no header, so nothing auto-detects):
  Format **Raw Binary**, Language **`x86:LE:16:Real Mode`** (cspec `default`), and
  Options → **Base Address `1000:0100`**. The `0100` is the part that matters — DOS loads a
  `.COM` at offset `0x100` (the PSP occupies the first 256 bytes) and the file's own absolute
  addresses assume it; import at `0` and every internal reference is off by `0x100`. Decline
  auto-analysis, then disassemble by hand (`G` then `D`) at `1000:01a8` (real entry — byte 0 is
  `jmp 0x1a8`) and at `1000:011d` (the INT 16h handler, reached only via the vector, so nothing
  points at it statically). `0x103` and `0x10D` are signature *data*, not code.
  Headless equivalent: `tools/ghidra.sh import 'game/KB!.COM' -loader BinaryLoader
  -loader-baseAddr 1000:0100 -processor 'x86:LE:16:Real Mode' -cspec default`
  **Then run `AnnotateKbCom.java` on it** (Script Manager, or headless) — it does the manual
  work auto-analysis cannot: marks `0x103`–`0x11C` as data, disassembles the entry, the INT 16h
  handler and the patcher, names everything, and sets the `Analyzed` flag so Ghidra stops
  offering. Declining auto-analysis is deliberate, not an oversight: on a raw `.COM` the
  analyzers invent functions from signature data and still miss the handler, which is reachable
  only through a vector written at runtime.
  **Gotcha: Ghidra rejects project paths containing a dot-directory** (`~/.claude/...` fails
  with "Path element starting with '.' is not permitted") — hence `ghidra/` in the repo.
  Re-dump everything: `tools/ghidra.sh run DumpDecomp.java build/decomp`.

## Source language & decompilation

The game is **C, compiled with Borland Turbo C++ 1990** (runtime copyright string is in the
binary; entry point is the stock Turbo C `c0` startup: `int 21h/AH=30h`, env-block scan, heap
setup, then `main`). Not hand-written assembly — which is why decompilation reads well.

Ghidra decompiles **443/443 functions** (`build/decomp/decompiled_all.c`, ~17.7k lines). Useful
as a **map, not as source**. Measured limits on this binary:

- **15 unrecovered jump tables** ("Could not recover jumptable / Treating indirect jump as call")
  — real dispatch logic the decompiler cannot follow.
- **56 raw absolute-address pointer casts** (`(uint *)0x341`) — DS-relative globals it can't name.
- 34 functions carry at least one warning; 3 hit bad-instruction/truncated control flow.
- **String xrefs are effectively absent: only 3 of 877 strings resolve to code** ("Tandy",
  "h[.256", "(null)"). In segmented real mode Ghidra can't statically pin DS, so the ~740 game
  text strings show **no** code references. Don't expect Ghidra to answer "who prints this
  string" — use runtime breakpoints in the DOSBox-X debugger instead.

**Decision: do NOT attempt a decompile → edit → recompile source port.** Output isn't
recompilable (segment-typed conventions like `__cdecl16far`, absolute-address globals, missing
jump tables), and it would trade a 100%-faithful binary for a rewrite that must be re-verified
across all game logic. Translation stays **binary patching** of `KBU.EXE`. Where genuinely new
code is needed (Cyrillic renderer, string repointing), write it fresh and inject into a code
cave — Open Watcom still targets 16-bit real mode.

## Copy protection (traced — one-byte patch, `tools/patches.csv`)

Two separate pieces: the **prompt routine** (shows page/line/word, collects the answer) and the
**verification branch**, ~1.1 KB later inside an unanalyzed block. The prompt routine contains no
comparison; the actual gate is the verification branch at `0xC40A`, disabled by `KB!.COM` below.

Address map used throughout: *Ghidra linear = image offset + `0x10000`; file offset = image
offset + `0x2000`*.

### `KB!.COM` is a loader-patcher, not a hardware check

It hooks **INT 16h** (saves the old vector, installs its handler at `CS:0x11D`), shrinks its
memory block (`AH=4Ah`), `EXEC`s `KB.EXE` (`AX=4B00`), then restores the vector and exits.

Its handler fires **once** (guard flag at `CS:0x114`) on the first `INT 16h` with `AH=0`, and:

1. reads the caller's return `CS:IP` off the interrupt frame,
2. verifies a **10-byte signature** at the caller's prologue — `55 8B EC 8A 66 06 CD 16 74 0F`
   (`push bp; mov bp,sp; mov ah,[bp+6]; int 16h; jz`), i.e. the game's keyboard wrapper,
3. verifies a **7-byte signature** — `4E 8B DF AC 99 72 05` — at `ES = callerCS + 0x8FE`,
   `DI = (IP-2) + 0x635`, i.e. **`linear(INT 16h) + 0x9615`**,
4. writes **`0xEB` over the `0x72`**, turning `JC +5` into `JMP +5`.

**So the protection is real and live; `KB!.COM` disables it at runtime.** Run `KB.EXE` (or
`KBU.EXE`) directly and the branch stays `JC`, the check runs, and the game exits.

### Where it lands in `KBU.EXE`

Both signatures occur **exactly once**: wrapper at file **`0x2DEF`**, check at **`0xC405`**,
branch byte at **`0xC40A`**. The launcher's own arithmetic (`0x2DEF + 6 + 0x9615`) independently
predicts `0xC40A` — the two derivations agree, which is what makes this certain.

Confirmed real code, not coincidental bytes: the adjacent `CALLF` at `19fe:042c` has its segment
word at file `0xC40F` **present in the DOS relocation table**. The 256-byte table below contains
no relocation entries, consistent with it being data. Note the whole region `19fe:02ee`–`0cc7`
is left **unanalyzed by Ghidra** — the verification code lives there, so use
`tools/ghidra_scripts/DisasmRange.java` rather than expecting auto-analysis to find it.

Apply statically as one entry in the patch manifest (`type: bytes`, `offset: 0xC40A`,
`expect: 72`, `write: EB`). The generic engine `tools/apply_patches.py` builds `KBR.EXE`
from pristine `KBU.EXE`, gated on `KBU`'s SHA-256 (baked into the script) so every offset is
provably correct — no per-patch signature arithmetic needed. Before writing, it verifies each
site matches its `expect` (all-or-nothing):

```
python3 tools/apply_patches.py                 # KBU.EXE -> KBR.EXE (1 byte differs)
```

The launcher-arithmetic cross-check that the old dedicated script did at runtime is now
subsumed by the whole-file hash gate: if `KBU.EXE` hashes correctly, `0xC40A` is the right
byte by construction. Re-apply after any `unpack_exepack.py` regeneration (and update the
baked-in `TARGET_SHA256` if the base image legitimately changes).

`KBU.EXE` stays pristine; `KBR.EXE` is our working copy / runnable-testable build. **Re-apply
after any regeneration via `unpack_exepack.py`.**

### The prompt routine

**`FUN_19fe_000b`** @ `19fe:000b`, **file offset `0xBFEB`**. Called from `main` at `1507:004c`.
It seeds from the DOS clock, indexes a 128-entry table at `19fe:02EE` (file `0xC2CE`) to pick a
page/line/word triple (all 128 decoded in `dumps/protection_table.txt`), prints the prompt, and
reads ≤16 chars — then **returns without comparing anything**. The typed answer is ignored; the
verdict is reached later at the `0xC40A` branch. The routine is deliberately obfuscated (junk
arithmetic, an always-taken `STC; JC`, split pushes) to derail linear disassemblers.

The ten prompt strings are ordinary UI text at DS `0xAD6`, `0xAEB`, `0xAF3`, `0xAF9`, `0xB0C`,
`0xB29`, `0xB48`, `0xB67`, `0xB85`, `0xBA0` — they still need translating. The gate itself is the
`0xC40A` branch, handled by the patch above.

## Dumps

- RAM snapshots (deleted after they served the unpack validation; regenerate via `MEMDUMPBIN`
  if needed): *base1* = normal launch, image at linear `0x8920`, load segment `0x892`; *loadfix*
  = under LOADFIX, image at `0x12C77`, load segment `0x10C0` (= base1 + `0x82E` paragraphs). The
  two-address pair is what let us diff out relocations.
- `dumps/game_text.txt`, `dumps/all_strings.txt`, `dumps/text_like.txt` — extracted text.
- `dumps/protection_table.txt` — all 128 decoded page/line/word triples.
- `dumps/kbcom_annotated.asm` — `KB!.COM` disassembled with a comment on every line. Read this
  before touching the launcher; it is the clearest explanation of how the protection is bypassed.
- `build/decomp/decompiled_all.c` — all 443 functions as pseudocode (regenerate with
  `tools/ghidra.sh run DumpDecomp.java build/decomp`).

## Status & next steps

- [x] Locate & extract all text; confirm it's translatable.
- [x] Defeat both packing layers → `KBU.EXE`, a flat editable base that runs (incl. LOADFIX).
- [x] **Copy protection** — fully traced. `KB!.COM` is a loader-patcher that flips one byte at
      runtime; the static build does the same via the patch manifest (file `0xC40A`, `JC`→`JMP`)
      producing `KBR.EXE`. Confirmed in DOSBox-X: `KBR` runs standalone and reaches the title
      screen (verified via a title-screen string edit).
- [x] **Patch engine** — `tools/apply_patches.py` + `tools/patches.csv`: manifest-driven,
      hash-gated builder of `KBR.EXE` (`bytes`/`string` patch types). Replaces the old
      `patch_protection.py`; the protection flip is its first entry. String patches (with CP866
      encoding + slot-length checks) land once translation starts.
- [ ] **Cyrillic font** — game font is Latin-only. Find the font bitmap (in `KBU` or a `.CC`
      member), add glyphs, remap to CP866. Nothing renders in Russian until this exists.
- [ ] **Translation** — edit strings in `KBU` respecting the two length limits; build repointing
      only for the strings that can't be shortened.
- [ ] **Patcher** — ownership-gated installer producing the translated build.

## Conventions

- `KBU.EXE` is the single source of truth for edits. Regenerate via the script; don't hand-hack
  headers. The game needs its `.CC` files in the same directory to run.
- Keep the pristine originals in `game/` (`KB.EXE`, `KB!.COM`, `256.CC`, `416.CC`) untouched —
  the patcher references them. The `.CC` copies in the run dir exist only so the game can load
  them at runtime; edit neither set until the translation phase.

## Commit Guidelines

- All development is ongoing in the `master` branch — only commit there, never create or commit to other branches
- Use imperative mood: "Add feature" not "Added feature" or "Adds feature"
- Keep first line under 70 characters
- Start with a type prefix: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`
- All messages should be one-liners, not extended descriptions
- One logical change per commit — separate refactoring from feature changes, don't mix formatting-only changes with functional changes
