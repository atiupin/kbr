// res/ files are bundled as strings (esbuild's `text` loader), so the page
// carries the manifest and the injected asm without fetching anything.
declare module "*.csv" {
  const text: string;
  export default text;
}
declare module "*.asm" {
  const text: string;
  export default text;
}
