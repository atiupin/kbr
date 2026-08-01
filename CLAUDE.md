@README.md

## Files

- **Never `rm -rf build/`.** Everything there is rebuildable except `*.DAT`, the in-game
  saves — nothing regenerates them, and `build/` is the run dir DOSBox writes saves into, so
  wiping it destroys play progress. Delete the generated files by name instead.
- **`bundle/` is committed, so `npm run bundle` is part of any change to `web/`, `core/` or
  `res/`** — the commit carries the rebuilt bytes, or CI rejects the push and the published
  page stays stale.

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

- **`core/` is universal.** Pure functions over `Uint8Array`: no `node:`, no DOM, no I/O, no
  process access — it compiles without the DOM lib, so a stray `document` or `node:fs` is a
  type error rather than a runtime surprise. Everything platform-shaped — files, `build/`,
  zip, printing — lives in `cli/`, so the web front-end is additive and never forces a
  change inside.
- **Never the `function` keyword.** A named function is a `const` bound to an arrow, at any
  level; an anonymous arrow passed inline stays inline.
- **A function's name starts with a verb** — `patchFont`, `decodeLzw`, never the noun first.
  The exception is one named for what it returns: an accessor (`u16`, `hexOffset`), an
  X-to-Y converter (`fontToSheet`), a predicate that reads as its condition (`fits`,
  `chains`), and a command, named after itself (`build`).
- **Imports carry a `.ts` extension.** Nothing is ever emitted, so `npm run typecheck` is
  what a "build" means here.
- **Validate before reporting anything done**: `npm run typecheck && npm run format`, after
  every change, a one-line edit and Markdown included — whatever else a task is gated on
  comes on top of this, never instead of it.
- **Every stage emits bytes deterministically**, so judge a change by `sha256`, never by "it
  looks right".
- Ghidra stays in Python: it spawns a JVM and is diagnostic, not part of the build.
