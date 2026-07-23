// Prints the comments attached to a program, so annotation work can be checked
// from the terminal without opening the GUI.
// Usage: -postScript ShowComments.java [startAddr] [length]

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressSetView;
import ghidra.program.model.listing.CodeUnit;
import ghidra.program.model.listing.CodeUnitIterator;
import ghidra.program.model.listing.Listing;

public class ShowComments extends GhidraScript {
    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        Listing listing = currentProgram.getListing();
        AddressSetView set;
        if (args.length >= 2) {
            Address s = currentProgram.getAddressFactory().getAddress(args[0]);
            set = new ghidra.program.model.address.AddressSet(s, s.add(Integer.decode(args[1]) - 1));
        } else {
            set = currentProgram.getMemory().getLoadedAndInitializedAddressSet();
        }

        CodeUnitIterator it = listing.getCodeUnits(set, true);
        while (it.hasNext() && !monitor.isCancelled()) {
            CodeUnit cu = it.next();
            String pre = cu.getComment(CodeUnit.PRE_COMMENT);
            String eol = cu.getComment(CodeUnit.EOL_COMMENT);
            if (pre == null && eol == null) continue;
            if (pre != null) println(cu.getAddress() + "  PRE  " + pre);
            if (eol != null) println(cu.getAddress() + "  EOL  " + eol);
        }
    }
}
