#!/usr/bin/env python3
"""Ghidra front-end for this project.

    ghidra/ghidra.py gui                       open the GUI on the project
    ghidra/ghidra.py run <Script.java> [args]  run a headless script on KBU2.EXE
    ghidra/ghidra.py import <file> [opts]      import a binary into the project

Nothing in the build depends on Ghidra -- this is diagnostic, for when a patched
string breaks something and you need to know what code touched it, or when you are
writing a new `bytes` row and need the surrounding disassembly. Reach for a
DOSBox-X breakpoint first; it is usually faster.

This is the one Python left in the project -- it spawns a JVM and answers questions
about the image, so it has nothing to share with the build, which is TypeScript.
The hand-written parts are this script and the analysis scripts in scripts/.
The project DATABASE lives in tmp/ (KBR.gpr / KBR.rep): it is game-derived and
fully regenerable, so it is scratch, not source. It is kept only as a warm cache
-- `-process` needs the program already imported, so without it every query
would re-run auto-analysis. Delete it freely; rebuild it per README.md.

Ghidra allows a single writer, so close the GUI before `run`/`import`; this
script checks and says so rather than letting Ghidra fail obscurely.

To see what scripts exist: `ls ghidra/scripts` (each one's first comment line says
what it does).

GUI orientation
---------------
Listing = disassembly, Decompiler = C-ish pseudocode, Window -> Bytes = hex
(cursor-linked to the Listing), Window -> Defined Strings = all 877 strings.
`G` = goto address, `D` = disassemble here. To run our scripts from the GUI,
Script Manager -> Manage Script Directories -> add ghidra/scripts; hit Refresh if a
script's version banner looks stale.

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

HERE = Path(__file__).resolve().parent
PROJECT_DIR = HERE.parent / "tmp"          # scratch: the project is regenerable
PROJECT_NAME = "KBR"
SCRIPTS = HERE / "scripts"                 # the .java analysis scripts
PROGRAM = "KBU2.EXE"                       # what `run` selects with -process

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
            f"       Recreate it (see README.md, \"Ghidra\"):\n"
            f"         ghidra/ghidra.py import build/KBU2.EXE")


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
            die("usage: ghidra/ghidra.py run <Script.java> [args...]")
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
            die("usage: ghidra/ghidra.py import <file> [extra analyzeHeadless opts]")
        PROJECT_DIR.mkdir(parents=True, exist_ok=True)   # may not exist yet
        check_unlocked()
        return headless(["-import", *rest])

    print(__doc__.strip())
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
