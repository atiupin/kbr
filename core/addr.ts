/** File offset <-> the seg:off a disassembler shows, both ways. */

export interface SegOff {
  seg: number;
  off: number;
}

export const fileToSegOff = (_fileOff: number, _seg?: number): SegOff => {
  throw new Error("fileToSegOff: not implemented yet");
};

export const segOffToFile = (_at: SegOff): number => {
  throw new Error("segOffToFile: not implemented yet");
};
