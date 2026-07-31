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

The build moves from Python to TypeScript so one implementation serves both the command line
and, in the end, a browser: a player drops in a zip of their own game copy and downloads a
patched one, from a static page with no backend — their files never leave the machine, and the
project still ships no game data.

**`core/` is universal.** Pure functions over `Uint8Array`: no `node:` imports, no DOM, no I/O,
no process access, nothing async. Everything platform-shaped — reading files, writing `dist/`,
zip, printing — lives in a shell around it, so the web front-end is additive and never forces a
change inside. Third-party libraries are allowed, but the domain code (LZW, EXEPACK, the CC
container, CP866, the assembler) has no equivalent on npm and stays hand-written; core needs no
runtime deps at all.

**Never the `function` keyword.** Every named function is a `const` bound to an arrow, at any
level; an anonymous arrow passed inline stays inline. **File names are camelCase**, so a module
per Python script means `unpack_nwc.py` -> `unpackNwc.ts`. Prettier owns the layout of every
`.ts` and `.md` file — run `npm run format`, never hand-align.

**Validate yourself before reporting anything done**: `npm run typecheck && npm run format`,
after every change, including a one-line edit and including changes to Markdown. Whatever else
a task is gated on comes on top of this, never instead of it.

Every stage emits bytes deterministically, so each step is gated on **`sha256` equality with
the Python output**, never on "it looks right". Ghidra stays in Python: it spawns a JVM and is
diagnostic, not part of the build.

Each phase ends on its stated gate, and the next one does not start until it holds.

**0 — Scaffold.** Gate: the harness runs and reports every artifact as missing.

- [x] `package.json` and a strict `tsconfig`; `core/` compiled without the DOM lib, so a stray
      `document` or `node:fs` is a type error rather than a runtime surprise.
- [x] Module per Python script, plus `bytes.ts` for the `struct`/`find` helpers every one of
      them needs, and a synchronous `sha256.ts` — `crypto.subtle` is async and core is not.
- [x] `cli/` shell: paths, argv, a reporter that prints, thrown error -> exit 1.
- [x] Byte-equality harness: hash `KBU1.EXE`, `KBU2.EXE`, `KBR.EXE`, `256.CC`, `416.CC` from
      the Python build, then assert the TypeScript output matches. This is the gate every
      phase below is measured against.

Node runs the `.ts` sources directly, so imports carry a `.ts` extension and nothing is ever
emitted; `npm run typecheck` is what a "build" means here. The TypeScript chain writes to
`build/ts/` while both builds coexist, and `npm run verify` compares that directory against
`build/` file by file.

**1 — Unpack chain.** Gate: `KBU1.EXE` and `KBU2.EXE` byte-identical, `KBU2` matching its
pinned hash.

- [ ] `lzw_decode`, checked first against a member the Python `cc.py extract` wrote.
- [ ] `unpack_nwc`, keeping the refusal on a nonzero inner `e_crlc` and the known-image warning.
- [ ] `unpack_exepack`, including the reloc-table rebuild from the 16 sections.

**2 — Assembler.** Gate: `selftest` reassembles both shipped routines byte-identically.

- [ ] Line parse, `Mem`/modrm, `encode` with `enc_mov`, `enc_alu`, `enc_data`.
- [ ] Fixed-point sizing loop; the symbol-table compare needs an explicit deep equality.
- [ ] The two safety checks that make it trustworthy: labels must not move during emission,
      branch targets must land on an instruction boundary.

**3 — Patcher.** Gate: `KBR.EXE` byte-identical.

- [ ] CP866 encode table, with the `\xNN` and `\\` escapes.
- [ ] Strict CSV reader — a line at a time, text after a closing quote rejected. Its strictness
      is load-bearing; nothing off the shelf reproduces it.
- [ ] Row shape check, `resolve`, and the copy-protection fence on `reloc` refs.
- [ ] Verification pass: `expect` against the pristine image, deref every ref, one row per
      string, no overlapping in-place writes.
- [ ] Pool allocation and ref repointing, inlining whatever fits its own slot.
- [ ] Inject `gate_picker.asm` and `name_tables.asm`; retarget relocations, then
      `check_relocations` and the MZ page counts.

**4 — Archives and font.** Gate: both `.CC` byte-identical, and the Python build retired.

- [ ] TOC read and archive rebuild.
- [ ] `lzw_encode`. The width schedule is the subtle part — a wrong port still round-trips
      through our own decoder and fails only in DOSBox, so trust the byte compare, not a
      round-trip test.
- [ ] CLI-only: the PNG reader/writer and `font-export`/`font-import`, plus a bake step that
      emits the 2048-byte font member for the web bundle to carry.
- [ ] Update `README.md`'s tool table and the build instructions.

**5 — Authoring aids.** Gate: same refs reported for a handful of known strings.

- [ ] `find_ref`, chain validation and paste-ready row included.
- [ ] `addr`.

**6 — Web front-end.** A project of its own; gate: a patched zip that runs.

- [ ] Bundler and a static build that deploys as a plain directory.
- [ ] Design: drop target, the run's log, the download.
- [ ] Zip, in the web shell and nowhere else: read via
      `DecompressionStream("deflate-raw")`, write store-only since the payload is already
      compressed.
- [ ] Bundle `patches.csv`, the baked font member and `dosbox.conf` as assets.
- [ ] Every failure as UI, the KBU2 hash gate reading "not the release this patch targets".
- [ ] Confirm nothing leaves the page — no network call on the patch path.
