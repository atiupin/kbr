// Disassembles and annotates KB!.COM, replacing Ghidra's auto-analysis (which
// makes a mess of a raw .COM: it has no entry-point metadata, its real handler
// is reachable only through an interrupt vector written at runtime, and it
// contains signature DATA that analyzers happily turn into plausible code).
//
// Run on the KB!.COM program: Script Manager -> AnnotateKbCom.java
// Companion listing with the full explanation: tmp/kbcom_annotated.asm (scratch,
// untracked -- last committed copy: git show a44da0b:dumps/kbcom_annotated.asm)

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressSet;
import ghidra.program.model.mem.MemoryBlock;

public class AnnotateKbCom extends GhidraScript {

    private Address base;   // where file byte 0 lives

    private Address at(int off) {
        return base.add(off - 0x100);
    }

    private static final String VERSION = "v3";

    /** Long text goes in a pre-comment (its own lines above the instruction);
     *  short text stays an EOL comment. The EOL field is narrow and clips with
     *  "..." rather than wrapping, so anything explanatory gets mangled there.
     *
     *  The cutoff depends on how wide YOUR EOL field is, which the script
     *  cannot see -- pass a number as the first argument to change it, e.g.
     *  `AnnotateKbCom.java 0` to force every comment into a pre-comment.
     *  The real fix is Edit -> Tool Options -> Listing Fields -> EOL Comments
     *  Field -> Enable Word Wrapping, which makes the cutoff irrelevant.
     *
     *  Both comment kinds are cleared first, so re-running is idempotent. */
    private int eolMax = 30;
    private int nPre = 0, nEol = 0;

    private void note(int off, String name, String cmt) throws Exception {
        Address a = at(off);
        if (name != null) createLabel(a, name, true);
        setEOLComment(a, null);
        setPreComment(a, null);
        if (cmt == null) return;
        if (cmt.length() > eolMax) { setPreComment(a, cmt); nPre++; }
        else { setEOLComment(a, cmt); nEol++; }
    }

    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length > 0) eolMax = Integer.parseInt(args[0].trim());
        println("AnnotateKbCom " + VERSION + " running on " + currentProgram.getName()
                + " (EOL cutoff " + eolMax + " chars)");

        MemoryBlock blk = currentProgram.getMemory().getBlocks()[0];

        // File byte 0 must be E9 A5 00 (jmp 0x1a8). Depending on whether the
        // PSP was mapped, that is the block start or 0x100 past it.
        base = null;
        for (Address cand : new Address[]{blk.getStart(), blk.getStart().add(0x100)}) {
            if ((getByte(cand) & 0xFF) == 0xE9 && (getByte(cand.add(1)) & 0xFF) == 0xA5) {
                base = cand;
                break;
            }
        }
        if (base == null) {
            popup("This does not look like KB!.COM: the entry bytes E9 A5 00 were not found.\n"
                  + "Nothing was changed.");
            return;
        }
        println("file byte 0 identified at " + base);

        // --- 0x103..0x11C is DATA: signature bytes copied from the game, plus
        // scratch storage. The entry jmp deliberately steps over it.
        clearListing(new AddressSet(at(0x103), at(0x11C)));
        for (int off = 0x103; off <= 0x11C; off++) createByte(at(off));

        // --- code the analyzer could never find on its own ---------------------
        disassemble(at(0x100));
        disassemble(at(0x11D));
        disassemble(at(0x12E));
        disassemble(at(0x1A8));
        createFunction(at(0x11D), "int16_handler");
        createFunction(at(0x1A8), "install_and_run");

        note(0x100, "start", "entry: skip the signature data below");
        note(0x103, "sig_kbd_wrapper",
             "DATA: 10 bytes of the GAME's keyboard wrapper (push bp/mov bp,sp/mov ah,[bp+6]/int 16h/jz)");
        note(0x10D, "sig_prot_branch",
             "DATA: 7 bytes around the protection branch; byte 5 is the JC (0x72) we overwrite");
        note(0x114, "flag_patch_done", "one-shot guard: 0 = not attempted yet");
        note(0x115, "old_int16_off",   "saved original INT 16h vector - offset");
        note(0x117, "old_int16_seg",   "saved original INT 16h vector - segment");
        note(0x119, "caller_cs",       "scratch: game's CS, from the interrupt frame");
        note(0x11B, "caller_int16_ea", "scratch: address of the game's INT 16h instruction");

        note(0x11D, null, "installed in the IVT: every keyboard call arrives here first");
        note(0x125, null, "AH == 0 means 'wait for a key' - the call we want");
        note(0x129, "chain_to_bios", "pass through to the real BIOS handler, unchanged");

        note(0x12E, "do_patch", "runs once, on the first blocking key read");
        note(0x12F, null, "after this: [bp+2] = caller IP, [bp+4] = caller CS");
        note(0x13B, null, "an interrupt hands us a live pointer into the game -- this is how the "
                        + "launcher locates code at an address DOS chose at random");
        note(0x146, null, "-2: INT 16h is 2 bytes, so point AT it rather than past it");
        note(0x14B, null, "-6 more: back up over the 3 instructions before the INT");
        note(0x156, null, "CHECK 1: are these 10 bytes the game's keyboard wrapper?");
        note(0x15D, null, "+0x8FE paragraphs (~36 KB) to reach the protection code");
        note(0x173, null, "CHECK 2: is the protection branch where we expect it?");
        note(0x17F, null, "0x72 = JC (jump if carry); 0xEB = JMP (always). Same length, same operand.");
        note(0x181, "the_patch", "*** ONE BYTE: a decision becomes a foregone conclusion ***");
        note(0x182, "mark_attempted",
             "set on ALL paths, including both failures -- the launcher gets exactly one attempt");
        note(0x18E, null, "hand off to the real handler; the game still gets its keypress");

        note(0x193, "str_kb_exe", "\"KB.EXE\", 0 - the program we launch");
        note(0x19A, "exec_param_block", "DOS EXEC parameter block: env seg, cmdline ptr, 2x FCB ptr");

        note(0x1A8, null, "real entry point");
        note(0x1AA, null, "DS = 0 -> the interrupt vector table; vector N lives at N*4");
        note(0x1B1, null, "0x16 * 4 = 0x58, so this is INT 16h (BIOS keyboard)");
        note(0x1D5, null, "shrink our own memory so the child has room to load");
        note(0x1FE, "exec_the_game",
             "DOS load-and-execute: the game runs here and returns when the player quits");
        note(0x203, "restore_and_exit",
             "put the original INT 16h vector back - leave the machine as we found it");

        // Mark the program analyzed so Ghidra stops offering to do it itself.
        currentProgram.getOptions(ghidra.program.model.listing.Program.PROGRAM_INFO)
                      .setBoolean("Analyzed", true);

        println("AnnotateKbCom " + VERSION + " done: " + nPre + " pre-comments, "
                + nEol + " EOL comments. Ghidra will no longer prompt to analyze this program.");
        println("If comments still clip, either re-run with a smaller cutoff "
                + "(e.g. AnnotateKbCom.java 0) or enable Edit > Tool Options > "
                + "Listing Fields > EOL Comments Field > Enable Word Wrapping.");
    }
}
