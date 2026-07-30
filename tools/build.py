#!/usr/bin/env python3
"""The whole build in one command, then a distributable dist/.

Runs the four build-chain steps in their only valid order --

    unpack_nwc      game/KB.EXE -> build/KBU1.EXE
    unpack_exepack  build/KBU1.EXE -> build/KBU2.EXE
    apply_patches   build/KBU2.EXE + res/patches.csv -> build/KBR.EXE
    cc font-build   res/font.png + game/*.CC -> build/256.CC, build/416.CC

-- and then stages what a player needs into dist/: the patched EXE, both
graphics archives (they carry the Cyrillic font), and res/dosbox.conf.

dist/ is a run dir, not just an output: the shipped config mounts the directory
it sits in as C:, so a player's *.DAT saves land next to those four files. They
are therefore replaced by name and the directory is never cleared -- same rule
that protects build/.

Takes no arguments; every path comes from paths.py. Any step that fails exits
with its own diagnostic, so a broken build never reaches dist/.
"""
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import apply_patches                                         # noqa: E402
import cc                                                    # noqa: E402
import paths                                                 # noqa: E402
import unpack_exepack                                        # noqa: E402
import unpack_nwc                                            # noqa: E402

DIST_FILES = (paths.KBR, paths.BUILD_CC[256], paths.BUILD_CC[416], paths.DOSBOX_CONF)


def step(n, what):
    print(f"\n=== {n}/5  {what} " + "=" * max(0, 60 - len(what)))


def stage():
    os.makedirs(paths.DIST, exist_ok=True)
    for src in DIST_FILES:
        dst = os.path.join(paths.DIST, os.path.basename(src))
        shutil.copyfile(src, dst)
        print(f"  {os.path.relpath(dst, paths.ROOT)}  ({os.path.getsize(dst)} bytes)")


def main():
    step(1, "unpack the NWC packer")
    unpack_nwc.unpack()
    step(2, "unpack EXEPACK")
    unpack_exepack.unpack()
    step(3, "apply patches")
    apply_patches.main()
    step(4, "build the Cyrillic-extended fonts")
    cc.font_build()
    step(5, "stage dist/")
    stage()
    print("\ndist/ is ready: run DOSBox there with -conf dosbox.conf")


if __name__ == "__main__":
    main()
