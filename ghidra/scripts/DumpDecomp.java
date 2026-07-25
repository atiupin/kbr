// Dumps decompiled C for every function in the program, plus a map of
// defined strings -> the functions that reference them.
// Usage: ghidra/ghidra.py run DumpDecomp.java build/decomp

import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Data;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import ghidra.program.model.symbol.Reference;

import java.io.File;
import java.io.PrintWriter;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

public class DumpDecomp extends GhidraScript {

    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        String outDir = (args.length > 0) ? args[0] : ".";
        new File(outDir).mkdirs();

        DecompInterface di = new DecompInterface();
        di.openProgram(currentProgram);

        PrintWriter code = new PrintWriter(new File(outDir, "decompiled_all.c"));
        int total = 0, ok = 0;

        FunctionIterator fit = currentProgram.getFunctionManager().getFunctions(true);
        while (fit.hasNext() && !monitor.isCancelled()) {
            Function f = fit.next();
            total++;
            DecompileResults res = di.decompileFunction(f, 60, monitor);
            code.println("/* ---- " + f.getName() + " @ " + f.getEntryPoint() + " ---- */");
            if (res != null && res.decompileCompleted()) {
                code.println(res.getDecompiledFunction().getC());
                ok++;
            } else {
                code.println("/* DECOMPILATION FAILED: "
                        + (res == null ? "null" : res.getErrorMessage()) + " */");
            }
            code.println();
        }
        code.close();

        // strings -> referencing functions
        PrintWriter xref = new PrintWriter(new File(outDir, "string_xrefs.txt"));
        int strCount = 0, strRefd = 0;
        Iterator<Data> dit = currentProgram.getListing().getDefinedData(true);
        while (dit.hasNext() && !monitor.isCancelled()) {
            Data d = dit.next();
            Object v = d.getValue();
            if (!(v instanceof String)) continue;
            String s = (String) v;
            if (s.trim().length() < 3) continue;
            strCount++;

            List<String> callers = new ArrayList<>();
            for (Reference r : getReferencesTo(d.getAddress())) {
                Address from = r.getFromAddress();
                Function cf = getFunctionContaining(from);
                callers.add(cf == null ? ("(no func) " + from) : (cf.getName() + " @ " + from));
            }
            if (callers.isEmpty()) continue;
            strRefd++;
            xref.println(d.getAddress() + "  \"" + s.replace("\n", "\\n") + "\"");
            for (String c : callers) xref.println("      <- " + c);
            xref.println();
        }
        xref.close();

        println("FUNCTIONS total=" + total + " decompiled=" + ok);
        println("STRINGS defined=" + strCount + " with_code_refs=" + strRefd);
        di.dispose();
    }
}
