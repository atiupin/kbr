// Recovers the string->code references Ghidra's analyzer cannot resolve in 16-bit
// segmented real mode. Locates a literal in memory, then scans every instruction for
// an immediate scalar equal to that string's segment offset (how Turbo C loads a
// DS-relative near pointer: mov ax,OFFS / push OFFS).
//
// Usage: -postScript FindStringUsers.java "Please turn to page"

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressSetView;
import ghidra.program.model.address.SegmentedAddress;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.scalar.Scalar;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

public class FindStringUsers extends GhidraScript {

    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length == 0) {
            println("need a search string");
            return;
        }
        String needle = args[0];
        byte[] pat = needle.getBytes(StandardCharsets.US_ASCII);

        Memory mem = currentProgram.getMemory();
        AddressSetView init = mem.getLoadedAndInitializedAddressSet();

        List<Address> hits = new ArrayList<>();
        Address at = init.getMinAddress();
        while (at != null && !monitor.isCancelled()) {
            Address found = mem.findBytes(at, init.getMaxAddress(), pat, null, true, monitor);
            if (found == null) break;
            hits.add(found);
            at = found.add(1);
        }

        if (hits.isEmpty()) {
            println("string not found: " + needle);
            return;
        }

        // Optional second arg: the segment the code addresses this data through
        // (DGROUP/DS). Turbo C emits near pointers relative to it, so the scalar in
        // the instruction stream is linear - base*16, not the raw segment offset.
        Long dsBase = (args.length > 1) ? Long.parseLong(args[1].replace("0x", ""), 16) : null;

        Set<Long> offsets = new LinkedHashSet<>();
        for (Address h : hits) {
            long off = (h instanceof SegmentedAddress)
                    ? ((SegmentedAddress) h).getSegmentOffset()
                    : h.getOffset();
            long linear = (h instanceof SegmentedAddress)
                    ? (((SegmentedAddress) h).getSegment() * 16L + off)
                    : off;
            println("FOUND \"" + needle + "\" at " + h + "  (segment offset 0x"
                    + Long.toHexString(off) + ", linear 0x" + Long.toHexString(linear) + ")");
            offsets.add(off);
            if (dsBase != null) {
                long rel = linear - dsBase * 16L;
                println("       DS(0x" + Long.toHexString(dsBase) + ")-relative offset 0x"
                        + Long.toHexString(rel));
                offsets.add(rel);
            }
        }

        println("--- instructions loading those offsets as an immediate ---");
        int n = 0;
        InstructionIterator it = currentProgram.getListing().getInstructions(true);
        while (it.hasNext() && !monitor.isCancelled()) {
            Instruction ins = it.next();
            for (int i = 0; i < ins.getNumOperands(); i++) {
                for (Object o : ins.getOpObjects(i)) {
                    if (!(o instanceof Scalar)) continue;
                    long v = ((Scalar) o).getUnsignedValue();
                    if (!offsets.contains(v)) continue;
                    Function f = getFunctionContaining(ins.getAddress());
                    println("  " + ins.getAddress() + "  " + ins
                            + "   in " + (f == null ? "(none)" : f.getName()));
                    n++;
                }
            }
        }
        println("--- " + n + " candidate reference(s) ---");
    }
}
