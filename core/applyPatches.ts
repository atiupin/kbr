/**
 * The edit base + the manifest + the injected asm -> the patched game.
 *
 * The step that decides, per string, between writing in place and moving it to the pool,
 * and the only one allowed to repoint a reference. One input, one output: the SHA-256 gate
 * below refuses any other image, so every manifest offset is provably correct against it.
 *
 * Manifest (res/patches.csv): CSV, header `type,offset,expect,write`, one patch per row.
 * Blank and `#` lines are skipped, so `#` carries the section comments. UTF-8 in, CP866
 * out, with `\xNN` for raw byte NN and `\\` for a literal backslash (see encodeText).
 * Quote expect/write ("Gold:  ") to keep significant leading and trailing spaces visible.
 * Rows are shape-checked before anything is applied; errors name the manifest line.
 *
 *     type    "bytes" | "string" | "reloc"
 *     offset  file offset (reloc: one or more ref offsets, space-separated)
 *     expect  what must be there now  (hex for bytes, the original English otherwise)
 *     write   what to write           (hex for bytes, the translation otherwise)
 *
 * bytes : hex, equal length, overwritten in place.
 *
 *         NO ACCIDENTAL CODE MOTION. Rewriting an instruction is fine (a flipped branch,
 *         a changed immediate); MOVING one drags two things with it. The MZ relocation
 *         table pins every far call's segment word BY FILE OFFSET and DOS adds the load
 *         segment to it, so a slid `9a` is never fixed up while the loader corrupts
 *         whatever took its place. A slid `b8` that a `reloc` row names moves that row's
 *         ref too. Both are legal when declared: repoint the relocation entries in their
 *         own `bytes` row and give the `reloc` row the ref's new offset. checkRelocations
 *         rejects an undeclared slide. Prefer moving the OUTPUT to moving code — the
 *         drawing calls take absolute columns — and reorder only when the print order
 *         itself is the bug.
 *
 * string: CP866 written in place, NUL-terminated. `expect` is the complete original (its
 *         NUL is verified), so its length is the slot budget. A longer `write` is an
 *         error, never an automatic reloc: upgrading needs refs the row does not carry,
 *         and could silently repoint inside the copy-protection block (see PROT_LO).
 *
 * reloc : `offset` is NOT the string — it is the REF, the file offset of the 2-byte near
 *         pointer reaching it, from find_ref. `expect` is still the English: the pointer
 *         is dereferenced and what it lands on must match.
 *
 *         The row says where the string is REACHED FROM, not that the pool must be used.
 *         A `write` that fits the original slot is inlined there with the refs untouched;
 *         only overflows go to the pool at DS POOL_DSOFF, every ref repointed. Inlining
 *         also covers what find_ref cannot see (computed or indexed access, a pointer
 *         table's first/last slot), which would otherwise keep showing English.
 *
 *         One row per string, not per ref — all its pointers must move together:
 *             reloc,0x0185CB 0x018F02,"lost!","потеряно!"
 *
 * Every reloc ref MUST come from find_ref, which proves the site is a real code immediate
 * or table slot. A hand-picked 2-byte value that merely happens to equal the string's DS
 * offset repoints something else — a slot inside a counter table, say — and the corruption
 * surfaces far from the edit.
 *
 * Two stages are not manifest-driven, both assembled and injected after the pool:
 * res/gate_picker.asm (see injectGatePicker) and res/name_tables.asm (see
 * injectNameTables). They are code and code-addressed data, not translation, and carry
 * relocation bookkeeping and resolved DS addresses the four-column manifest cannot express.
 */

import { assemble, type Assembled } from "./asm16.ts";
import { concat, equal, findByte, hex, setU16, u16 } from "./bytes.ts";
import { decodeCp866, encodeCp866 } from "./cp866.ts";
import { sha256 } from "./sha256.ts";

/**
 * The edit base this manifest describes. Every offset in patches.csv is only meaningful
 * against this exact image, so a mismatch means they would land somewhere else entirely.
 */
export const KBU2_SHA256 =
  "a0ad8832b6a9afa7b28c7d0054a13e286d7952a558eaa12a38f6146e77339d49";

const COLUMNS = ["type", "offset", "expect", "write"] as const;
const KINDS = ["bytes", "string", "reloc"] as const;
const OFFSET_RE = /^0x[0-9a-fA-F]+$/;
const HEX_RE = /^[0-9a-fA-F]+$/;

/** DGROUP layout of KBU2.EXE: the file offset of DS:0000. */
export const DS_BASE = 0x15690;

