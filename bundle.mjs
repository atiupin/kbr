import * as esbuild from "esbuild";

const options = {
  entryPoints: ["web/main.ts", "web/index.html"],
  bundle: true,
  outdir: "bundle",
  loader: {
    ".csv": "text",
    ".asm": "text",
    ".conf": "text",
    ".png": "binary",
    ".html": "copy",
  },
  logLevel: "info",
};

if (process.argv.includes("--serve")) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  await ctx.serve({ servedir: options.outdir });
} else {
  await esbuild.build(options);
}
