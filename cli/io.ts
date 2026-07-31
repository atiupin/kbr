/**
 * Every filesystem touch in the build, so core never grows one.
 *
 * read returns a plain Uint8Array rather than Node's Buffer: core is typed
 * against the former, and a Buffer leaking in would let Buffer-only methods
 * compile there once cli/ is in the same pass.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";

import { ROOT } from "./paths.ts";

export const exists = (path: string): boolean => existsSync(path);

export const read = (path: string): Uint8Array => {
  const buf = readFileSync(path);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
};

export const readText = (path: string): string => readFileSync(path, "utf8");

export const write = (path: string, data: Uint8Array): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
};

/** For messages: paths print relative to the repo root. */
export const rel = (path: string): string => relative(ROOT, path);