// Pool placement, measured from MEMDUMP.BIN (heavy session, puzzle map open): heap
// high-water DS 0xb6cf, stack low-water DS 0xfe2c — a 17.8 KB cold band above _end, the
// heap floor at DS 0xb64c. The pool sits mid-band, so heap and stack each keep KB of slack,
// and c0's BSS wipe stops at _end, so its file-loaded bytes survive startup. DGROUP is left
// FLOATING (_heaplen 0): capping it buys nothing and costs stack headroom.
//
// To re-measure: DOSBox-X debugger, `MEMDUMPBIN 0000:0000 100000`. DS:0000 sits 4 bytes
// below the "Turbo C++ - Copyright 1990 Borla..." literal; RAM boots zeroed, so the highest
// nonzero byte above _end and the lowest below 0xffff are the real water marks.
//
// That reading holds only on a FRESHLY STARTED DOSBox running the game ONCE. DOS clears
// nothing on load, so a later run leaves earlier builds' pool tails standing above its own
// image end — byte-exact translated strings, layered, each build's image covering the head
// of the one before. They read as live writes past the pool and are nothing of the sort.
const POOL_DSOFF = 0xd000; // pool base, mid cold band
const POOL_SIZE = 0x1800; // 6 KB
const POOL_END_DSOFF = POOL_DSOFF + POOL_SIZE; // hard cap; clear of the stack's descent

// Copy-protection segment (Ghidra 19fe:0000-0cc7). `reloc` rows MUST NOT repoint a ref in
// here. THE RULE IS SOLID; THE MECHANISM IS UNKNOWN — distrust any explanation.
//
// One repointed immediate plays for minutes, then hangs in an INT 6 loop on entering the
// king's castle. It is not a simple checksum: repointing to another string inside the
// original image hangs too, and so does swapping two immediates, which leaves both the byte
// sum and the XOR unchanged. Heap exhaustion, stack exhaustion and pool placement are all
// ruled out — re-testing those is wasted effort.
//
// Not "any byte here is fatal": our own flip at 0xC40A sits inside the block and plays
// through. The fence is conservative and costs nothing — every string reached from here is
// protection UI that fits its own slot as a `string` row.
// Rejected at parse time: an inlined reloc is harmless today, one rewording from fatal.
export const PROT_LO = 0xbfe0; // file offsets, inclusive
export const PROT_HI = 0xcca7;

// --- Town/Castle Gate destination picker (res/gate_picker.asm) ---------------------------
// Why the gate needs a window of its own is in that file's header; what matters here is
// placement. The routine lands at CODE_DSOFF, the pool's hard cap: the pool bump-allocates
// upward and can never reach it, so string growth and code never compete. DGROUP is the
// routine's code segment as well as its data segment, so its labels are DS offsets.
const CODE_DSOFF = POOL_END_DSOFF; // 0xE800, paragraph-aligned, just above the pool

// The gate's header/list/prompt/decode block. Everything from the box being drawn to the
// key being turned into a slot index; the tail that resolves coordinates is left alone.
const STUB_AT = 0xf7c1;
const STUB_END = 0xf8c4;
const GATE_RESUME = 0xf900; // past the visited re-check, now unreachable
const GATE_EXIT = 0xf979; // pop si / mov sp,bp / pop bp / retf
const STUB_PAD = 0x90;

// --- Cyrillic hero names (res/name_tables.asm) -------------------------------------------
// Neither site can be a manifest row: both need the DS address of a table that only exists
// once the tables are placed. What each table is for is in that file's header.
//
// NAME_AT is the accept path of the name field's key loop. It is rewritten whole because
// the mapping must happen before the byte is BOTH stored and echoed, and because loading
// the key into AL once — the original re-reads [bp-1] at every test — is what pays for the
// xlat.
//
// FNAME_AT is the save-file name builder's per-character test, "A-Z, or else '_'". The
// table answers that for every byte, so the test collapses into a lookup plus a jump to the
// store the block already ends with. Only the first 6 bytes are rewritten and the rest is
// left as dead code, which keeps the relocation entry at 0x8FED pinning the word it always
// pinned. Overwriting that word means re-aiming the entry, and the replacement has no far
// call to re-aim it at; jumping over it costs nothing since nothing there runs any more.
const TABLES_DSOFF = 0xec00; // clear of the gate picker below, the stack above
const NAME_AT = 0x6750;
const NAME_END = 0x6776;
const NAME_REJECT = 0x677d; // the key loop's "not accepted" tail
const FNAME_AT = 0x8fe0;
const FNAME_PINNED = 0x8fed; // relocation target, must stay where it is
const FNAME_STORE = 0x8fff; // mov [si+0x6438],al -- reached with AL already set

const hex16 = (v: number): string => `0x${v.toString(16).padStart(4, "0")}`;
const at = (v: number): string => `0x${v.toString(16)}`;

