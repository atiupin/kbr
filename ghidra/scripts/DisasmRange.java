// Forces disassembly of an address range Ghidra's auto-analysis left as raw data,
// then prints the instructions. Usage: -postScript DisasmRange.java 19fe:03ee 0x120

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressSet;
import ghidra.program.model.listing.CodeUnit;
import ghidra.program.model.listing.CodeUnitIterator;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.symbol.Reference;

public class DisasmRange extends GhidraScript {
    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        Address start = currentProgram.getAddressFactory().getAddress(args[0]);
        int len = Integer.decode(args[1]);
        Address end = start.add(len - 1);

        clearListing(new AddressSet(start, end));
        disassemble(start);

        CodeUnitIterator it = currentProgram.getListing()
                .getCodeUnits(new AddressSet(start, end), true);
        while (it.hasNext() && !monitor.isCancelled()) {
            CodeUnit cu = it.next();
            StringBuilder sb = new StringBuilder();
            sb.append(cu.getAddress()).append("  ");
            byte[] b = cu.getBytes();
            StringBuilder hex = new StringBuilder();
            for (int i = 0; i < b.length && i < 6; i++) hex.append(String.format("%02x", b[i]));
            sb.append(String.format("%-14s", hex)).append(cu.toString());
            if (cu instanceof Instruction) {
                for (Reference r : cu.getReferencesFrom()) {
                    if (r.getReferenceType().isCall()) {
                        var f = getFunctionAt(r.getToAddress());
                        if (f != null) sb.append("   -> ").append(f.getName());
                    }
                }
            }
            println(sb.toString());
        }
    }
}
