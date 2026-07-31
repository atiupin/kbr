@README.md

## Files

- **Never `rm -rf build/` or `dist/`.** Everything there is rebuildable except `*.DAT`, the
  in-game saves — nothing regenerates them, and both directories are run dirs DOSBox
  writes saves into, so wiping one destroys play progress. Delete the generated files by
  name instead.

## Writing

- **Comment only the non-obvious, and briefly.** A comment earns its place by recording a
  finding, a constraint, or the reason behind a choice — never by restating the code,
  narrating how something ordinary works, or walking through examples. One dense sentence
  beats a paragraph; if it would only tell a competent reader what they can see, drop it.
- **Document a finding in the script that owns it**, next to the code that enforces it —
  not in `README.md`. That file says what the project is, where things live, and which
  rules must not be broken; everything else belongs in a docstring.
- **Comments and docs state what is true now, never how they got that way** — no earlier
  wording, no corrections, no "previously", no progress or status. Git holds the history,
  and a mistake still worth guarding against becomes a present-tense constraint. Nothing in
  the project is "a port of" anything: a module documents what it does, never what it was
  translated from or which file it replaces.
- Prose in the repo is English; only the translated game text itself is Russian.

## Commits

- NEVER commit unless explicitly asked.
- All development is on `master` — only commit there, never create or commit to other
  branches.
- Imperative mood: "Add feature", not "Added feature" or "Adds feature".
- First line under 70 characters, prefixed with a type: `feat:`, `fix:`, `refactor:`,
  `docs:`, `chore:`.
- One-liners, not extended descriptions.
- One logical change per commit — separate refactoring from feature changes, don't mix
  formatting-only changes with functional ones.

## TypeScript Port

The build is TypeScript so one implementation serves both the command line and, in the end, a
browser: a player drops in a zip of their own game copy and downloads a patched one, from a
static page with no backend — their files never leave the machine, and the project still ships
no game data.

**`core/` is universal.** Pure functions over `Uint8Array`: no `node:` imports, no DOM, no I/O,
no process access. Everything platform-shaped — reading files, writing `dist/`, zip, printing —
lives in a shell around it, so the web front-end is additive and never forces a change inside.
Dependencies are welcome anywhere, core included, as long as they run in both a browser and
Node; what stays hand-written is only what npm has no equivalent for — LZW, EXEPACK, the CC
container, CP866, the assembler.

**Never the `function` keyword.** Every named function is a `const` bound to an arrow, at any
level; an anonymous arrow passed inline stays inline. **File names are camelCase**:
`unpackNwc.ts`, `applyPatches.ts`. Prettier owns the layout of every `.ts` and `.md` file —
run `npm run format`, never hand-align.

**Validate yourself before reporting anything done**: `npm run typecheck && npm run format`,
after every change, including a one-line edit and including changes to Markdown. Whatever else
a task is gated on comes on top of this, never instead of it.

Every stage emits bytes deterministically, so a change is judged by **`sha256`**, never by "it
looks right". Ghidra stays in Python: it spawns a JVM and is diagnostic, not part of the build.

Each phase ends on its stated gate, and the next one does not start until it holds.

**0 — Scaffold.** Gate: the harness runs and reports every artifact as missing.

- [x] `package.json` and a strict `tsconfig`; `core/` compiled without the DOM lib, so a stray
      `document` or `node:fs` is a type error rather than a runtime surprise.
- [x] Module per Python script, plus `bytes.ts` for the `struct`/`find` helpers every one of
      them needs, and `sha256.ts` over `@noble/hashes`.
- [x] `cli/` shell: paths, argv, a reporter that prints, thrown error -> exit 1.
- [x] Byte-equality harness: hash `KBU1.EXE`, `KBU2.EXE`, `KBR.EXE`, `256.CC`, `416.CC` from
      the reference build, then assert this one's output matches. This is the gate every
      phase below is measured against.

Node runs the `.ts` sources directly, so imports carry a `.ts` extension and nothing is ever
emitted; `npm run typecheck` is what a "build" means here. The chain writes to `build/` and
gates itself as it runs, on the one hash that outlives any build: the patcher takes no base
but the pinned `KBU2.EXE`.

**1 — Unpack chain.** Gate: `KBU1.EXE` and `KBU2.EXE` byte-identical, `KBU2` matching its
pinned hash.

- [x] `lzw_decode`, checked first against a member the Python `cc.py extract` wrote.
- [x] `unpack_nwc`, keeping the refusal on a nonzero inner `e_crlc` and the known-image warning.
- [x] `unpack_exepack`, including the reloc-table rebuild from the 16 sections.

**2 — Assembler.** Gate: `selftest` reassembles both shipped routines byte-identically.

- [x] Line parse, `Mem`/modrm, `encode` with `enc_mov`, `enc_alu`, `enc_data`.
- [x] Fixed-point sizing loop; the symbol-table compare needs an explicit deep equality.
- [x] The two safety checks that make it trustworthy: labels must not move during emission,
      branch targets must land on an instruction boundary.

**3 — Patcher.** Gate: `KBR.EXE` byte-identical.

- [x] The `\xNN` and `\\` escapes on top of the CP866 encode table the assembler already uses.
- [x] Strict CSV reader — a line at a time, text after a closing quote rejected. Its strictness
      is load-bearing; nothing off the shelf reproduces it.
- [x] Row shape check, `resolve`, and the copy-protection fence on `reloc` refs.
- [x] Verification pass: `expect` against the pristine image, deref every ref, one row per
      string, no overlapping in-place writes.
- [x] Pool allocation and ref repointing, inlining whatever fits its own slot.
- [x] Inject `gate_picker.asm` and `name_tables.asm`; retarget relocations, then
      `check_relocations` and the MZ page counts.

**4 — Archives and font.** Gate: both `.CC` byte-identical.

- [x] TOC read and archive rebuild.
- [x] `lzw_encode`. The width schedule is the subtle part — a wrong port still round-trips
      through our own decoder and fails only in DOSBox, so trust the byte compare, not a
      round-trip test.
- [x] `font-export`/`font-import`. The PNG decode is the only part that stays in the shell —
      `core/font.ts` takes raw RGBA, so a browser reaches it through `createImageBitmap`
      and needs neither `pngjs` nor a pre-baked member.

**5 — Authoring aids.** Gate: same refs reported for a handful of known strings, then the
Python build retired.

- [x] `find_ref`, chain validation and paste-ready row included.
- [x] `addr`.
- [x] Retire `tools/*.py` bar the Ghidra front-end: `OUT` becomes `BUILD`, `verify` goes with
      the reference build it compared against — the pin it checked is enforced inside the
      patcher — and `README.md`'s tool table and build instructions become the npm ones.
      `dist/` goes too: the web patcher is what a player gets, so no command stages a run dir.

**6 — Web front-end.** A project of its own; gate: a patched zip that runs.

- [ ] Bundler and a static build that deploys as a plain directory.
- [ ] Design: drop target, the run's log, the download.
- [ ] Zip through `fflate` — `unzipSync` in, store-only out since the payload is already
      compressed — in the web shell and nowhere else.
- [ ] Bundle `res/` as assets: `patches.csv`, `font.png`, both `.asm` and `dosbox.conf`.
- [ ] Every failure as UI, the KBU2 hash gate reading "not the release this patch targets".
- [ ] Confirm nothing leaves the page — no network call on the patch path.