const stubSource = (dgroupPara: number): string => `
    push si
    callf ${hex16(dgroupPara)}:${hex16(CODE_DSOFF)}
    pop  cx
    cmp  al,0xff
    jz   cancelled
    mov  [bp-1],al
    jmp  ${hex16(GATE_RESUME)}
cancelled:
    xor  ax,ax
    push ax
    mov  ax,1
    push ax
    callf 0x1168:0x0d4d
    pop  cx
    pop  cx
    jmp  ${hex16(GATE_EXIT)}
`;

const nameSource = (keymap: number): string => `
    mov  al,[bp-1]
    cmp  al,0x20
    jb   ${hex16(NAME_REJECT)}
    cmp  al,0x7f
    ja   ${hex16(NAME_REJECT)}
    cmp  si,[bp+8]
    jge  ${hex16(NAME_REJECT)}
    or   si,si
    jnz  map
    cmp  al,0x20
    je   ${hex16(NAME_REJECT)}
map:
    mov  bx,${hex16(keymap)}
    xlat
    mov  bx,[bp+6]
    mov  [bx+si],al
    inc  si
    mov  ah,0
`;

const fnameSource = (translit: number): string => `
    mov  bx,${hex16(translit)}
    xlat
    jmp  ${hex16(FNAME_STORE)}
`;

export interface PatchInputs {
  /** The unpacked, flat image every offset in the manifest is measured against. */
  base: Uint8Array;
  /** res/patches.csv as text; the strict reader that parses it is ours. */
  patchesCsv: string;
  gatePickerAsm: string;
  nameTablesAsm: string;
}

/** What the run did, in numbers: the shell decides how to say it. */
export interface PatchSummary {
  rows: number;
  inlined: number;
  pooled: number;
  poolUsed: number;
  poolSize: number;
  gate: { code: number; stub: number; sites: number; reaimed: number; added: number };
  names: { tables: number; keymap: number; translit: number };
}

export interface PatchResult {
  image: Uint8Array;
  summary: PatchSummary;
}

type Kind = (typeof KINDS)[number];

interface Row {
  where: string;
  type: string;
  offset: string;
  expect: string;
  write: string;
}

/** A `bytes` or `string` row: one payload, written at its own offset. */
interface Direct {
  kind: "bytes" | "string";
  label: string;
  off: number;
  expect: Uint8Array;
  payload: Uint8Array;
}

interface Reloc {
  kind: "reloc";
  label: string;
  offs: number[];
  expect: Uint8Array;
  /** The translation with its NUL: what lands in the slot or in the pool. */
  text: Uint8Array;
}

type Patch = Direct | Reloc;

/** A reloc row once its refs have been dereferenced against the image. */
interface Placed {
  patch: Reloc;
  src: number;
  inlined: boolean;
}

interface Span {
  off: number;
  payload: Uint8Array;
  label: string;
}

/**
 * One CSV line into fields, strictly: text after a closing quote is an error rather than
 * something folded into the field, and an unbalanced quote is an error rather than a field
 * that swallows the rows below it. Both are how a mistyped manifest silently shifts a
 * translation into the wrong column. No field spans a newline, so a line is a record.
 */
const csvFields = (line: string, where: string): string[] => {
  const fields: string[] = [];
  let field = "";
  let state: "start" | "plain" | "quoted" | "closing" = "start";
  for (const ch of line) {
    if (state === "quoted") {
      if (ch === '"') state = "closing";
      else field += ch;
    } else if (state === "closing" && ch === '"') {
      // a doubled quote is one literal quote
      field += '"';
      state = "quoted";
    } else if (ch === ",") {
      fields.push(field);
      field = "";
      state = "start";
    } else if (state === "closing") {
      throw new Error(`${where}: text after a closing quote -- write "" for a literal one`);
    } else if (state === "start" && ch === '"') {
      state = "quoted";
    } else {
      field += ch;
      state = "plain";
    }
  }
  if (state === "quoted") throw new Error(`${where}: unbalanced quote`);
  fields.push(field);
  return fields;
};

/**
 * Encode one manifest text field to CP866. `\xNN` writes raw byte NN, `\\` a literal
 * backslash. The escape is for glyphs CP866 will not round-trip: the movement menu's arrows
 * are bytes 0x18-0x1b, which the codec maps to the C0 controls.
 */
