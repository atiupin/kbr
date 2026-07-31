@README.md

## Files

- **Never `rm -rf build/`.** Everything there is rebuildable except `*.DAT`, the in-game
  saves — nothing regenerates them, and `build/` is the run dir DOSBox writes saves into, so
  wiping it destroys play progress. Delete the generated files by name instead.

## Writing

- **A comment is earned, never owed.** It records a finding, a constraint or the reason for
  a choice — never what the code already shows, and never because of where it sits. One
  dense sentence beats a paragraph.
- **The finding belongs in the script that enforces it**, not `README.md`, which says only
  what the project is, where things live and which rules must not be broken.
- **Only what is true now** — no earlier wording, no corrections, no "previously", no
  progress. Git holds the history; a mistake still worth guarding against becomes a
  present-tense constraint, and nothing here is "a port of" anything.
- **Form follows scope.** A `/** … */` binds to the one declaration under it, so a note over
  a group is a `//` block under a `// --- section ---` rule; in a body `//` goes above the
  statement, never trailing — the exception is a gloss on a value, where a column of short
  notes reads as part of the data.
- **92 columns for everything**: `printWidth`, comments, Markdown, the width a section rule
  pads to. Hand-aligned tables and samples keep their own layout.
- Prose is English; only the translated game text is Russian.

## Commits

- All development is on `master` — only commit there, never create or commit to other
  branches.
- First line under 70 characters, prefixed with a type: `feat:`, `fix:`, `refactor:`,
  `docs:`, `chore:`.
- One-liners, not extended descriptions.

## TypeScript

- **`core/` is universal.** Pure functions over `Uint8Array`: no `node:` imports, no DOM, no
  I/O, no process access — it compiles without the DOM lib, so a stray `document` or
  `node:fs` is a type error rather than a runtime surprise. Everything platform-shaped —
  reading files, writing `build/`, zip, printing — lives in `cli/`, so the web front-end is
  additive and never forces a change inside.
- **Never the `function` keyword.** Every named function is a `const` bound to an arrow, at
  any level; an anonymous arrow passed inline stays inline.
- **A function's name starts with a verb** — `patchFont`, `decodeLzw`, never the noun first.
  The exception is one named for what it returns rather than what it does: an accessor
  (`u16`, `hexOffset`), an X-to-Y converter (`fontToSheet`), a predicate that reads as its
  condition (`fits`, `chains`), and a command, which is named after itself (`build`).
- **Imports carry a `.ts` extension.** Node runs the sources directly and nothing is ever
  emitted, so `npm run typecheck` is what a "build" means here.
- **Validate yourself before reporting anything done**:
  `npm run typecheck && npm run format`, after every change, including a one-line edit and
  including changes to Markdown. Whatever else a task is gated on comes on top of this,
  never instead of it.
- **Every stage emits bytes deterministically**, so a change is judged by `sha256`, never by
  "it looks right".
- Ghidra stays in Python: it spawns a JVM and is diagnostic, not part of the build.

## Web Front-End

One implementation serves both the command line and the browser: a player drops in a zip of
their own game copy and downloads a patched one, from a static page with no backend — their
files never leave the machine, and the project still ships no game data. A project of its
own; gate: a patched zip that runs. Bare HTML and one bundled script — no framework, no CSS
framework, no template engine.

- [x] Bundler and a static build that deploys as a plain directory.
- [ ] Design: drop target, the run's log, the download.
- [x] Zip through `fflate` — `unzipSync` in, store-only out since the payload is already
      compressed — in the web shell and nowhere else.
- [x] Bundle `res/` as assets: `patches.csv`, `font.png`, both `.asm` and `dosbox.conf`.
- [x] Every failure as UI, the KBU2 hash gate reading "not the release this patch targets".
- [x] Confirm nothing leaves the page — no network call on the patch path.
