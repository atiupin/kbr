#!/usr/bin/env bash
# Ghidra front-end for this project.
#
#   tools/ghidra.sh gui                      launch the Ghidra GUI
#   tools/ghidra.sh run <Script.java> [args] run a headless script on KB_F.EXE
#   tools/ghidra.sh list                     show available scripts
#   tools/ghidra.sh import <file> [opts]     import another binary into the project
#
# The project holds hand-made annotations. Ghidra allows a single writer, so
# close the GUI before using `run`; this script checks and tells you if not.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GHIDRA_DIR="/opt/homebrew/Cellar/ghidra/12.1.2/libexec"
HEADLESS="$GHIDRA_DIR/support/analyzeHeadless"
PROJECT_DIR="$ROOT/ghidra"
PROJECT_NAME="KBR"
SCRIPTS="$ROOT/tools/ghidra_scripts"
PROGRAM="KB_F.EXE"

export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21}"

die() { echo "error: $*" >&2; exit 1; }

check_unlocked() {
    if compgen -G "$PROJECT_DIR/*.lock" > /dev/null; then
        die "the Ghidra project is locked -- close the GUI (File > Close Project) and retry"
    fi
}

# Ghidra logs its whole startup at INFO. Script output has already had its
# "INFO  Foo.java> " prefix stripped by the caller's sed, so dropping INFO/WARN
# here removes the noise without touching results. ERROR lines are kept.
filter() {
    grep -vE "^(INFO|WARN|openjdk version|OpenJDK|Picked up)" \
    | grep -vE "^[[:space:]]+/" || true
}

cmd="${1:-gui}"; shift || true

case "$cmd" in
  gui)
      exec /opt/homebrew/bin/ghidraRun "$PROJECT_DIR/$PROJECT_NAME.gpr"
      ;;
  list)
      echo "scripts in $SCRIPTS:"
      for f in "$SCRIPTS"/*.java; do
          [ -e "$f" ] || continue
          printf '  %-22s %s\n' "$(basename "$f")" \
              "$(sed -n '1s|^// *||p' "$f")"
      done
      ;;
  run)
      [ $# -ge 1 ] || die "usage: tools/ghidra.sh run <Script.java> [args...]"
      script="$1"; shift
      [ -f "$SCRIPTS/$script" ] || die "no such script: $SCRIPTS/$script"
      check_unlocked
      "$HEADLESS" "$PROJECT_DIR" "$PROJECT_NAME" \
          -process "$PROGRAM" -noanalysis \
          -scriptPath "$SCRIPTS" -postScript "$script" "$@" 2>&1 \
        | sed "s|.*${script}> ||; s| (GhidraScript).*||" | filter
      ;;
  import)
      [ $# -ge 1 ] || die "usage: tools/ghidra.sh import <file> [extra analyzeHeadless opts]"
      target="$1"; shift
      check_unlocked
      "$HEADLESS" "$PROJECT_DIR" "$PROJECT_NAME" -import "$target" "$@" 2>&1 | filter
      ;;
  *)
      sed -n '2,12s|^# \?||p' "${BASH_SOURCE[0]}"
      exit 1
      ;;
esac