const encodeText = (text: string, label: string, column: string): Uint8Array => {
  const out: number[] = [];
  let lit = "";

  const flush = (): void => {
    if (lit === "") return;
    try {
      out.push(...encodeCp866(lit));
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      throw new Error(`${label}: ${column} is not encodable in CP866 (${why})`);
    }
    lit = "";
  };

  let i = 0;
  while (i < text.length) {
    if (text[i] !== "\\") {
      lit += text[i];
      i += 1;
      continue;
    }
    const esc = text.slice(i + 1, i + 2);
    if (esc === "\\") {
      lit += "\\";
      i += 2;
    } else if (esc === "x") {
      const digits = text.slice(i + 2, i + 4);
      if (!/^[0-9a-fA-F]{2}$/.test(digits)) {
        throw new Error(
          `${label}: bad \\x escape in ${column} (${JSON.stringify(text.slice(i, i + 4))}` +
            ` -- want \\xNN)`,
        );
      }
      flush();
      out.push(Number.parseInt(digits, 16));
      i += 4;
    } else {
      throw new Error(
        `${label}: stray backslash in ${column} -- write \\\\ for a literal one, ` +
          `\\xNN for a raw byte`,
      );
    }
  }
  flush();
  return Uint8Array.from(out);
};

const unhex = (text: string): Uint8Array => {
  const packed = text.replace(/ /g, "");
  const out = new Uint8Array(packed.length / 2);
  for (let i = 0; i < out.length; i++)
    out[i] = Number.parseInt(packed.slice(i * 2, i * 2 + 2), 16);
  return out;
};

/** Reject any row whose columns are not what its `type` says they are. */
const checkRow = (row: Row): void => {
  const { where, type, offset, expect, write } = row;

  if (!(KINDS as readonly string[]).includes(type)) {
    throw new Error(
      `${where}: type ${JSON.stringify(type)} -- want one of ${KINDS.join(", ")}`,
    );
  }

  const toks = offset.split(/\s+/).filter((t) => t !== "");
  if (toks.length === 0) throw new Error(`${where}: offset is empty`);
  if (type !== "reloc" && toks.length > 1) {
    throw new Error(
      `${where}: ${toks.length} offsets, but only 'reloc' rows may list several`,
    );
  }
  for (const tok of toks) {
    if (!OFFSET_RE.test(tok)) {
      throw new Error(
        `${where}: offset ${JSON.stringify(tok)} -- want 0x-prefixed hex, e.g. 0x0185e3`,
      );
    }
  }

  if (expect === "") {
    throw new Error(
      `${where}: expect is empty -- it is what pins the row to the right bytes`,
    );
  }

  if (type === "bytes") {
    for (const [column, value] of [
      ["expect", expect],
      ["write", write],
    ] as const) {
      const packed = value.replace(/ /g, "");
      if (packed === "" || !HEX_RE.test(packed) || packed.length % 2 !== 0) {
        throw new Error(
          `${where}: bytes ${column} ${JSON.stringify(value)} -- want whole hex bytes, ` +
            `e.g. "72" or "eb 0d 90"`,
        );
      }
    }
  } else {
    // Validation only; resolve encodes for real. An empty write is legal — it blanks the
    // string.
    encodeText(expect, where, "expect");
    encodeText(write, where, "write");
  }
};

/** res/patches.csv into one shape-checked row per patch. */
const loadManifest = (text: string): Row[] => {
  const records: { where: string; fields: string[] }[] = [];
  text.split(/\r\n|\n|\r/).forEach((raw, i) => {
    if (raw.trim() === "" || raw.trimStart().startsWith("#")) return;
    const where = `patches.csv line ${i + 1}`;
    const fields = csvFields(raw, where);
    if (fields.length !== COLUMNS.length) {
      throw new Error(
        `${where}: ${fields.length} field(s), want ${COLUMNS.length} ` +
          `(${COLUMNS.join(",")})\n       ${raw.trim()}`,
      );
    }
    records.push({ where, fields });
  });

  const header = records.shift();
  if (header === undefined) throw new Error("the manifest holds no patches");
  if (!header.fields.every((f, i) => f === COLUMNS[i])) {
    throw new Error(
      `${header.where}: header is ${header.fields.join(",")}, want ${COLUMNS.join(",")}`,
    );
  }
  if (records.length === 0) throw new Error("the manifest holds no patches");

  return records.map(({ where, fields }) => {
    const [type, offset, expect, write] = fields;
    const row: Row = { where, type, offset, expect, write };
    checkRow(row);
    return row;
  });
};

