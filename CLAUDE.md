@README.md

## Files

- **Never `rm -rf build/`.** Everything there is rebuildable except `*.DAT`, the in-game
  saves — nothing regenerates them, and `build/` is the run dir DOSBox writes saves into, so
  wiping it destroys play progress. Delete the generated files by name instead.

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
- **Imports carry a `.ts` extension.** Node runs the sources directly and nothing is ever
  emitted, so `npm run typecheck` is what a "build" means here.
- **Validate yourself before reporting anything done**: `npm run typecheck && npm run format`,
  after every change, including a one-line edit and including changes to Markdown. Whatever
  else a task is gated on comes on top of this, never instead of it.
- **Every stage emits bytes deterministically**, so a change is judged by `sha256`, never by
  "it looks right".
- Ghidra stays in Python: it spawns a JVM and is diagnostic, not part of the build.

## Web Front-End

One implementation serves both the command line and the browser: a player drops in a zip of
their own game copy and downloads a patched one, from a static page with no backend — their
files never leave the machine, and the project still ships no game data. A project of its own;
gate: a patched zip that runs.

- [ ] Bundler and a static build that deploys as a plain directory.
- [ ] Design: drop target, the run's log, the download.
- [ ] Zip through `fflate` — `unzipSync` in, store-only out since the payload is already
      compressed — in the web shell and nowhere else.
- [ ] Bundle `res/` as assets: `patches.csv`, `font.png`, both `.asm` and `dosbox.conf`.
- [ ] Every failure as UI, the KBU2 hash gate reading "not the release this patch targets".
- [ ] Confirm nothing leaves the page — no network call on the patch path.
