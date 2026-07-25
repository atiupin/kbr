// Dumps Ghidra's analyzed assembly listing for one function, with resolved
// symbols and call targets. Usage: -postScript DumpAsm.java 19fe:000b

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.CodeUnit;
import ghidra.program.model.listing.CodeUnitIterator;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.symbol.Reference;

public class DumpAsm extends GhidraScript {
    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        Address entry = currentProgram.getAddressFactory().getAddress(args[0]);
        Function f = getFunctionContaining(entry);
        if (f == null) {
            println("no function at " + args[0]);
            return;
        }
        println("FUNCTION " + f.getName() + "  body=" + f.getBody());
        CodeUnitIterator it = currentProgram.getListing().getCodeUnits(f.getBody(), true);
        while (it.hasNext() && !monitor.isCancelled()) {
            CodeUnit cu = it.next();
            StringBuilder sb = new StringBuilder();
            sb.append(cu.getAddress()).append("  ").append(cu.toString());
            if (cu instanceof Instruction) {
                for (Reference r : cu.getReferencesFrom()) {
                    if (r.getReferenceType().isCall() || r.getReferenceType().isJump()) {
                        Function t = getFunctionAt(r.getToAddress());
                        if (t != null) sb.append("   -> ").append(t.getName());
                    }
                }
            }
            println(sb.toString());
        }
    }
}