const resolve = (row: Row): Patch => {
  const label = row.where;
  const offs = row.offset
    .split(/\s+/)
    .filter((t) => t !== "")
    .map((tok) => Number.parseInt(tok, 16));
  const kind = row.type as Kind;

  if (kind === "bytes") {
    const expect = unhex(row.expect);
    const payload = unhex(row.write);
    if (expect.length !== payload.length) {
      throw new Error(
        `${label}: bytes expect/write differ in length ` +
          `(${expect.length} vs ${payload.length})`,
      );
    }
    return { kind, label, off: offs[0], expect, payload };
  }

  const expect = encodeText(row.expect, label, "expect");
  const text = encodeText(row.write, label, "write");

  if (kind === "string") {
    if (text.length > expect.length) {
      throw new Error(
        `${label}: translation is ${text.length}B but the slot holds ${expect.length}B ` +
          `-- use a 'reloc' row`,
      );
    }
    return {
      kind,
      label,
      off: offs[0],
      expect,
      payload: concat([text, new Uint8Array(1)]),
    };
  }

  for (const ref of offs) {
    if (ref >= PROT_LO && ref <= PROT_HI) {
      throw new Error(
        `${label}: reloc ref ${at(ref)} is inside the copy-protection block ` +
          `(${at(PROT_LO)}-${at(PROT_HI)}).\n` +
          `       That block is integrity-checked and retaliates on a delay -- the game ` +
          `runs, then hangs much later (INT 6 in the graphics loader).\n` +
          `       Use a 'string' row instead: the protection UI text all fits its ` +
          `original slot.`,
      );
    }
  }
  return { kind, label, offs, expect, text: concat([text, new Uint8Array(1)]) };
};

const deref = (
  data: Uint8Array,
  ref: number,
  label: string,
): { src: number; text: Uint8Array } => {
  if (ref + 2 > data.length)
    throw new Error(`${label}: ref ${at(ref)} is past the end of the image`);
  const dsoff = u16(data, ref);
  const src = DS_BASE + dsoff;
  const end = src < data.length ? findByte(data, 0, src) : -1;
  if (end === -1) {
    throw new Error(
      `${label}: ref ${at(ref)} points at DS ${hex16(dsoff)} (file ${at(src)}), ` +
        `which is not a NUL-terminated string`,
    );
  }
  return { src, text: data.subarray(src, end) };
};

/**
 * One string, one row. Two rows repointing the same string mean its pointers were split
 * across rows — they must move together, so list every ref in one row.
 */
const checkRelocSources = (placed: readonly Placed[]): void => {
  const seen = new Map<number, Placed>();
  for (const p of placed) {
    const prev = seen.get(p.src);
    if (prev === undefined) {
      seen.set(p.src, p);
      continue;
    }
    const refs = [...prev.patch.offs, ...p.patch.offs].map((r) => at(r)).join(" ");
    throw new Error(
      `${p.patch.label} and ${prev.patch.label} both repoint the string at ${at(p.src)} ` +
        `(${JSON.stringify(decodeCp866(p.patch.expect))}).\n` +
        `       Merge them into one row listing every ref (offset column: "${refs}").`,
    );
  }
};

/**
 * Only in-place writes can collide (pool appends are bump-allocated) — including inlined
 * `reloc` rows, whose slot can land on a `string` row.
 */
const checkOverlaps = (spans: readonly Span[]): void => {
  const sorted = [...spans].sort(
    (a, b) => a.off - b.off || a.payload.length - b.payload.length,
  );
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    if (b.off < a.off + a.payload.length) {
      throw new Error(
        `patches overlap: ${JSON.stringify(a.label)} [${at(a.off)},` +
          `${at(a.off + a.payload.length)}) and ${JSON.stringify(b.label)} ` +
          `[${at(b.off)},${at(b.off + b.payload.length)})`,
      );
    }
  }
};

interface RelocTable {
  count: number;
  hdr: number;
  tbl: number;
}

const mzRelocTable = (data: Uint8Array): RelocTable => ({
  count: u16(data, 0x06),
  hdr: u16(data, 0x08) * 16,
  tbl: u16(data, 0x18),
});

const relocTarget = (data: Uint8Array, ent: number, hdr: number): number =>
  hdr + u16(data, ent + 2) * 16 + u16(data, ent);

/**
 * Aim one entry at a file offset. The image's own entries all use seg=0, which only reaches
 * the first 64K; the injected routine is past that, so the offset is split.
 */
const setRelocEntry = (
  data: Uint8Array,
  ent: number,
  target: number,
  hdr: number,
): void => {
  const seg = Math.floor((target - hdr) / 16);
  if (seg > 0xffff)
    throw new Error(`relocation target ${at(target)} is past the addressable image`);
  setU16(data, ent, (target - hdr) % 16);
  setU16(data, ent + 2, seg);
};

/**
 * Re-aim every entry pointing into [lo,hi) at one of `sites`, then append the rest.
 *
 * Both halves matter. An entry left pointing into overwritten code has DOS add the load
 * segment to whatever byte pair took its place — silent corruption far from the edit. A new
 * far call with no entry keeps its link-time segment and calls into whatever the loader put
 * there.
 */
