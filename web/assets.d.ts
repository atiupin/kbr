declare module "*.csv" {
  const text: string;
  export default text;
}

declare module "*.asm" {
  const text: string;
  export default text;
}

declare module "*.conf" {
  const text: string;
  export default text;
}

declare module "*.png" {
  const bytes: Uint8Array;
  export default bytes;
}
