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
  and a mistake still worth guarding against becomes a present-tense constraint.
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
