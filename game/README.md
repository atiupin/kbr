# Put your King's Bounty files here

This directory holds the **pristine originals** of the 1990 DOS King's Bounty
(New World Computing). They are not distributed with this repository — supply
your own copy. Everything else in the project is built from them.

Expected files (as shipped on the original disks):

| file      | what it is                                                |
| --------- | --------------------------------------------------------- |
| `KB.EXE`  | the packed game (double-packed; the unpack base)           |
| `KB!.COM` | the launcher that patches out the doc check at runtime     |
| `256.CC`  | graphics archive for one display mode                      |
| `416.CC`  | graphics archive for the other display mode                |

Nothing here is ever modified: the tools read these and write their output to
`build/`. With the four files in place the whole build is plain Python — no
DOSBox needed:

```
python3 tools/unpack_nwc.py                                        # KB.EXE  -> KB_NWC.EXE
python3 tools/unpack_exepack.py                                    # KB_NWC  -> KBU.EXE
python3 tools/apply_patches.py                                     # KBU     -> KBR.EXE
python3 tools/cc.py font-import tools/font.png game/256.CC build/256.CC
python3 tools/cc.py font-import tools/font.png game/416.CC build/416.CC
```

Python 3 stdlib only — nothing to install. See CLAUDE.md → "The packing story"
for what each step does.