const retargetRelocations = (
  data: Uint8Array,
  lo: number,
  hi: number,
  sites: readonly number[],
): { reaimed: number; added: number } => {
  const { count, hdr, tbl } = mzRelocTable(data);
  const dead: number[] = [];
  for (let i = 0; i < count; i++) {
    const ent = tbl + 4 * i;
    const target = relocTarget(data, ent, hdr);
    if (target >= lo && target < hi) dead.push(ent);
  }
  if (dead.length > sites.length) {
    throw new Error(
      `${dead.length} relocation entries point into [${at(lo)},${at(hi)}) but the ` +
        `replacement has only ${sites.length} far calls to re-aim them at.\n` +
        `       Removing an entry means compacting the table, which this does not do.`,
    );
  }

  const todo = [...sites];
  for (const ent of dead) setRelocEntry(data, ent, todo.shift()!, hdr);

  const room = Math.floor((hdr - (tbl + 4 * count)) / 4);
  if (todo.length > room) {
    throw new Error(
      `${todo.length} new relocation entries needed but only ${room} free slots before ` +
        `the header ends -- growing the table would shift the whole image`,
    );
  }
  todo.forEach((site, k) => setRelocEntry(data, tbl + 4 * (count + k), site, hdr));
  setU16(data, 0x06, count + todo.length);
  return { reaimed: dead.length, added: todo.length };
};

/**
 * Gate the "no code motion" rule instead of trusting it: a relocation target's word may not
 * change.
 *
 *   entry untouched -> the word must still be what pristine KBU2 had there
 *   entry repointed -> its new target must be a far call's segment word (`9a` +3)
 *   entry appended  -> same, and it must fit in the header's own spare slots
 *
 * Repointing is how deliberate code motion declares itself; the `9a` proves the entry
 * landed on a call and not on an arbitrary word. The table may grow into the zeros between
 * its end and the end of the header, which shifts nothing; it may not move.
 */
const checkRelocations = (orig: Uint8Array, data: Uint8Array): void => {
  const now = mzRelocTable(data);
  const was = mzRelocTable(orig);
  if (now.hdr !== was.hdr || now.tbl !== was.tbl) {
    throw new Error("the MZ relocation table itself moved -- unsupported");
  }
  if (now.count < was.count) {
    throw new Error(
      `the relocation table shrank (${was.count} -> ${now.count}) -- unsupported`,
    );
  }
  if (now.tbl + 4 * now.count > now.hdr) {
    throw new Error(
      `the relocation table (${now.count} entries) ran past the end of the header`,
    );
  }

  const onFarCall = (target: number, what: string): void => {
    if (data[target - 3] !== 0x9a) {
      throw new Error(
        `${what} aims at ${at(target)}, which is not a far call's segment word ` +
          `(no 9a at ${at(target - 3)})`,
      );
    }
  };

  for (let i = was.count; i < now.count; i++) {
    onFarCall(
      relocTarget(data, now.tbl + 4 * i, now.hdr),
      `appended relocation entry ${i}`,
    );
  }

  for (let i = 0; i < was.count; i++) {
    const ent = now.tbl + 4 * i;
    const target = relocTarget(data, ent, now.hdr);
    if (!equal(data.subarray(ent, ent + 4), orig.subarray(ent, ent + 4))) {
      // a changed entry is deliberate code motion, so it only has to land on a far call
      onFarCall(target, `relocation entry ${i} at ${at(ent)}, repointed,`);
    } else if (
      !equal(data.subarray(target, target + 2), orig.subarray(target, target + 2))
    ) {
      throw new Error(
        `a patch changed the word at ${at(target)}, which relocation entry ${i} ` +
          `(${at(ent)}) pins.\n` +
          `       DOS fixes up that word at load time: moving code out from under an ` +
          `entry\n       breaks the call that moved AND corrupts what took its place. ` +
          `See 'NO CODE MOTION'\n       in this module's header.`,
      );
    }
  }
};

const assembled = (what: string, source: string, org: number): Assembled => {
  try {
    return assemble(source, org);
  } catch (err) {
    throw new Error(`${what}: ${err instanceof Error ? err.message : String(err)}`);
  }
};

/** The image only ever grows at its end; a copy per growth is nothing at this size. */
const padTo = (data: Uint8Array, size: number): Uint8Array => {
  if (size <= data.length) return data;
  const out = new Uint8Array(size);
  out.set(data);
  return out;
};

