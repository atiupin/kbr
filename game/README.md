# Put your King's Bounty files here

This directory holds the **pristine originals** of the 1990 DOS King's Bounty
(New World Computing). They are not distributed with this repository — supply
your own copy. Everything else in the project is built from them, and nothing
here is ever modified: the tools read these and write to `build/`.

Expected files (as shipped on the original disks):

| file      | what it is                                                |
| --------- | --------------------------------------------------------- |
| `KB.EXE`  | the packed game (double-packed; the unpack base)           |
| `KB!.COM` | the launcher that patches out the doc check at runtime     |
| `256.CC`  | graphics archive for one display mode                      |
| `416.CC`  | graphics archive for the other display mode                |

With the four files in place the whole build is four argument-free Python 3
commands, stdlib only — nothing to install and no DOSBox needed. See
CLAUDE.md → "Build".
