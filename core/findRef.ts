/**
 * What points at a string. An authoring aid, not a build step -- but a hard
 * dependency of one: a `reloc` row's refs must come from here and nowhere else,
 * because a 2-byte value that merely happens to equal a string's DS offset looks
 * exactly like a pointer.
 */

export interface Ref {
  /** File offset of the 2-byte DS offset. */
  offset: number;
  /** How the candidate was validated: a lone immediate, or a chained table slot. */
  kind: "immediate" | "table";
}

export const findRefs = (_image: Uint8Array, _strOff: number): Ref[] => {
  throw new Error("findRefs: not implemented yet");
};