const injectGatePicker = (
  image: Uint8Array,
  source: string,
): { image: Uint8Array; gate: PatchSummary["gate"] } => {
  const { code, relocs: codeRelocs } = assembled("gate picker", source, CODE_DSOFF);

  // DGROUP's own paragraph, image-relative; DOS adds the load segment via the entry.
  const { hdr } = mzRelocTable(image);
  if ((DS_BASE - hdr) % 16 !== 0) {
    throw new Error(
      `DGROUP is not paragraph-aligned (DS_BASE ${at(DS_BASE)}) -- the injected routine ` +
        `cannot be reached by a far call`,
    );
  }

  const stubAsm = assembled("gate stub", stubSource((DS_BASE - hdr) / 16), STUB_AT);
  const stub = stubAsm.code;
  if (STUB_AT + stub.length > STUB_END) {
    throw new Error(
      `gate stub is ${stub.length}B but the block it replaces is ${STUB_END - STUB_AT}B`,
    );
  }

  const codeAt = DS_BASE + CODE_DSOFF;
  if (image.length > codeAt) {
    throw new Error(
      `the overflow pool reached DS ${hex16(image.length - DS_BASE)}, past the code ` +
        `region at DS ${hex16(CODE_DSOFF)} -- lower POOL_SIZE or move CODE_DSOFF`,
    );
  }
  const data = padTo(image, codeAt + code.length);
  data.set(stub, STUB_AT);
  data.fill(STUB_PAD, STUB_AT + stub.length, STUB_END);
  data.set(code, codeAt);

  const sites = [
    ...stubAsm.relocs.map((r) => STUB_AT + r),
    ...codeRelocs.map((r) => codeAt + r),
  ];
  for (const site of sites) {
    // the entry is only ever correct on a `9a` +3
    if (data[site - 3] !== 0x9a) {
      throw new Error(`internal: reloc site ${at(site)} is not a far call's segment word`);
    }
  }
  const { reaimed, added } = retargetRelocations(data, STUB_AT, STUB_END, sites);
  return {
    image: data,
    gate: { code: code.length, stub: stub.length, sites: sites.length, reaimed, added },
  };
};

const injectNameTables = (
  image: Uint8Array,
  source: string,
): { image: Uint8Array; names: PatchSummary["names"] } => {
  const { code: tables, relocs, symbols } = assembled("name tables", source, TABLES_DSOFF);
  if (relocs.length > 0) {
    throw new Error(
      "name tables: data only -- a far call there would need its own relocation entry",
    );
  }
  const keymap = symbols.get("keymap");
  const translit = symbols.get("translit");
  if (keymap === undefined || translit === undefined) {
    throw new Error("name tables: both a keymap: and a translit: label are needed");
  }

  // Both tables are indexed by the raw byte, so a label IS its xlat base — and a row of the
  // wrong length would silently shift every entry past it instead of failing.
  const spans = [
    { name: "keymap", lo: keymap, hi: translit, want: 0x80 },
    { name: "translit", lo: translit, hi: TABLES_DSOFF + tables.length, want: 0x100 },
  ];
  for (const { name, lo, hi, want } of spans) {
    if (hi - lo !== want) {
      throw new Error(
        `name tables: ${name} spans ${hi - lo}B, want ${want}B -- it must cover ` +
          `its whole index range, 16 bytes to the row`,
      );
    }
  }

  const tablesAt = DS_BASE + TABLES_DSOFF;
  if (image.length > tablesAt) {
    throw new Error(
      `the image reached DS ${hex16(image.length - DS_BASE)}, past the name tables at ` +
        `DS ${hex16(TABLES_DSOFF)} -- raise TABLES_DSOFF`,
    );
  }

  const entry = assembled("name site", nameSource(keymap), NAME_AT).code;
  const fname = assembled("file name site", fnameSource(translit), FNAME_AT).code;
  if (NAME_AT + entry.length > NAME_END) {
    throw new Error(
      `the name entry block is ${entry.length}B but the accept path it replaces is ` +
        `${NAME_END - NAME_AT}B`,
    );
  }
  if (FNAME_AT + fname.length > FNAME_PINNED) {
    throw new Error(
      `the file name block is ${fname.length}B and would reach the relocation target at ` +
        `${at(FNAME_PINNED)}`,
    );
  }

  const data = padTo(image, tablesAt + tables.length);
  data.set(tables, tablesAt);
  data.set(entry, NAME_AT);
  data.fill(STUB_PAD, NAME_AT + entry.length, NAME_END);
  data.set(fname, FNAME_AT);
  return { image: data, names: { tables: tables.length, keymap, translit } };
};

/**
 * Rewrite the MZ page-count fields so DOS loads the grown image. minalloc is left as-is:
 * the runtime's BSS/heap/stack now sit in the file-backed region as harmless zeros, and
 * keeping it guarantees at least the original extra memory.
 */
const fixMzHeader = (data: Uint8Array): void => {
  // e_cblp, then e_cp
  setU16(data, 0x02, data.length % 512);
  setU16(data, 0x04, Math.ceil(data.length / 512));
};

