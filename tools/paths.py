#!/usr/bin/env python3
"""The one place that knows where things live.

Every script in this repo imports its paths from here, so the layout is stated
once and a move is a one-line change. Nothing else belongs in this module --
keep binary-layout constants (DS_BASE, pool placement, ...) next to the code
that reasons about them.

The directories, and the rule each one carries:

    GAME    the user's pristine originals -- READ ONLY, never write here
    BUILD   everything generated, and the DOSBox run dir (mounted as C:)
    RES     hand-written build INPUTS: the patch manifest, the font sheet
    TOOLS   this directory: scripts only -- the build scripts, plus ghidra.py
            and its ghidra/*.java scripts
    TMP     scratch -- the Ghidra project DB, DOSBox captures

Paths are absolute and derived from this file's own location, so the scripts
work from any working directory.
"""

import os

TOOLS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS)
GAME = os.path.join(ROOT, "game")
BUILD = os.path.join(ROOT, "build")
RES = os.path.join(ROOT, "res")
TMP = os.path.join(ROOT, "tmp")

# --- inputs: the user's own copy, never modified -----------------------------
KB_EXE = os.path.join(GAME, "KB.EXE")            # the packed game
KB_COM = os.path.join(GAME, "KB!.COM")           # the launcher
GAME_CC = {256: os.path.join(GAME, "256.CC"),    # graphics archives, one per
           416: os.path.join(GAME, "416.CC")}    # display mode

# --- the build chain: KB.EXE -> KB_NWC -> KBU -> KBR -------------------------
KB_NWC = os.path.join(BUILD, "KB_NWC.EXE")       # minus the outer NWC packer
KBU = os.path.join(BUILD, "KBU.EXE")             # flat, unpacked: the edit base
KBR = os.path.join(BUILD, "KBR.EXE")             # KBU + patches.csv: our build
BUILD_CC = {256: os.path.join(BUILD, "256.CC"),  # run-dir copies, carrying the
            416: os.path.join(BUILD, "416.CC")}  # Cyrillic-extended font

# --- hand-written build inputs (tracked) -------------------------------------
PATCHES_CSV = os.path.join(RES, "patches.csv")
FONT_PNG = os.path.join(RES, "font.png")

# KBU.EXE's SHA-256. Every tool that reads KBU gates on this: the file offsets
# in patches.csv are only meaningful against this exact image, so a mismatch
# means the offsets would land somewhere else entirely. Update it only when the
# base image legitimately changes (i.e. unpack_exepack.py changed).
KBU_SHA256 = "a0ad8832b6a9afa7b28c7d0054a13e286d7952a558eaa12a38f6146e77339d49"
