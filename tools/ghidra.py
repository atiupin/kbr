#!/usr/bin/env python3
"""Ghidra front-end for this project.

    tools/ghidra.py gui                       open the GUI on the project
    tools/ghidra.py run <Script.java> [args]  run a headless script on KBU2.EXE
    tools/ghidra.py import <file> [opts]      import a binary into the project

Analysis is DONE -- nothing in the build depends on Ghidra. What is left is
diagnostic: when a patched string breaks something and you need to know what code
touched it. Reach for a DOSBox-X breakpoint first; it is usually faster.

The hand-written parts are this script and the analysis scripts in tools/ghidra/.
The project DATABASE lives in tmp/ (KBR.gpr / KBR.rep): it is game-derived and
fully regenerable, so it is scratch, not source. It is kept only as a warm cache
-- `-process` needs the program already imported, so without it every query
would re-run auto-analysis. Delete it freely; rebuild it per CLAUDE.md.

Ghidra allows a single writer, so close the GUI before `run`/`import`; this
script checks and says so rather than letting Ghidra fail obscurely.

To see what scripts exist: `ls tools/ghidra` (each one's first comment line says
what it does).

GUI orientation
---------------
Listing = disassembly, Decompiler = C-ish pseudocode, Window -> Bytes = hex
(cursor-linked to the Listing), Window -> Defined Strings = all 877 strings.
`G` = goto address, `D` = disassemble here. To run our scripts from the GUI,
Script Manager -> Manage Script Directories -> add tools/ghidra; hit Refresh if a
script's version banner looks stale.

EOL comments TRUNCATE in the Listing by default -- the field is narrow and clips
with "..." rather than wrapping. Fix it once in Edit -> Tool Options -> Listing
Fields -> EOL Comments Field: tick Enable Word Wrapping and raise Maximum Lines.
Our scripts also dodge it, writing anything over 30 chars as a pre-comment (pass
a different cutoff as the script's first argument).

Importing KB!.COM takes explicit options (see CLAUDE.md "Ghidra") because a .COM
has no header for anything to auto-detect. The base address 1000:0100 is the
part that matters: DOS loads a .COM at offset 0x100, and the file's own absolute
addresses assume it -- import at 0 and every internal reference is off by 0x100.
Decline auto-analysis on it and run AnnotateKbCom.java instead; on a raw .COM the
analyzers invent functions out of signature data and still miss the INT 16h
handler, which is reachable only through a vector written at runtime.

Gotcha: Ghidra refuses a project path containing a dot-directory ("Path element
starting with '.' is not permitted"), which is why PROJECT_DIR below is the
repo's tmp/ and not a hidden cache dir.
"""

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from paths import TOOLS, TMP, KBU2                           # noqa: E402

PROJECT_DIR = Path(TMP)                    # scratch: the project is regenerable
PROJECT_NAME = "KBR"
SCRIPTS = Path(TOOLS) / "ghidra"           # the .java analysis scripts
PROGRAM = Path(KBU2).name                   # what `run` selects with -process

# Ghidra logs its whole startup at INFO, and prefixes script output with
# "INFO  Foo.java> ... (GhidraScript)". Strip both so results read clean;
# ERROR lines are kept.
NOISE = re.compile(r"^(INFO|WARN|openjdk version|OpenJDK|Picked up|\s+/)")


def die(msg):
    sys.exit(f"error: {msg}")


def ghidra_home():
    """Locate the Ghidra install (the dir holding support/analyzeHeadless).

    Never pin a version: a Homebrew Cellar path with the version baked in breaks
    on the next `brew upgrade ghidra`.
    """
    candidates = []
    if os.environ.get("GHIDRA_HOME"):
        candidates.append(Path(os.environ["GHIDRA_HOME"]))
    launcher = shutil.which("ghidraRun")
    if launcher:                            # Homebrew: <install>/bin/ghidraRun
        real = Path(launcher).resolve()
        candidates += [real.parents[1] / "libexec", real.parents[1], real.parent]
    candidates.append(Path("/opt/homebrew/opt/ghidra/libexec"))
    for c in candidates:
        if (c / "support" / "analyzeHeadless").is_file():
            return c
    die("cannot find Ghidra (no support/analyzeHeadless) -- `brew install ghidra`, "
        "or set GHIDRA_HOME to the install directory")


def check_project():
    """The project lives in scratch, so a fresh clone simply has none yet."""
    if not (PROJECT_DIR / f"{PROJECT_NAME}.gpr").is_file():
        die(f"no Ghidra project at {PROJECT_DIR / (PROJECT_NAME + '.gpr')} -- it is "
            f"gitignored scratch.\n"
            f"       Recreate it (CLAUDE.md, \"Rebuilding the Ghidra project\"):\n"
            f"         tools/ghidra.py import build/KBU2.EXE")


def check_unlocked():
    if any(PROJECT_DIR.glob("*.lock")):
        die("the Ghidra project is locked -- close the GUI "
            "(File > Close Project) and retry")


def headless(args, script=None):
    """Run analyzeHeadless on the project, de-noising its output."""
    env = dict(os.environ)
    env.setdefault("JAVA_HOME", "/opt/homebrew/opt/openjdk@21")
    proc = subprocess.Popen(
        [str(ghidra_home() / "support" / "analyzeHeadless"),
         str(PROJECT_DIR), PROJECT_NAME, *args],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env)
    for line in proc.stdout:
        if script:                          # "INFO  Foo.java> out (GhidraScript)"
            line = re.sub(rf".*{re.escape(script)}> ", "", line)
            line = re.sub(r" \(GhidraScript\).*", "", line)
        if not NOISE.match(line):
            print(line, end="")
    return proc.wait()


def main(argv):
    cmd = argv[1] if len(argv) > 1 else ""
    rest = argv[2:]

    if cmd == "gui":
        check_project()
        launcher = shutil.which("ghidraRun") or str(ghidra_home() / "ghidraRun")
        os.execv(launcher, [launcher, str(PROJECT_DIR / f"{PROJECT_NAME}.gpr")])

    elif cmd == "run":
        if not rest:
            die("usage: tools/ghidra.py run <Script.java> [args...]")
        script, args = rest[0], rest[1:]
        if not (SCRIPTS / script).is_file():
            die(f"no such script: {SCRIPTS / script}")
        check_project()
        check_unlocked()
        return headless(["-process", PROGRAM, "-noanalysis",
                         "-scriptPath", str(SCRIPTS),
                         "-postScript", script, *args], script=script)

    elif cmd == "import":
        if not rest:
            die("usage: tools/ghidra.py import <file> [extra analyzeHeadless opts]")
        PROJECT_DIR.mkdir(parents=True, exist_ok=True)   # may not exist yet
        check_unlocked()
        return headless(["-import", *rest])

    print(__doc__.strip())
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