export const applyPatches = (inputs: PatchInputs): PatchResult => {
  const patches = loadManifest(inputs.patchesCsv).map(resolve);

  const digest = sha256(inputs.base);
  if (digest !== KBU2_SHA256) {
    throw new Error(
      `the input is not pristine KBU2.EXE\n       expected sha256 ${KBU2_SHA256}\n` +
        `       got             ${digest}`,
    );
  }
  let data: Uint8Array = new Uint8Array(inputs.base);

  // every bytes/string expect, against the pristine image
  for (const p of patches) {
    if (p.kind === "reloc") continue;
    const end = p.off + p.expect.length;
    // a string needs its NUL too
    const need = p.kind === "string" ? end + 1 : end;
    if (need > data.length) {
      throw new Error(
        `${p.label}: ${at(p.off)}+${p.expect.length}B runs past the end of the image ` +
          `(${data.length} bytes)`,
      );
    }
    const got = data.subarray(p.off, end);
    if (!equal(got, p.expect)) {
      throw new Error(
        `${p.label}: expected ${hex(p.expect)} at ${at(p.off)}, found ${hex(got)}`,
      );
    }
    if (p.kind === "string" && data[end] !== 0) {
      throw new Error(
        `${p.label}: original string at ${at(p.off)} is not NUL-terminated at its ` +
          `expected length`,
      );
    }
  }

  // `bytes` rows land first, so a row that deliberately moves a `b8 <dsoff>` is resolved at
  // the ref's NEW offset — pristine would still show the pre-motion instruction there.
  // `expect` is unchanged, so a wrong offset is still caught; it now just has to name where
  // the ref ends up. The in-place pass below rewrites these identically.
  for (const p of patches) if (p.kind === "bytes") data.set(p.payload, p.off);

  const relocs = patches.filter((p) => p.kind === "reloc");
  const placed = relocs.map((patch): Placed => {
    let src: number | null = null;
    for (const ref of patch.offs) {
      const hit = deref(data, ref, patch.label);
      if (!equal(hit.text, patch.expect)) {
        throw new Error(
          `${patch.label}: ref ${at(ref)} points at ` +
            `${JSON.stringify(decodeCp866(hit.text))}, not ` +
            `${JSON.stringify(decodeCp866(patch.expect))}`,
        );
      }
      if (src !== null && src !== hit.src) {
        throw new Error(
          `${patch.label}: its refs point at different strings (${at(src)} and ` +
            `${at(hit.src)}) -- one row per string`,
        );
      }
      src = hit.src;
    }
    // The pool is for overflows only; a translation that fits goes in the slot with the
    // refs left alone. The freed tail keeps stale English, past our NUL and never read.
    return { patch, src: src!, inlined: patch.text.length - 1 <= patch.expect.length };
  });
  checkRelocSources(placed);

  // bytes/string at their own offset, inlined relocs at the slot their refs point to
  const inplace: Span[] = patches
    .filter((p) => p.kind !== "reloc")
    .map((p) => ({ off: p.off, payload: p.payload, label: p.label }));
  for (const p of placed) {
    if (p.inlined)
      inplace.push({ off: p.src, payload: p.patch.text, label: p.patch.label });
  }
  checkOverlaps(inplace);
  for (const span of inplace) data.set(span.payload, span.off);

  const pooled = placed.filter((p) => !p.inlined);
  if (pooled.length > 0) {
    const poolBase = DS_BASE + POOL_DSOFF;
    data = padTo(data, poolBase);
    for (const p of pooled) {
      const dsoff = POOL_DSOFF + (data.length - poolBase);
      if (dsoff + p.patch.text.length > POOL_END_DSOFF) {
        throw new Error(
          `${p.patch.label}: overflow pool exhausted (need DS ${hex16(dsoff)}+` +
            `${p.patch.text.length}B, cap ${hex16(POOL_END_DSOFF)})`,
        );
      }
      const grown = padTo(data, data.length + p.patch.text.length);
      grown.set(p.patch.text, data.length);
      data = grown;
      // all pointers move together
      for (const ref of p.patch.offs) setU16(data, ref, dsoff);
    }
  }

  // After the pool: the routine sits at the pool's cap, so it must be placed once the pool
  // has stopped growing. Measure the pool first — injection pads the file out to the code
  // region, which would otherwise read as a full pool.
  const poolUsed = Math.max(0, data.length - (DS_BASE + POOL_DSOFF));
  const picker = injectGatePicker(data, inputs.gatePickerAsm);
  const tables = injectNameTables(picker.image, inputs.nameTablesAsm);
  data = tables.image;
  fixMzHeader(data);

  checkRelocations(inputs.base, data);

  return {
    image: data,
    summary: {
      rows: patches.length,
      inlined: placed.length - pooled.length,
      pooled: pooled.length,
      poolUsed,
      poolSize: POOL_SIZE,
      gate: picker.gate,
      names: tables.names,
    },
  };
};
