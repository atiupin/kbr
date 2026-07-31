/** The 16-bit assembler the injected res/*.asm are built with. */

export interface Assembled {
  code: Uint8Array;
  /** Offsets into `code` holding a segment value the patcher must relocate. */
  relocs: number[];
  symbols: Map<string, number>;
}

export const assemble = (_source: string, _org = 0): Assembled => {
  throw new Error("assemble: not implemented yet");
};
