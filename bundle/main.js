"use strict";
(() => {
  // core/cp866.ts
  var HIGH = "\u0410\u0411\u0412\u0413\u0414\u0415\u0416\u0417\u0418\u0419\u041A\u041B\u041C\u041D\u041E\u041F\u0420\u0421\u0422\u0423\u0424\u0425\u0426\u0427\u0428\u0429\u042A\u042B\u042C\u042D\u042E\u042F\u0430\u0431\u0432\u0433\u0434\u0435\u0436\u0437\u0438\u0439\u043A\u043B\u043C\u043D\u043E\u043F\u2591\u2592\u2593\u2502\u2524\u2561\u2562\u2556\u2555\u2563\u2551\u2557\u255D\u255C\u255B\u2510\u2514\u2534\u252C\u251C\u2500\u253C\u255E\u255F\u255A\u2554\u2569\u2566\u2560\u2550\u256C\u2567\u2568\u2564\u2565\u2559\u2558\u2552\u2553\u256B\u256A\u2518\u250C\u2588\u2584\u258C\u2590\u2580\u0440\u0441\u0442\u0443\u0444\u0445\u0446\u0447\u0448\u0449\u044A\u044B\u044C\u044D\u044E\u044F\u0401\u0451\u0404\u0454\u0407\u0457\u040E\u045E\xB0\u2219\xB7\u221A\u2116\xA4\u25A0\xA0";
  var BYTE_OF = /* @__PURE__ */ new Map();
  for (let i2 = 0; i2 < HIGH.length; i2++) BYTE_OF.set(HIGH[i2], 128 + i2);
  var decodeCp866 = (bytes) => {
    let text = "";
    for (const byte of bytes)
      text += byte < 128 ? String.fromCharCode(byte) : HIGH[byte - 128];
    return text;
  };
  var encodeCp866 = (text) => {
    const out = new Uint8Array(text.length);
    for (let i2 = 0; i2 < text.length; i2++) {
      const code = text.charCodeAt(i2);
      const byte = code < 128 ? code : BYTE_OF.get(text[i2]);
      if (byte === void 0)
        throw new RangeError(`${JSON.stringify(text[i2])} has no CP866 byte`);
      out[i2] = byte;
    }
    return out;
  };

  // core/asm16.ts
  var R16 = ["ax", "cx", "dx", "bx", "sp", "bp", "si", "di"];
  var R8 = ["al", "cl", "dl", "bl", "ah", "ch", "dh", "bh"];
  var ALU = ["add", "or", "adc", "sbb", "and", "sub", "xor", "cmp"];
  var RM16 = /* @__PURE__ */ new Map([
    ["bx+si", 0],
    ["bx+di", 1],
    ["bp+si", 2],
    ["bp+di", 3],
    ["si", 4],
    ["di", 5],
    ["bp", 6],
    ["bx", 7]
  ]);
  var JCC = /* @__PURE__ */ new Map([
    ["jo", 0],
    ["jno", 1],
    ["jb", 2],
    ["jc", 2],
    ["jnae", 2],
    ["jnb", 3],
    ["jnc", 3],
    ["jae", 3],
    ["jz", 4],
    ["je", 4],
    ["jnz", 5],
    ["jne", 5],
    ["jbe", 6],
    ["jna", 6],
    ["ja", 7],
    ["jnbe", 7],
    ["js", 8],
    ["jns", 9],
    ["jp", 10],
    ["jnp", 11],
    ["jl", 12],
    ["jnge", 12],
    ["jge", 13],
    ["jnl", 13],
    ["jle", 14],
    ["jng", 14],
    ["jg", 15],
    ["jnle", 15]
  ]);
  var NO_OPERAND = /* @__PURE__ */ new Map([
    ["nop", 144],
    ["cbw", 152],
    ["cwd", 153],
    ["ret", 195],
    ["retf", 203],
    ["clc", 248],
    ["stc", 249],
    ["pushf", 156],
    ["popf", 157],
    ["xlat", 215]
    // al = ds:[bx+al], the whole point of a lookup patch
  ]);
  var SHIFT = /* @__PURE__ */ new Map([
    ["shl", 4],
    ["shr", 5],
    ["sar", 7]
  ]);
  var UNARY = /* @__PURE__ */ new Map([
    ["not", 2],
    ["neg", 3],
    ["mul", 4],
    ["imul", 5],
    ["div", 6],
    ["idiv", 7]
  ]);
  var AsmError = class extends Error {
  };
  var w16 = (v) => [v & 255, v >> 8 & 255];
  var regForm = (op, reg, rm) => [
    op,
    192 | reg << 3 | rm
  ];
  var memModrm = (mem, reg, out) => {
    if (mem.base === null) {
      out.push(6 | reg << 3, ...w16(mem.disp));
    } else if (mem.disp === 0 && mem.base !== 6) {
      out.push(reg << 3 | mem.base);
    } else if (mem.disp >= -128 && mem.disp <= 127) {
      out.push(64 | reg << 3 | mem.base, mem.disp & 255);
    } else {
      out.push(128 | reg << 3 | mem.base, ...w16(mem.disp));
    }
  };
  var parseNum = (tok, symbols, need) => {
    const t = tok.trim();
    if (/^-?0x[0-9a-fA-F]+$/.test(t)) return Number.parseInt(t, 16);
    if (/^-?\d+$/.test(t)) return Number.parseInt(t, 10);
    const value = symbols.get(t);
    if (value !== void 0) return value;
    if (need) throw new AsmError(`undefined symbol or bad number: ${JSON.stringify(t)}`);
    return 0;
  };
  var parseOperand = (tok, symbols, need) => {
    const t = tok.trim();
    const low = t.toLowerCase();
    if (R16.includes(low)) return { kind: "r16", reg: R16.indexOf(low) };
    if (R8.includes(low)) return { kind: "r8", reg: R8.indexOf(low) };
    const bracketed = /^\[([^\]]+)\]$/.exec(t);
    if (bracketed === null) return { kind: "imm", value: parseNum(t, symbols, need) };
    const inner = bracketed[1].trim();
    const bare = RM16.get(inner.toLowerCase());
    if (bare !== void 0) return { kind: "mem", mem: { base: bare, disp: 0 } };
    const split = /^([a-zA-Z+]+?)\s*([+-])\s*(\S+)$/.exec(inner);
    const base = split === null ? void 0 : RM16.get(split[1].toLowerCase());
    if (split !== null && base !== void 0) {
      const disp = parseNum(split[3], symbols, need);
      return { kind: "mem", mem: { base, disp: split[2] === "-" ? -disp : disp } };
    }
    return { kind: "mem", mem: { base: null, disp: parseNum(inner, symbols, need) } };
  };
  var splitOperands = (rest) => {
    const parts = [];
    let depth = 0;
    let cur = "";
    let quote = null;
    for (const ch of rest) {
      if (quote !== null) {
        cur += ch;
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === "[") depth++;
      else if (ch === "]") depth--;
      if (ch === "," && depth === 0) {
        parts.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    if (cur.trim() !== "") parts.push(cur);
    return parts.map((p) => p.trim());
  };
  var stripSize = (ops) => {
    const m = /^(byte|word)\s+(.*)$/i.exec(ops[0]);
    if (m === null) return { size: null, ops };
    return { size: m[1].toLowerCase(), ops: [m[2], ...ops.slice(1)] };
  };
  var branchTarget = (tok, symbols, pc, need) => {
    const t = tok.trim();
    const named = /^[A-Za-z_][\w.]*$/.test(t);
    if (named && !symbols.has(t) && !need) return pc;
    return parseNum(t, symbols, need);
  };
  var plain = (bytes) => ({ bytes, relocs: [] });
  var encode = (mnem, ops, symbols, pc, need, targets) => {
    const bare = NO_OPERAND.get(mnem);
    if (bare !== void 0) return plain([bare]);
    if (mnem === "callf") {
      const m = /^(\S+)\s*:\s*(\S+)$/.exec(ops[0]);
      if (m === null) throw new AsmError("callf wants seg:off");
      const seg = parseNum(m[1], symbols, need);
      const off = parseNum(m[2], symbols, need);
      return { bytes: [154, ...w16(off), ...w16(seg)], relocs: [3] };
    }
    const cc = JCC.get(mnem);
    if (cc !== void 0) {
      const target = branchTarget(ops[0], symbols, pc, need);
      targets.push(target);
      const rel = target - (pc + 2);
      if (need && (rel < -128 || rel > 127)) {
        throw new AsmError(`${mnem} out of rel8 range (${rel})`);
      }
      return plain([112 | cc, rel & 255]);
    }
    if (mnem === "jmp") {
      const target = branchTarget(ops[0], symbols, pc, need);
      targets.push(target);
      const short = target - (pc + 2);
      if (short >= -128 && short <= 127) return plain([235, short & 255]);
      return plain([233, ...w16(target - (pc + 3))]);
    }
    if (mnem === "push" || mnem === "pop") {
      const op = parseOperand(ops[0], symbols, need);
      if (op.kind === "r16") return plain([(mnem === "push" ? 80 : 88) + op.reg]);
      if (op.kind === "mem") {
        const out = [mnem === "push" ? 255 : 143];
        memModrm(op.mem, mnem === "push" ? 6 : 0, out);
        return plain(out);
      }
      throw new AsmError(
        `${mnem} takes a word register or memory; 8086 has no push-immediate`
      );
    }
    if (mnem === "inc" || mnem === "dec") {
      const sized = stripSize(ops);
      const op = parseOperand(sized.ops[0], symbols, need);
      const field = mnem === "inc" ? 0 : 1;
      if (op.kind === "r16") return plain([(mnem === "inc" ? 64 : 72) + op.reg]);
      if (op.kind === "r8") return plain(regForm(254, field, op.reg));
      if (op.kind === "imm") throw new AsmError(`${mnem} takes a register or memory`);
      const out = [sized.size === "byte" ? 254 : 255];
      memModrm(op.mem, field, out);
      return plain(out);
    }
    const shift = SHIFT.get(mnem);
    if (shift !== void 0) {
      const op = parseOperand(ops[0], symbols, need);
      if (op.kind !== "r16" && op.kind !== "r8")
        throw new AsmError(`${mnem} takes a register`);
      if (parseNum(ops[1], symbols, need) !== 1)
        throw new AsmError("only shift-by-1 is supported");
      return plain(regForm(op.kind === "r16" ? 209 : 208, shift, op.reg));
    }
    const unary = UNARY.get(mnem);
    if (unary !== void 0) {
      const op = parseOperand(ops[0], symbols, need);
      if (op.kind !== "r16" && op.kind !== "r8")
        throw new AsmError(`${mnem} takes a register`);
      return plain(regForm(op.kind === "r16" ? 247 : 246, unary, op.reg));
    }
    if (mnem === "mov") return plain(encMov(ops, symbols, need));
    if (ALU.includes(mnem)) return plain(encAlu(mnem, ops, symbols, need));
    throw new AsmError(`unsupported mnemonic ${JSON.stringify(mnem)}`);
  };
  var encMov = (rawOps, symbols, need) => {
    const { size, ops } = stripSize(rawOps);
    const d = parseOperand(ops[0], symbols, need);
    const s = parseOperand(ops[1], symbols, need);
    if (d.kind === "r16" && s.kind === "imm") return [184 + d.reg, ...w16(s.value)];
    if (d.kind === "r8" && s.kind === "imm") return [176 + d.reg, s.value & 255];
    if (d.kind === "r16" && s.kind === "r16") return regForm(139, d.reg, s.reg);
    if (d.kind === "r8" && s.kind === "r8") return regForm(138, d.reg, s.reg);
    if ((d.kind === "r16" || d.kind === "r8") && s.kind === "mem") {
      if (d.reg === 0 && s.mem.base === null) {
        return [d.kind === "r16" ? 161 : 160, ...w16(s.mem.disp)];
      }
      const out = [d.kind === "r16" ? 139 : 138];
      memModrm(s.mem, d.reg, out);
      return out;
    }
    if (d.kind === "mem" && (s.kind === "r16" || s.kind === "r8")) {
      if (s.reg === 0 && d.mem.base === null) {
        return [s.kind === "r16" ? 163 : 162, ...w16(d.mem.disp)];
      }
      const out = [s.kind === "r16" ? 137 : 136];
      memModrm(d.mem, s.reg, out);
      return out;
    }
    if (d.kind === "mem" && s.kind === "imm") {
      if (size === null) throw new AsmError("store of an immediate needs `byte` or `word`");
      const out = [size === "byte" ? 198 : 199];
      memModrm(d.mem, 0, out);
      return [...out, ...size === "byte" ? [s.value & 255] : w16(s.value)];
    }
    throw new AsmError(`unsupported mov form: ${ops.join(",")}`);
  };
  var encAlu = (mnem, rawOps, symbols, need) => {
    const op = ALU.indexOf(mnem);
    const { size, ops } = stripSize(rawOps);
    const d = parseOperand(ops[0], symbols, need);
    const s = parseOperand(ops[1], symbols, need);
    if ((d.kind === "r16" || d.kind === "r8") && s.kind === "imm") {
      if (d.reg === 0) {
        if (d.kind === "r16") return [op * 8 + 5, ...w16(s.value)];
        return [op * 8 + 4, s.value & 255];
      }
      if (d.kind === "r16" && s.value >= -128 && s.value <= 127) {
        return [...regForm(131, op, d.reg), s.value & 255];
      }
      const out = regForm(d.kind === "r16" ? 129 : 128, op, d.reg);
      return [...out, ...d.kind === "r16" ? w16(s.value) : [s.value & 255]];
    }
    if (d.kind === "r16" && s.kind === "r16") return regForm(op * 8 + 3, d.reg, s.reg);
    if (d.kind === "r8" && s.kind === "r8") return regForm(op * 8 + 2, d.reg, s.reg);
    if ((d.kind === "r16" || d.kind === "r8") && s.kind === "mem") {
      const out = [op * 8 + (d.kind === "r16" ? 3 : 2)];
      memModrm(s.mem, d.reg, out);
      return out;
    }
    if (d.kind === "mem" && (s.kind === "r16" || s.kind === "r8")) {
      const out = [op * 8 + (s.kind === "r16" ? 1 : 0)];
      memModrm(d.mem, s.reg, out);
      return out;
    }
    if (d.kind === "mem" && s.kind === "imm") {
      if (size === null)
        throw new AsmError(`${mnem} of an immediate needs \`byte\` or \`word\``);
      const out = [size === "byte" ? 128 : 129];
      memModrm(d.mem, op, out);
      return [...out, ...size === "byte" ? [s.value & 255] : w16(s.value)];
    }
    throw new AsmError(`unsupported ${mnem} form: ${ops.join(",")}`);
  };
  var encData = (mnem, rest, symbols, need) => {
    const out = [];
    for (const tok of splitOperands(rest)) {
      const str = /^"([\s\S]*)"$/.exec(tok);
      if (str !== null) out.push(...encodeCp866(str[1]));
      else if (mnem === "db") out.push(parseNum(tok, symbols, need) & 255);
      else out.push(...w16(parseNum(tok, symbols, need)));
    }
    return out;
  };
  var parseLines = (source) => {
    const lines = [];
    for (const raw of source.split("\n")) {
      let line = raw.split(";")[0].trim();
      const equ = /^([A-Za-z_]\w*)\s+equ\s+(.+)$/.exec(line);
      if (equ !== null) {
        lines.push({ kind: "equ", name: equ[1], expr: equ[2].trim() });
        continue;
      }
      while (line !== "") {
        const label = /^([A-Za-z_.][\w.]*)\s*:(?!\s*[0-9a-fA-Fx])/.exec(line);
        if (label !== null) {
          lines.push({ kind: "label", name: label[1] });
          line = line.slice(label[0].length).trim();
          continue;
        }
        const sp = line.search(/\s/);
        lines.push({
          kind: "insn",
          mnem: (sp === -1 ? line : line.slice(0, sp)).toLowerCase(),
          rest: sp === -1 ? "" : line.slice(sp + 1).trim()
        });
        break;
      }
    }
    return lines;
  };
  var onePass = (lines, org, symbols, final) => {
    const pass = new Map(symbols);
    const defined = /* @__PURE__ */ new Set();
    const boundaries = /* @__PURE__ */ new Set();
    const targets = [];
    const out = [];
    const relocs = [];
    let pc = org;
    for (const line of lines) {
      if (line.kind === "label" || line.kind === "equ") {
        if (defined.has(line.name)) {
          throw new AsmError(
            `${JSON.stringify(line.name)} is defined twice -- branches to it would go to the later one`
          );
        }
        defined.add(line.name);
      }
      if (line.kind === "label") {
        pass.set(line.name, pc);
        continue;
      }
      if (line.kind === "equ") {
        pass.set(line.name, parseNum(line.expr, pass, final));
        continue;
      }
      boundaries.add(pc);
      let chunk;
      try {
        chunk = line.mnem === "db" || line.mnem === "dw" ? plain(encData(line.mnem, line.rest, pass, final)) : encode(line.mnem, splitOperands(line.rest), pass, pc, final, targets);
      } catch (err2) {
        if (!(err2 instanceof AsmError)) throw err2;
        throw new AsmError(`${line.mnem} ${line.rest}: ${err2.message}`);
      }
      if (final) {
        for (const r of chunk.relocs) relocs.push(pc - org + r);
        out.push(...chunk.bytes);
      }
      pc += chunk.bytes.length;
    }
    boundaries.add(pc);
    return { code: Uint8Array.from(out), relocs, symbols: pass, boundaries, targets };
  };
  var sameSymbols = (a, b) => a.size === b.size && [...a].every(([name, at2]) => b.get(name) === at2);
  var assemble = (source, org = 0) => {
    const lines = parseLines(source);
    let symbols = /* @__PURE__ */ new Map();
    let settled = false;
    for (let i2 = 0; i2 < 8 && !settled; i2++) {
      const next = onePass(lines, org, symbols, false).symbols;
      settled = sameSymbols(next, symbols);
      symbols = next;
    }
    if (!settled)
      throw new AsmError("instruction sizes did not settle -- a jump is oscillating");
    const final = onePass(lines, org, symbols, true);
    const moved = [...final.symbols].filter(([name, at2]) => symbols.get(name) !== at2).map(([name, at2]) => `${name} ${symbols.get(name)} -> ${at2}`);
    if (moved.length > 0) {
      const list = moved.join(", ");
      throw new AsmError(`labels moved during emission, so a branch would be wrong: ${list}`);
    }
    const stray = [...new Set(final.targets)].filter((t) => t >= org && t < org + final.code.length && !final.boundaries.has(t)).sort((a, b) => a - b);
    if (stray.length > 0) {
      const list = stray.map((t) => `0x${t.toString(16)}`).join(", ");
      throw new AsmError(`branch target(s) not on an instruction boundary: ${list}`);
    }
    return { code: final.code, relocs: final.relocs, symbols: final.symbols };
  };

  // core/bytes.ts
  var check = (b, off, width) => {
    if (!Number.isInteger(off) || off < 0 || off + width > b.length) {
      throw new RangeError(`offset ${off} (${width} bytes) outside 0..${b.length}`);
    }
  };
  var fits = (v, width) => {
    const max2 = width === 1 ? 255 : width === 2 ? 65535 : width === 3 ? 16777215 : 4294967295;
    if (!Number.isInteger(v) || v < 0 || v > max2) {
      throw new RangeError(`${v} does not fit in ${width} unsigned byte(s)`);
    }
  };
  var u16 = (b, off) => {
    check(b, off, 2);
    return b[off] | b[off + 1] << 8;
  };
  var u24 = (b, off) => {
    check(b, off, 3);
    return b[off] | b[off + 1] << 8 | b[off + 2] << 16;
  };
  var u16s = (b, off, n) => {
    const out = [];
    for (let i2 = 0; i2 < n; i2++) out.push(u16(b, off + i2 * 2));
    return out;
  };
  var setU16 = (b, off, v) => {
    check(b, off, 2);
    fits(v, 2);
    b[off] = v & 255;
    b[off + 1] = v >>> 8;
  };
  var setU16s = (b, off, values) => {
    values.forEach((v, i2) => setU16(b, off + i2 * 2, v));
  };
  var setU24 = (b, off, v) => {
    check(b, off, 3);
    fits(v, 3);
    b[off] = v & 255;
    b[off + 1] = v >>> 8 & 255;
    b[off + 2] = v >>> 16 & 255;
  };
  var setU32 = (b, off, v) => {
    check(b, off, 4);
    fits(v, 4);
    b[off] = v & 255;
    b[off + 1] = v >>> 8 & 255;
    b[off + 2] = v >>> 16 & 255;
    b[off + 3] = v >>> 24 & 255;
  };
  var packU32 = (v) => {
    const b = new Uint8Array(4);
    setU32(b, 0, v);
    return b;
  };
  var find = (hay, needle, from = 0) => {
    if (needle.length === 0) return Math.min(Math.max(from, 0), hay.length);
    const last = hay.length - needle.length;
    for (let i2 = Math.max(from, 0); i2 <= last; i2++) {
      let j = 0;
      while (j < needle.length && hay[i2 + j] === needle[j]) j++;
      if (j === needle.length) return i2;
    }
    return -1;
  };
  var findByte = (hay, byte, from = 0) => hay.indexOf(byte, from);
  var concat = (parts) => {
    let n = 0;
    for (const p of parts) n += p.length;
    const out = new Uint8Array(n);
    let at2 = 0;
    for (const p of parts) {
      out.set(p, at2);
      at2 += p.length;
    }
    return out;
  };
  var equal = (a, b) => {
    if (a.length !== b.length) return false;
    for (let i2 = 0; i2 < a.length; i2++) if (a[i2] !== b[i2]) return false;
    return true;
  };
  var fromLatin1 = (s) => {
    const out = new Uint8Array(s.length);
    for (let i2 = 0; i2 < s.length; i2++) {
      const c = s.charCodeAt(i2);
      if (c > 255)
        throw new RangeError(`U+${c.toString(16).toUpperCase()} is not a latin1 char`);
      out[i2] = c;
    }
    return out;
  };
  var hex = (b) => {
    let s = "";
    for (let i2 = 0; i2 < b.length; i2++) s += b[i2].toString(16).padStart(2, "0");
    return s;
  };

  // node_modules/@noble/hashes/utils.js
  function isBytes(a) {
    return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
  }
  function abytes(value, length, title = "") {
    const bytes = isBytes(value);
    const len = value?.length;
    const needsLen = length !== void 0;
    if (!bytes || needsLen && len !== length) {
      const prefix = title && `"${title}" `;
      const ofLen = needsLen ? ` of length ${length}` : "";
      const got = bytes ? `length=${len}` : `type=${typeof value}`;
      const message = prefix + "expected Uint8Array" + ofLen + ", got " + got;
      if (!bytes)
        throw new TypeError(message);
      throw new RangeError(message);
    }
    return value;
  }
  function aexists(instance, checkFinished = true) {
    if (instance.destroyed)
      throw new Error("Hash instance has been destroyed");
    if (checkFinished && instance.finished)
      throw new Error("Hash#digest() has already been called");
  }
  function aoutput(out, instance) {
    abytes(out, void 0, "digestInto() output");
    const min = instance.outputLen;
    if (out.length < min) {
      throw new RangeError('"digestInto() output" expected to be of length >=' + min);
    }
  }
  function clean(...arrays) {
    for (let i2 = 0; i2 < arrays.length; i2++) {
      arrays[i2].fill(0);
    }
  }
  function createView(arr) {
    return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
  }
  function rotr(word, shift) {
    return word << 32 - shift | word >>> shift;
  }
  var hasHexBuiltin = /* @__PURE__ */ (() => (
    // @ts-ignore
    typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function"
  ))();
  var hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i2) => i2.toString(16).padStart(2, "0"));
  function bytesToHex(bytes) {
    abytes(bytes);
    if (hasHexBuiltin)
      return bytes.toHex();
    let hex2 = "";
    for (let i2 = 0; i2 < bytes.length; i2++) {
      hex2 += hexes[bytes[i2]];
    }
    return hex2;
  }
  function createHasher(hashCons, info = {}) {
    const hashC = (msg, opts) => hashCons(opts).update(msg).digest();
    const tmp = hashCons(void 0);
    hashC.outputLen = tmp.outputLen;
    hashC.blockLen = tmp.blockLen;
    hashC.canXOF = tmp.canXOF;
    hashC.create = (opts) => hashCons(opts);
    Object.assign(hashC, info);
    return Object.freeze(hashC);
  }
  var oidNist = (suffix) => ({
    // Current NIST hashAlgs suffixes used here fit in one DER subidentifier octet.
    // Larger suffix values would need base-128 OID encoding and a different length byte.
    oid: Uint8Array.from([6, 9, 96, 134, 72, 1, 101, 3, 4, 2, suffix])
  });

  // node_modules/@noble/hashes/_md.js
  function Chi(a, b, c) {
    return a & b ^ ~a & c;
  }
  function Maj(a, b, c) {
    return a & b ^ a & c ^ b & c;
  }
  var HashMD = class {
    blockLen;
    outputLen;
    canXOF = false;
    padOffset;
    isLE;
    // For partial updates less than block size
    buffer;
    view;
    finished = false;
    length = 0;
    pos = 0;
    destroyed = false;
    constructor(blockLen, outputLen, padOffset, isLE) {
      this.blockLen = blockLen;
      this.outputLen = outputLen;
      this.padOffset = padOffset;
      this.isLE = isLE;
      this.buffer = new Uint8Array(blockLen);
      this.view = createView(this.buffer);
    }
    update(data) {
      aexists(this);
      abytes(data);
      const { view, buffer, blockLen } = this;
      const len = data.length;
      for (let pos = 0; pos < len; ) {
        const take = Math.min(blockLen - this.pos, len - pos);
        if (take === blockLen) {
          const dataView = createView(data);
          for (; blockLen <= len - pos; pos += blockLen)
            this.process(dataView, pos);
          continue;
        }
        buffer.set(data.subarray(pos, pos + take), this.pos);
        this.pos += take;
        pos += take;
        if (this.pos === blockLen) {
          this.process(view, 0);
          this.pos = 0;
        }
      }
      this.length += data.length;
      this.roundClean();
      return this;
    }
    digestInto(out) {
      aexists(this);
      aoutput(out, this);
      this.finished = true;
      const { buffer, view, blockLen, isLE } = this;
      let { pos } = this;
      buffer[pos++] = 128;
      clean(this.buffer.subarray(pos));
      if (this.padOffset > blockLen - pos) {
        this.process(view, 0);
        pos = 0;
      }
      for (let i2 = pos; i2 < blockLen; i2++)
        buffer[i2] = 0;
      view.setBigUint64(blockLen - 8, BigInt(this.length * 8), isLE);
      this.process(view, 0);
      const oview = createView(out);
      const len = this.outputLen;
      if (len % 4)
        throw new Error("_sha2: outputLen must be aligned to 32bit");
      const outLen = len / 4;
      const state = this.get();
      if (outLen > state.length)
        throw new Error("_sha2: outputLen bigger than state");
      for (let i2 = 0; i2 < outLen; i2++)
        oview.setUint32(4 * i2, state[i2], isLE);
    }
    digest() {
      const { buffer, outputLen } = this;
      this.digestInto(buffer);
      const res = buffer.slice(0, outputLen);
      this.destroy();
      return res;
    }
    _cloneInto(to) {
      to ||= new this.constructor();
      to.set(...this.get());
      const { blockLen, buffer, length, finished, destroyed, pos } = this;
      to.destroyed = destroyed;
      to.finished = finished;
      to.length = length;
      to.pos = pos;
      if (length % blockLen)
        to.buffer.set(buffer);
      return to;
    }
    clone() {
      return this._cloneInto();
    }
  };
  var SHA256_IV = /* @__PURE__ */ Uint32Array.from([
    1779033703,
    3144134277,
    1013904242,
    2773480762,
    1359893119,
    2600822924,
    528734635,
    1541459225
  ]);

  // node_modules/@noble/hashes/sha2.js
  var SHA256_K = /* @__PURE__ */ Uint32Array.from([
    1116352408,
    1899447441,
    3049323471,
    3921009573,
    961987163,
    1508970993,
    2453635748,
    2870763221,
    3624381080,
    310598401,
    607225278,
    1426881987,
    1925078388,
    2162078206,
    2614888103,
    3248222580,
    3835390401,
    4022224774,
    264347078,
    604807628,
    770255983,
    1249150122,
    1555081692,
    1996064986,
    2554220882,
    2821834349,
    2952996808,
    3210313671,
    3336571891,
    3584528711,
    113926993,
    338241895,
    666307205,
    773529912,
    1294757372,
    1396182291,
    1695183700,
    1986661051,
    2177026350,
    2456956037,
    2730485921,
    2820302411,
    3259730800,
    3345764771,
    3516065817,
    3600352804,
    4094571909,
    275423344,
    430227734,
    506948616,
    659060556,
    883997877,
    958139571,
    1322822218,
    1537002063,
    1747873779,
    1955562222,
    2024104815,
    2227730452,
    2361852424,
    2428436474,
    2756734187,
    3204031479,
    3329325298
  ]);
  var SHA256_W = /* @__PURE__ */ new Uint32Array(64);
  var SHA2_32B = class extends HashMD {
    constructor(outputLen) {
      super(64, outputLen, 8, false);
    }
    get() {
      const { A, B, C, D, E, F, G, H } = this;
      return [A, B, C, D, E, F, G, H];
    }
    // prettier-ignore
    set(A, B, C, D, E, F, G, H) {
      this.A = A | 0;
      this.B = B | 0;
      this.C = C | 0;
      this.D = D | 0;
      this.E = E | 0;
      this.F = F | 0;
      this.G = G | 0;
      this.H = H | 0;
    }
    process(view, offset) {
      for (let i2 = 0; i2 < 16; i2++, offset += 4)
        SHA256_W[i2] = view.getUint32(offset, false);
      for (let i2 = 16; i2 < 64; i2++) {
        const W15 = SHA256_W[i2 - 15];
        const W2 = SHA256_W[i2 - 2];
        const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
        const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
        SHA256_W[i2] = s1 + SHA256_W[i2 - 7] + s0 + SHA256_W[i2 - 16] | 0;
      }
      let { A, B, C, D, E, F, G, H } = this;
      for (let i2 = 0; i2 < 64; i2++) {
        const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
        const T1 = H + sigma1 + Chi(E, F, G) + SHA256_K[i2] + SHA256_W[i2] | 0;
        const sigma0 = rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22);
        const T2 = sigma0 + Maj(A, B, C) | 0;
        H = G;
        G = F;
        F = E;
        E = D + T1 | 0;
        D = C;
        C = B;
        B = A;
        A = T1 + T2 | 0;
      }
      A = A + this.A | 0;
      B = B + this.B | 0;
      C = C + this.C | 0;
      D = D + this.D | 0;
      E = E + this.E | 0;
      F = F + this.F | 0;
      G = G + this.G | 0;
      H = H + this.H | 0;
      this.set(A, B, C, D, E, F, G, H);
    }
    roundClean() {
      clean(SHA256_W);
    }
    destroy() {
      this.destroyed = true;
      this.set(0, 0, 0, 0, 0, 0, 0, 0);
      clean(this.buffer);
    }
  };
  var _SHA256 = class extends SHA2_32B {
    // We cannot use array here since array allows indexing by variable
    // which means optimizer/compiler cannot use registers.
    A = SHA256_IV[0] | 0;
    B = SHA256_IV[1] | 0;
    C = SHA256_IV[2] | 0;
    D = SHA256_IV[3] | 0;
    E = SHA256_IV[4] | 0;
    F = SHA256_IV[5] | 0;
    G = SHA256_IV[6] | 0;
    H = SHA256_IV[7] | 0;
    constructor() {
      super(32);
    }
  };
  var sha256 = /* @__PURE__ */ createHasher(
    () => new _SHA256(),
    /* @__PURE__ */ oidNist(1)
  );

  // core/sha256.ts
  var sha2562 = (data) => bytesToHex(sha256(data));

  // core/applyPatches.ts
  var KBU2_SHA256 = "a0ad8832b6a9afa7b28c7d0054a13e286d7952a558eaa12a38f6146e77339d49";
  var COLUMNS = ["type", "offset", "expect", "write"];
  var KINDS = ["bytes", "string", "reloc"];
  var OFFSET_RE = /^0x[0-9a-fA-F]+$/;
  var HEX_RE = /^[0-9a-fA-F]+$/;
  var DS_BASE = 87696;
  var POOL_DSOFF = 53248;
  var POOL_SIZE = 6144;
  var POOL_END_DSOFF = POOL_DSOFF + POOL_SIZE;
  var PROT_LO = 49120;
  var PROT_HI = 52391;
  var CODE_DSOFF = POOL_END_DSOFF;
  var STUB_AT = 63425;
  var STUB_END = 63684;
  var GATE_RESUME = 63744;
  var GATE_EXIT = 63865;
  var STUB_PAD = 144;
  var TABLES_DSOFF = 60416;
  var NAME_AT = 26448;
  var NAME_END = 26486;
  var NAME_REJECT = 26493;
  var FNAME_AT = 36832;
  var FNAME_PINNED = 36845;
  var FNAME_STORE = 36863;
  var hex16 = (v) => `0x${v.toString(16).padStart(4, "0")}`;
  var at = (v) => `0x${v.toString(16)}`;
  var stubSource = (dgroupPara) => `
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
  var nameSource = (keymap) => `
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
  var fnameSource = (translit) => `
    mov  bx,${hex16(translit)}
    xlat
    jmp  ${hex16(FNAME_STORE)}
`;
  var csvFields = (line, where) => {
    const fields = [];
    let field = "";
    let state = "start";
    for (const ch of line) {
      if (state === "quoted") {
        if (ch === '"') state = "closing";
        else field += ch;
      } else if (state === "closing" && ch === '"') {
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
  var encodeText = (text, label, column) => {
    const out = [];
    let lit = "";
    const flush = () => {
      if (lit === "") return;
      try {
        out.push(...encodeCp866(lit));
      } catch (err2) {
        const why = err2 instanceof Error ? err2.message : String(err2);
        throw new Error(`${label}: ${column} is not encodable in CP866 (${why})`);
      }
      lit = "";
    };
    let i2 = 0;
    while (i2 < text.length) {
      if (text[i2] !== "\\") {
        lit += text[i2];
        i2 += 1;
        continue;
      }
      const esc = text.slice(i2 + 1, i2 + 2);
      if (esc === "\\") {
        lit += "\\";
        i2 += 2;
      } else if (esc === "x") {
        const digits = text.slice(i2 + 2, i2 + 4);
        if (!/^[0-9a-fA-F]{2}$/.test(digits)) {
          throw new Error(
            `${label}: bad \\x escape in ${column} (${JSON.stringify(text.slice(i2, i2 + 4))} -- want \\xNN)`
          );
        }
        flush();
        out.push(Number.parseInt(digits, 16));
        i2 += 4;
      } else {
        throw new Error(
          `${label}: stray backslash in ${column} -- write \\\\ for a literal one, \\xNN for a raw byte`
        );
      }
    }
    flush();
    return Uint8Array.from(out);
  };
  var unhex = (text) => {
    const packed = text.replace(/ /g, "");
    const out = new Uint8Array(packed.length / 2);
    for (let i2 = 0; i2 < out.length; i2++)
      out[i2] = Number.parseInt(packed.slice(i2 * 2, i2 * 2 + 2), 16);
    return out;
  };
  var checkRow = (row) => {
    const { where, type, offset, expect, write } = row;
    if (!KINDS.includes(type)) {
      throw new Error(
        `${where}: type ${JSON.stringify(type)} -- want one of ${KINDS.join(", ")}`
      );
    }
    const toks = offset.split(/\s+/).filter((t) => t !== "");
    if (toks.length === 0) throw new Error(`${where}: offset is empty`);
    if (type !== "reloc" && toks.length > 1) {
      throw new Error(
        `${where}: ${toks.length} offsets, but only 'reloc' rows may list several`
      );
    }
    for (const tok of toks) {
      if (!OFFSET_RE.test(tok)) {
        throw new Error(
          `${where}: offset ${JSON.stringify(tok)} -- want 0x-prefixed hex, e.g. 0x0185e3`
        );
      }
    }
    if (expect === "") {
      throw new Error(
        `${where}: expect is empty -- it is what pins the row to the right bytes`
      );
    }
    if (type === "bytes") {
      for (const [column, value] of [
        ["expect", expect],
        ["write", write]
      ]) {
        const packed = value.replace(/ /g, "");
        if (packed === "" || !HEX_RE.test(packed) || packed.length % 2 !== 0) {
          throw new Error(
            `${where}: bytes ${column} ${JSON.stringify(value)} -- want whole hex bytes, e.g. "72" or "eb 0d 90"`
          );
        }
      }
    } else {
      encodeText(expect, where, "expect");
      encodeText(write, where, "write");
    }
  };
  var loadManifest = (text) => {
    const records = [];
    text.split(/\r\n|\n|\r/).forEach((raw, i2) => {
      if (raw.trim() === "" || raw.trimStart().startsWith("#")) return;
      const where = `patches.csv line ${i2 + 1}`;
      const fields = csvFields(raw, where);
      if (fields.length !== COLUMNS.length) {
        throw new Error(
          `${where}: ${fields.length} field(s), want ${COLUMNS.length} (${COLUMNS.join(",")})
       ${raw.trim()}`
        );
      }
      records.push({ where, fields });
    });
    const header = records.shift();
    if (header === void 0) throw new Error("the manifest holds no patches");
    if (!header.fields.every((f, i2) => f === COLUMNS[i2])) {
      throw new Error(
        `${header.where}: header is ${header.fields.join(",")}, want ${COLUMNS.join(",")}`
      );
    }
    if (records.length === 0) throw new Error("the manifest holds no patches");
    return records.map(({ where, fields }) => {
      const [type, offset, expect, write] = fields;
      const row = { where, type, offset, expect, write };
      checkRow(row);
      return row;
    });
  };
  var resolve = (row) => {
    const label = row.where;
    const offs = row.offset.split(/\s+/).filter((t) => t !== "").map((tok) => Number.parseInt(tok, 16));
    const kind = row.type;
    if (kind === "bytes") {
      const expect2 = unhex(row.expect);
      const payload = unhex(row.write);
      if (expect2.length !== payload.length) {
        throw new Error(
          `${label}: bytes expect/write differ in length (${expect2.length} vs ${payload.length})`
        );
      }
      return { kind, label, off: offs[0], expect: expect2, payload };
    }
    const expect = encodeText(row.expect, label, "expect");
    const text = encodeText(row.write, label, "write");
    if (kind === "string") {
      if (text.length > expect.length) {
        throw new Error(
          `${label}: translation is ${text.length}B but the slot holds ${expect.length}B -- use a 'reloc' row`
        );
      }
      return {
        kind,
        label,
        off: offs[0],
        expect,
        payload: concat([text, new Uint8Array(1)])
      };
    }
    for (const ref of offs) {
      if (ref >= PROT_LO && ref <= PROT_HI) {
        throw new Error(
          `${label}: reloc ref ${at(ref)} is inside the copy-protection block (${at(PROT_LO)}-${at(PROT_HI)}).
       That block is integrity-checked and retaliates on a delay -- the game runs, then hangs much later (INT 6 in the graphics loader).
       Use a 'string' row instead: the protection UI text all fits its original slot.`
        );
      }
    }
    return { kind, label, offs, expect, text: concat([text, new Uint8Array(1)]) };
  };
  var deref = (data, ref, label) => {
    if (ref + 2 > data.length)
      throw new Error(`${label}: ref ${at(ref)} is past the end of the image`);
    const dsoff = u16(data, ref);
    const src = DS_BASE + dsoff;
    const end = src < data.length ? findByte(data, 0, src) : -1;
    if (end === -1) {
      throw new Error(
        `${label}: ref ${at(ref)} points at DS ${hex16(dsoff)} (file ${at(src)}), which is not a NUL-terminated string`
      );
    }
    return { src, text: data.subarray(src, end) };
  };
  var checkRelocSources = (placed) => {
    const seen = /* @__PURE__ */ new Map();
    for (const p of placed) {
      const prev = seen.get(p.src);
      if (prev === void 0) {
        seen.set(p.src, p);
        continue;
      }
      const refs = [...prev.patch.offs, ...p.patch.offs].map((r) => at(r)).join(" ");
      throw new Error(
        `${p.patch.label} and ${prev.patch.label} both repoint the string at ${at(p.src)} (${JSON.stringify(decodeCp866(p.patch.expect))}).
       Merge them into one row listing every ref (offset column: "${refs}").`
      );
    }
  };
  var checkOverlaps = (spans) => {
    const sorted = [...spans].sort(
      (a, b) => a.off - b.off || a.payload.length - b.payload.length
    );
    for (let i2 = 1; i2 < sorted.length; i2++) {
      const a = sorted[i2 - 1];
      const b = sorted[i2];
      if (b.off < a.off + a.payload.length) {
        throw new Error(
          `patches overlap: ${JSON.stringify(a.label)} [${at(a.off)},${at(a.off + a.payload.length)}) and ${JSON.stringify(b.label)} [${at(b.off)},${at(b.off + b.payload.length)})`
        );
      }
    }
  };
  var mzRelocTable = (data) => ({
    count: u16(data, 6),
    hdr: u16(data, 8) * 16,
    tbl: u16(data, 24)
  });
  var relocTarget = (data, ent, hdr) => hdr + u16(data, ent + 2) * 16 + u16(data, ent);
  var setRelocEntry = (data, ent, target, hdr) => {
    const seg = Math.floor((target - hdr) / 16);
    if (seg > 65535)
      throw new Error(`relocation target ${at(target)} is past the addressable image`);
    setU16(data, ent, (target - hdr) % 16);
    setU16(data, ent + 2, seg);
  };
  var retargetRelocations = (data, lo, hi, sites) => {
    const { count, hdr, tbl } = mzRelocTable(data);
    const dead = [];
    for (let i2 = 0; i2 < count; i2++) {
      const ent = tbl + 4 * i2;
      const target = relocTarget(data, ent, hdr);
      if (target >= lo && target < hi) dead.push(ent);
    }
    if (dead.length > sites.length) {
      throw new Error(
        `${dead.length} relocation entries point into [${at(lo)},${at(hi)}) but the replacement has only ${sites.length} far calls to re-aim them at.
       Removing an entry means compacting the table, which this does not do.`
      );
    }
    const todo = [...sites];
    for (const ent of dead) setRelocEntry(data, ent, todo.shift(), hdr);
    const room = Math.floor((hdr - (tbl + 4 * count)) / 4);
    if (todo.length > room) {
      throw new Error(
        `${todo.length} new relocation entries needed but only ${room} free slots before the header ends -- growing the table would shift the whole image`
      );
    }
    todo.forEach((site, k) => setRelocEntry(data, tbl + 4 * (count + k), site, hdr));
    setU16(data, 6, count + todo.length);
    return { reaimed: dead.length, added: todo.length };
  };
  var checkRelocations = (orig, data) => {
    const now = mzRelocTable(data);
    const was = mzRelocTable(orig);
    if (now.hdr !== was.hdr || now.tbl !== was.tbl) {
      throw new Error("the MZ relocation table itself moved -- unsupported");
    }
    if (now.count < was.count) {
      throw new Error(
        `the relocation table shrank (${was.count} -> ${now.count}) -- unsupported`
      );
    }
    if (now.tbl + 4 * now.count > now.hdr) {
      throw new Error(
        `the relocation table (${now.count} entries) ran past the end of the header`
      );
    }
    const onFarCall = (target, what) => {
      if (data[target - 3] !== 154) {
        throw new Error(
          `${what} aims at ${at(target)}, which is not a far call's segment word (no 9a at ${at(target - 3)})`
        );
      }
    };
    for (let i2 = was.count; i2 < now.count; i2++) {
      onFarCall(
        relocTarget(data, now.tbl + 4 * i2, now.hdr),
        `appended relocation entry ${i2}`
      );
    }
    for (let i2 = 0; i2 < was.count; i2++) {
      const ent = now.tbl + 4 * i2;
      const target = relocTarget(data, ent, now.hdr);
      if (!equal(data.subarray(ent, ent + 4), orig.subarray(ent, ent + 4))) {
        onFarCall(target, `relocation entry ${i2} at ${at(ent)}, repointed,`);
      } else if (!equal(data.subarray(target, target + 2), orig.subarray(target, target + 2))) {
        throw new Error(
          `a patch changed the word at ${at(target)}, which relocation entry ${i2} (${at(ent)}) pins.
       DOS fixes up that word at load time: moving code out from under an entry
       breaks the call that moved AND corrupts what took its place. See 'NO CODE MOTION'
       in this module's header.`
        );
      }
    }
  };
  var assembled = (what, source, org) => {
    try {
      return assemble(source, org);
    } catch (err2) {
      throw new Error(`${what}: ${err2 instanceof Error ? err2.message : String(err2)}`);
    }
  };
  var padTo = (data, size) => {
    if (size <= data.length) return data;
    const out = new Uint8Array(size);
    out.set(data);
    return out;
  };
  var injectGatePicker = (image, source) => {
    const { code, relocs: codeRelocs } = assembled("gate picker", source, CODE_DSOFF);
    const { hdr } = mzRelocTable(image);
    if ((DS_BASE - hdr) % 16 !== 0) {
      throw new Error(
        `DGROUP is not paragraph-aligned (DS_BASE ${at(DS_BASE)}) -- the injected routine cannot be reached by a far call`
      );
    }
    const stubAsm = assembled("gate stub", stubSource((DS_BASE - hdr) / 16), STUB_AT);
    const stub = stubAsm.code;
    if (STUB_AT + stub.length > STUB_END) {
      throw new Error(
        `gate stub is ${stub.length}B but the block it replaces is ${STUB_END - STUB_AT}B`
      );
    }
    const codeAt = DS_BASE + CODE_DSOFF;
    if (image.length > codeAt) {
      throw new Error(
        `the overflow pool reached DS ${hex16(image.length - DS_BASE)}, past the code region at DS ${hex16(CODE_DSOFF)} -- lower POOL_SIZE or move CODE_DSOFF`
      );
    }
    const data = padTo(image, codeAt + code.length);
    data.set(stub, STUB_AT);
    data.fill(STUB_PAD, STUB_AT + stub.length, STUB_END);
    data.set(code, codeAt);
    const sites = [
      ...stubAsm.relocs.map((r) => STUB_AT + r),
      ...codeRelocs.map((r) => codeAt + r)
    ];
    for (const site of sites) {
      if (data[site - 3] !== 154) {
        throw new Error(`internal: reloc site ${at(site)} is not a far call's segment word`);
      }
    }
    const { reaimed, added } = retargetRelocations(data, STUB_AT, STUB_END, sites);
    return {
      image: data,
      gate: { code: code.length, stub: stub.length, sites: sites.length, reaimed, added }
    };
  };
  var injectNameTables = (image, source) => {
    const { code: tables, relocs, symbols } = assembled("name tables", source, TABLES_DSOFF);
    if (relocs.length > 0) {
      throw new Error(
        "name tables: data only -- a far call there would need its own relocation entry"
      );
    }
    const keymap = symbols.get("keymap");
    const translit = symbols.get("translit");
    if (keymap === void 0 || translit === void 0) {
      throw new Error("name tables: both a keymap: and a translit: label are needed");
    }
    const spans = [
      { name: "keymap", lo: keymap, hi: translit, want: 128 },
      { name: "translit", lo: translit, hi: TABLES_DSOFF + tables.length, want: 256 }
    ];
    for (const { name, lo, hi, want } of spans) {
      if (hi - lo !== want) {
        throw new Error(
          `name tables: ${name} spans ${hi - lo}B, want ${want}B -- it must cover its whole index range, 16 bytes to the row`
        );
      }
    }
    const tablesAt = DS_BASE + TABLES_DSOFF;
    if (image.length > tablesAt) {
      throw new Error(
        `the image reached DS ${hex16(image.length - DS_BASE)}, past the name tables at DS ${hex16(TABLES_DSOFF)} -- raise TABLES_DSOFF`
      );
    }
    const entry = assembled("name site", nameSource(keymap), NAME_AT).code;
    const fname = assembled("file name site", fnameSource(translit), FNAME_AT).code;
    if (NAME_AT + entry.length > NAME_END) {
      throw new Error(
        `the name entry block is ${entry.length}B but the accept path it replaces is ${NAME_END - NAME_AT}B`
      );
    }
    if (FNAME_AT + fname.length > FNAME_PINNED) {
      throw new Error(
        `the file name block is ${fname.length}B and would reach the relocation target at ${at(FNAME_PINNED)}`
      );
    }
    const data = padTo(image, tablesAt + tables.length);
    data.set(tables, tablesAt);
    data.set(entry, NAME_AT);
    data.fill(STUB_PAD, NAME_AT + entry.length, NAME_END);
    data.set(fname, FNAME_AT);
    return { image: data, names: { tables: tables.length, keymap, translit } };
  };
  var fixMzHeader = (data) => {
    setU16(data, 2, data.length % 512);
    setU16(data, 4, Math.ceil(data.length / 512));
  };
  var applyPatches = (inputs) => {
    const patches = loadManifest(inputs.patchesCsv).map(resolve);
    const digest = sha2562(inputs.base);
    if (digest !== KBU2_SHA256) {
      throw new Error(
        `the input is not pristine KBU2.EXE
       expected sha256 ${KBU2_SHA256}
       got             ${digest}`
      );
    }
    let data = new Uint8Array(inputs.base);
    for (const p of patches) {
      if (p.kind === "reloc") continue;
      const end = p.off + p.expect.length;
      const need = p.kind === "string" ? end + 1 : end;
      if (need > data.length) {
        throw new Error(
          `${p.label}: ${at(p.off)}+${p.expect.length}B runs past the end of the image (${data.length} bytes)`
        );
      }
      const got = data.subarray(p.off, end);
      if (!equal(got, p.expect)) {
        throw new Error(
          `${p.label}: expected ${hex(p.expect)} at ${at(p.off)}, found ${hex(got)}`
        );
      }
      if (p.kind === "string" && data[end] !== 0) {
        throw new Error(
          `${p.label}: original string at ${at(p.off)} is not NUL-terminated at its expected length`
        );
      }
    }
    for (const p of patches) if (p.kind === "bytes") data.set(p.payload, p.off);
    const relocs = patches.filter((p) => p.kind === "reloc");
    const placed = relocs.map((patch2) => {
      let src = null;
      for (const ref of patch2.offs) {
        const hit = deref(data, ref, patch2.label);
        if (!equal(hit.text, patch2.expect)) {
          throw new Error(
            `${patch2.label}: ref ${at(ref)} points at ${JSON.stringify(decodeCp866(hit.text))}, not ${JSON.stringify(decodeCp866(patch2.expect))}`
          );
        }
        if (src !== null && src !== hit.src) {
          throw new Error(
            `${patch2.label}: its refs point at different strings (${at(src)} and ${at(hit.src)}) -- one row per string`
          );
        }
        src = hit.src;
      }
      return { patch: patch2, src, inlined: patch2.text.length - 1 <= patch2.expect.length };
    });
    checkRelocSources(placed);
    const inplace = patches.filter((p) => p.kind !== "reloc").map((p) => ({ off: p.off, payload: p.payload, label: p.label }));
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
            `${p.patch.label}: overflow pool exhausted (need DS ${hex16(dsoff)}+${p.patch.text.length}B, cap ${hex16(POOL_END_DSOFF)})`
          );
        }
        const grown = padTo(data, data.length + p.patch.text.length);
        grown.set(p.patch.text, data.length);
        data = grown;
        for (const ref of p.patch.offs) setU16(data, ref, dsoff);
      }
    }
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
        names: tables.names
      }
    };
  };

  // core/unpackExepack.ts
  var STUB = 103248;
  var CORRUPT_MSG = "Packed file is corrupt";
  var unpackExepack = (packed) => {
    const [cblp, cp, , cparhdr] = u16s(packed, 2, 4);
    const img = packed.subarray(cparhdr * 16, (cp - 1) * 512 + cblp);
    const [realIp, realCs, , , realSp, realSs, destLen] = u16s(img, STUB, 8);
    if (!equal(img.subarray(STUB + 16, STUB + 18), fromLatin1("RB"))) {
      throw new Error(`EXEPACK 'RB' signature not found at 0x${(STUB + 16).toString(16)}`);
    }
    const dest = new Uint8Array(destLen * 16);
    dest.set(img.subarray(0, STUB));
    let src = STUB;
    while (src > 0 && img[src - 1] === 255) src--;
    let dst = dest.length;
    for (; ; ) {
      const cmd = img[src - 1];
      const length = img[src - 3] | img[src - 2] << 8;
      src -= 3;
      if ((cmd & 254) === 176) {
        const fill = img[src - 1];
        src -= 1;
        dest.fill(fill, dst - length, dst);
        dst -= length;
      } else if ((cmd & 254) === 178) {
        dest.copyWithin(dst - length, src - length, src);
        src -= length;
        dst -= length;
      } else {
        throw new Error(`bad EXEPACK opcode 0x${cmd.toString(16).padStart(2, "0")}`);
      }
      if (cmd & 1) break;
    }
    const msg = find(img, fromLatin1(CORRUPT_MSG));
    if (msg === -1)
      throw new Error(`"${CORRUPT_MSG}" not found; no EXEPACK relocation table`);
    let p = msg + CORRUPT_MSG.length;
    const relocs = [];
    for (let section = 0; section < 16; section++) {
      const count = u16(img, p);
      p += 2;
      for (let i2 = 0; i2 < count; i2++) {
        relocs.push({ seg: section * 4096, off: u16(img, p) });
        p += 2;
      }
    }
    const relocBytes = new Uint8Array(relocs.length * 4);
    relocs.forEach((r, i2) => setU16s(relocBytes, i2 * 4, [r.off, r.seg]));
    const hdrSize = Math.ceil((28 + relocBytes.length) / 512) * 512;
    const total = hdrSize + dest.length;
    const minalloc = Math.max(
      512,
      Math.floor((realSs * 16 + realSp - dest.length) / 16) + 512
    );
    const hdr = new Uint8Array(hdrSize);
    setU16s(hdr, 0, [
      23117,
      total % 512,
      Math.ceil(total / 512),
      relocs.length,
      hdrSize / 16,
      minalloc,
      65535,
      realSs,
      realSp,
      0,
      realIp,
      realCs,
      28,
      0
    ]);
    hdr.set(relocBytes, 28);
    return concat([hdr, dest]);
  };

  // core/lzw.ts
  var CLEAR = 256;
  var END = 257;
  var FIRST = 258;
  var MAXBITS = 12;
  var singles = Array.from({ length: 256 }, (_, i2) => Uint8Array.of(i2));
  var extend = (entry, byte) => {
    const grown = new Uint8Array(entry.length + 1);
    grown.set(entry);
    grown[entry.length] = byte;
    return grown;
  };
  var decodeLzw = (stream, declen) => {
    let out = new Uint8Array(Math.max(declen, 64));
    let len = 0;
    const emit = (entry) => {
      if (len + entry.length > out.length) {
        const grown = new Uint8Array(Math.max(out.length * 2, len + entry.length));
        grown.set(out.subarray(0, len));
        out = grown;
      }
      out.set(entry, len);
      len += entry.length;
    };
    let bitpos = 0;
    const total = stream.length * 8;
    const readCode = (width2) => {
      let val = 0;
      for (let i2 = 0; i2 < width2; i2++) {
        val |= (stream[bitpos >> 3] >> (bitpos & 7) & 1) << i2;
        bitpos++;
      }
      return val;
    };
    let width = 9;
    let table = singles.slice();
    let next = FIRST;
    let prev;
    while (len < declen && bitpos + width <= total) {
      const code = readCode(width);
      if (code === CLEAR) {
        width = 9;
        table = singles.slice();
        next = FIRST;
        prev = void 0;
        continue;
      }
      if (code === END) break;
      let entry;
      if (table[code] !== void 0) {
        entry = table[code];
      } else if (code === next && prev !== void 0) {
        entry = extend(prev, prev[0]);
      } else {
        break;
      }
      emit(entry);
      if (prev !== void 0) {
        table[next] = extend(prev, entry[0]);
        next++;
        if (next >= 1 << width && width < MAXBITS) width++;
      }
      prev = entry;
    }
    return out.subarray(0, len);
  };
  var encodeLzw = (data) => {
    const bits2 = [];
    let acc = 0;
    let nbits = 0;
    const emit = (code, width2) => {
      acc |= code << nbits;
      nbits += width2;
      while (nbits >= 8) {
        bits2.push(acc & 255);
        acc >>>= 8;
        nbits -= 8;
      }
    };
    let width = 9;
    const table = /* @__PURE__ */ new Map();
    let next = FIRST;
    emit(CLEAR, width);
    if (data.length > 0) {
      let prefix = data[0];
      for (let i2 = 1; i2 < data.length; i2++) {
        const byte = data[i2];
        const key = prefix * 256 + byte;
        const known = table.get(key);
        if (known !== void 0) {
          prefix = known;
          continue;
        }
        emit(prefix, width);
        table.set(key, next);
        next++;
        if (next > 1 << width && width < MAXBITS) width++;
        if (next > 1 << MAXBITS) {
          emit(CLEAR, width);
          width = 9;
          table.clear();
          next = FIRST;
        }
        prefix = byte;
      }
      emit(prefix, width);
    }
    emit(END, width);
    if (nbits > 0) bits2.push(acc & 255);
    return Uint8Array.from(bits2);
  };

  // core/unpackNwc.ts
  var BASE_PTR = 75;
  var KNOWN_IMAGE_SHA256 = "06ca56b4d1ca737b050178cd394cc9e52e9879c860dcf51c45ff457cc5236c4a";
  var MZ_MAGIC = 23117;
  var mzFields = (data, off) => {
    if (u16(data, off) !== MZ_MAGIC)
      throw new Error(`no MZ signature at 0x${off.toString(16)}`);
    return u16s(data, off, 14);
  };
  var unpackNwc = (kbExe) => {
    const outerCparhdr = mzFields(kbExe, 0)[4];
    const base = u16(kbExe, outerCparhdr * 16 + BASE_PTR);
    const [, cblp, cp, crlc, cparhdr, minalloc, maxalloc, ss, sp, , ip, cs] = mzFields(
      kbExe,
      base
    );
    if (crlc !== 0) {
      throw new Error(
        `inner EXE declares ${crlc} relocations; this unpacker only handles the relocation-free layout of the copy it was written for`
      );
    }
    const imgLen = (cp - 1) * 512 + cblp - cparhdr * 16;
    const image = decodeLzw(kbExe.subarray(base + cparhdr * 16), imgLen);
    if (image.length !== imgLen) {
      throw new Error(`LZW stream ended early: ${image.length} of ${imgLen} bytes`);
    }
    const digest = sha2562(image);
    const warnings = digest === KNOWN_IMAGE_SHA256 ? [] : [
      `unpacked image hash ${digest} differs from the known-good copy -- patches.csv offsets assume that build, and the patcher will refuse a mismatch`
    ];
    const total = 32 + image.length;
    const hdr = new Uint8Array(32);
    setU16s(hdr, 0, [
      MZ_MAGIC,
      total % 512,
      Math.ceil(total / 512),
      0,
      2,
      minalloc,
      maxalloc,
      ss,
      sp,
      0,
      ip,
      cs,
      28,
      0
    ]);
    return { image: concat([hdr, image]), warnings };
  };

  // web/screen.ts
  var WIDTH = 80;
  var GAP = "	";
  var MARKUP = /\{(\w+)\|([^}]*)\}/g;
  var DOUBLE = { side: "\u2551", bar: "\u2550", nw: "\u2554", ne: "\u2557", sw: "\u255A", se: "\u255D" };
  var SINGLE = { side: "\u2502", bar: "\u2500", nw: "\u250C", ne: "\u2510", sw: "\u2514", se: "\u2518" };
  var buildSpan = (className, text) => {
    const span = document.createElement("b");
    span.className = className;
    span.textContent = text;
    return span;
  };
  var widthOf = (cells) => cells.reduce(
    (total, cell) => total + (typeof cell === "string" ? cell : cell.textContent ?? "").length,
    0
  );
  var paintText = (text) => {
    const cells = [];
    const pushPlain = (plain2) => {
      for (const [index, piece] of plain2.split(GAP).entries()) {
        if (index > 0) cells.push(GAP);
        if (piece !== "") cells.push(piece);
      }
    };
    let at2 = 0;
    for (const match of text.matchAll(MARKUP)) {
      pushPlain(text.slice(at2, match.index));
      cells.push(buildSpan(match[1], match[2]));
      at2 = match.index + match[0].length;
    }
    pushPlain(text.slice(at2));
    return cells;
  };
  var buildRow = (side, ...cells) => {
    const [head, tail] = side === "" ? ["", ""] : [`${side} `, ` ${side}`];
    const groups = [[]];
    for (const cell of cells) {
      if (cell === GAP) groups.push([]);
      else groups[groups.length - 1].push(cell);
    }
    if (groups.length === 1) groups.push([]);
    const gaps = groups.length - 1;
    const free = Math.max(0, WIDTH - head.length - tail.length - widthOf(groups.flat()));
    const each = Math.floor(free / gaps);
    const row = document.createDocumentFragment();
    row.append(head);
    for (const [index, group] of groups.entries()) {
      if (index > 0) row.append(" ".repeat(index === gaps ? free - each * (gaps - 1) : each));
      row.append(...group);
    }
    row.append(tail, "\n");
    return row;
  };
  var drawBox = (target, frame, lines) => {
    const rule = (left, right) => `${left}${frame.bar.repeat(WIDTH - 2)}${right}
`;
    target.replaceChildren(
      rule(frame.nw, frame.ne),
      ...lines.map((line) => buildRow(frame.side, ...paintText(line))),
      rule(frame.sw, frame.se)
    );
  };
  var INTRO = [
    "{y|\u0420\u0443\u0441\u0441\u043A\u0430\u044F \u0432\u0435\u0440\u0441\u0438\u044F KING'S BOUNTY 1990 \u0434\u043B\u044F DOS}	{c|\u041F\u0435\u0440\u0435\u0432\u0435\u043B \u0410\u041B\u0415\u041A\u0421\u0410\u041D\u0414\u0420 \u0422\u042E\u041F\u0418\u041D}",
    "",
    "\u042D\u0442\u043E\u0442 \u043F\u0430\u0442\u0447\u0435\u0440 \u0441\u043E\u0431\u0438\u0440\u0430\u0435\u0442 \u0440\u0443\u0441\u0441\u043A\u0443\u044E \u0432\u0435\u0440\u0441\u0438\u044E \u0438\u0437 \u0432\u0430\u0448\u0435\u0439 \u043A\u043E\u043F\u0438\u0438 \u0438\u0433\u0440\u044B \u043F\u0440\u044F\u043C\u043E \u0432 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0435.",
    "",
    "1. \u041D\u0430\u0439\u0434\u0438\u0442\u0435 \u043E\u0440\u0438\u0433\u0438\u043D\u0430\u043B\u044C\u043D\u0443\u044E \u0432\u0435\u0440\u0441\u0438\u044E \u0438\u0433\u0440\u044B. \u041E\u043D\u0430 \u0432 \u0441\u0442\u0430\u0442\u0443\u0441\u0435 abandonware, \u0442\u0430\u043A \u0447\u0442\u043E \u044D\u0442\u043E",
    "   \u043D\u0435\u0442\u0440\u0443\u0434\u043D\u043E. \u042D\u0442\u043E \u0434\u043E\u043B\u0436\u0435\u043D \u0431\u044B\u0442\u044C ZIP-\u0430\u0440\u0445\u0438\u0432, \u0441 \u0444\u0430\u0439\u043B\u0430\u043C\u0438 {w|KB.EXE}, {w|256.CC} \u0438 {w|416.CC}.",
    "   \u041F\u043E\u0434\u043E\u0439\u0434\u0435\u0442 \u0442\u043E\u043B\u044C\u043A\u043E \u0432\u0435\u0440\u0441\u0438\u044F 1990 \u0433\u043E\u0434\u0430 \u0431\u0435\u0437 \u0441\u043D\u044F\u0442\u043E\u0439 \u0437\u0430\u0449\u0438\u0442\u044B.",
    "2. \u0417\u0430\u043A\u0438\u043D\u044C\u0442\u0435 \u0435\u0435 \u0432 \u043F\u0430\u0442\u0447\u0435\u0440 \u043D\u0438\u0436\u0435 \u0438 \u0443\u0431\u0435\u0434\u0438\u0442\u0435\u0441\u044C, \u0447\u0442\u043E \u0432\u0441\u0435 \u043F\u0440\u043E\u0448\u043B\u043E \u0445\u043E\u0440\u043E\u0448\u043E.",
    "3. \u0421\u043A\u0430\u0447\u0430\u0439\u0442\u0435 {w|kbr.zip}, \u0440\u0430\u0441\u043F\u0430\u043A\u0443\u0439\u0442\u0435 \u0438 \u0437\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u0435 {w|KBR.EXE} \u0447\u0435\u0440\u0435\u0437 DOSBox.",
    "",
    "NB: \u0438\u0433\u0440\u0430 \u0434\u0435\u043B\u0430\u043B\u0430\u0441\u044C \u043F\u043E\u0434 \u0443\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0441 \u0446\u0438\u0444\u0440\u043E\u0432\u043E\u0439 \u043A\u043B\u0430\u0432\u0438\u0430\u0442\u0443\u0440\u044B, \u0442\u0430\u043A \u0447\u0442\u043E \u0438\u043D\u043E\u0433\u0434\u0430 \u0442\u0430\u043C",
    "\u043D\u0443\u0436\u043D\u043E \u0445\u043E\u0434\u0438\u0442\u044C \u043F\u043E \u0434\u0438\u0430\u0433\u043E\u043D\u0430\u043B\u0438, \u043E\u0441\u043E\u0431\u0435\u043D\u043D\u043E \u0432 \u0431\u043E\u044E. \u0415\u0441\u043B\u0438 \u0443 \u0432\u0430\u0441 \u0442\u0430\u043A\u043E\u0433\u043E \u0431\u043E\u0433\u0430\u0442\u0441\u0442\u0432\u0430 \u043D\u0435\u0442,",
    "\u0442\u043E \u044D\u0442\u043E \u043D\u0435 \u0441\u0442\u0440\u0430\u0448\u043D\u043E \u2014 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0439\u0442\u0435 \u0446\u0438\u0444\u0440\u044B {w|1}, {w|3}, {w|7}, {w|9} \u2014 \u0431\u044B\u0441\u0442\u0440\u043E \u043F\u0440\u0438\u0432\u044B\u043A\u043D\u0435\u0442\u0435."
  ];
  var DROP = [
    "",
    "	\u041F\u0435\u0440\u0435\u0442\u0430\u0449\u0438\u0442\u0435 \u0441\u044E\u0434\u0430 ZIP \u0441\u043E \u0441\u0432\u043E\u0435\u0439 \u043A\u043E\u043F\u0438\u0435\u0439 \u0438\u0433\u0440\u044B	",
    "	\u0438\u043B\u0438 \u043D\u0430\u0436\u043C\u0438\u0442\u0435, \u0447\u0442\u043E\u0431\u044B \u0432\u044B\u0431\u0440\u0430\u0442\u044C \u0444\u0430\u0439\u043B	",
    ""
  ];
  var LOG_BADGES = { ok: "[OK]", err: "[!!]" };
  var introBox = document.getElementById("intro-box");
  var dropBox = document.getElementById("drop-box");
  var fileInput = document.getElementById("file-input");
  var logBox = document.getElementById("log-box");
  var downloadBox = document.getElementById("download-box");
  var wrapText = (text, width) => {
    const rows = [];
    let row = "";
    for (const word of text.split(" ")) {
      if (row === "") row = word;
      else if (row.length + 1 + word.length <= width) row += ` ${word}`;
      else {
        rows.push(row);
        row = word;
      }
      while (row.length > width) {
        rows.push(row.slice(0, width));
        row = row.slice(width);
      }
    }
    rows.push(row);
    return rows;
  };
  var logMessage = (text, kind = "ok") => {
    const badge = buildSpan(kind, LOG_BADGES[kind]);
    for (const [index, row] of wrapText(text, WIDTH - 5).entries()) {
      logBox.append(index === 0 ? buildRow("", badge, " ", row) : buildRow("", "     ", row));
    }
    logBox.hidden = false;
  };
  var clearScreen = () => {
    logBox.replaceChildren();
    logBox.hidden = true;
    downloadBox.hidden = true;
  };
  var showDownloadBox = (zip) => {
    downloadBox.href = URL.createObjectURL(
      new Blob([zip], { type: "application/zip" })
    );
    downloadBox.download = "kbr.zip";
    drawBox(downloadBox, SINGLE, ["", "	\u0421\u043A\u0430\u0447\u0430\u0442\u044C kbr.zip	", ""]);
    downloadBox.hidden = false;
  };
  var bindPicker = (onFile) => {
    const onPicked = (file) => {
      if (file != null) onFile(file);
    };
    dropBox.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      fileInput.value = "";
      onPicked(file);
    });
    dropBox.addEventListener("dragover", () => dropBox.classList.add("hot"));
    dropBox.addEventListener("dragleave", () => dropBox.classList.remove("hot"));
    dropBox.addEventListener("drop", (event) => {
      dropBox.classList.remove("hot");
      onPicked(event.dataTransfer?.files[0]);
    });
    window.addEventListener("dragover", (event) => event.preventDefault());
    window.addEventListener("drop", (event) => event.preventDefault());
  };
  drawBox(introBox, DOUBLE, INTRO);
  drawBox(dropBox, SINGLE, DROP);

  // node_modules/fflate/esm/browser.js
  var u8 = Uint8Array;
  var u162 = Uint16Array;
  var i32 = Int32Array;
  var fleb = new u8([
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    1,
    1,
    1,
    1,
    2,
    2,
    2,
    2,
    3,
    3,
    3,
    3,
    4,
    4,
    4,
    4,
    5,
    5,
    5,
    5,
    0,
    /* unused */
    0,
    0,
    /* impossible */
    0
  ]);
  var fdeb = new u8([
    0,
    0,
    0,
    0,
    1,
    1,
    2,
    2,
    3,
    3,
    4,
    4,
    5,
    5,
    6,
    6,
    7,
    7,
    8,
    8,
    9,
    9,
    10,
    10,
    11,
    11,
    12,
    12,
    13,
    13,
    /* unused */
    0,
    0
  ]);
  var clim = new u8([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
  var freb = function(eb, start) {
    var b = new u162(31);
    for (var i2 = 0; i2 < 31; ++i2) {
      b[i2] = start += 1 << eb[i2 - 1];
    }
    var r = new i32(b[30]);
    for (var i2 = 1; i2 < 30; ++i2) {
      for (var j = b[i2]; j < b[i2 + 1]; ++j) {
        r[j] = j - b[i2] << 5 | i2;
      }
    }
    return { b, r };
  };
  var _a = freb(fleb, 2);
  var fl = _a.b;
  var revfl = _a.r;
  fl[28] = 258, revfl[258] = 28;
  var _b = freb(fdeb, 0);
  var fd = _b.b;
  var revfd = _b.r;
  var rev = new u162(32768);
  for (i = 0; i < 32768; ++i) {
    x = (i & 43690) >> 1 | (i & 21845) << 1;
    x = (x & 52428) >> 2 | (x & 13107) << 2;
    x = (x & 61680) >> 4 | (x & 3855) << 4;
    rev[i] = ((x & 65280) >> 8 | (x & 255) << 8) >> 1;
  }
  var x;
  var i;
  var hMap = (function(cd, mb, r) {
    var s = cd.length;
    var i2 = 0;
    var l = new u162(mb);
    for (; i2 < s; ++i2) {
      if (cd[i2])
        ++l[cd[i2] - 1];
    }
    var le = new u162(mb);
    for (i2 = 1; i2 < mb; ++i2) {
      le[i2] = le[i2 - 1] + l[i2 - 1] << 1;
    }
    var co;
    if (r) {
      co = new u162(1 << mb);
      var rvb = 15 - mb;
      for (i2 = 0; i2 < s; ++i2) {
        if (cd[i2]) {
          var sv = i2 << 4 | cd[i2];
          var r_1 = mb - cd[i2];
          var v = le[cd[i2] - 1]++ << r_1;
          for (var m = v | (1 << r_1) - 1; v <= m; ++v) {
            co[rev[v] >> rvb] = sv;
          }
        }
      }
    } else {
      co = new u162(s);
      for (i2 = 0; i2 < s; ++i2) {
        if (cd[i2]) {
          co[i2] = rev[le[cd[i2] - 1]++] >> 15 - cd[i2];
        }
      }
    }
    return co;
  });
  var flt = new u8(288);
  for (i = 0; i < 144; ++i)
    flt[i] = 8;
  var i;
  for (i = 144; i < 256; ++i)
    flt[i] = 9;
  var i;
  for (i = 256; i < 280; ++i)
    flt[i] = 7;
  var i;
  for (i = 280; i < 288; ++i)
    flt[i] = 8;
  var i;
  var fdt = new u8(32);
  for (i = 0; i < 32; ++i)
    fdt[i] = 5;
  var i;
  var flm = /* @__PURE__ */ hMap(flt, 9, 0);
  var flrm = /* @__PURE__ */ hMap(flt, 9, 1);
  var fdm = /* @__PURE__ */ hMap(fdt, 5, 0);
  var fdrm = /* @__PURE__ */ hMap(fdt, 5, 1);
  var max = function(a) {
    var m = a[0];
    for (var i2 = 1; i2 < a.length; ++i2) {
      if (a[i2] > m)
        m = a[i2];
    }
    return m;
  };
  var bits = function(d, p, m) {
    var o = p / 8 | 0;
    return (d[o] | d[o + 1] << 8) >> (p & 7) & m;
  };
  var bits16 = function(d, p) {
    var o = p / 8 | 0;
    return (d[o] | d[o + 1] << 8 | d[o + 2] << 16) >> (p & 7);
  };
  var shft = function(p) {
    return (p + 7) / 8 | 0;
  };
  var slc = function(v, s, e) {
    if (s == null || s < 0)
      s = 0;
    if (e == null || e > v.length)
      e = v.length;
    return new u8(v.subarray(s, e));
  };
  var ec = [
    "unexpected EOF",
    "invalid block type",
    "invalid length/literal",
    "invalid distance",
    "stream finished",
    "no stream handler",
    ,
    // determined by compression function
    "no callback",
    "invalid UTF-8 data",
    "extra field too long",
    "date not in range 1980-2099",
    "filename too long",
    "stream finishing",
    "invalid zip data"
    // determined by unknown compression method
  ];
  var err = function(ind, msg, nt) {
    var e = new Error(msg || ec[ind]);
    e.code = ind;
    if (Error.captureStackTrace)
      Error.captureStackTrace(e, err);
    if (!nt)
      throw e;
    return e;
  };
  var inflt = function(dat, st, buf, dict) {
    var sl = dat.length, dl = dict ? dict.length : 0;
    if (!sl || st.f && !st.l)
      return buf || new u8(0);
    var noBuf = !buf;
    var resize = noBuf || st.i != 2;
    var noSt = st.i;
    if (noBuf)
      buf = new u8(sl * 3);
    var cbuf = function(l2) {
      var bl = buf.length;
      if (l2 > bl) {
        var nbuf = new u8(Math.max(bl * 2, l2));
        nbuf.set(buf);
        buf = nbuf;
      }
    };
    var final = st.f || 0, pos = st.p || 0, bt = st.b || 0, lm = st.l, dm = st.d, lbt = st.m, dbt = st.n;
    var tbts = sl * 8;
    do {
      if (!lm) {
        final = bits(dat, pos, 1);
        var type = bits(dat, pos + 1, 3);
        pos += 3;
        if (!type) {
          var s = shft(pos) + 4, l = dat[s - 4] | dat[s - 3] << 8, t = s + l;
          if (t > sl) {
            if (noSt)
              err(0);
            break;
          }
          if (resize)
            cbuf(bt + l);
          buf.set(dat.subarray(s, t), bt);
          st.b = bt += l, st.p = pos = t * 8, st.f = final;
          continue;
        } else if (type == 1)
          lm = flrm, dm = fdrm, lbt = 9, dbt = 5;
        else if (type == 2) {
          var hLit = bits(dat, pos, 31) + 257, hcLen = bits(dat, pos + 10, 15) + 4;
          var tl = hLit + bits(dat, pos + 5, 31) + 1;
          pos += 14;
          var ldt = new u8(tl);
          var clt = new u8(19);
          for (var i2 = 0; i2 < hcLen; ++i2) {
            clt[clim[i2]] = bits(dat, pos + i2 * 3, 7);
          }
          pos += hcLen * 3;
          var clb = max(clt), clbmsk = (1 << clb) - 1;
          var clm = hMap(clt, clb, 1);
          for (var i2 = 0; i2 < tl; ) {
            var r = clm[bits(dat, pos, clbmsk)];
            pos += r & 15;
            var s = r >> 4;
            if (s < 16) {
              ldt[i2++] = s;
            } else {
              var c = 0, n = 0;
              if (s == 16)
                n = 3 + bits(dat, pos, 3), pos += 2, c = ldt[i2 - 1];
              else if (s == 17)
                n = 3 + bits(dat, pos, 7), pos += 3;
              else if (s == 18)
                n = 11 + bits(dat, pos, 127), pos += 7;
              while (n--)
                ldt[i2++] = c;
            }
          }
          var lt = ldt.subarray(0, hLit), dt = ldt.subarray(hLit);
          lbt = max(lt);
          dbt = max(dt);
          lm = hMap(lt, lbt, 1);
          dm = hMap(dt, dbt, 1);
        } else
          err(1);
        if (pos > tbts) {
          if (noSt)
            err(0);
          break;
        }
      }
      if (resize)
        cbuf(bt + 131072);
      var lms = (1 << lbt) - 1, dms = (1 << dbt) - 1;
      var lpos = pos;
      for (; ; lpos = pos) {
        var c = lm[bits16(dat, pos) & lms], sym = c >> 4;
        pos += c & 15;
        if (pos > tbts) {
          if (noSt)
            err(0);
          break;
        }
        if (!c)
          err(2);
        if (sym < 256)
          buf[bt++] = sym;
        else if (sym == 256) {
          lpos = pos, lm = null;
          break;
        } else {
          var add = sym - 254;
          if (sym > 264) {
            var i2 = sym - 257, b = fleb[i2];
            add = bits(dat, pos, (1 << b) - 1) + fl[i2];
            pos += b;
          }
          var d = dm[bits16(dat, pos) & dms], dsym = d >> 4;
          if (!d)
            err(3);
          pos += d & 15;
          var dt = fd[dsym];
          if (dsym > 3) {
            var b = fdeb[dsym];
            dt += bits16(dat, pos) & (1 << b) - 1, pos += b;
          }
          if (pos > tbts) {
            if (noSt)
              err(0);
            break;
          }
          if (resize)
            cbuf(bt + 131072);
          var end = bt + add;
          if (bt < dt) {
            var shift = dl - dt, dend = Math.min(dt, end);
            if (shift + bt < 0)
              err(3);
            for (; bt < dend; ++bt)
              buf[bt] = dict[shift + bt];
          }
          for (; bt < end; ++bt)
            buf[bt] = buf[bt - dt];
        }
      }
      st.l = lm, st.p = lpos, st.b = bt, st.f = final;
      if (lm)
        final = 1, st.m = lbt, st.d = dm, st.n = dbt;
    } while (!final);
    return bt != buf.length && noBuf ? slc(buf, 0, bt) : buf.subarray(0, bt);
  };
  var wbits = function(d, p, v) {
    v <<= p & 7;
    var o = p / 8 | 0;
    d[o] |= v;
    d[o + 1] |= v >> 8;
  };
  var wbits16 = function(d, p, v) {
    v <<= p & 7;
    var o = p / 8 | 0;
    d[o] |= v;
    d[o + 1] |= v >> 8;
    d[o + 2] |= v >> 16;
  };
  var hTree = function(d, mb) {
    var t = [];
    for (var i2 = 0; i2 < d.length; ++i2) {
      if (d[i2])
        t.push({ s: i2, f: d[i2] });
    }
    var s = t.length;
    var t2 = t.slice();
    if (!s)
      return { t: et, l: 0 };
    if (s == 1) {
      var v = new u8(t[0].s + 1);
      v[t[0].s] = 1;
      return { t: v, l: 1 };
    }
    t.sort(function(a, b) {
      return a.f - b.f;
    });
    t.push({ s: -1, f: 25001 });
    var l = t[0], r = t[1], i0 = 0, i1 = 1, i22 = 2;
    t[0] = { s: -1, f: l.f + r.f, l, r };
    while (i1 != s - 1) {
      l = t[t[i0].f < t[i22].f ? i0++ : i22++];
      r = t[i0 != i1 && t[i0].f < t[i22].f ? i0++ : i22++];
      t[i1++] = { s: -1, f: l.f + r.f, l, r };
    }
    var maxSym = t2[0].s;
    for (var i2 = 1; i2 < s; ++i2) {
      if (t2[i2].s > maxSym)
        maxSym = t2[i2].s;
    }
    var tr = new u162(maxSym + 1);
    var mbt = ln(t[i1 - 1], tr, 0);
    if (mbt > mb) {
      var i2 = 0, dt = 0;
      var lft = mbt - mb, cst = 1 << lft;
      t2.sort(function(a, b) {
        return tr[b.s] - tr[a.s] || a.f - b.f;
      });
      for (; i2 < s; ++i2) {
        var i2_1 = t2[i2].s;
        if (tr[i2_1] > mb) {
          dt += cst - (1 << mbt - tr[i2_1]);
          tr[i2_1] = mb;
        } else
          break;
      }
      dt >>= lft;
      while (dt > 0) {
        var i2_2 = t2[i2].s;
        if (tr[i2_2] < mb)
          dt -= 1 << mb - tr[i2_2]++ - 1;
        else
          ++i2;
      }
      for (; i2 >= 0 && dt; --i2) {
        var i2_3 = t2[i2].s;
        if (tr[i2_3] == mb) {
          --tr[i2_3];
          ++dt;
        }
      }
      mbt = mb;
    }
    return { t: new u8(tr), l: mbt };
  };
  var ln = function(n, l, d) {
    return n.s == -1 ? Math.max(ln(n.l, l, d + 1), ln(n.r, l, d + 1)) : l[n.s] = d;
  };
  var lc = function(c) {
    var s = c.length;
    while (s && !c[--s])
      ;
    var cl = new u162(++s);
    var cli = 0, cln = c[0], cls = 1;
    var w = function(v) {
      cl[cli++] = v;
    };
    for (var i2 = 1; i2 <= s; ++i2) {
      if (c[i2] == cln && i2 != s)
        ++cls;
      else {
        if (!cln && cls > 2) {
          for (; cls > 138; cls -= 138)
            w(32754);
          if (cls > 2) {
            w(cls > 10 ? cls - 11 << 5 | 28690 : cls - 3 << 5 | 12305);
            cls = 0;
          }
        } else if (cls > 3) {
          w(cln), --cls;
          for (; cls > 6; cls -= 6)
            w(8304);
          if (cls > 2)
            w(cls - 3 << 5 | 8208), cls = 0;
        }
        while (cls--)
          w(cln);
        cls = 1;
        cln = c[i2];
      }
    }
    return { c: cl.subarray(0, cli), n: s };
  };
  var clen = function(cf, cl) {
    var l = 0;
    for (var i2 = 0; i2 < cl.length; ++i2)
      l += cf[i2] * cl[i2];
    return l;
  };
  var wfblk = function(out, pos, dat) {
    var s = dat.length;
    var o = shft(pos + 2);
    out[o] = s & 255;
    out[o + 1] = s >> 8;
    out[o + 2] = out[o] ^ 255;
    out[o + 3] = out[o + 1] ^ 255;
    for (var i2 = 0; i2 < s; ++i2)
      out[o + i2 + 4] = dat[i2];
    return (o + 4 + s) * 8;
  };
  var wblk = function(dat, out, final, syms, lf, df, eb, li, bs, bl, p) {
    wbits(out, p++, final);
    ++lf[256];
    var _a2 = hTree(lf, 15), dlt = _a2.t, mlb = _a2.l;
    var _b2 = hTree(df, 15), ddt = _b2.t, mdb = _b2.l;
    var _c = lc(dlt), lclt = _c.c, nlc = _c.n;
    var _d = lc(ddt), lcdt = _d.c, ndc = _d.n;
    var lcfreq = new u162(19);
    for (var i2 = 0; i2 < lclt.length; ++i2)
      ++lcfreq[lclt[i2] & 31];
    for (var i2 = 0; i2 < lcdt.length; ++i2)
      ++lcfreq[lcdt[i2] & 31];
    var _e = hTree(lcfreq, 7), lct = _e.t, mlcb = _e.l;
    var nlcc = 19;
    for (; nlcc > 4 && !lct[clim[nlcc - 1]]; --nlcc)
      ;
    var flen = bl + 5 << 3;
    var ftlen = clen(lf, flt) + clen(df, fdt) + eb;
    var dtlen = clen(lf, dlt) + clen(df, ddt) + eb + 14 + 3 * nlcc + clen(lcfreq, lct) + 2 * lcfreq[16] + 3 * lcfreq[17] + 7 * lcfreq[18];
    if (bs >= 0 && flen <= ftlen && flen <= dtlen)
      return wfblk(out, p, dat.subarray(bs, bs + bl));
    var lm, ll, dm, dl;
    wbits(out, p, 1 + (dtlen < ftlen)), p += 2;
    if (dtlen < ftlen) {
      lm = hMap(dlt, mlb, 0), ll = dlt, dm = hMap(ddt, mdb, 0), dl = ddt;
      var llm = hMap(lct, mlcb, 0);
      wbits(out, p, nlc - 257);
      wbits(out, p + 5, ndc - 1);
      wbits(out, p + 10, nlcc - 4);
      p += 14;
      for (var i2 = 0; i2 < nlcc; ++i2)
        wbits(out, p + 3 * i2, lct[clim[i2]]);
      p += 3 * nlcc;
      var lcts = [lclt, lcdt];
      for (var it = 0; it < 2; ++it) {
        var clct = lcts[it];
        for (var i2 = 0; i2 < clct.length; ++i2) {
          var len = clct[i2] & 31;
          wbits(out, p, llm[len]), p += lct[len];
          if (len > 15)
            wbits(out, p, clct[i2] >> 5 & 127), p += clct[i2] >> 12;
        }
      }
    } else {
      lm = flm, ll = flt, dm = fdm, dl = fdt;
    }
    for (var i2 = 0; i2 < li; ++i2) {
      var sym = syms[i2];
      if (sym > 255) {
        var len = sym >> 18 & 31;
        wbits16(out, p, lm[len + 257]), p += ll[len + 257];
        if (len > 7)
          wbits(out, p, sym >> 23 & 31), p += fleb[len];
        var dst = sym & 31;
        wbits16(out, p, dm[dst]), p += dl[dst];
        if (dst > 3)
          wbits16(out, p, sym >> 5 & 8191), p += fdeb[dst];
      } else {
        wbits16(out, p, lm[sym]), p += ll[sym];
      }
    }
    wbits16(out, p, lm[256]);
    return p + ll[256];
  };
  var deo = /* @__PURE__ */ new i32([65540, 131080, 131088, 131104, 262176, 1048704, 1048832, 2114560, 2117632]);
  var et = /* @__PURE__ */ new u8(0);
  var dflt = function(dat, lvl, plvl, pre, post, st) {
    var s = st.z || dat.length;
    var o = new u8(pre + s + 5 * (1 + Math.ceil(s / 7e3)) + post);
    var w = o.subarray(pre, o.length - post);
    var lst = st.l;
    var pos = (st.r || 0) & 7;
    if (lvl) {
      if (pos)
        w[0] = st.r >> 3;
      var opt = deo[lvl - 1];
      var n = opt >> 13, c = opt & 8191;
      var msk_1 = (1 << plvl) - 1;
      var prev = st.p || new u162(32768), head = st.h || new u162(msk_1 + 1);
      var bs1_1 = Math.ceil(plvl / 3), bs2_1 = 2 * bs1_1;
      var hsh = function(i3) {
        return (dat[i3] ^ dat[i3 + 1] << bs1_1 ^ dat[i3 + 2] << bs2_1) & msk_1;
      };
      var syms = new i32(25e3);
      var lf = new u162(288), df = new u162(32);
      var lc_1 = 0, eb = 0, i2 = st.i || 0, li = 0, wi = st.w || 0, bs = 0;
      for (; i2 + 2 < s; ++i2) {
        var hv = hsh(i2);
        var imod = i2 & 32767, pimod = head[hv];
        prev[imod] = pimod;
        head[hv] = imod;
        if (wi <= i2) {
          var rem = s - i2;
          if ((lc_1 > 7e3 || li > 24576) && (rem > 423 || !lst)) {
            pos = wblk(dat, w, 0, syms, lf, df, eb, li, bs, i2 - bs, pos);
            li = lc_1 = eb = 0, bs = i2;
            for (var j = 0; j < 286; ++j)
              lf[j] = 0;
            for (var j = 0; j < 30; ++j)
              df[j] = 0;
          }
          var l = 2, d = 0, ch_1 = c, dif = imod - pimod & 32767;
          if (rem > 2 && hv == hsh(i2 - dif)) {
            var maxn = Math.min(n, rem) - 1;
            var maxd = Math.min(32767, i2);
            var ml = Math.min(258, rem);
            while (dif <= maxd && --ch_1 && imod != pimod) {
              if (dat[i2 + l] == dat[i2 + l - dif]) {
                var nl = 0;
                for (; nl < ml && dat[i2 + nl] == dat[i2 + nl - dif]; ++nl)
                  ;
                if (nl > l) {
                  l = nl, d = dif;
                  if (nl > maxn)
                    break;
                  var mmd = Math.min(dif, nl - 2);
                  var md = 0;
                  for (var j = 0; j < mmd; ++j) {
                    var ti = i2 - dif + j & 32767;
                    var pti = prev[ti];
                    var cd = ti - pti & 32767;
                    if (cd > md)
                      md = cd, pimod = ti;
                  }
                }
              }
              imod = pimod, pimod = prev[imod];
              dif += imod - pimod & 32767;
            }
          }
          if (d) {
            syms[li++] = 268435456 | revfl[l] << 18 | revfd[d];
            var lin = revfl[l] & 31, din = revfd[d] & 31;
            eb += fleb[lin] + fdeb[din];
            ++lf[257 + lin];
            ++df[din];
            wi = i2 + l;
            ++lc_1;
          } else {
            syms[li++] = dat[i2];
            ++lf[dat[i2]];
          }
        }
      }
      for (i2 = Math.max(i2, wi); i2 < s; ++i2) {
        syms[li++] = dat[i2];
        ++lf[dat[i2]];
      }
      pos = wblk(dat, w, lst, syms, lf, df, eb, li, bs, i2 - bs, pos);
      if (!lst) {
        st.r = pos & 7 | w[pos / 8 | 0] << 3;
        pos -= 7;
        st.h = head, st.p = prev, st.i = i2, st.w = wi;
      }
    } else {
      for (var i2 = st.w || 0; i2 < s + lst; i2 += 65535) {
        var e = i2 + 65535;
        if (e >= s) {
          w[pos / 8 | 0] = lst;
          e = s;
        }
        pos = wfblk(w, pos + 1, dat.subarray(i2, e));
      }
      st.i = s;
    }
    return slc(o, 0, pre + shft(pos) + post);
  };
  var crct = /* @__PURE__ */ (function() {
    var t = new Int32Array(256);
    for (var i2 = 0; i2 < 256; ++i2) {
      var c = i2, k = 9;
      while (--k)
        c = (c & 1 && -306674912) ^ c >>> 1;
      t[i2] = c;
    }
    return t;
  })();
  var crc = function() {
    var c = -1;
    return {
      p: function(d) {
        var cr = c;
        for (var i2 = 0; i2 < d.length; ++i2)
          cr = crct[cr & 255 ^ d[i2]] ^ cr >>> 8;
        c = cr;
      },
      d: function() {
        return ~c;
      }
    };
  };
  var dopt = function(dat, opt, pre, post, st) {
    if (!st) {
      st = { l: 1 };
      if (opt.dictionary) {
        var dict = opt.dictionary.subarray(-32768);
        var newDat = new u8(dict.length + dat.length);
        newDat.set(dict);
        newDat.set(dat, dict.length);
        dat = newDat;
        st.w = dict.length;
      }
    }
    return dflt(dat, opt.level == null ? 6 : opt.level, opt.mem == null ? st.l ? Math.ceil(Math.max(8, Math.min(13, Math.log(dat.length))) * 1.5) : 20 : 12 + opt.mem, pre, post, st);
  };
  var mrg = function(a, b) {
    var o = {};
    for (var k in a)
      o[k] = a[k];
    for (var k in b)
      o[k] = b[k];
    return o;
  };
  var b2 = function(d, b) {
    return d[b] | d[b + 1] << 8;
  };
  var b4 = function(d, b) {
    return (d[b] | d[b + 1] << 8 | d[b + 2] << 16 | d[b + 3] << 24) >>> 0;
  };
  var b8 = function(d, b) {
    return b4(d, b) + b4(d, b + 4) * 4294967296;
  };
  var wbytes = function(d, b, v) {
    for (; v; ++b)
      d[b] = v, v >>>= 8;
  };
  function deflateSync(data, opts) {
    return dopt(data, opts || {}, 0, 0);
  }
  function inflateSync(data, opts) {
    return inflt(data, { i: 2 }, opts && opts.out, opts && opts.dictionary);
  }
  var fltn = function(d, p, t, o) {
    for (var k in d) {
      var val = d[k], n = p + k, op = o;
      if (Array.isArray(val))
        op = mrg(o, val[1]), val = val[0];
      if (ArrayBuffer.isView(val))
        t[n] = [val, op];
      else {
        t[n += "/"] = [new u8(0), op];
        fltn(val, n, t, o);
      }
    }
  };
  var te = typeof TextEncoder != "undefined" && /* @__PURE__ */ new TextEncoder();
  var td = typeof TextDecoder != "undefined" && /* @__PURE__ */ new TextDecoder();
  var tds = 0;
  try {
    td.decode(et, { stream: true });
    tds = 1;
  } catch (e) {
  }
  var dutf8 = function(d) {
    for (var r = "", i2 = 0; ; ) {
      var c = d[i2++];
      var eb = (c > 127) + (c > 223) + (c > 239);
      if (i2 + eb > d.length)
        return { s: r, r: slc(d, i2 - 1) };
      if (!eb)
        r += String.fromCharCode(c);
      else if (eb == 3) {
        c = ((c & 15) << 18 | (d[i2++] & 63) << 12 | (d[i2++] & 63) << 6 | d[i2++] & 63) - 65536, r += String.fromCharCode(55296 | c >> 10, 56320 | c & 1023);
      } else if (eb & 1)
        r += String.fromCharCode((c & 31) << 6 | d[i2++] & 63);
      else
        r += String.fromCharCode((c & 15) << 12 | (d[i2++] & 63) << 6 | d[i2++] & 63);
    }
  };
  function strToU8(str, latin1) {
    if (latin1) {
      var ar_1 = new u8(str.length);
      for (var i2 = 0; i2 < str.length; ++i2)
        ar_1[i2] = str.charCodeAt(i2);
      return ar_1;
    }
    if (te)
      return te.encode(str);
    var l = str.length;
    var ar = new u8(str.length + (str.length >> 1));
    var ai = 0;
    var w = function(v) {
      ar[ai++] = v;
    };
    for (var i2 = 0; i2 < l; ++i2) {
      if (ai + 5 > ar.length) {
        var n = new u8(ai + 8 + (l - i2 << 1));
        n.set(ar);
        ar = n;
      }
      var c = str.charCodeAt(i2);
      if (c < 128 || latin1)
        w(c);
      else if (c < 2048)
        w(192 | c >> 6), w(128 | c & 63);
      else if (c > 55295 && c < 57344)
        c = 65536 + (c & 1023 << 10) | str.charCodeAt(++i2) & 1023, w(240 | c >> 18), w(128 | c >> 12 & 63), w(128 | c >> 6 & 63), w(128 | c & 63);
      else
        w(224 | c >> 12), w(128 | c >> 6 & 63), w(128 | c & 63);
    }
    return slc(ar, 0, ai);
  }
  function strFromU8(dat, latin1) {
    if (latin1) {
      var r = "";
      for (var i2 = 0; i2 < dat.length; i2 += 16384)
        r += String.fromCharCode.apply(null, dat.subarray(i2, i2 + 16384));
      return r;
    } else if (td) {
      return td.decode(dat);
    } else {
      var _a2 = dutf8(dat), s = _a2.s, r = _a2.r;
      if (r.length)
        err(8);
      return s;
    }
  }
  var slzh = function(d, b) {
    return b + 30 + b2(d, b + 26) + b2(d, b + 28);
  };
  var zh = function(d, b, z) {
    var fnl = b2(d, b + 28), efl = b2(d, b + 30), fn = strFromU8(d.subarray(b + 46, b + 46 + fnl), !(b2(d, b + 8) & 2048)), es = b + 46 + fnl;
    var _a2 = z64hs(d, es, efl, z, b4(d, b + 20), b4(d, b + 24), b4(d, b + 42)), sc = _a2[0], su = _a2[1], off = _a2[2];
    return [b2(d, b + 10), sc, su, fn, es + efl + b2(d, b + 32), off];
  };
  var z64hs = function(d, b, l, z, sc, su, off) {
    var nsc = sc == 4294967295, nsu = su == 4294967295, noff = off == 4294967295, e = b + l;
    var nf = nsc + nsu + noff;
    if (z && nf) {
      for (; b + 4 < e; b += 4 + b2(d, b + 2)) {
        if (b2(d, b) == 1) {
          return [
            nsc ? b8(d, b + 4 + 8 * nsu) : sc,
            nsu ? b8(d, b + 4) : su,
            noff ? b8(d, b + 4 + 8 * (nsu + nsc)) : off,
            1
          ];
        }
      }
      if (z < 2)
        err(13);
    }
    return [sc, su, off, 0];
  };
  var exfl = function(ex) {
    var le = 0;
    if (ex) {
      for (var k in ex) {
        var l = ex[k].length;
        if (l > 65535)
          err(9);
        le += l + 4;
      }
    }
    return le;
  };
  var wzh = function(d, b, f, fn, u, c, ce, co) {
    var fl2 = fn.length, ex = f.extra, col = co && co.length;
    var exl = exfl(ex);
    wbytes(d, b, ce != null ? 33639248 : 67324752), b += 4;
    if (ce != null)
      d[b++] = 20, d[b++] = f.os;
    d[b] = 20, b += 2;
    d[b++] = f.flag << 1 | (c < 0 && 8), d[b++] = u && 8;
    d[b++] = f.compression & 255, d[b++] = f.compression >> 8;
    var dt = new Date(f.mtime == null ? Date.now() : f.mtime), y = dt.getFullYear() - 1980;
    if (y < 0 || y > 119)
      err(10);
    wbytes(d, b, y << 25 | dt.getMonth() + 1 << 21 | dt.getDate() << 16 | dt.getHours() << 11 | dt.getMinutes() << 5 | dt.getSeconds() >> 1), b += 4;
    if (c != -1) {
      wbytes(d, b, f.crc);
      wbytes(d, b + 4, c < 0 ? -c - 2 : c);
      wbytes(d, b + 8, f.size);
    }
    wbytes(d, b + 12, fl2);
    wbytes(d, b + 14, exl), b += 16;
    if (ce != null) {
      wbytes(d, b, col);
      wbytes(d, b + 6, f.attrs);
      wbytes(d, b + 10, ce), b += 14;
    }
    d.set(fn, b);
    b += fl2;
    if (exl) {
      for (var k in ex) {
        var exf = ex[k], l = exf.length;
        wbytes(d, b, +k);
        wbytes(d, b + 2, l);
        d.set(exf, b + 4), b += 4 + l;
      }
    }
    if (col)
      d.set(co, b), b += col;
    return b;
  };
  var wzf = function(o, b, c, d, e) {
    wbytes(o, b, 101010256);
    wbytes(o, b + 8, c);
    wbytes(o, b + 10, c);
    wbytes(o, b + 12, d);
    wbytes(o, b + 16, e);
  };
  function zipSync(data, opts) {
    if (!opts)
      opts = {};
    var r = {};
    var files = [];
    fltn(data, "", r, opts);
    var o = 0;
    var tot = 0;
    for (var fn in r) {
      var _a2 = r[fn], file = _a2[0], p = _a2[1];
      var compression = p.level == 0 ? 0 : 8;
      var f = strToU8(fn), s = f.length;
      var com = p.comment, m = com && strToU8(com), ms = m && m.length;
      var exl = exfl(p.extra);
      if (s > 65535)
        err(11);
      var d = compression ? deflateSync(file, p) : file, l = d.length;
      var c = crc();
      c.p(file);
      files.push(mrg(p, {
        size: file.length,
        crc: c.d(),
        c: d,
        f,
        m,
        u: s != fn.length || m && com.length != ms,
        o,
        compression
      }));
      o += 30 + s + exl + l;
      tot += 76 + 2 * (s + exl) + (ms || 0) + l;
    }
    var out = new u8(tot + 22), oe = o, cdl = tot - o;
    for (var i2 = 0; i2 < files.length; ++i2) {
      var f = files[i2];
      wzh(out, f.o, f, f.f, f.u, f.c.length);
      var badd = 30 + f.f.length + exfl(f.extra);
      out.set(f.c, f.o + badd);
      wzh(out, o, f, f.f, f.u, f.c.length, f.o, f.m), o += 16 + badd + (f.m ? f.m.length : 0);
    }
    wzf(out, o, files.length, cdl, oe);
    return out;
  }
  function unzipSync(data, opts) {
    var files = {};
    var e = data.length - 22;
    for (; b4(data, e) != 101010256; --e) {
      if (!e || data.length - e > 65558)
        err(13);
    }
    ;
    var c = b2(data, e + 8);
    if (!c)
      return {};
    var o = b4(data, e + 16);
    var z = b4(data, e - 20) == 117853008;
    if (z) {
      var ze = b4(data, e - 12);
      z = b4(data, ze) == 101075792;
      if (z) {
        c = b4(data, ze + 32);
        o = b4(data, ze + 48);
      }
    }
    var fltr = opts && opts.filter;
    for (var i2 = 0; i2 < c; ++i2) {
      var _a2 = zh(data, o, z), c_2 = _a2[0], sc = _a2[1], su = _a2[2], fn = _a2[3], no = _a2[4], off = _a2[5], b = slzh(data, off);
      o = no;
      if (!fltr || fltr({
        name: fn,
        size: sc,
        originalSize: su,
        compression: c_2
      })) {
        if (!c_2)
          files[fn] = slc(data, b, b + sc);
        else if (c_2 == 8)
          files[fn] = inflateSync(data.subarray(b, b + sc), { out: new u8(su) });
        else
          err(14, "unknown compression type " + c_2);
      }
    }
    return files;
  }

  // core/cc.ts
  var FONT_ID = 39858;
  var readToc = (archive) => {
    const count = u16(archive, 0);
    const entries = [];
    for (let i2 = 0; i2 < count; i2++) {
      const at2 = 2 + i2 * 8;
      entries.push({
        id: u16(archive, at2),
        offset: u24(archive, at2 + 2),
        size: u16(archive, at2 + 5)
      });
    }
    return entries;
  };
  var encodeMember = (raw) => concat([packU32(raw.length), encodeLzw(raw)]);
  var rebuild = (archive, replacements) => {
    const entries = readToc(archive);
    const tocSize = 2 + entries.length * 8;
    const blobs = entries.map((e) => {
      const raw = replacements.get(e.id);
      return raw === void 0 ? archive.subarray(e.offset, e.offset + e.size) : encodeMember(raw);
    });
    const toc = new Uint8Array(tocSize);
    setU16(toc, 0, entries.length);
    let at2 = tocSize;
    blobs.forEach((blob, i2) => {
      const slot = 2 + i2 * 8;
      setU16(toc, slot, entries[i2].id);
      setU24(toc, slot + 2, at2);
      setU16(toc, slot + 5, blob.length);
      at2 += blob.length;
    });
    return concat([toc, ...blobs]);
  };

  // core/font.ts
  var COLS = 16;
  var sheetToFont = ({ width, height, rgba }, glyphs) => {
    const need = Math.ceil(glyphs / COLS) * 8;
    if (width < COLS * 8 || height < need) {
      throw new Error(
        `sheet is ${width}x${height}; need at least ${COLS * 8}x${need} for ${glyphs} glyphs (1:1, ${COLS} glyphs per row, no grid)`
      );
    }
    const font = new Uint8Array(glyphs * 8);
    for (let ch = 0; ch < glyphs; ch++) {
      const ox = ch % COLS * 8;
      const oy = Math.floor(ch / COLS) * 8;
      for (let r = 0; r < 8; r++) {
        let byte = 0;
        for (let c = 0; c < 8; c++) {
          const p = ((oy + r) * width + ox + c) * 4;
          if (rgba[p + 3] >= 128 && rgba[p] + rgba[p + 1] + rgba[p + 2] >= 128)
            byte |= 1 << 7 - c;
        }
        font[ch * 8 + r] = byte;
      }
    }
    return font;
  };
  var sheetToMember = (sheet) => {
    const font = sheetToFont(sheet, 256);
    return font.subarray(1024).some((b) => b !== 0) ? font : font.subarray(0, 1024);
  };

  // res/font.png
  var font_default = Uint8Array.fromBase64("iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAAAXNSR0IArs4c6QAACglJREFUeJztXdl26jAMDJz+/y9zn+jxVTXSaHGSUs1LS2wtlhUtJsDjOAmv1+v1/v/xeDyi47v5Z+WvdBrevKrrkzI1vpZ8hK+KInfFaqCDMFIHpKEjMtFca/PkGrP4SAc4FgMxGyHnRI2ryYnK1hzI06PDCUIOwCyIUajj7mDkZTY/QnsYG911h1pyO/g82YmsQTLhLDPvU7Dm8hXHSbZIpQCviIrQ7aBZaatF0gHWtm6clQIY/rKgO7N++dga4G1ENhd7vKwqXtvoSprzIkBnl/KRDiAN1OEEHir8rQiwOw20GoZVtlondPbUGl/Ec3dujvC30oV3bQVdBH4iVkdC/2d4dc7tokc0qgM8ADLK3hXehu/e0KwTRKOfV1D+qAEspmfk0gyiKUWGRSsHR2RHbRM9K8imvnXfpMynnMgwYxSszOlEtMJGPORGX7mOaju98mrvAiyv3mU0zyCyV48aEPX5cixaxJ5d9GqRYEsbeKc08V50tYK3NjqTGq/qeKQT/IkuQOZ6a55XA3Uczpx9ItrGC+U+L0eur6386fFH+dzjy8iQ/DLjvwnvtdwmAnjVtHX8+v4/26W8nYKJEJYjyr9ITlS/bvyXVjKEXWfRsv1ixtGbLIxu2pzKmlBlfdVJIgOpw3YHkHQWD3YTvTdeqpsZoelwcFZell7yWem2vxmEQjsTcjVeyOirsc+801CUsuZk2tCqnkh2qAbIHAmv89H/DKTDMPk6oh+bm1H4184F7oK2GyJbxHR0Ado8ybNaZF3dBXToj2yFaD7qDZ7fCqaA3AUY/iJFmkfPjmu5MltkMaGdoWfG7w5TfxkiUCj1rqNrDI312gthmbAX0S/CP6PrOoboorBsK699IUJWua5irBPRs4Az5Frj3uajcaZd9s5LzA80dB22aIvwQqzURRvzaLO6RfTTrkfgbb4nI0Kvrf8LTY7Ccw6pyEu0ThovxE/Se/wt/bTrEf3OQIcDovW3HARZm78z5LKo6BCh9eZq497pqCebtTnkfRAhUJvTWWVbC2C8nw3hkRy8owuQUYkd65BzhxtxcEOkIkC0QLL4Z4u8w4kQHg/rfN66pq3PmuPx9/iy9My5iibnubYLK2QviRYq84wUuiqjjXv02jjKbdq4J58FlU+JOT/aMPL9DWlPNG7J09b/lJPRZlcNuEJuUgSZQqtTfgXVPJw9L7Dw3QW8Al+owCiww8BVA2TOIrpQ3fzH8iAMCunaDewh9P0AnoCuCGHxr45b4XtnZOiKnJVxDd8O8BCPC2vMuwyU8dRVD6TjsSnyWIisJeIEVfuw+LJCCsMAFYtrkaMZSTOGRm8Vo9q41NuTzwLJ0fh79cd7vrT9rqjZsf7Bh6J80lal93hU++DOPlp77dVEaAzJOhtP2YfKRVb7eLaNlHz2L/1/WZq+UT5sjeSlOo+mE5d8MEQaSjPalU4QkS3XwvKIOAG7+aVzAKRUBJki8DeALfSsdKIBFZOInknFWiFs4cf3A1RaPRTiHwJoMbvR1YOzm5+VEdUT1SgMtqeASs/PgM3hWtu1jmm8WGj0Wu0TSX1WjbVCzouuwX03CjFDdzoyCKJHMrwwatF7OTnaBVj6ZboAJkxrqWBH2kzn+d+Uw/8yvEgQrl6RgE6HyPDMFpkRWRW9Ml3BGbjN9wNUIPPtkcjjDJgCOVvzXBVRv9tA1IYcJ+TwzCGIZTBGf08HtsaI6CV5ReYeombRXiM9LPuVHkxgiqizxrWFy7kZ/h4vbXyd48liddXQYT/qsfDucJoJd5an36Uwte7Iqo5v3paMDFwHiHolg4wxqoa74uAJ6VFZS7dergOwBkShGNF74578ivNknGGlWTcx4swWDeJfhWv/DiF3R7SIrPK/OhVFcCtF75LLr4IXGdhT2hWeLT/iHOCTsfts4yvbRx7Hzwo8cl5u8b9jm8m2oWiNd4C2lv8OgtaJsuWwwtJaZEijMGE9U1B1QVbnUR28s4JqiNb0jNBJvQ5RZLamgLWyX/8/Fqe6siXzol3VAXc68Mo7u/laOvmSk95g2zQG2l3S1eqwd/D7urYOGb1ezmPfFr2mX3WNFWjReH2tpgCJah8dbcOkx3obwIRHq+c+gMPLKGbRa+vs2HyvC/Dg0aSOUa/I1Vci6sBVOZm9QHAdQGPEHvtaVTBTBFlyWHoZvrU0YG2gV+Vr+rFzPTt2dCHs+pD9ntoktNjHAmscGUGjR3NZ+R5kOmGrc00PRra3YYjeqlFYedb6kP7PrIGqITBLn2nTKiFVqz9QTdLVRZyJ0LeEeQVJtWCJyF/lrBtibUJE/4gOnlwGWgqL6pbB9znAa4GlpJd3siGWgbVp77GsfswGMvVMZd2W7Ez6Y/Df9wPsENCNqKE9p9Z4Iz7eHE23K8J6BPQDIfJ/b7FoHBWAaG7VmDJFSP3Qa8QrIm+dv+vGYtd3W0SKrEE/Wr+JU5vD9smHEyEQPeqJ0WuLXkYda1yLcEyN4umvwbJ/ZL0aj/L3A2iLj4YfWcVbqaRabXdjtx6s/Q9xA6H9k3qn3g1EzOSc6AIPZcO1a3fZ/DOwuzBv/X4ADahIOQtnyrfs5zkvU8RZa/DSMBpv+70AC1blfwbOkr9GKtQFaN2N1FGjlzw02UwtJpFKAZE7ypvL5HhU6PwFdEQvK/qUvx8AzYl0Eeu8bBegwQu3DH3EeZkx1GVYule6AOvm+dhaanfOv7Km6UaoUv+P8FO9B+BP3DkaPsnbBz+RfqKkOn44eS6TA2WFHcnRkZO6yLi3hg7+mf17z3m+/2FO+rRx2eow45EeWZ5kRTuBKL3H1+vF306INswrTKPRll0fsv1XRqinzAE2UyqU5S35rGlKOhO6C5GzWZW5NW45MQMtgmn8uwEfCcsgc4dGeXuRSF5fncPST2tBI+MW38gamfWz/Bh8/14Ae4dJZdfr2h0mx1H4R3M9+R5Y+o6IhZwyom8UVftcDk356TzOg/vW7uDDMXfb34b5e0Fse2a9zvAenIcfTwUfyV5Uo7WKoB0V7SCO8PcEWlX8Cm1zZ8PvB+p5AO+EaZdyg/0wNzVSHzDn39rYONBgMBgMBoPBYDAYDAaDwWAwGAwGg8FgMBgMBoPBYDAYfCTm8wnn4xbfFBr9bMJ6jf18AkMvP51rjXuPwaO1evpr6H42c+UBvy1c+7g1+3Rw5EFP79O9lj6sjJ3YrQdr//c1b/+k3qEfjJDE6DW6loX8BGyEt/fp504wn59AuqMbirmTrTFv/fAHI7yQxBp09cjsRrAfO7N0kHfQDngRUqYPpOMh7mB0F0t6Sy80p5yD0ByGX2cNoMG72xh6hj+jv8bT4u/d+WwNYNn6IZVBC62CcaBD5LAOebvWdLc6pIw1zGhh2hsfDAa/FOUcN/gAWGHdSwmD3w31ByNQgXamYoNzQP9gxIT8z8TUAIPBX8Y/aEZpRCklFEgAAAAASUVORK5CYII=");

  // web/utils.ts
  var readZip = (data) => {
    const files = /* @__PURE__ */ new Map();
    for (const [path, bytes] of Object.entries(unzipSync(data))) {
      const name = path.slice(path.lastIndexOf("/") + 1).toUpperCase();
      if (name !== "" && !files.has(name)) files.set(name, bytes);
    }
    return files;
  };
  var writeZip = (files) => zipSync(Object.fromEntries(files), { level: 0, mtime: new Date(1990, 0, 1) });
  var requireFile = (files, name) => {
    const bytes = files.get(name);
    if (bytes === void 0) throw new Error(`the zip has no ${name}`);
    return bytes;
  };
  var patchFont = async (archive) => {
    const bitmap = await createImageBitmap(
      new Blob([font_default], { type: "image/png" }),
      {
        premultiplyAlpha: "none",
        colorSpaceConversion: "none"
      }
    );
    const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d");
    if (ctx === null)
      throw new Error("the browser gave no 2D context, so the sheet cannot be read");
    ctx.drawImage(bitmap, 0, 0);
    const { width, height, data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    const rgba = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return rebuild(archive, /* @__PURE__ */ new Map([[FONT_ID, sheetToMember({ width, height, rgba })]]));
  };

  // res/dosbox.conf
  var dosbox_default = '[sdl]\noutput=openglnb\n\n[render]\naspect=true\n\n[autoexec]\nmount c "."\nc:\nKBR.EXE\nexit\n';

  // res/gate_picker.asm
  var gate_picker_default = `; Town/Castle Gate destination picker \u2014 replaces the gate's two-character letter list with a
; named list in its own window, drawn the way the spell book draws.
;
; The point is the naming, not the layout. In English the listed letter IS the town's first
; letter, so nothing is looked up; no Cyrillic scheme reproduces that, because the letter a
; Russian player presses for "\u0410" depends on whether they think in translit (A) or in
; keyboard position (F), and those two disagree on every letter of the alphabet. Printing
; the name beside the key removes the question: the letter becomes a menu key with no
; relation to the spelling, exactly as the spell book's own A-G column already is.
;
; The letter stays bound to the destination, not to the position in the list: castle 1 is
; always B, so an unvisited one leaves a gap. Numbering the visited ones consecutively
; instead would silently send a player who knows B is Basefit to whatever took the slot, and
; would throw away what the gap tells them \u2014 that there is a B castle still to find.
;
; far, cdecl:  picker(word flag)     flag 0 = castles, nonzero = towns
; returns AL = slot index 0..25 for the caller's existing coordinate lookup, 0xFF to cancel.
;
; Assembled into DGROUP above the string pool, so labels are DS offsets and CS == DS at run
; time. Every callf needs an MZ relocation entry.

; ---- engine entry points -----------------------------------------------------------------
VID         equ 0x1168          ; window and text library
ADV         equ 0x0207          ; adventure-screen helpers
CRT         equ 0x0000          ; Turbo C runtime

WIN_NEW     equ 0x03ca          ; (x1,y1,x2,y2) cells -> struct, 0 if all 3 slots are busy
WIN_OPEN    equ 0x088b          ; (win)  saves what is under it and makes it current
WIN_CLOSE   equ 0x08ee          ; (win)  restores it
WIN_PAGE    equ 0x0cb8          ; (page)
WIN_ATTACH  equ 0x0f00          ; (n)    binds the window to draw surface n
WIN_JUST    equ 0x0f97          ; (mode) 2 = centre; cleared by hand afterwards
GOTOXY      equ 0x0fb7          ; (col, y)  col in 8px cells, y in PIXELS -- not symmetric
PUTS        equ 0x1063
PUTCH       equ 0x05eb
FRAME       equ 0x01a5          ; ADV (x1,y1,x2,y2) cells, same rect as WIN_NEW
GETKEY      equ 0x006c          ; ADV (lo, hi) -> key, or 0x1b for ESC
RESTORE     equ 0x0c36          ; ADV, redraws the adventure screen
TOUPPER     equ 0x0c46          ; CRT

; ---- game data ---------------------------------------------------------------------------
CURWIN      equ 0x59c8          ; pointer to the current window struct
WINCOLOUR   equ 0x01ed
TOWN_REMAP  equ 0x3007          ; slot -> town index
TOWN_SEEN   equ 0x64e5          ; indexed by town index, not by slot
CASTLE_SEEN equ 0x64cb
TOWN_NAMES  equ 0x2e25          ; word table, indexed by town index
CASTLE_NAMES equ 0x2d9e
HDR_CASTLE  equ 0x2fb1          ; the four already-translated prompt pointers
ASK_CASTLE  equ 0x2fb3
HDR_TOWN    equ 0x2fb5
ASK_TOWN    equ 0x2fb7
NONE_STR    equ 0x0d9e          ; "(none)" -- fits its own slot, so a plain \`string\` row

; ---- layout ------------------------------------------------------------------------------
; 26 destinations at most, so two columns of 13. Each column is 17 cells: 15 for the widest
; entry ("A) \u041F\u0440\u0438\u044E\u0442 \u041A\u043E\u0440\u043E\u043B\u044F") and 2 of gutter, inside a 36-cell window.
;
; Window edges snap to the 8px cell grid while the text inside them does not, and the play
; area leaves only 2 scanlines above the window and 6 below \u2014 so this is the lowest row that
; fits, and the bottom border lands on the play frame's own line rather than short of it.
; Moving the block down any further means shrinking it.
WIN_X1      equ 2
WIN_Y1      equ 4
WIN_X2      equ 37
WIN_Y2      equ 23
TITLE_Y     equ 38
COL_L       equ 2               ; flush with the prompt below the list
COL_STEP    equ 17
ROW_Y0      equ 52
ROW_STEP    equ 9               ; 8px glyph + 1 scanline of leading
ROWS        equ 13
; The prompt tracks the list: at 13 rows the last one ends at 160, so anything above 168
; would be overdrawn by it.
ASK_Y       equ 174
SLOTS       equ 26

; ---- locals ------------------------------------------------------------------------------
;   [bp-1] slot 0..25      [bp-2] entry number      [bp-3] resolved town/castle index
;   [bp-4] row             [bp-5] column            [bp-6] result

picker:
    push bp
    mov  bp,sp
    sub  sp,6
    push si
    push di
    mov  si,[bp+6]

    mov  ax,0
    push ax
    callf VID:WIN_PAGE
    pop  cx

    mov  ax,WIN_Y2
    push ax
    mov  ax,WIN_X2
    push ax
    mov  ax,WIN_Y1
    push ax
    mov  ax,WIN_X1
    push ax
    callf VID:WIN_NEW
    add  sp,8
    mov  di,ax
    or   ax,ax
    jnz  opened
    mov  al,0xff                ; all three window slots busy: cancel rather than draw junk
    jmp  leave_nowin
opened:
    mov  byte [di+8],1
    mov  al,[WINCOLOUR]
    mov  [di+7],al
    push di
    callf VID:WIN_OPEN
    pop  cx
    mov  ax,0
    push ax
    callf VID:WIN_ATTACH
    pop  cx

    mov  ax,WIN_Y2
    push ax
    mov  ax,WIN_X2
    push ax
    mov  ax,WIN_Y1
    push ax
    mov  ax,WIN_X1
    push ax
    callf ADV:FRAME
    add  sp,8

; ---- title, centred ----------------------------------------------------------------------
    mov  ax,2
    push ax
    callf VID:WIN_JUST
    pop  cx
    mov  ax,TITLE_Y
    push ax
    mov  ax,0
    push ax
    callf VID:GOTOXY
    pop  cx
    pop  cx
    or   si,si
    jz   title_castle
    mov  ax,[HDR_TOWN]
    jmp  title_put
title_castle:
    mov  ax,[HDR_CASTLE]
title_put:
    push ax
    callf VID:PUTS
    pop  cx
    mov  bx,[CURWIN]
    mov  byte [bx+0xa],0        ; back to left-justified; WIN_JUST only ever sets bits

; ---- one line per visited destination ----------------------------------------------------
    mov  byte [bp-1],0
    mov  byte [bp-2],0
    mov  byte [bp-4],0
    mov  byte [bp-5],0
scan:
    or   si,si
    jz   scan_castle
    mov  al,[bp-1]
    mov  ah,0
    mov  bx,ax
    mov  al,[bx+TOWN_REMAP]
    mov  [bp-3],al
    mov  ah,0
    mov  bx,ax
    cmp  byte [bx+TOWN_SEEN],0
    jnz  scan_show
scan_skip:                      ; the loop body is past rel8, so both tests branch via here
    jmp  scan_next
scan_castle:
    mov  al,[bp-1]
    mov  [bp-3],al
    mov  ah,0
    mov  bx,ax
    cmp  byte [bx+CASTLE_SEEN],0
    jz   scan_skip

scan_show:
    mov  al,[bp-4]
    mov  ah,0
    mov  bx,ROW_STEP
    imul bx
    add  ax,ROW_Y0
    push ax
    mov  al,[bp-5]
    mov  ah,0
    mov  bx,COL_STEP
    imul bx
    add  ax,COL_L
    push ax
    callf VID:GOTOXY
    pop  cx
    pop  cx

    mov  al,[bp-1]              ; the slot, so the letter names the destination
    mov  ah,0
    add  ax,0x41
    push ax
    callf VID:PUTCH
    pop  cx
    mov  ax,0x29                ; ')'
    push ax
    callf VID:PUTCH
    pop  cx
    mov  ax,0x20
    push ax
    callf VID:PUTCH
    pop  cx

    mov  al,[bp-3]
    mov  ah,0
    shl  ax,1
    mov  bx,ax
    or   si,si
    jz   name_castle
    push [bx+TOWN_NAMES]
    jmp  name_put
name_castle:
    push [bx+CASTLE_NAMES]
name_put:
    callf VID:PUTS
    pop  cx

    inc  byte [bp-2]            ; entries drawn, for the row/column walk only
    inc  byte [bp-4]
    cmp  byte [bp-4],ROWS
    jc   scan_next
    mov  byte [bp-4],0
    mov  byte [bp-5],1
scan_next:
    inc  byte [bp-1]
    cmp  byte [bp-1],SLOTS
    jnc  scan_done
    jmp  scan
scan_done:
    mov  al,[bp-2]
    or   al,al
    jnz  ask_prompt
    mov  ax,ROW_Y0              ; nothing visited: the game's own "(none)" in the list area
    push ax
    mov  ax,COL_L
    push ax
    callf VID:GOTOXY
    pop  cx
    pop  cx
    mov  ax,NONE_STR
    push ax
    callf VID:PUTS
    pop  cx
ask_prompt:

; ---- prompt and choice -------------------------------------------------------------------
    mov  ax,ASK_Y
    push ax
    mov  ax,2
    push ax
    callf VID:GOTOXY
    pop  cx
    pop  cx
    or   si,si
    jz   ask_castle
    mov  ax,[ASK_TOWN]
    jmp  ask_put
ask_castle:
    mov  ax,[ASK_CASTLE]
ask_put:
    push ax
    callf VID:PUTS
    pop  cx

; The whole alphabet is accepted and an unlisted letter is simply re-read, so a key for a
; destination not yet visited does nothing instead of teleporting somewhere else.
ask:
    mov  ax,0x7a                ; through lowercase: the range check runs before TOUPPER,
    push ax                     ; so stopping at 'Z' would reject every unshifted key
    mov  ax,0x41
    push ax
    callf ADV:GETKEY
    pop  cx
    pop  cx
    push ax
    callf CRT:TOUPPER
    pop  cx
    cmp  al,0x1b
    jz   cancel
    sub  al,0x41
    cmp  al,SLOTS               ; '[' to '\`' also survive the range check, and TOUPPER
    jnc  ask                    ; leaves them: keep them out of the coordinate tables
    mov  [bp-1],al
    or   si,si
    jz   key_castle
    mov  ah,0
    mov  bx,ax
    mov  al,[bx+TOWN_REMAP]
    mov  ah,0
    mov  bx,ax
    cmp  byte [bx+TOWN_SEEN],0
    jmp  key_test
key_castle:
    mov  ah,0
    mov  bx,ax
    cmp  byte [bx+CASTLE_SEEN],0
key_test:
    jz   ask
    mov  al,[bp-1]
    jmp  leave

cancel:
    mov  al,0xff
leave:
    mov  [bp-6],al
    push di
    callf VID:WIN_CLOSE
    pop  cx
    callf ADV:RESTORE
    mov  al,[bp-6]
leave_nowin:
    pop  di
    pop  si
    mov  sp,bp
    pop  bp
    retf
`;

  // res/name_tables.asm
  var name_tables_default = `; Hero-name lookup tables \u2014 two 8086 xlat tables, no code. Assembled into DGROUP by the
; patcher, which rewrites the two sites that read them; the labels are DS offsets.
;
; keymap makes Cyrillic typable with no DOS keyboard driver at all. The game reads keys
; through INT 16h, so a Russian name would otherwise need the player's own DOSBox to load
; KEYB RU \u2014 unknowable for a patch we hand out. Instead the accepted key code is mapped
; here, by keyboard POSITION (\u0419\u0426\u0423\u041A\u0415\u041D), which is the layout a Russian player's fingers know.
;
; The mapping sits INSIDE the name field's accept path, which is why the rest of the game
; keeps its Latin command keys, and why the raw code is what gets mapped: \u0401 and \u0451 sit on the
; tilde and backquote keys, so they never collide with the arrows, which arrive as 0xF0 and
; 0xF1 from the engine's own scancode table. Latin letters are the price \u2014 there is no room
; in the 38-byte block for a layout toggle, so a name is Cyrillic, digits and punctuation.
;
; The one other caller of that input routine is the copy-protection prompt's "Word:" line.
; It gets \u0419\u0426\u0423\u041A\u0415\u041D too, which costs nothing: the answer is never compared.
;
; translit turns the finished name into the save file's 8.3 name (<name>.DAT). It is 1:1 by
; necessity, not by taste: the builder loop is one input byte, one output byte, one index,
; cut at 8 \u2014 zh/ch/sh digraphs need a second index and an overflow check that the 6-byte
; block it now occupies cannot hold. So \u0435/\u0451/\u044D collapse to E, \u0430/\u044F to A, \u0443/\u044E to U, \u0439/\u044B to Y,
; \u0448/\u0449 to W, \u044C/\u044A to _. Two heroes can then land on one file, but never silently: the game
; already asks "destroy the game of <name>?" whenever the file exists.
;
; Both tables span their whole index range, so neither caller needs a range check. Anything
; that is not a letter or a digit becomes '_', which is what the original did to every byte
; outside A-Z \u2014 spaces included.

; ---- keymap: key code (ASCII, 0x00-0x7F) -> the CP866 letter it types --------------------
keymap:
    db "________________"       ; 0x00  control codes: the caller rejects anything < 0x20
    db "________________"       ; 0x10
    db " !\u042D#$%&\u044D()*+\u0431-\u044E."       ; 0x20  " -> \u042D, ' -> \u044D, , -> \u0431, . -> \u044E, / -> .
    db "0123456789\u0416\u0436\u0411=\u042E,"       ; 0x30  digits stay; : ; < > ? carry \u0416 \u0436 \u0411 \u042E ,
    db "@\u0424\u0418\u0421\u0412\u0423\u0410\u041F\u0420\u0428\u041E\u041B\u0414\u042C\u0422\u0429"       ; 0x40  A-O
    db "\u0417\u0419\u041A\u042B\u0415\u0413\u041C\u0426\u0427\u041D\u042F\u0445\\\u044A^_"       ; 0x50  P-Z, then [ -> \u0445, ] -> \u044A
    db "\u0451\u0444\u0438\u0441\u0432\u0443\u0430\u043F\u0440\u0448\u043E\u043B\u0434\u044C\u0442\u0449"       ; 0x60  \` -> \u0451, a-o
    db "\u0437\u0439\u043A\u044B\u0435\u0433\u043C\u0446\u0447\u043D\u044F\u0425|\u042A\u0401",0x7f   ; 0x70  p-z, { -> \u0425, } -> \u042A, ~ -> \u0401, DEL kept as itself

; ---- translit: name byte (CP866) -> save-file name byte (ASCII) --------------------------
translit:
    db "________________"       ; 0x00
    db "________________"       ; 0x10
    db "________________"       ; 0x20  space included: the original blanked it too
    db "0123456789______"       ; 0x30
    db "_ABCDEFGHIJKLMNO"       ; 0x40
    db "PQRSTUVWXYZ_____"       ; 0x50
    db "_ABCDEFGHIJKLMNO"       ; 0x60  a-z fold to upper case
    db "PQRSTUVWXYZ_____"       ; 0x70
    db "ABVGDEJZIYKLMNOP"       ; 0x80  \u0410-\u041F
    db "RSTUFHCQWW_Y_EUA"       ; 0x90  \u0420-\u042F
    db "ABVGDEJZIYKLMNOP"       ; 0xA0  \u0430-\u043F
    db "________________"       ; 0xB0  box drawing
    db "________________"       ; 0xC0
    db "________________"       ; 0xD0
    db "RSTUFHCQWW_Y_EUA"       ; 0xE0  \u0440-\u044F
    db "EE______________"       ; 0xF0  \u0401 \u0451
`;

  // res/patches.csv
  var patches_default = `type,offset,expect,write

# ==== COPY PROTECTION =====================================================================
bytes,0xC40A,"72","EB"

# ==== TITLE SCREEN ========================================================================
string,0x15E48,"Select Char A-D or L-Load saved game","\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0433\u0435\u0440\u043E\u044F A-D \u0438\u043B\u0438 L-\u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u0435\u0441\u044C"

# ---- credits
string,0x15E6D,"King's Bounty Designed By:","\u0414\u0438\u0437\u0430\u0439\u043D King's Bounty:"
string,0x15E88,"Jon Van Caneghem","\u0414\u0436\u043E\u043D \u0412\u0430\u043D \u041A\u0430\u043D\u0435\u0433\u0435\u043C"
string,0x15E99,"Programmed By:","\u041F\u0440\u043E\u0433\u0440\u0430\u043C\u043C\u0438\u0441\u0442\u044B:"
string,0x15EA8,"Mark Caldwell","\u041C\u0430\u0440\u043A \u041A\u043E\u043B\u0434\u0443\u044D\u043B\u043B"
string,0x15EB6,"Andy Caldwell","\u042D\u043D\u0434\u0438 \u041A\u043E\u043B\u0434\u0443\u044D\u043B\u043B"
string,0x15EC4,"Graphics By:","\u0413\u0440\u0430\u0444\u0438\u043A\u0430:"
string,0x15ED1,"Kenneth L. Mayfield","\u041A\u0435\u043D\u043D\u0435\u0442 \u041B. \u041C\u0435\u0439\u0444\u0438\u043B\u0434"
string,0x15EE5,"Vincent DeQuattro, Jr.","\u0412\u0438\u043D\u0441\u0435\u043D\u0442 \u0414\u0435\u041A\u0443\u0430\u0442\u0442\u0440\u043E, \u043C\u043B."
string,0x15F24,"All Rights Reserved","\u0412\u0441\u0435 \u043F\u0440\u0430\u0432\u0430 \u0437\u0430\u0449\u0438\u0449\u0435\u043D\u044B"

# ---- new game
string,0x15F38,"Name: ","\u0418\u043C\u044F: "
string,0x167A2,"Difficulty   Days  Score","\u0421\u043B\u043E\u0436\u043D\u043E\u0441\u0442\u044C    \u0414\u043D\u0438   \u041E\u0447\u043A\u0438"
string,0x167BD,"Easy         900    x.5","\u041B\u0435\u0433\u043A\u043E        900    x.5"
string,0x167D5,"Normal       600     x1","\u041D\u043E\u0440\u043C\u0430\u043B\u044C\u043D\u043E    600     x1"
string,0x167ED,"Hard         400     x2","\u0422\u0440\u0443\u0434\u043D\u043E       400     x2"
string,0x16805,"Impossible?  200     x4","\u041D\u0435\u0432\u043E\u0437\u043C\u043E\u0436\u043D\u043E?  200     x4"
string,0x15F3F,"\\x18\\x19 to select   Ent to Accept","\\x18\\x19: \u0412\u044B\u0431\u0440\u0430\u0442\u044C   ENTER: \u041F\u0440\u0438\u043D\u044F\u0442\u044C"

# ---- copy-protection prompt
# DO NOT RELOC: every ref here is inside the copy-protection block.
string,0x16166,"Please turn to page ","\u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443 "
string,0x1617B,", go to",", \u0442\u0430\u043C"
string,0x16183,"line ","\u0440\u044F\u0434 "
string,0x16189," and type in word "," \u0438 \u0441\u043B\u043E\u0432\u043E "
string,0x16230,"Word: ","\u0421\u043B\u043E\u0432\u043E:"
string,0x1619C,"Note: Spaces are not counted","\u041B\u0430\u0434\u043D\u043E, \u0448\u0443\u0447\u0443! \u041D\u0435 \u043D\u0443\u0436\u043D\u043E \u043D\u0438\u0447\u0435\u0433\u043E"
string,0x161B9,"as words or lines.  Hyphenated","\u043E\u0442\u043A\u0440\u044B\u0432\u0430\u0442\u044C, \u043A\u043E\u043D\u0435\u0447\u043D\u043E. \u0417\u0430\u0449\u0438\u0442\u0430 \u0443\u0436\u0435"
string,0x161D8,"words are treated as one word.","\u0441\u043D\u044F\u0442\u0430. \u041F\u0440\u043E\u0441\u0442\u043E \u043D\u0430\u0436\u043C\u0438\u0442\u0435 Enter \u0438"
string,0x161F7,"Any line that has any kind of","\u0432\u043F\u0435\u0440\u0451\u0434, \u043A \u043F\u0440\u0438\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F\u043C. \u0423\u0434\u0430\u0447\u0438"
string,0x16215,"text is considered a line.","\u0432 \u043F\u043E\u0445\u043E\u0434\u0435, \u0433\u0435\u0440\u043E\u0439!"

# ---- new-game creation message
# FUN_155b_06dc draws all four at column 4, flush left, in a 32-column panel, so the ragged
# right edge is on show: break by clause, not by leftover width.
reloc,0x01672c,"A new game is being created.","\u0421\u043E\u0437\u0434\u0430\u0451\u0442\u0441\u044F \u043D\u043E\u0432\u044B\u0439 \u043C\u0438\u0440."
reloc,0x01672e,"Please wait while I perform","\u041F\u043E\u0434\u043E\u0436\u0434\u0438\u0442\u0435, \u043F\u043E\u043A\u0430 \u044F \u0442\u0432\u043E\u0440\u044E"
reloc,0x016730,"godlike actions to make this","\u0431\u043E\u0436\u0435\u0441\u0442\u0432\u0435\u043D\u043D\u044B\u0435 \u0447\u0443\u0434\u0435\u0441\u0430 \u0438"
reloc,0x016732,"game playable.","\u043D\u0430\u043F\u043E\u043B\u043D\u044F\u044E \u0435\u0433\u043E \u0436\u0438\u0437\u043D\u044C\u044E."

# ---- destroy-saved-game confirmation
string,0x16758,"Do you wish to destroy the","\u042D\u0442\u043E \u0438\u043C\u044F \u0443\u0436\u0435 \u0431\u044B\u043B\u043E. \u0421\u0442\u0435\u0440\u0435\u0442\u044C"
string,0x16773,"game of ","\u0433\u0435\u0440\u043E\u044F "

# ---- load saved game
string,0x15F6B,"Select game:"," \u0421\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F "
string,0x15F78,"'ESC' to exit \\x18\\x19 Return to Select","ESC:\u0412\u044B\u0439\u0442\u0438  \\x18\\x19:\u0412\u044B\u0431\u043E\u0440  ENTER:\u0418\u0433\u0440\u0430\u0442\u044C"

# ---- loading message
reloc,0x01673c,"Please wait while I prepare","\u041F\u043E\u0434\u043E\u0436\u0434\u0438\u0442\u0435, \u044F \u0433\u043E\u0442\u043E\u0432\u043B\u044E \u043C\u0438\u0440,"
reloc,0x01673e,"a suitable environment for","\u0434\u043E\u0441\u0442\u043E\u0439\u043D\u044B\u0439 \u0432\u0430\u0448\u0435\u0439 \u043E\u0445\u043E\u0442\u044B \u0437\u0430"
reloc,0x016740,"your bountying enjoyment!","\u0433\u043E\u043B\u043E\u0432\u0430\u043C\u0438 \u0437\u043B\u043E\u0434\u0435\u0435\u0432!"

# ---- disk errors
# Three boxes in the same 32-column panel at column 4 as the messages above (FUN_155b_0d90,
# FUN_155b_1a78, FUN_155b_1ae6), so the same ragged right edge is on show: break by clause.
reloc,0x016734,"This disk has no characters","\u0421\u043E\u0445\u0440\u0430\u043D\u0451\u043D\u043D\u044B\u0445 \u0438\u0433\u0440 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E."
reloc,0x016736,"on it. Try creating a new","\u0421\u043E\u0437\u0434\u0430\u0439\u0442\u0435 \u043D\u043E\u0432\u043E\u0433\u043E \u0433\u0435\u0440\u043E\u044F \u0438\u043B\u0438"
reloc,0x016738,"character or copy one from","\u0441\u043A\u043E\u043F\u0438\u0440\u0443\u0439\u0442\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0435 \u0432"
reloc,0x01673a,"another disk.","\u043F\u0430\u043F\u043A\u0443 \u0441 \u0438\u0433\u0440\u043E\u0439."
reloc,0x016742,"Sorry,","\u0423\u0432\u044B, \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0439 \u043C\u043E\u0436\u0435\u0442 \u0431\u044B\u0442\u044C"
reloc,0x016744,"the maximum number of saved","\u043D\u0435 \u0431\u043E\u043B\u044C\u0448\u0435 \u0434\u0435\u0432\u044F\u0442\u0438. \u0423\u0434\u0430\u043B\u0438\u0442\u0435"
reloc,0x016746,"games is 9. Please delete or","\u043E\u0434\u043D\u043E \u0438\u0437 \u043D\u0438\u0445 \u0438\u043B\u0438 \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u0435"
reloc,0x016748,"load a saved game.","\u0441\u043E\u0445\u0440\u0430\u043D\u0451\u043D\u043D\u0443\u044E \u0438\u0433\u0440\u0443."
reloc,0x01674a,"There is not enough free","\u041D\u0435 \u0445\u0432\u0430\u0442\u0430\u0435\u0442 \u0441\u0432\u043E\u0431\u043E\u0434\u043D\u043E\u0433\u043E"
reloc,0x01674c,"space on this disk to create","\u043C\u0435\u0441\u0442\u0430, \u0447\u0442\u043E\u0431\u044B \u0441\u043E\u0437\u0434\u0430\u0442\u044C"
reloc,0x01674e,"a character.","\u0433\u0435\u0440\u043E\u044F."

# ==== MENU BAR ============================================================================

# ---- header
# FUN_1207_0c36 prints header + counter label + ":%d" as one line, so the two share the
# original's 34 columns \u2014 the day count reaches 900, and 36 columns overflows on screen. The
# label is padded to keep the colon in a fixed column across both counters.
string,0x0157A5,"Options / Controls / ","\u041E:\u041F\u043E\u043C\u043E\u0449\u044C  C:\u041E\u043F\u0446\u0438\u0438    "
reloc,0x004a88," Options "," \u041E:\u041F\u043E\u043C\u043E\u0449\u044C "
string,0x015790," Controls "," C:\u041E\u043F\u0446\u0438\u0438 "
string,0x0157C5,"Days Left","\u041E\u0441\u0442. \u0434\u043D\u0435\u0439"
string,0x0157BB,"Time Stop","   \u0421\u0442\u0430\u0437\u0438\u0441"

# ---- controls
# "\u0414\u0430"/"\u041D\u0435\u0442" are overprinted at hardcoded columns 12 and 15.
string,0x01A9DF,"1 Delay 0123456789","1 \u041F\u0430\u0443\u0437\u0430 0123456789"
string,0x01A9F2,"2 Sounds    On/Off","2 \u0417\u0432\u0443\u043A\u0438     \u0414\u0430/\u041D\u0435\u0442"
string,0x01AA05,"3 Walk Beep On/Off","3 \u0428\u0430\u0433\u0438      \u0414\u0430/\u041D\u0435\u0442"
string,0x01AA18,"4 Animation On/Off","4 \u0410\u043D\u0438\u043C\u0430\u0446\u0438\u044F  \u0414\u0430/\u041D\u0435\u0442"
string,0x01AA2B,"5 Army Size On/Off","5 \u0421\u0442\u0435\u043A\u0438     \u0414\u0430/\u041D\u0435\u0442"
string,0x01AA51,"Off","\u041D\u0435\u0442"
string,0x01AA55,"On","\u0414\u0430"

# ---- options
string,0x01AA58,"  \\x19  or 2 Move Down","  \\x19  2  \u0412\u043D\u0438\u0437"
string,0x01AA6C,"  \\x1A  or 4 Move Left","  \\x1A  4  \u0412\u043B\u0435\u0432\u043E"
string,0x01AA80,"  \\x1B  or 6 Move Right","  \\x1B  6  \u0412\u043F\u0440\u0430\u0432\u043E"
string,0x01AA95,"  \\x18  or 8 Move Up","  \\x18  8  \u0412\u0432\u0435\u0440\u0445"
string,0x01AAA7,"END  or 1 Down Left","END  1  \u0412\u043D\u0438\u0437-\u0432\u043B\u0435\u0432\u043E"
string,0x01AABB,"PGDN or 3 Down Right","PGDN 3  \u0412\u043D\u0438\u0437-\u0432\u043F\u0440\u0430\u0432\u043E"
reloc,0x018BA5,"HOME or 7 Up Left","HOME 7  \u0412\u0432\u0435\u0440\u0445-\u0432\u043B\u0435\u0432\u043E"
reloc,0x018BA7,"PGUP or 9 Up Right","PGUP 9  \u0412\u0432\u0435\u0440\u0445-\u0432\u043F\u0440\u0430\u0432\u043E"
string,0x01AAF5,"  A View Army","  A \u0410\u0440\u043C\u0438\u044F"
string,0x01AB03,"  C Controls","  C \u0421\u0438\u0441\u0442\u0435\u043C\u0430"
string,0x01AB22,"  I Contract Info","  I \u041A\u043E\u043D\u0442\u0440\u0430\u043A\u0442"
string,0x01AB34,"  M Auto-mapping","  M \u041A\u0430\u0440\u0442\u0430"
string,0x01AB45,"  P Puzzle Solve","  P \u0413\u043E\u043B\u043E\u0432\u043E\u043B\u043E\u043C\u043A\u0430"
string,0x01AB56,"  S Search Area","  S \u041A\u043E\u043F\u0430\u0442\u044C"
string,0x01AB66,"  U Use Magic","  U \u041A\u043E\u043B\u0434\u043E\u0432\u0430\u0442\u044C"
string,0x01AB74,"  V View Character","  V \u0413\u0435\u0440\u043E\u0439"
string,0x01AB87,"  W Wait End Week","  W \u0416\u0434\u0430\u0442\u044C \u043D\u0435\u0434\u0435\u043B\u044E"
reloc,0x018BBD,"  Q Quit and Save","  Q \u0417\u0430\u043F\u0438\u0441\u044C \u0438 \u0432\u044B\u0445\u043E\u0434"
# The last three are one indexed mini-table (\`mov ax,[bx+0x353b]\`) feeding this list's
# single mutable line \u2014 so find-ref sees no ref \u2014 and Fly doubles as a combat entry. All
# three pad to 17 to erase each other on redraw.
string,0x01ABF1,"  N New Continent","  N \u041A\u043E\u043D\u0442\u0438\u043D\u0435\u043D\u0442"
string,0x01AC03,"  L Land         ","  L \u041F\u0440\u0438\u0437\u0435\u043C\u043B\u0438\u0442\u044C\u0441\u044F "
string,0x01AC15,"  F Fly          ","  F \u041B\u0435\u0442\u0435\u0442\u044C       "

# ---- quit confirmation
string,0x162D1,"Quit to DOS without saving (y/n) ","\u0412\u044B\u0439\u0442\u0438 \u0431\u0435\u0437 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F? (y/n) "

# ---- game saved
reloc,0x01894c,"Your game has been saved.","\u0418\u0433\u0440\u0430 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0430."
reloc,0x018950,"Press Control-Q to Quit or","\u041D\u0430\u0436\u043C\u0438\u0442\u0435 Ctrl+Q \u0447\u0442\u043E\u0431\u044B \u0432\u044B\u0439\u0442\u0438,"
reloc,0x018952,"any other key to continue.","\u0438\u043B\u0438 \u043F\u0440\u043E\u0431\u0435\u043B \u0447\u0442\u043E\u0431\u044B \u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0438\u0442\u044C."

# ==== VIEW MAP ============================================================================
# FUN_1c2c_0f0d joins four table slots into the foot hint that SPC toggles: <exit>< / SPC:
# ><whole|your>< map>, and nothing clears the line between the two, so the your-line
# skeleton carries one trailing space per character the whole word is longer \u2014 two for
# \u041F\u043E\u043B\u043D\u0430\u044F over \u0412\u0430\u0448\u0430.
reloc,0x00f289,"X=%2d Position Y=%2d","\u041F\u043E\u0437\u0438\u0446\u0438\u044F: X=%2d Y=%2d"
reloc,0x0188f6,"'ESC' to exit","ESC: \u0412\u044B\u0439\u0442\u0438"
reloc,0x0188fe," / 'SPC' "," / SPC: "
reloc,0x0188f8,"whole","\u041F\u043E\u043B\u043D\u0430\u044F"
reloc,0x0188fa,"your","\u0412\u0430\u0448\u0430"
reloc,0x0188fc," map"," \u043A\u0430\u0440\u0442\u0430"
reloc,0x00f389,"%s%s%s%s ","%s%s%s%s  "

# ==== ARMY SCREEN =========================================================================

# ---- header bar
string,0x1AC27,"Press 'ESC' to exit","ESC: \u0412\u044B\u0439\u0442\u0438"

# ---- row labels
string,0x016237,"HitPts:","\u0416\u0438\u0437\u043D\u0438: "
string,0x01623F,"SL:   MV:      Damage:","\u0423\u0440:   \u0425\u043E\u0434\u044B:    \u0423\u0440\u043E\u043D:  "
# FUN_19fe_0cc8 places the cursor once and then prints either the move value or the flying
# word, so both start at the same column and the word cannot cover the label. The rewrite
# picks the column before that gotoxy \u2014 19 for the digit, 13 for "\u041B\u0435\u0442\u0430\u0435\u0442", which lands on
# "\u0425\u043E\u0434\u044B:" \u2014 and keeps the tail (the two prints) byte-identical. Two NOPs pad the run; the
# three far calls slide, so the row after repoints their relocation entries, and the flying
# word's ref slides with them, 0xCE13 -> 0xCE11.
bytes,0xCDD0,"8a 46 06 b4 00 8b d8 8a 87 71 32 b4 00 05 0a 00 50 b8 11 00 50 9a b7 0f 68 11 59 59 8a 46 ff b4 00 8b d8 80 bf f2 02 00 74 18 8a 46 ff b4 00 8b d8 8a 87 f2 02 b4 00 05 30 00 50 9a eb 05 68 11 eb 09 b8 c6 0b 50 9a 63 10 68 11 59","8a 5e 06 b7 00 8a 9f 71 32 b7 00 8d bf 0a 00 8a 5e ff b7 00 b8 0d 00 80 bf f2 02 00 74 02 b0 13 53 57 50 9a b7 0f 68 11 59 59 5b 8a 87 f2 02 b4 00 08 c0 74 0b 05 30 00 50 9a eb 05 68 11 eb 09 b8 c6 0b 50 9a 63 10 68 11 59 90 90"
bytes,0x1188,"e8 ad 00 00 0e ae 00 00 19 ae 00 00","f6 ad 00 00 0c ae 00 00 17 ae 00 00"
reloc,0x00CE11,"Fly","\u041B\u0435\u0442\u0430\u0435\u0442"
string,0x01625A,"Out of Control","\u041D\u0435\u0443\u043F\u0440\u0430\u0432\u043B\u044F\u0435\u043C\u044B"
reloc,0x00CEAD,"Morale:","\u041C\u043E\u0440\u0430\u043B\u044C: "
string,0x016271,"G-Cost:","\u0426\u0435\u043D\u0430:  "

# ---- morale
reloc,0x01594A,"Norm","\u041D\u043E\u0440\u043C."
reloc,0x01594C,"Low","\u041D\u0438\u0437\u043A."
reloc,0x01594E,"High","\u0412\u044B\u0441."

# ==== GARRISON SCREEN =====================================================================

# ---- army list
# FUN_18ac_0be5's right column, 8 chars measured: <verb1> / "(A-E) " on rows 0-1, "Space to"
# / <verb2> on rows 3-4, and the caller swaps the verbs, so each has to read in both slots.
reloc,0x0186e5,"Remove","\u0417\u0430\u0431\u0440\u0430\u0442\u044C"
reloc,0x0186e7,"Garrison","\u041E\u0441\u0442\u0430\u0432\u0438\u0442\u044C"
reloc,0x0186e9,"Space to","\u041F\u0440\u043E\u0431\u0435\u043B:"
reloc,0x0186eb,"Empty","\u041F\u0443\u0441\u0442\u043E"

# ---- refusal
# FUN_18ac_05e3 indents each line by a hardcoded column from the byte table at DS 0x31f2;
# line 2's 9 centred a 10-char word, ours is 21.
bytes,0x018885,"09","02"
reloc,0x01888a,"You cannot garrison your","\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0439 \u043E\u0442\u0440\u044F\u0434 \u043D\u0435\u043B\u044C\u0437\u044F"
reloc,0x01888c,"last army!","\u043E\u0441\u0442\u0430\u0432\u0438\u0442\u044C \u0432 \u0433\u0430\u0440\u043D\u0438\u0437\u043E\u043D\u0435!"

# ==== DISMISS ARMY ========================================================================

# ---- picker
# FUN_19fe_1cde draws the prompt at column 1 and then parks the cursor at a hardcoded column
# 0x14, one past the 18-char English text; ours is 17.
reloc,0x00dce6,"Dismiss which army","\u0420\u0430\u0441\u043F\u0443\u0441\u0442\u0438\u0442\u044C \u043E\u0442\u0440\u044F\u0434:"
bytes,0x00dd76,"14","13"

# ---- confirmation
reloc,0x01897d,"If you Dismiss your last","\u0420\u0430\u0441\u043F\u0443\u0441\u0442\u0438\u0432 \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0439 \u043E\u0442\u0440\u044F\u0434,"
reloc,0x01897f,"army, you will be sent back","\u0432\u044B \u0441 \u043F\u043E\u0437\u043E\u0440\u043E\u043C \u0432\u0435\u0440\u043D\u0451\u0442\u0435\u0441\u044C"
reloc,0x018981,"to the King in disgrace.","\u043A \u043A\u043E\u0440\u043E\u043B\u044E."
reloc,0x018983,"Dismiss last army (y/n)?","\u0420\u0430\u0441\u043F\u0443\u0441\u0442\u0438\u0442\u044C? (y/n) "

# ==== SEARCH PROMPT =======================================================================
# Four draws at col 1 plus the y/n line at col 16; the 28-char English line 2 is the budget.
# The day count prints inside line 2, between its two strings, so no wording can move it
# off; it is always 10 \u2014 the byte making it 1 (cmp DS:0x6457 at 0xE107) is BSS and never
# written.
reloc,0x018e7f,"Search...","\u0420\u0430\u0441\u043A\u043E\u043F\u043A\u0438"
reloc,0x018e81,"It will take ","\u0422\u0443\u0442 \u0440\u0430\u0431\u043E\u0442\u044B \u043D\u0430 "
reloc,0x018e83," days to do a"," \u0434\u043D\u0435\u0439 -"
reloc,0x018e85,"search of this area.","\u043F\u0435\u0440\u0435\u043A\u043E\u043F\u0430\u0442\u044C \u0432\u0441\u044E \u043E\u043A\u0440\u0443\u0433\u0443."
reloc,0x018e87,"Search (y/n)?","\u041A\u043E\u043F\u0430\u0442\u044C? (y/n)"
reloc,0x018e89,"Your search of this area has","\u0420\u0430\u0441\u043A\u043E\u043F\u043A\u0438 \u043D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u0434\u0430\u043B\u0438."
reloc,0x018e8b,"revealed nothing.",""

# ==== ADVENTURE MAP =======================================================================
# ---- enemy castle, siege prompt
reloc,0x0092f6,"Various groups of monsters","\u0420\u0430\u0437\u043D\u043E\u0448\u0435\u0440\u0441\u0442\u043D\u044B\u0435 \u0448\u0430\u0439\u043A\u0438 \u0447\u0443\u0434\u043E\u0432\u0438\u0449"
reloc,0x009379," and"," \u0441\u043E"
reloc,0x009392,"army ","\u0441\u0432\u043E\u0438\u043C \u0432\u043E\u0439\u0441\u043A\u043E\u043C "
string,0x019a88,"occupy this castle.","\u0437\u0430\u043D\u044F\u043B\u0438 \u0437\u0430\u043C\u043E\u043A."
string,0x019a9c,"Lay Siege (y/n)?","  \u041E\u0441\u0430\u0434\u0438\u0442\u044C? (y/n)"

# ---- without siege weapons
reloc,0x018e75,"You need siege weapons to","\u0414\u043B\u044F \u0448\u0442\u0443\u0440\u043C\u0430 \u0437\u0430\u043C\u043A\u0430 \u043D\u0443\u0436\u043D\u0430"
reloc,0x018e77,"attack a castle.  (space)","\u043A\u0430\u0442\u0430\u043F\u0443\u043B\u044C\u0442\u0430.   (\u043F\u0440\u043E\u0431\u0435\u043B)"

# ---- scouts sight an enemy army
reloc,0x00b333,"Your scouts have sighted:","\u0412\u0430\u0448\u0438 \u0440\u0430\u0437\u0432\u0435\u0434\u0447\u0438\u043A\u0438 \u0432\u0438\u0434\u044F\u0442:"
reloc,0x00b451,"Attack (y/n)?","\u0410\u0442\u0430\u043A\u043E\u0432\u0430\u0442\u044C? (y/n)"
bytes,0x00B446,"10","0d"

# ---- wandering army: flees, or offers to join
reloc,0x0186ef,"flee in terror at the sight","\u0432 \u0443\u0436\u0430\u0441\u0435 \u0431\u0435\u0433\u0443\u0442, \u0437\u0430\u0432\u0438\u0434\u0435\u0432"
reloc,0x0186f1,"your vast army.","\u0432\u0430\u0448\u0435 \u043D\u0435\u0441\u043C\u0435\u0442\u043D\u043E\u0435 \u0432\u043E\u0439\u0441\u043A\u043E."
reloc,0x0186f5,"with desires of greater","\u0432 \u0436\u0430\u0436\u0434\u0435 \u043F\u043E\u0434\u0432\u0438\u0433\u043E\u0432 \u0438 \u0441\u043B\u0430\u0432\u044B"
reloc,0x0186f7,"glory, wish to join you","\u043F\u0440\u043E\u0441\u044F\u0442\u0441\u044F \u043A \u0432\u0430\u043C \u043D\u0430 \u0441\u043B\u0443\u0436\u0431\u0443."
# Foot line col 16 -> 15; shared with both branches, hence its extra leading space.
bytes,0x00B545,"10","0f"
reloc,0x0186f3,"      (space)","      (\u043F\u0440\u043E\u0431\u0435\u043B)"
reloc,0x0186f9,"Accept (y/n)?","\u041F\u0440\u0438\u043D\u044F\u0442\u044C? (y/n)"

# ==== COMBAT SCREEN =======================================================================
# ---- menu bar
# Entries 0-9 (the movement keys, A/C) are drawn by the same loop as the map's, then the
# index jumps to 19 \u2014 these six. "  F Fly" is printed in between, from the map's block
# below: the one entry the two lists genuinely share.
reloc,0x01086f,"Options / ","\u041E:\u041F\u043E\u043C\u043E\u0449\u044C  "
reloc,0x018bbf,"  G Give Up","  G \u0421\u0434\u0430\u0442\u044C\u0441\u044F"
reloc,0x018bc1,"  S Shoot","  S \u0421\u0442\u0440\u0435\u043B\u044F\u0442\u044C"
reloc,0x018bc3,"  U Use Magic","  U \u041A\u043E\u043B\u0434\u043E\u0432\u0430\u0442\u044C"
reloc,0x018bc5,"  V View Char","  V \u0413\u0435\u0440\u043E\u0439"
reloc,0x018bc7,"  W Wait","  W \u0416\u0434\u0430\u0442\u044C"
reloc,0x018bc9,"  SPC Pass","SPC \u041F\u0440\u043E\u043F\u0443\u0441\u0442\u0438\u0442\u044C \u0445\u043E\u0434"

# ---- status line: the acting army's flags
# Same top line, right of the name: comma-joined single letters, each a putchar immediate in
# FUN_1d9b_0cc7 rather than a string, so \`bytes\` rows are the only handle. Fly is a flag,
# the other two carry a count \u2014 \u041B(\u0435\u0442\u0430\u0435\u0442), \u0425(\u043E\u0434\u044B), \u0412(\u044B\u0441\u0442\u0440\u0435\u043B\u044B).
bytes,0x106E1,"46","8B"
bytes,0x107A7,"4D","95"
bytes,0x10829,"53","82"

# ---- action log
# One line in the lower bar: the acting army's name (FUN_1d9b_1663), then fragments at the
# cursor (FUN_1f51_1024). Every shape, all sized to a 35-column budget:
#   <army> vs <army> killing <n>     melee \u2014 the widest English line is exactly 35
#   <army> shoot <army> killing <n>  " vs " skipped, " shoot " already named the target
#   <army> retaliate killing <n>     the retaliator's name replaces "<vs> <army>"
#   <army> vs <army>, <n> die        same melee, shorter: NWC's guard for the 16 pairings
#                                    (0x128CC) whose long form would have run to 36
# The count always costs 3: FUN_1207_0321 divides by 1000 and appends 'K' past 999.
reloc,0x010d59," wait"," \u0436\u0434\u0443\u0442"
reloc,0x010d5e," pass"," \u043F\u0440\u043E\u043F\u0443\u0441\u043A\u0430\u044E\u0442 \u0445\u043E\u0434"
reloc,0x011099," are out of control!"," \u043D\u0435\u0443\u043F\u0440\u0430\u0432\u043B\u044F\u0435\u043C\u044B!"
reloc,0x012183," move"," \u0438\u0434\u0443\u0442"
reloc,0x01230a," fly"," \u043B\u0435\u0442\u044F\u0442"
reloc,0x01263c," shoot "," \\xB0\\xB1\\xB2\\xB3 "
reloc,0x0128a1," retaliate"," \u043E\u0442\u0432\u0435\u0447\u0430\u044E\u0442"
reloc,0x01887a," vs "," \\xB0\\xB1\\xB2\\xB3 "
reloc,0x01887c," killing ",", \u0443\u0431\u0438\u0442\u043E "
# That shorter tally is "7 die" / "1 dies": the 's' is verb agreement, appended when the
# count is 1. With "\u0443\u0431\u0438\u0442\u043E" ahead of the number the trailing slot empties, so that branch
# always jumps.
reloc,0x018880,", ",", \u0443\u0431\u0438\u0442\u043E "
reloc,0x01887e," die",""
bytes,0x0129F8,"75","EB"

# ---- refusals
reloc,0x0134c3,"Can't ",""
reloc,0x0187ce,"Fly","\u041D\u0435 \u0443\u043C\u0435\u044E\u0442 \u043B\u0435\u0442\u0430\u0442\u044C"
reloc,0x0187d0,"Cast","\u0412\u044B \u043D\u0435 \u0443\u043C\u0435\u0435\u0442\u0435 \u043A\u043E\u043B\u0434\u043E\u0432\u0430\u0442\u044C"
reloc,0x0187d2,"Shoot","\u041D\u0435 \u043C\u043E\u0433\u0443\u0442 \u0441\u0442\u0440\u0435\u043B\u044F\u0442\u044C"

# ---- demon's half ability
reloc,0x01356c,"HALF","1/2!"

# ---- victory
# The box is 36 columns wide, so "(\u043F\u0440\u043E\u0431\u0435\u043B)" \u2014 a char wider \u2014 needs its gotoxy 28 -> 27.
reloc,0x0115ff,"Victory!","\u041F\u043E\u0431\u0435\u0434\u0430!"
bytes,0x118D4,"1C","1B"
reloc,0x0118df,"(space)","(\u043F\u0440\u043E\u0431\u0435\u043B)"

# ---- victory, the spoils
# Table DS 0x308e, read only by FUN_1f51_0000 \u2014 the combat screen, not the king's castle.
# Text starts at column 1 of the same 36-column box, so 35 chars clip. Line 1 also carries
# the name (10 max) + " the " + rank (9 max) and a comma the code drops on column 35, so NWC
# sized it to the byte: the prefix has 13.
reloc,0x01871e,"Well done ","\u041E\u0442\u043B\u0438\u0447\u043D\u043E, "
reloc,0x018720,"you have successfully vanquished","\u0432\u044B \u0431\u043B\u0435\u0441\u0442\u044F\u0449\u0435 \u043E\u0434\u043E\u043B\u0435\u043B\u0438 \u043E\u0447\u0435\u0440\u0435\u0434\u043D\u043E\u0433\u043E"
reloc,0x018722,"yet another foe.","\u043F\u0440\u043E\u0442\u0438\u0432\u043D\u0438\u043A\u0430."
# Blanking the " and the" that trails the purse gives "capture of " a line of its own \u2014 the
# only way to name an undeclinable villain ("\u0426\u0430\u0440\u044C \u041D\u0438\u043A\u043E\u043B\u0430\u0439 \u0411\u0435\u0437\u0443\u043C\u043D\u044B\u0439", 21 + 9 = 30).
reloc,0x018724,"Spoils of War: ","\u0422\u0440\u043E\u0444\u0435\u0438: "
reloc,0x018738," gold"," \u0437\u043E\u043B."
reloc,0x018726," and the",""
reloc,0x018728,"capture of ","\u0412 \u043F\u043B\u0435\u043D\u0443: "
reloc,0x01872a,"For fulfilling your contract you","\u041F\u043E \u043A\u043E\u043D\u0442\u0440\u0430\u043A\u0442\u0443 \u0432\u0430\u043C \u043F\u043E\u043B\u0430\u0433\u0430\u0435\u0442\u0441\u044F"
reloc,0x01872c,"receive an additional ","\u043D\u0430\u0433\u0440\u0430\u0434\u0430: "
reloc,0x01872e,"as bounty... and a piece of the","\u0410 \u0432 \u0441\u043E\u043A\u0440\u043E\u0432\u0438\u0449\u043D\u0438\u0446\u0435 \u0437\u0430\u043C\u043A\u0430 \u043D\u0430\u0448\u043B\u0430\u0441\u044C"
reloc,0x018730,"map to the stolen scepter.","\u0447\u0430\u0441\u0442\u044C \u043A\u0430\u0440\u0442\u044B \u043A \u0421\u043A\u0438\u043F\u0435\u0442\u0440\u0443 \u043F\u043E\u0440\u044F\u0434\u043A\u0430."
reloc,0x018732,"Since you did not have the proper","\u0423\u0432\u044B, \u043A\u043E\u043D\u0442\u0440\u0430\u043A\u0442\u0430 \u043D\u0430 \u044D\u0442\u043E\u0433\u043E"
reloc,0x018734,"contract, the Lord has been set","\u0437\u043B\u043E\u0434\u0435\u044F \u0443 \u0432\u0430\u0441 \u043D\u0435 \u0431\u044B\u043B\u043E, \u0438 \u0435\u0433\u043E"
reloc,0x018736,"free.","\u043F\u0440\u0438\u0448\u043B\u043E\u0441\u044C \u043E\u0442\u043F\u0443\u0441\u0442\u0438\u0442\u044C."

# ---- give up
reloc,0x018e79,"Giving up will forfeit your","\u0421\u0434\u0430\u0432\u0448\u0438\u0441\u044C, \u0432\u044B \u043F\u043E\u0442\u0435\u0440\u044F\u0435\u0442\u0435"
reloc,0x018e7b,"armies and send you back to","\u0441\u0432\u043E\u0451 \u0432\u043E\u0439\u0441\u043A\u043E \u0438 \u0432\u0435\u0440\u043D\u0451\u0442\u0435\u0441\u044C"
reloc,0x018e7d,"the King. Give up (y/n)?","\u043A \u043A\u043E\u0440\u043E\u043B\u044E. \u0421\u0434\u0430\u0442\u044C\u0441\u044F? (y/n)"

# ==== SPELL CASTING =======================================================================

# ---- not trained yet
reloc,0x018637,"You have not been trained in","\u0412\u044B \u0435\u0449\u0451 \u043D\u0435 \u043E\u0431\u0443\u0447\u0435\u043D\u044B \u0438\u0441\u043A\u0443\u0441\u0441\u0442\u0432\u0443"
reloc,0x018639,"the art of spellcasting yet.","\u043C\u0430\u0433\u0438\u0438. \u041E\u0431\u0440\u0430\u0442\u0438\u0442\u0435\u0441\u044C \u043A \u0432\u0435\u043B\u0438\u043A\u043E\u043C\u0443"
reloc,0x01863b,"Visit the Archmage Aurange","\u0430\u0440\u0445\u0438\u043C\u0430\u0433\u0443 \u0410\u0443\u0440\u0430\u043D\u0436\u0443, \u0447\u0442\u043E \u0436\u0438\u0432\u0451\u0442"
reloc,0x01863d,"in Continentia at 11,19 for","\u0432 \u041A\u043E\u043D\u0442\u0438\u043D\u0435\u043D\u0442\u0438\u0438 (11,19), \u0438 \u043E\u043D"
reloc,0x01863f,"this ability.","\u043F\u043E\u0441\u0432\u044F\u0442\u0438\u0442 \u0432\u0430\u0441 \u0432 \u0441\u0432\u043E\u0438 \u0442\u0430\u0439\u043D\u044B."

# ---- Archmage Aurange
# FUN_18ac_0aa4 draws table DS 0x306b centred: entries 0-3 the offer, 4-8 the refusal. The
# "\u041F\u0440\u0438\u043D\u044F\u0442\u044C? (y/n)" foot is a separate draw, so it needs its own col 16 -> 15.
bytes,0x00B5D0,"10","0f"
reloc,0x0186fb,"The venerable Archmage,","\u041F\u043E\u0447\u0442\u0435\u043D\u043D\u044B\u0439 \u0430\u0440\u0445\u0438\u043C\u0430\u0433 \u0410\u0443\u0440\u0430\u043D\u0436"
reloc,0x0186fd,"Aurange, will teach you the","\u0433\u043E\u0442\u043E\u0432 \u043E\u0442\u043A\u0440\u044B\u0442\u044C \u0432\u0430\u043C \u0442\u0430\u0439\u043D\u044B"
reloc,0x0186ff,"secrets of spell casting for","\u043C\u0430\u0433\u0438\u0447\u0435\u0441\u043A\u043E\u0433\u043E \u0438\u0441\u043A\u0443\u0441\u0441\u0442\u0432\u0430"
reloc,0x018701,"5000 gold. ","\u0437\u0430 5000 \u0437\u043E\u043B\u043E\u0442\u044B\u0445."

# ---- Archmage Aurange, not enough gold
reloc,0x018703,"The sign said 5000 gold! Why","\u041D\u0430 \u0432\u044B\u0432\u0435\u0441\u043A\u0435 \u0436\u0435 \u0447\u0451\u0442\u043A\u043E \u0441\u043A\u0430\u0437\u0430\u043D\u043E:"
reloc,0x018705,"waste my valuable time when","5000 \u0437\u043E\u043B\u043E\u0442\u044B\u0445! \u0417\u0430\u0447\u0435\u043C \u0442\u0440\u0430\u0442\u0438\u0442\u044C"
reloc,0x018707,"you know you don''t have the","\u043C\u043E\u0451 \u0432\u0440\u0435\u043C\u044F, \u0435\u0441\u043B\u0438 \u0443 \u0432\u0430\u0441 \u043D\u0435\u0442"
reloc,0x018709,"required amount of gold?","\u043D\u0443\u0436\u043D\u043E\u0439 \u0441\u0443\u043C\u043C\u044B? \u0412\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u0439\u0442\u0435\u0441\u044C,"
reloc,0x01870b,"Begone until you do!","\u043A\u043E\u0433\u0434\u0430 \u0441\u043E\u0431\u0435\u0440\u0451\u0442\u0435 \u0435\u0451!"

# ---- spell book
reloc,0x00e34b,"Spells","\u0417\u0430\u043A\u043B\u0438\u043D\u0430\u043D\u0438\u044F"
reloc,0x00e36c,"Combat","\u0411\u043E\u0435\u0432\u044B\u0435"
reloc,0x00e385,"Adventuring","\u041F\u043E\u0445\u043E\u0434\u043D\u044B\u0435"
reloc,0x00e4b1,"Cast which ","\u041A\u0430\u043A\u043E\u0435 "
reloc,0x0188de,"Adventure","\u043F\u043E\u0445\u043E\u0434\u043D\u043E\u0435"
reloc,0x0188e0,"Combat","\u0431\u043E\u0435\u0432\u043E\u0435"
reloc,0x00e4ce," spell (A-G)?"," \u0437\u0430\u043A\u043B\u0438\u043D\u0430\u043D\u0438\u0435? (A-G) "
reloc,0x00e654,"You don't know that spell!","\u0412\u044B \u043D\u0435 \u0437\u043D\u0430\u0435\u0442\u0435 \u044D\u0442\u043E \u0437\u0430\u043A\u043B\u0438\u043D\u0430\u043D\u0438\u0435!"

# ---- combat target prompts
# Line limit 35. The leading space is the centring fix \u2014 FUN_2168_1063 centres over the
# width less the cursor column, and FUN_1207_0caf leaves the cursor at col 1, so every line
# rounds a column left; unlike patching 1063 it reaches only this sprintf. The bytes row
# swaps the sprintf arguments so the spell name leads (Turbo C has no %1$s); the blocks are
# adjacent and both 13 bytes, so nothing moves. Slot 6 hits the enemy, slot 7 your own;
# Teleport skips the helper.
bytes,0xF63F,"8a 46 08 b4 00 d1 e0 8b d8 ff b7 65 2e 8a 46 06 b4 00 d1 e0 8b d8 ff b7 52 32","8a 46 06 b4 00 d1 e0 8b d8 ff b7 52 32 8a 46 08 b4 00 d1 e0 8b d8 ff b7 65 2e"
reloc,0x00f65a,"%s%s"," %s%s"
reloc,0x0188ee,"Select enemy army to ",": \u0432\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043E\u0442\u0440\u044F\u0434 \u0432\u0440\u0430\u0433\u0430"
reloc,0x0188f0,"Select your army to ",": \u0432\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0441\u0432\u043E\u0439 \u043E\u0442\u0440\u044F\u0434"
reloc,0x00e89f,"Select army to %s"," %s: \u0432\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0441\u0432\u043E\u0439 \u043E\u0442\u0440\u044F\u0434"
reloc,0x0188f2,"Select new location","\u041A\u0443\u0434\u0430 \u0442\u0435\u043B\u0435\u043F\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C?"

# ---- combat spell effects
# Appended to a unit name (nominative plural, so the verb goes plural). Clone and Resurrect
# led with printnum(n), a numeral in front of a nominative; each site is one 68-byte run of
# four print blocks, reordered to name, verb, ' ', printnum(n). The count rides SI, which
# Turbo C callees preserve. Far calls slide here, so the row after each repoints their four
# contiguous relocation entries; Clone's ref slides too, 0xE863 -> 0xE848.
bytes,0xE828,"b8 20 00 50 b8 01 00 50 56 9a 55 12 68 11 83 c4 06 b8 20 00 50 9a eb 05 68 11 59 a0 33 b5 b4 00 b1 04 d3 e0 8b d8 8a 87 98 63 b4 00 d1 e0 8b d8 ff b7 88 02 9a 63 10 68 11 59 b8 c9 0c 50 9a 63 10 68 11 59","a0 33 b5 b4 00 b1 04 d3 e0 8b d8 8a 87 98 63 b4 00 d1 e0 8b d8 ff b7 88 02 9a 63 10 68 11 59 b8 c9 0c 50 9a 63 10 68 11 59 b8 20 00 50 9a eb 05 68 11 59 b8 20 00 50 b8 01 00 50 56 9a 55 12 68 11 83 c4 06"
bytes,0x15A0,"69 c8 00 00 5f c8 00 00 40 c8 00 00 34 c8 00 00","67 c8 00 00 58 c8 00 00 4e c8 00 00 44 c8 00 00"
bytes,0xEAD7,"b8 20 00 50 b8 01 00 50 56 9a 55 12 68 11 83 c4 06 b8 20 00 50 9a eb 05 68 11 59 a0 33 b5 b4 00 b1 04 d3 e0 8b d8 8a 87 98 63 b4 00 d1 e0 8b d8 ff b7 88 02 9a 63 10 68 11 59 ff 36 5c 32 9a 63 10 68 11 59","a0 33 b5 b4 00 b1 04 d3 e0 8b d8 8a 87 98 63 b4 00 d1 e0 8b d8 ff b7 88 02 9a 63 10 68 11 59 ff 36 5c 32 9a 63 10 68 11 59 b8 20 00 50 9a eb 05 68 11 59 b8 20 00 50 b8 01 00 50 56 9a 55 12 68 11 83 c4 06"
bytes,0x1648,"18 cb 00 00 0e cb 00 00 ef ca 00 00 e3 ca 00 00","16 cb 00 00 07 cb 00 00 fd ca 00 00 f3 ca 00 00"
reloc,0x00e848," cloned"," \u043A\u043B\u043E\u043D\u0438\u0440\u043E\u0432\u0430\u043D\u044B:"
reloc,0x0188ec," resurrected"," \u0432\u043E\u0441\u043A\u0440\u0435\u0448\u0435\u043D\u044B:"
reloc,0x0188e8," are frozen"," \u0437\u0430\u043C\u043E\u0440\u043E\u0436\u0435\u043D\u044B"

# ---- combat damage log
# Was <spell name> + " kills " + FUN_1f51_1024's "<count> <unit name>", a tail no Russian
# verb can govern: the numeral wants a genitive the helper never prints. The line ends on
# the count instead. The subject is \u041E\u0433\u043D\u0435\u043D\u043D\u044B\u0439 \u0448\u0430\u0440, \u041C\u043E\u043B\u043D\u0438\u044F or \u042D\u043A\u0437\u043E\u0440\u0446\u0438\u0437\u043C, so the verb must be
# 3sg present to skip gender agreement and intransitive to need no object; that leaves it 20
# chars. The bytes row drops the unit name by forcing the guard at 0x12A08 (jz -> jmp) that
# already skips it for the helper's other callers, so no far call moves and no relocation
# entry with it.
bytes,0x12A08,"74","eb"
reloc,0x0188ea," kills "," \u0440\u0430\u0437\u0438\u0442 \u0446\u0435\u043B\u044C. \u0423\u0431\u0438\u0442\u043E: "

reloc,0x0188e2,"This spell seems to have no effect!","\u0417\u0430\u043A\u043B\u0438\u043D\u0430\u043D\u0438\u0435 \u043D\u0435 \u043F\u043E\u0434\u0435\u0439\u0441\u0442\u0432\u043E\u0432\u0430\u043B\u043E!"
reloc,0x0188e4,"No undead armies","\u041D\u0435\u0436\u0438\u0442\u0438 \u0437\u0434\u0435\u0441\u044C \u043D\u0435\u0442"
reloc,0x0188e6,"No armies need resurrecting","\u0412\u043E\u0441\u043A\u0440\u0435\u0448\u0430\u0442\u044C \u043D\u0435\u043A\u043E\u0433\u043E"
reloc,0x0188f4,"Only 1 spell per round!","\u041E\u0434\u043D\u043E \u0437\u0430\u043A\u043B\u0438\u043D\u0430\u043D\u0438\u0435 \u0437\u0430 \u0440\u0430\u0443\u043D\u0434!"

# ---- Bridge
reloc,0x00ec14,"Build bridge in which direction \\x1a\\x18\\x19\\x1b"," \u0412 \u043A\u0430\u043A\u0443\u044E \u0441\u0442\u043E\u0440\u043E\u043D\u0443 \u0441\u0442\u0440\u043E\u0438\u0442\u044C \u043C\u043E\u0441\u0442? \\x1a\\x18\\x19\\x1b"
reloc,0x00edcf," You've built your bridge too far!","   \u041C\u043E\u0441\u0442 \u043D\u0435 \u0434\u043E\u0442\u044F\u043D\u0435\u0442\u0441\u044F \u0442\u0430\u043A \u0434\u0430\u043B\u0435\u043A\u043E!"
reloc,0x00edf1,"   What a waste of a good spell!","     \u0417\u0430\u043A\u043B\u0438\u043D\u0430\u043D\u0438\u0435 \u043F\u043E\u0442\u0440\u0430\u0447\u0435\u043D\u043E \u0437\u0440\u044F!"
reloc,0x00eee5,"Not a suitable location for a bridge","    \u0417\u0434\u0435\u0441\u044C \u043D\u0435\u043B\u044C\u0437\u044F \u043F\u043E\u0441\u0442\u0440\u043E\u0438\u0442\u044C \u043C\u043E\u0441\u0442"

# ---- Castle Gate / Town Gate
reloc,0x018641,"Castles you have been to:","\u0417\u0430\u043C\u043A\u0438, \u0433\u0434\u0435 \u0432\u044B \u043F\u043E\u0431\u044B\u0432\u0430\u043B\u0438:"
reloc,0x018643,"Revisit which castle? ","\u0412 \u043A\u0430\u043A\u043E\u0439 \u0437\u0430\u043C\u043E\u043A? "
reloc,0x018645,"Towns you have been to:","\u0413\u043E\u0440\u043E\u0434\u0430, \u0433\u0434\u0435 \u0432\u044B \u043F\u043E\u0431\u044B\u0432\u0430\u043B\u0438:"
reloc,0x018647,"Revisit which town? ","\u0412 \u043A\u0430\u043A\u043E\u0439 \u0433\u043E\u0440\u043E\u0434? "

# ---- Instant Army
reloc,0x0186c1,"have joined to your army.","\u0432\u0441\u0442\u0443\u043F\u0438\u043B\u0438 \u0432 \u0432\u0430\u0448\u0435 \u0432\u043E\u0439\u0441\u043A\u043E."
reloc,0x0186c3,"   There are no open slots  ","   \u041D\u0435\u0442 \u043D\u0438 \u0441\u0432\u043E\u0431\u043E\u0434\u043D\u044B\u0445 \u043C\u0435\u0441\u0442,"
reloc,0x0186c5,"  or any of this army type! ","   \u043D\u0438 \u043E\u0442\u0440\u044F\u0434\u0430 \u0442\u0430\u043A\u043E\u0433\u043E \u0442\u0438\u043F\u0430!"

# ==== DWELLING SCREEN =====================================================================

# ---- terrain header
string,0x01A33C,"Hill","\u0425\u043E\u043B\u043C"
string,0x01A357,"----","----"
reloc,0x0186CD,"Plains","\u0420\u0430\u0432\u043D\u0438\u043D\u0430"
reloc,0x0186D5,"------","-------"
string,0x01A348,"Forest"," \u041B\u0435\u0441"
string,0x01A363,"------"," ---"
reloc,0x0186D1,"Dungeon","\u0422\u0435\u043C\u043D\u0438\u0446\u0430"
reloc,0x0186D9,"-------","-------"

# ---- recruit dialogue
# The count printed first \u2014 "150 \u0421\u043A\u0435\u043B\u0435\u0442\u044B", a numeral in front of a nominative plural. The
# block at 0xACCD splits 15/42/15/19/10 = A/B/C/D/E and is rewritten A+D+E+B + "eb 0d" +
# filler, putting the count at the cursor; the dropped goto(5,0x98) pays for the jmp and its
# filler keeps a 68 11 at 0xAD2F so no relocation target changes value. The second row
# repoints the 3 far calls that slid (the patcher does no code motion).
bytes,0xACCD,"b8 98 00 50 b8 01 00 50 9a b7 0f 68 11 59 59 b8 20 00 50 b8 01 00 50 8a 46 f8 b4 00 ba 0b 00 f7 ea 8a 56 06 b6 00 03 c2 8b d8 8a 87 ae 72 b4 00 50 9a 55 12 68 11 83 c4 06 b8 98 00 50 b8 05 00 50 9a b7 0f 68 11 59 59 8a 46 ff b4 00 d1 e0 8b d8 ff b7 88 02 9a 63 10 68 11 59 b8 48 0a 50 9a 63 10 68 11 59","b8 98 00 50 b8 01 00 50 9a b7 0f 68 11 59 59 8a 46 ff b4 00 d1 e0 8b d8 ff b7 88 02 9a 63 10 68 11 59 b8 48 0a 50 9a 63 10 68 11 59 b8 20 00 50 b8 01 00 50 8a 46 f8 b4 00 ba 0b 00 f7 ea 8a 56 06 b6 00 03 c2 8b d8 8a 87 ae 72 b4 00 50 9a 55 12 68 11 83 c4 06 eb 0d 90 90 90 90 90 90 90 90 90 90 68 11 90"
bytes,0xDD4,"25 8d 00 00 11 8d 00 00 01 8d 00 00","1e 8d 00 00 f6 8c 00 00 ec 8c 00 00"
string,0x0160D8," are available"," \u043A \u043D\u0430\u0439\u043C\u0443: "
string,0x0160E7,"Cost= ","\u0426\u0435\u043D\u0430: "
reloc,0x00AD69," each."," \u043A\u0430\u0436\u0434\u044B\u0439"
string,0x0160F5,"You may recruit up to ","\u041C\u043E\u0436\u043D\u043E \u043D\u0430\u043D\u044F\u0442\u044C \u0434\u043E "
string,0x01610C,"Recruit how many ","\u0421\u043A\u043E\u043B\u044C\u043A\u043E \u043D\u0430\u043D\u044F\u0442\u044C?  "

# ---- refusal
string,0x01A66B,"You already have the maximum","   \u0423 \u0432\u0430\u0441 \u0443\u0436\u0435 \u043C\u0430\u043A\u0441\u0438\u043C\u0430\u043B\u044C\u043D\u043E\u0435"
string,0x01A688,"number of armies!","  \u0447\u0438\u0441\u043B\u043E \u043E\u0442\u0440\u044F\u0434\u043E\u0432!"

# ==== CHARACTER SCREEN ====================================================================
string,0x01A824,"Leadership","\u041B\u0438\u0434\u0435\u0440\u0441\u0442\u0432\u043E"
reloc,0x018912,"Commission/Week","\u0416\u0430\u043B\u043E\u0432\u0430\u043D\u044C\u0435 \u0432 \u043D\u0435\u0434\u0435\u043B\u044E"
reloc,0x018914,"Gold","\u0417\u043E\u043B\u043E\u0442\u043E"
string,0x01A844,"Spell power","\u0421\u0438\u043B\u0430 \u043C\u0430\u0433\u0438\u0438"
reloc,0x018918,"Max # of spells","\u041C\u0430\u043A\u0441\u0438\u043C\u0443\u043C \u0437\u0430\u043A\u043B\u0438\u043D\u0430\u043D\u0438\u0439"
string,0x01A860,"Villains caught","\u0417\u043B\u043E\u0434\u0435\u0435\u0432 \u043F\u043E\u0439\u043C\u0430\u043D\u043E"
reloc,0x01891C,"Artifacts found","\u0410\u0440\u0442\u0435\u0444\u0430\u043A\u0442\u043E\u0432 \u043D\u0430\u0439\u0434\u0435\u043D\u043E"
string,0x01A880,"Castles garrisoned","\u0417\u0430\u043C\u043A\u043E\u0432 \u0437\u0430\u043D\u044F\u0442\u043E"
string,0x01A893,"Followers killed","\u0412\u043E\u0438\u043D\u043E\u0432 \u043F\u043E\u0442\u0435\u0440\u044F\u043D\u043E"
string,0x01A8A4,"Current score","\u0422\u0435\u043A\u0443\u0449\u0438\u0439 \u0441\u0447\u0451\u0442"

# ==== KING'S CASTLE =======================================================================

# ---- main
string,0x016047,"Castle ","\u0417\u0430\u043C\u043E\u043A "
reloc,0x018462,"of King Maximus","\u043A\u043E\u0440\u043E\u043B\u044F \u041C\u0430\u043A\u0441\u0438\u043C\u0443\u0441\u0430"
string,0x01A6CF,"B) Audience with the King","B) \u0410\u0443\u0434\u0438\u0435\u043D\u0446\u0438\u044F \u0443 \u043A\u043E\u0440\u043E\u043B\u044F"

# ---- recruit soldiers
string,0x01A6BE,"Recruit Soldiers","\u041D\u0430\u043D\u044F\u0442\u044C \u0432\u043E\u0439\u0441\u043A\u0430"
string,0x01A3C5,"n/a","\u043D\u0435\u0442"
string,0x01614D,"Max=","\u0414\u043E:"
reloc,0x00BE3E,"How Many","\u0421\u043A\u043E\u043B\u044C\u043A\u043E?"
string,0x01A6E9,"You don't have enough gold!","\u041D\u0435\u0434\u043E\u0441\u0442\u0430\u0442\u043E\u0447\u043D\u043E \u0437\u043E\u043B\u043E\u0442\u0430!"

# ---- audience intro
reloc,0x0185AF,"Trumpets announce your","\u0422\u0440\u0443\u0431\u044B \u0432\u043E\u0437\u0432\u0435\u0449\u0430\u044E\u0442 \u043E \u0432\u0430\u0448\u0435\u043C"
string,0x01A074,"arrival with regal fanfare.","\u043F\u0440\u0438\u0431\u044B\u0442\u0438\u0438 \u0441 \u043F\u043E\u0447\u0435\u0441\u0442\u044F\u043C\u0438."
string,0x01A091,"King Maximus rises from his","\u041A\u043E\u0440\u043E\u043B\u044C \u041C\u0430\u043A\u0441\u0438\u043C\u0443\u0441 \u043F\u043E\u0434\u043D\u0438\u043C\u0430\u0435\u0442\u0441\u044F"
string,0x01A0AD,"throne to greet you and","\u0441 \u0442\u0440\u043E\u043D\u0430 \u0432\u0430\u043C \u043D\u0430\u0432\u0441\u0442\u0440\u0435\u0447\u0443"
string,0x01A0C5,"proclaims:           (space)","\u0438 \u043F\u0440\u043E\u0432\u043E\u0437\u0433\u043B\u0430\u0448\u0430\u0435\u0442:    (\u043F\u0440\u043E\u0431\u0435\u043B)"

# ---- audience, not enough villains
# Line 3 is assembled in code as [text][N][" more"][line 4 "villain"][optional "s"]["."],
# which cannot agree with a Russian numeral. Reworded to put the noun before N ("\u0432\u044B \u043F\u043E\u0439\u043C\u0430\u0435\u0442\u0435
# \u0435\u0449\u0451 \u0437\u043B\u043E\u0434\u0435\u0435\u0432: 3."), then " more" is blanked and two code bytes drop the now-redundant 4th
# line and the plural "s" (loop bound 4->3; JNG->JMP). N reaches 14, so the line 3 prefix
# must stay <= 25 chars to fit the ~28-char box.
reloc,0x0185BB,"My dear ","\u041F\u0440\u0438\u0432\u0435\u0442\u0441\u0442\u0432\u0443\u044E, "
string,0x01A0EB,"I can aid you better after","\u042F \u0441\u043C\u043E\u0433\u0443 \u043F\u043E\u043C\u043E\u0447\u044C \u0432\u0430\u043C, \u043A\u043E\u0433\u0434\u0430"
reloc,0x0185BF,"you've captured ","\u0432\u044B \u043F\u043E\u0439\u043C\u0430\u0435\u0442\u0435 \u0435\u0449\u0451 \u0437\u043B\u043E\u0434\u0435\u0435\u0432: "
string,0x016041," more",""
bytes,0x00A630,"04","03"
bytes,0x00A636,"7E","EB"

# ---- audience, promotion
string,0x01A11F,"Congratulations ","\u041F\u043E\u0437\u0434\u0440\u0430\u0432\u043B\u044F\u044E, "
string,0x01A130,"I now promote you to ","\u041E\u0442\u043D\u044B\u043D\u0435 \u0432\u0430\u0448\u0435 \u0437\u0432\u0430\u043D\u0438\u0435 - "

# ---- audience, already at top rank
string,0x01A146,"Hurry and recover my Scepter","\u041F\u043E\u0441\u043F\u0435\u0448\u0438\u0442\u0435 \u0432\u0435\u0440\u043D\u0443\u0442\u044C \u0421\u043A\u0438\u043F\u0435\u0442\u0440"
string,0x01A163,"of Order or all will be","\u043F\u043E\u0440\u044F\u0434\u043A\u0430, \u0438\u043B\u0438 \u0432\u0441\u0451 \u0431\u0443\u0434\u0435\u0442"
reloc,0x0185CB,"lost!","\u043F\u043E\u0442\u0435\u0440\u044F\u043D\u043E!"

# ---- sent back in disgrace
reloc,0x018d48,"After being disgraced on the","\u041F\u043E\u0441\u043B\u0435 \u043F\u043E\u0437\u043E\u0440\u043D\u043E\u0433\u043E \u043F\u043E\u0440\u0430\u0436\u0435\u043D\u0438\u044F"
reloc,0x018d4a,"field of battle, King","\u043D\u0430 \u043F\u043E\u043B\u0435 \u0431\u043E\u044F \u043A\u043E\u0440\u043E\u043B\u044C \u041C\u0430\u043A\u0441\u0438\u043C\u0443\u0441"
reloc,0x018d4c,"Maximus summons you to his","\u0432\u044B\u0437\u044B\u0432\u0430\u0435\u0442 \u0432\u0430\u0441 \u0432 \u0441\u0432\u043E\u0439 \u0437\u0430\u043C\u043E\u043A."
reloc,0x018d4e,"castle. After a lesson in","\u0414\u0430\u0432 \u0432\u0430\u043C \u0443\u0440\u043E\u043A \u0442\u0430\u043A\u0442\u0438\u043A\u0438, \u043E\u043D"
reloc,0x018d50,"tactics, he reluctantly re-","\u0441 \u043D\u0435\u043E\u0445\u043E\u0442\u043E\u0439 \u0432\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u0442 \u0432\u0430\u043C"
reloc,0x018d52,"issues your commission and","\u0436\u0430\u043B\u043E\u0432\u0430\u043D\u044C\u0435 \u0438 \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u044F\u0435\u0442 \u0432\u0430\u0441"
reloc,0x018d54,"sends you on your way.","\u0432 \u043F\u0443\u0442\u044C."

# ==== TOWN SCREEN =========================================================================
# 28 chars max. The rent price is one hardcoded digit ('1' or '5', chosen at 0x009605)
# followed by the "00 week)" row, so the rent line is a fixed 27 chars and cannot grow with
# the price.

# ---- main menu
reloc,0x00a6c1,"Town of ","\u0413\u043E\u0440\u043E\u0434 "
reloc,0x0184e9,"A) Get New Contract","A) \u041D\u043E\u0432\u044B\u0439 \u043A\u043E\u043D\u0442\u0440\u0430\u043A\u0442"
reloc,0x0184eb,"B) Rent boat (","B) \u041D\u0430\u043D\u044F\u0442\u044C \u043A\u043E\u0440\u0430\u0431\u043B\u044C ("
reloc,0x00961c,"00 week)","00/\u043D\u0435\u0434)"
reloc,0x0184f3,"B) Cancel boat rental","B) \u0412\u0435\u0440\u043D\u0443\u0442\u044C \u043A\u043E\u0440\u0430\u0431\u043B\u044C"
reloc,0x0184ed,"C) Gather information","C) \u0421\u043E\u0431\u0440\u0430\u0442\u044C \u0441\u0432\u0435\u0434\u0435\u043D\u0438\u044F"
# The spell line is "D) " + spell name + " spell " + '(' + price + ')'. Russian cannot
# decline the name after the noun, so the noun moves in front of it as an abbreviated label
# on the "D) " prefix, and " spell " shrinks to the space before the price. Budget: the
# 9-char prefix leaves 16 for name + price digits, so a 4-digit spell may not exceed 12
# chars ("\u041F\u0440\u0438\u0437\u044B\u0432 \u0432\u043E\u0439\u0441\u043A"); the longest lines land on exactly 28.
reloc,0x0184ef,"D) ","D) \u0417\u0430\u043A\u043B. "
reloc,0x009660," spell "," "
reloc,0x0184f1,"E) Buy seige weapons (3000)","E) \u041A\u0443\u043F\u0438\u0442\u044C \u043A\u0430\u0442\u0430\u043F\u0443\u043B\u044C\u0442\u0443 (3000)"

# ---- refusals
reloc,0x0188dc,"Please vacate the boat first","\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0441\u043E\u0439\u0434\u0438\u0442\u0435 \u0441 \u043A\u043E\u0440\u0430\u0431\u043B\u044F"
reloc,0x0098dc,"You have seige weapons!","\u041A\u0430\u0442\u0430\u043F\u0443\u043B\u044C\u0442\u0430 \u0443\u0436\u0435 \u043A\u0443\u043F\u043B\u0435\u043D\u0430!"

# ---- gather information
# Line 1 is "Castle " + name + this row; line 2 is ["your" | "no one's" | villain name +
# "'s"] + " rule" + '.'. No Russian genitive can agree with an undeclinable name, so it is
# recast as a label and its answer, with " rule" and "'s" blanked.
reloc,0x0097d4," is under",", \u0445\u043E\u0437\u044F\u0438\u043D:"
reloc,0x0097ff,"your","\u0432\u044B"
reloc,0x00980f,"no one's","\u043D\u0438\u043A\u0442\u043E"
reloc,0x009843,"'s",""
reloc,0x009865," rule",""

# ---- spell purchase
# Refusal is two centred lines at columns 4 and 3. The tally is "You can learn " + N + "
# more spell" + 's' + '.', where the 's' is an unconditional English plural, so the branch
# that appends it becomes a jump that always skips it (JZ -> JMP), the same fix as the
# king's audience above.
reloc,0x00a7bd,"You have learned your","\u0412\u044B \u0432\u044B\u0443\u0447\u0438\u043B\u0438 \u043F\u0440\u0435\u0434\u0435\u043B\u044C\u043D\u043E\u0435"
reloc,0x00a7d6,"maximum number of spells.","   \u0447\u0438\u0441\u043B\u043E \u0437\u0430\u043A\u043B\u0438\u043D\u0430\u043D\u0438\u0439."
reloc,0x00a841,"You can learn ","\u041C\u043E\u0436\u043D\u043E \u0432\u044B\u0443\u0447\u0438\u0442\u044C \u0435\u0449\u0451: "
reloc,0x00a85c," more spell",""
bytes,0x00A868,"74","EB"

# ==== MISCELLANEOUS =======================================================================

# ---- name/class connector
# "(name) the (class)" -> ", " (Taiga the Sorceress -> Taiga, \u041A\u043E\u043B\u0434\u0443\u043D\u044C\u044F)
string,0x1A181," the ",", "

# ---- gold amounts (town, dwellings, etc.)
reloc,0x005E82,"GP=","\u0417\u043E\u043B:"

# ---- empty-list placeholder
# res/gate_picker.asm hardcodes DS 0x0d9e, so this string must stay where it is.
string,0x01642E,"(none)","(\u043D\u0435\u0442)"

# ==== BOAT TRAVEL MENU ====================================================================
string,0x01A992,"1. Continentia","1. \u041A\u043E\u043D\u0442\u0438\u043D\u0435\u043D\u0442\u0438\u044F"
string,0x01A9A1,"2. Forestria","2. \u0424\u043E\u0440\u0435\u0441\u0442\u0440\u0438\u044F"
string,0x01A9AE,"3. Archipelia","3. \u0410\u0440\u0445\u0438\u043F\u0435\u043B\u0438\u044F"
string,0x01A9BC,"4. Saharia","4. \u0421\u0430\u0445\u0430\u0440\u0438\u044F"
string,0x01A9C7,"Go to which continent? ","\u041A\u0443\u0434\u0430 \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u044F\u0435\u043C\u0441\u044F? "

# ==== WEEK CHANGE =========================================================================

# ---- astrologers / repopulation
reloc,0x00d5fa,"Astrologers proclaim:","\u0410\u0441\u0442\u0440\u043E\u043B\u043E\u0433\u0438 \u0432\u043E\u0437\u0432\u0435\u0449\u0430\u044E\u0442, \u0447\u044C\u044F"
reloc,0x00d613,"Week of the ","\u043D\u044B\u043D\u0447\u0435 \u043D\u0435\u0434\u0435\u043B\u044F: "
reloc,0x00d6f4,"All ",""
reloc,0x00d711," dwellings are",": \u0432\u0441\u0435 \u0436\u0438\u043B\u0438\u0449\u0430"
reloc,0x00d72a,"repopulated.","\u043F\u043E\u043F\u043E\u043B\u043D\u0435\u043D\u044B."
# Foot prompt, via a pointer: endings-table slot 40, which its own loops never reach.
# "(\u043F\u0440\u043E\u0431\u0435\u043B)" is a char wider than "(space)", so the goto moves one column left.
bytes,0xD738,"16","15"
reloc,0x018edd,"(space)","(\u043F\u0440\u043E\u0431\u0435\u043B)"
reloc,0x00dbd8,"Week #","\u041D\u0435\u0434\u0435\u043B\u044F "

# ---- budget box
reloc,0x00d783,"Budget","\u0411\u044E\u0434\u0436\u0435\u0442"
reloc,0x018954,"On Hand","\u041A\u0430\u0437\u043D\u0430"
reloc,0x018956,"Payment","\u0414\u043E\u0445\u043E\u0434"
reloc,0x018958,"Boat","\u041A\u043E\u0440\u0430\u0431\u043B\u044C"
reloc,0x01895a,"Army","\u0410\u0440\u043C\u0438\u044F"
reloc,0x01895c,"Balance","\u0418\u0442\u043E\u0433\u043E"
# Slot 6 of the same table; the ledger loop only reads slots 1-5, so this one is not drawn
# anywhere we could find \u2014 translated just in case.
reloc,0x01895e,"Leave","\u0423\u0448\u043B\u0438"
reloc,0x00d870,"Leave","\u0423\u0448\u043B\u0438"

# ==== ENDINGS =============================================================================
# FUN_1207_2b88 draws 20 rows from table DS 0x37fd \u2014 victory slots 0-19, defeat 20-39 \u2014 into
# box 13, x 16..159, the ending picture flush against it at x 160: 18 columns, of which the
# text uses 16 from column 1. The row count is fixed and the last slot of each stays empty:
# victory's would land on row 20, where the caller draws the score (fixed y 0xb6), and
# defeat's is the bottom margin. The hero's name follows slot 0 (victory: alone on its row,
# leaving slot 1 unused) or slot 20, and the rank title from the class table opens the next
# row for slot 2 / 21 to continue \u2014 those two rows lose the longest rank's 9 chars.

# ---- margins: text starts at column 1, row 1
# The five \`xor ax,ax\` are the cursor's x argument \u2014 row loop, victory name row, both rank
# rows (via FUN_1207_2de4), score row in the caller; \`mov al,1\` is the same length and AH is
# already 0 from the y computation. The sixth patch is the row counter's initial value.
bytes,0x006BC0,33C0,B001
bytes,0x006C42,33C0,B001
bytes,0x006C89,33C0,B001
bytes,0x006CBA,33C0,B001
bytes,0x006CD8,33C0,B001
bytes,0x006C05,00,01

# ---- victory
reloc,0x018e8d,"Congratulations,","\u041F\u043E\u0437\u0434\u0440\u0430\u0432\u043B\u044F\u0435\u043C,"
reloc,0x018e91,"! You","! \u0412\u044B"
reloc,0x018e93,"have recovered the","\u0432\u044B\u0440\u0432\u0430\u043B\u0438 \u0421\u043A\u0438\u043F\u0435\u0442\u0440"
reloc,0x018e95,"Sceptre of Order","\u043F\u043E\u0440\u044F\u0434\u043A\u0430 \u0438\u0437 \u043B\u0430\u043F"
reloc,0x018e97,"from the clutches","\u043B\u044E\u0442\u044B\u0445 \u0437\u043B\u043E\u0434\u0435\u0435\u0432."
reloc,0x018e99,"of the evil Master","\u0412 \u043D\u0430\u0433\u0440\u0430\u0434\u0443 \u0437\u0430 \u0442\u043E,"
reloc,0x018e9b,"Villains. As a","\u0447\u0442\u043E \u0432\u044B \u0441\u043F\u0430\u0441\u043B\u0438"
reloc,0x018e9d,"reward for saving","\u043A\u043E\u0440\u043E\u043B\u044F \u043E\u0442 \u0432\u0435\u0440\u043D\u043E\u0439"
reloc,0x018e9f,"himself and the","\u0433\u0438\u0431\u0435\u043B\u0438, \u0430 \u0447\u0435\u0442\u044B\u0440\u0435"
reloc,0x018ea1,"four continents","\u043A\u043E\u043D\u0442\u0438\u043D\u0435\u043D\u0442\u0430 - \u043E\u0442"
reloc,0x018ea3,"from ruin, King","\u0440\u0430\u0437\u043E\u0440\u0435\u043D\u0438\u044F, \u0441\u0430\u043C"
reloc,0x018ea5,"Maximus and his","\u041C\u0430\u043A\u0441\u0438\u043C\u0443\u0441 \u0438 \u0435\u0433\u043E"
reloc,0x018ea7,"subjects reward","\u043F\u043E\u0434\u0434\u0430\u043D\u043D\u044B\u0435 \u0436\u0430\u043B\u0443\u044E\u0442"
reloc,0x018ea9,"you with a large","\u0432\u0430\u043C \u043E\u0431\u0448\u0438\u0440\u043D\u044B\u0439"
reloc,0x018eab,"parcel of land,","\u0437\u0435\u043C\u0435\u043B\u044C\u043D\u044B\u0439 \u043D\u0430\u0434\u0435\u043B,"
reloc,0x018ead,"a rank of nobility","\u0434\u0432\u043E\u0440\u044F\u043D\u0441\u043A\u0438\u0439 \u0442\u0438\u0442\u0443\u043B"
reloc,0x018eaf,"and a medal","\u0438 \u043C\u0435\u0434\u0430\u043B\u044C \u0441 \u0432\u0430\u0448\u0438\u043C"
reloc,0x018eb1,"announcing your","\u0438\u0442\u043E\u0433\u043E\u0432\u044B\u043C \u0441\u0447\u0451\u0442\u043E\u043C:"
reloc,0x018eb3,"Final Score:",""

# ---- defeat
reloc,0x018eb5,"Oh, ","\u0423\u0432\u044B, "
reloc,0x018eb7,", you",", \u0432\u044B \u043D\u0435"
reloc,0x018eb9,"have failed to","\u0443\u0441\u043F\u0435\u043B\u0438 \u0432\u0435\u0440\u043D\u0443\u0442\u044C"
reloc,0x018ebb,"recover the","\u0421\u043A\u0438\u043F\u0435\u0442\u0440 \u043F\u043E\u0440\u044F\u0434\u043A\u0430"
reloc,0x018ebd,"Sceptre of Order","\u0438 \u0441\u043F\u0430\u0441\u0442\u0438 \u0441\u0442\u0440\u0430\u043D\u0443!"
reloc,0x018ebf,"in time to save","\u0412\u0441\u0435\u043C\u0438 \u043B\u044E\u0431\u0438\u043C\u044B\u0439"
reloc,0x018ec1,"the land! Beloved","\u043A\u043E\u0440\u043E\u043B\u044C \u041C\u0430\u043A\u0441\u0438\u043C\u0443\u0441"
reloc,0x018ec3,"King Maximus has","\u043C\u0451\u0440\u0442\u0432, \u0430 \u0442\u0440\u043E\u043D"
reloc,0x018ec5,"died and the Demon","\u0435\u0433\u043E \u0437\u0430\u043D\u044F\u043B \u043A\u043E\u0440\u043E\u043B\u044C"
reloc,0x018ec7,"King Urthrax","\u0434\u0435\u043C\u043E\u043D\u043E\u0432 \u0423\u0440\u0442\u0440\u0430\u043A\u0441"
reloc,0x018ec9,"Killspite rules in","\u0414\u0443\u0448\u0435\u0433\u0443\u0431. \u0427\u0435\u0442\u044B\u0440\u0435"
reloc,0x018ecb,"his place. The","\u043A\u043E\u043D\u0442\u0438\u043D\u0435\u043D\u0442\u0430 \u043B\u0435\u0436\u0430\u0442"
reloc,0x018ecd,"Four Continents","\u0432 \u0440\u0443\u0438\u043D\u0430\u0445, \u0430 \u0438\u0445"
reloc,0x018ecf,"lay in ruin about","\u043D\u0430\u0440\u043E\u0434 \u043E\u0431\u0440\u0435\u0447\u0451\u043D \u043D\u0430"
reloc,0x018ed1,"you, its people","\u0436\u0438\u0437\u043D\u044C \u0432 \u043D\u0438\u0449\u0435\u0442\u0435 \u0438"
reloc,0x018ed3,"doomed to a life","\u0443\u0433\u043D\u0435\u0442\u0435\u043D\u0438\u0438. \u0410 \u0432\u0441\u0451"
reloc,0x018ed5,"of misery and","\u043F\u043E\u0442\u043E\u043C\u0443, \u0447\u0442\u043E \u0432\u044B"
reloc,0x018ed7,"oppression because","\u0442\u0430\u043A \u0438 \u043D\u0435 \u043D\u0430\u0448\u043B\u0438"
reloc,0x018ed9,"you could not find","\u0421\u043A\u0438\u043F\u0435\u0442\u0440."
reloc,0x018edb,"the Sceptre.",""

# ==== NAME TABLES =========================================================================

# ---- unit names
reloc,0x015918,"Peasants","\u041A\u0440\u0435\u0441\u0442\u044C\u044F\u043D\u0435"
string,0x015C02,"Sprites","\u0424\u0435\u0438"
reloc,0x01591C,"Militia","\u041E\u043F\u043E\u043B\u0447\u0435\u043D\u0446\u044B"
string,0x015C12,"Wolves","\u0412\u043E\u043B\u043A\u0438"
string,0x015C19,"Skeletons","\u0421\u043A\u0435\u043B\u0435\u0442\u044B"
string,0x015C23,"Zombies","\u0417\u043E\u043C\u0431\u0438"
string,0x015C2B,"Gnomes","\u0413\u043D\u043E\u043C\u044B"
string,0x015C32,"Orcs","\u041E\u0440\u043A\u0438"
string,0x015C37,"Archers","\u041B\u0443\u0447\u043D\u0438\u043A\u0438"
string,0x015C3F,"Elves","\u042D\u043B\u044C\u0444\u044B"
reloc,0x01592C,"Pikemen","\u041A\u043E\u043F\u0435\u0439\u0449\u0438\u043A\u0438"
reloc,0x01592E,"Nomads","\u041A\u043E\u0447\u0435\u0432\u043D\u0438\u043A\u0438"
string,0x015C54,"Dwarves","\u0414\u0432\u043E\u0440\u0444\u044B"
reloc,0x015932,"Ghosts","\u041F\u0440\u0438\u0437\u0440\u0430\u043A\u0438"
string,0x015C63,"Knights","\u0420\u044B\u0446\u0430\u0440\u0438"
string,0x015C6B,"Ogres","\u041E\u0433\u0440\u044B"
string,0x015C71,"Barbarians","\u0412\u0430\u0440\u0432\u0430\u0440\u044B"
string,0x015C7C,"Trolls","\u0422\u0440\u043E\u043B\u043B\u0438"
reloc,0x01593C,"Cavalry","\u041A\u043E\u043D\u043D\u0438\u043A\u0438"
string,0x015C8B,"Druids","\u0414\u0440\u0443\u0438\u0434\u044B"
string,0x015C92,"Archmages","\u0410\u0440\u0445\u0438\u043C\u0430\u0433\u0438"
string,0x015C9C,"Vampires","\u0412\u0430\u043C\u043F\u0438\u0440\u044B"
reloc,0x015944,"Giants","\u0412\u0435\u043B\u0438\u043A\u0430\u043D\u044B"
string,0x015CAC,"Demons","\u0414\u0435\u043C\u043E\u043D\u044B"
string,0x015CB3,"Dragons","\u0414\u0440\u0430\u043A\u043E\u043D\u044B"

# ---- army-size prefixes
# Match HotA's wording more or less.
reloc,0x005f1b,"A few ","\u041C\u0430\u043B\u043E: "
reloc,0x005f16,"Some ","\u0413\u0440\u0443\u043F\u043F\u0430: "
reloc,0x005f0c,"Many ","\u0422\u043E\u043B\u043F\u0430: "
reloc,0x005f02,"A lot of ","\u041E\u0440\u0434\u0430: "
reloc,0x005ef8,"A horde of ","\u0422\u0443\u0447\u0430: "
reloc,0x005eee,"A multitude of ","\u0422\u044C\u043C\u0430: "

# ---- spell names
# 13 chars max on the cast screen, but see the town screen's spell line: one sold at a
# 4-digit price gets only 12.
reloc,0x0184f5,"Clone","\u041A\u043B\u043E\u043D\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435"
reloc,0x0184f7,"Teleport","\u0422\u0435\u043B\u0435\u043F\u043E\u0440\u0442"
reloc,0x0184f9,"Fireball","\u041E\u0433\u043D\u0435\u043D\u043D\u044B\u0439 \u0448\u0430\u0440"
reloc,0x0184fb,"Lightning","\u041C\u043E\u043B\u043D\u0438\u044F"
reloc,0x0184fd,"Freeze","\u0417\u0430\u043C\u043E\u0440\u043E\u0437\u043A\u0430"
reloc,0x0184ff,"Resurrect","\u0412\u043E\u0441\u043A\u0440\u0435\u0448\u0435\u043D\u0438\u0435"
reloc,0x018501,"Turn Undead","\u042D\u043A\u0437\u043E\u0440\u0446\u0438\u0437\u043C"
reloc,0x018503,"Bridge","\u041C\u043E\u0441\u0442"
reloc,0x018505,"Time Stop","\u0421\u0442\u0430\u0437\u0438\u0441"
reloc,0x018507,"Find Villain","\u041F\u043E\u0438\u0441\u043A \u0437\u043B\u043E\u0434\u0435\u044F"
reloc,0x018509,"Castle Gate","\u0412\u0440\u0430\u0442\u0430 \u0437\u0430\u043C\u043A\u0430"
reloc,0x01850b,"Town Gate","\u0412\u0440\u0430\u0442\u0430 \u0433\u043E\u0440\u043E\u0434\u0430"
reloc,0x01850d,"Instant Army","\u041F\u0440\u0438\u0437\u044B\u0432 \u0432\u043E\u0439\u0441\u043A"
string,0x019C93,"Raise Control","\u0414\u0430\u0440 \u043B\u0438\u0434\u0435\u0440\u0441\u0442\u0432\u0430"

# ---- character classes
string,0x1A187,"Knight","\u0420\u044B\u0446\u0430\u0440\u044C"
string,0x01A18E,"General","\u0413\u0435\u043D\u0435\u0440\u0430\u043B"
string,0x01A196,"Marshal","\u041C\u0430\u0440\u0448\u0430\u043B"
string,0x01A19E,"Lord","\u041B\u043E\u0440\u0434"
string,0x1A1A3,"Paladin","\u041F\u0430\u043B\u0430\u0434\u0438\u043D"
reloc,0x0185D9,"Crusader","\u0425\u0440\u0430\u043C\u043E\u0432\u043D\u0438\u043A"
reloc,0x0185DB,"Avenger","\u041C\u0441\u0442\u0438\u0442\u0435\u043B\u044C"
string,0x01A1BC,"Champion","\u0427\u0435\u043C\u043F\u0438\u043E\u043D"
string,0x1A1C5,"Sorceress","\u041A\u043E\u043B\u0434\u0443\u043D\u044C\u044F"
reloc,0x0185E1,"Magician","\u041A\u0443\u0434\u0435\u0441\u043D\u0438\u0446\u0430"
reloc,0x0185E3,"Mage","\u0427\u0430\u0440\u043E\u0434\u0435\u0439\u043A\u0430"
string,0x01A1DD,"Archmage","\u0410\u0440\u0445\u0438\u043C\u0430\u0433"
string,0x1A1E6,"Barbarian","\u0412\u0430\u0440\u0432\u0430\u0440"
string,0x01A1F0,"Chieftain","\u0412\u043E\u0436\u0434\u044C"
string,0x01A1FA,"Warlord","\u0412\u043E\u0435\u0432\u043E\u0434\u0430"
string,0x01A202,"Overlord","\u0412\u043B\u0430\u0434\u044B\u043A\u0430"

# ---- continent names
string,0x016C0A,"Continentia","\u041A\u043E\u043D\u0442\u0438\u043D\u0435\u043D\u0442\u0438\u044F"
string,0x016C16,"Forestria","\u0424\u043E\u0440\u0435\u0441\u0442\u0440\u0438\u044F"
string,0x016C20,"Archipelia","\u0410\u0440\u0445\u0438\u043F\u0435\u043B\u0438\u044F"
string,0x016C2B,"Saharia","\u0421\u0430\u0445\u0430\u0440\u0438\u044F"

# ---- villain names
# Their own table, separate from the contract screen's "Name: " lines: it feeds the town's
# gather-information line 2 (<= 26 chars, the '.' follows) and the victory screen. The first
# two fit their own slots (16 and 14 chars) and are left in place; both have a ref if a
# rewording needs the pool.
string,0x018EDF,"Murray the Miser","\u041C\u044E\u0440\u0440\u0435\u0439 \u0421\u043A\u0440\u044F\u0433\u0430"
string,0x018EF0,"Hack the Rogue","\u0425\u0430\u043A \u041F\u0440\u043E\u0445\u0432\u043E\u0441\u0442"
reloc,0x01826a,"Princess Aimola","\u041F\u0440\u0438\u043D\u0446\u0435\u0441\u0441\u0430 \u0410\u0439\u043C\u043E\u043B\u0430"
reloc,0x01826c,"Baron Johnno Makahl","\u0411\u0430\u0440\u043E\u043D \u0414\u0436\u043E\u043D\u043D\u043E \u041C\u0430\u043A\u0430\u043B"
reloc,0x01826e,"Dread Pirate Rob","\u0423\u0436\u0430\u0441\u043D\u044B\u0439 \u041F\u0438\u0440\u0430\u0442 \u0420\u043E\u0431"
reloc,0x018270,"Canegor the Mystic","\u041A\u0430\u043D\u0435\u0433\u043E\u0440 \u041C\u0438\u0441\u0442\u0438\u043A"
reloc,0x018272,"Sir Moradon the Cruel","\u0421\u044D\u0440 \u041C\u043E\u0440\u0430\u0434\u043E\u043D \u0416\u0435\u0441\u0442\u043E\u043A\u0438\u0439"
reloc,0x018274,"Prince Barrowpine","\u041F\u0440\u0438\u043D\u0446 \u0411\u0430\u0440\u0440\u043E\u0443\u043F\u0430\u0439\u043D"
reloc,0x018276,"Bargash Eyesore","\u0411\u0430\u0440\u0433\u0430\u0448 \u041E\u0431\u0440\u0430\u0437\u0438\u043D\u0430"
reloc,0x018278,"Rinaldus Drybone","\u0420\u0438\u043D\u0430\u043B\u044C\u0434\u0443\u0441 \u041A\u043E\u0441\u0442\u043B\u044F\u0432\u044B\u0439"
reloc,0x01827a,"Ragface","\u041B\u043E\u0445\u043C\u043E\u0442\u043D\u0438\u043A"
reloc,0x01827c,"Mahk Bellowspeak","\u041C\u0430\u043A \u0413\u043E\u0440\u043B\u043E\u043F\u0430\u043D"
reloc,0x01827e,"Auric Whiteskin","\u0410\u0443\u0440\u0438\u043A \u0411\u0435\u043B\u043E\u0448\u043A\u0443\u0440\u044B\u0439"
reloc,0x018280,"Czar Nickolai the Mad","\u0426\u0430\u0440\u044C \u041D\u0438\u043A\u043E\u043B\u0430\u0439 \u0411\u0435\u0437\u0443\u043C\u043D\u044B\u0439"
reloc,0x018282,"Magus Deathspell","\u041C\u0430\u0433\u0443\u0441 \u0427\u0435\u0440\u043D\u043E\u043A\u043D\u0438\u0436\u043D\u0438\u043A"
reloc,0x018284,"Urthrax Killspite","\u0423\u0440\u0442\u0440\u0430\u043A\u0441 \u0414\u0443\u0448\u0435\u0433\u0443\u0431"
reloc,0x018286,"Arech Dragonbreath","\u0410\u0440\u0435\u0445 \u041E\u0433\u043D\u0435\u0434\u044B\u0448\u0430\u0449\u0438\u0439"

# ---- castle names
# Two copies of the same 27 entries that must stay in lockstep: table DS 0x1368 (contract
# screens) and DS 0x2d9e (town gather-information, king's castle, the gate picker).
reloc,0x0169f8,"Azram","\u0410\u0437\u0440\u0430\u043C"
reloc,0x0169fa,"Basefit","\u0411\u0435\u0439\u0441\u0444\u0438\u0442"
reloc,0x0169fc,"Cancomar","\u041A\u0430\u043D\u043A\u043E\u043C\u0430\u0440"
reloc,0x0169fe,"Duvock","\u0414\u0443\u0432\u043E\u043A"
reloc,0x016a00,"Endryx","\u042D\u043D\u0434\u0440\u0438\u043A\u0441"
reloc,0x016a02,"Faxis","\u0424\u0430\u043A\u0441\u0438\u0441"
reloc,0x016a04,"Goobare","\u0413\u0443\u0431\u0430\u0440\u0435"
reloc,0x016a06,"Hyppus","\u0425\u0438\u043F\u043F\u0443\u0441"
reloc,0x016a08,"Irok","\u0418\u0440\u043E\u043A"
reloc,0x016a0a,"Jhan","\u0414\u0436\u0430\u043D"
reloc,0x016a0c,"Kookamunga","\u041A\u0443\u043A\u0430\u043C\u0443\u043D\u0433\u0430"
reloc,0x016a0e,"Lorsche","\u041B\u043E\u0440\u0448\u0435"
reloc,0x016a10,"Mooseweigh","\u041C\u0443\u0441\u0432\u0435\u0439"
reloc,0x016a12,"Nilslag","\u041D\u0438\u043B\u044C\u0441\u043B\u0430\u0433"
reloc,0x016a14,"Ophiraund","\u041E\u0444\u0438\u0440\u0430\u0443\u043D\u0434"
reloc,0x016a16,"Portalis","\u041F\u043E\u0440\u0442\u0430\u043B\u0438\u0441"
reloc,0x016a18,"Quinderwitch","\u041A\u0443\u0438\u043D\u0434\u0435\u0440\u0432\u0438\u0447"
reloc,0x016a1a,"Rythacon","\u0420\u0438\u0442\u0430\u043A\u043E\u043D"
reloc,0x016a1c,"Spockana","\u0421\u043F\u043E\u043A\u0430\u043D\u0430"
reloc,0x016a1e,"Tylitch","\u0422\u0438\u043B\u0438\u0447"
reloc,0x016a20,"Uzare","\u0423\u0437\u0430\u0440\u0435"
reloc,0x016a22,"Vutar","\u0412\u0443\u0442\u0430\u0440"
reloc,0x016a24,"Wankelforte","\u0412\u0430\u043D\u043A\u0435\u043B\u044C\u0444\u043E\u0440\u0442"
reloc,0x016a26,"Xelox","\u041A\u0441\u0438\u043B\u043E\u043A\u0441"
reloc,0x016a28,"Yeneverre","\u042D\u043D\u0435\u0432\u0435\u0440\u0440\u0435"
reloc,0x016a2a,"Zyzzarzaz","\u0417\u0438\u0437\u0437\u0430\u0440\u0437\u0430\u0437"
# Slot 26 is the king's castle: unreachable here (the contract screen indexes 0..25), but
# kept in step with the other copy's slot 26, which the castle screen prints. That screen is
# the only reader of either, and it is 27 chars wide after "\u0417\u0430\u043C\u043E\u043A ", not 13.
reloc,0x016a2c,"of King Maximus","\u043A\u043E\u0440\u043E\u043B\u044F \u041C\u0430\u043A\u0441\u0438\u043C\u0443\u0441\u0430"
reloc,0x01842e,"Azram","\u0410\u0437\u0440\u0430\u043C"
reloc,0x018430,"Basefit","\u0411\u0435\u0439\u0441\u0444\u0438\u0442"
reloc,0x018432,"Cancomar","\u041A\u0430\u043D\u043A\u043E\u043C\u0430\u0440"
reloc,0x018434,"Duvock","\u0414\u0443\u0432\u043E\u043A"
reloc,0x018436,"Endryx","\u042D\u043D\u0434\u0440\u0438\u043A\u0441"
reloc,0x018438,"Faxis","\u0424\u0430\u043A\u0441\u0438\u0441"
reloc,0x01843a,"Goobare","\u0413\u0443\u0431\u0430\u0440\u0435"
reloc,0x01843c,"Hyppus","\u0425\u0438\u043F\u043F\u0443\u0441"
reloc,0x01843e,"Irok","\u0418\u0440\u043E\u043A"
reloc,0x018440,"Jhan","\u0414\u0436\u0430\u043D"
reloc,0x018442,"Kookamunga","\u041A\u0443\u043A\u0430\u043C\u0443\u043D\u0433\u0430"
reloc,0x018444,"Lorsche","\u041B\u043E\u0440\u0448\u0435"
reloc,0x018446,"Mooseweigh","\u041C\u0443\u0441\u0432\u0435\u0439"
reloc,0x018448,"Nilslag","\u041D\u0438\u043B\u044C\u0441\u043B\u0430\u0433"
reloc,0x01844a,"Ophiraund","\u041E\u0444\u0438\u0440\u0430\u0443\u043D\u0434"
reloc,0x01844c,"Portalis","\u041F\u043E\u0440\u0442\u0430\u043B\u0438\u0441"
reloc,0x01844e,"Quinderwitch","\u041A\u0443\u0438\u043D\u0434\u0435\u0440\u0432\u0438\u0447"
reloc,0x018450,"Rythacon","\u0420\u0438\u0442\u0430\u043A\u043E\u043D"
reloc,0x018452,"Spockana","\u0421\u043F\u043E\u043A\u0430\u043D\u0430"
reloc,0x018454,"Tylitch","\u0422\u0438\u043B\u0438\u0447"
reloc,0x018456,"Uzare","\u0423\u0437\u0430\u0440\u0435"
reloc,0x018458,"Vutar","\u0412\u0443\u0442\u0430\u0440"
reloc,0x01845a,"Wankelforte","\u0412\u0430\u043D\u043A\u0435\u043B\u044C\u0444\u043E\u0440\u0442"
reloc,0x01845c,"Xelox","\u041A\u0441\u0438\u043B\u043E\u043A\u0441"
reloc,0x01845e,"Yeneverre","\u042D\u043D\u0435\u0432\u0435\u0440\u0440\u0435"
reloc,0x018460,"Zyzzarzaz","\u0417\u0438\u0437\u0437\u0430\u0440\u0437\u0430\u0437"

# ---- town names
# Table DS 0x2e25. Same 13-char budget as the castles, for the gate picker's columns.
reloc,0x0184b5,"Riverton","\u041F\u0440\u0438\u0440\u0435\u0447\u044C\u0435"
reloc,0x0184b7,"Underfoot","\u041F\u043E\u0434\u043D\u043E\u0436\u044C\u0435"
reloc,0x0184b9,"Path's End","\u041A\u043E\u043D\u0435\u0446 \u041F\u0443\u0442\u0438"
reloc,0x0184bb,"Anomaly","\u0410\u043D\u043E\u043C\u0430\u043B\u0438\u044F"
reloc,0x0184bd,"Topshore","\u0412\u0437\u043C\u043E\u0440\u044C\u0435"
reloc,0x0184bf,"Lakeview","\u041F\u0440\u0438\u043E\u0437\u0451\u0440\u044C\u0435"
reloc,0x0184c1,"Simpleton","\u041F\u0440\u043E\u0441\u0442\u0430\u043A\u043E\u0432\u043E"
reloc,0x0184c3,"Centrapf","\u0426\u0435\u043D\u0442\u0440\u0430\u043F\u0444"
reloc,0x0184c5,"Quiln Point","\u041C\u044B\u0441 \u041A\u0443\u0438\u043B\u043D"
reloc,0x0184c7,"Midland","\u0421\u0440\u0435\u0434\u0438\u043D\u043D\u043E\u0435"
reloc,0x0184c9,"Xoctan","\u041A\u0441\u043E\u043A\u0442\u0430\u043D"
reloc,0x0184cb,"Overthere","\u0417\u0430\u0442\u0430\u043C\u044C\u0435"
reloc,0x0184cd,"Elan's Landing","\u041F\u0440\u0438\u0447\u0430\u043B \u042D\u043B\u0430\u043D\u0430"
reloc,0x0184cf,"King's Haven","\u041F\u0440\u0438\u044E\u0442 \u041A\u043E\u0440\u043E\u043B\u044F"
reloc,0x0184d1,"Bayside","\u0417\u0430\u043B\u0438\u0432\u044C\u0435"
reloc,0x0184d3,"Nyre","\u041D\u0430\u0439\u0440"
reloc,0x0184d5,"Dark Corner","\u0422\u0451\u043C\u043D\u044B\u0439 \u0423\u0433\u043E\u043B"
reloc,0x0184d7,"Isla Vista","\u0418\u0441\u043B\u0430 \u0412\u0438\u0441\u0442\u0430"
reloc,0x0184d9,"Grimwold","\u0413\u0440\u0438\u043C\u0432\u043E\u043B\u0434"
reloc,0x0184db,"Japper","\u0414\u0436\u0430\u043F\u043F\u0435\u0440"
reloc,0x0184dd,"Vengeance","\u0412\u043E\u0437\u043C\u0435\u0437\u0434\u0438\u0435"
reloc,0x0184df,"Hunterville","\u041E\u0445\u043E\u0442\u043D\u0438\u0447\u044C\u0435"
reloc,0x0184e1,"Fjord","\u0424\u044C\u043E\u0440\u0434"
reloc,0x0184e3,"Yakonia","\u042F\u043A\u043E\u043D\u0438\u044F"
reloc,0x0184e5,"Woods End","\u041E\u043F\u0443\u0448\u043A\u0430"
reloc,0x0184e7,"Zaezoizu","\u0417\u0430\u044D\u0437\u043E\u0439\u0437\u0443"

# ==== CONTRACT SCREENS ====================================================================
# 17 records, each a 14-entry pointer table (villain 1 at 0x016A2E, stride 28), so every
# line is reloc-able and the labels repeat once per record. Width: 27 chars for lines 1-5
# (name, alias, reward, last seen, castle), 34 for lines 6-14 (the features header and the
# description); 35 clips. Descriptions are reloc by default, but Russian usually fits its
# own slot: all 17 records land at ~2.1 KB of pool, well inside POOL_SIZE, so no budget
# change was needed. Rows that fit their own slot are written in place as 'string'; that is
# a byte budget, not a limit \u2014 find-ref reaches every slot of these tables.

# ---- shared with every record
reloc,0x0051d3,"Unknown","\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u0435\u043D"
reloc,0x005277,"You have no Contract!","\u0423 \u0432\u0430\u0441 \u043D\u0435\u0442 \u043A\u043E\u043D\u0442\u0440\u0430\u043A\u0442\u0430!"

# ---- villain 1, Murray the Miser
string,0x016D19,"Name: Murray the Miser","\u0418\u043C\u044F: \u041C\u044E\u0440\u0440\u0435\u0439 \u0421\u043A\u0440\u044F\u0433\u0430"
string,0x016D30,"Alias: None","\u041A\u043B\u0438\u0447\u043A\u0430: \u043D\u0435\u0442"
string,0x016D3C,"Reward: 5,000 gold","\u041D\u0430\u0433\u0440\u0430\u0434\u0430: 5000 \u0437\u043E\u043B."
string,0x016D4F,"Last Seen:","\u041A\u043E\u043D\u0442\u0438\u043D\u0435\u043D\u0442:"
string,0x016D5A,"Castle:"," \u0417\u0430\u043C\u043E\u043A:"
string,0x016D62,"Distinguishing Features:","\u041E\u0441\u043E\u0431\u044B\u0435 \u043F\u0440\u0438\u043C\u0435\u0442\u044B:"
reloc,0x016A3A,"  Threadbare clothes, bald","  \u041F\u043E\u0442\u0440\u0451\u043F\u0430\u043D\u043D\u0430\u044F \u043E\u0434\u0435\u0436\u0434\u0430, \u043B\u044B\u0441\u0438\u043D\u0430,"
reloc,0x016A3C,"  patch with hair combed to","  \u043F\u0440\u0438\u043A\u0440\u044B\u0442\u0430\u044F \u0437\u0430\u0447\u0451\u0441\u043E\u043C, \u0430 \u0442\u0430\u043A\u0436\u0435"
reloc,0x016A3E,"  cover it, incessant cough.","  \u043D\u0435\u043F\u0440\u0435\u043A\u0440\u0430\u0449\u0430\u044E\u0449\u0438\u0439\u0441\u044F \u043A\u0430\u0448\u0435\u043B\u044C."
reloc,0x016A40,"Crimes: Murray is wanted for","\u041F\u0440\u0435\u0441\u0442\u0443\u043F\u043B\u0435\u043D\u0438\u044F: \u043C\u0435\u043B\u043A\u0438\u0435 \u043A\u0440\u0430\u0436\u0438"
reloc,0x016A42,"  various petty crimes as well","  \u0438 \u0438\u0437\u043C\u0435\u043D\u0430. \u041C\u044E\u0440\u0440\u0435\u0439 \u0432\u043F\u0443\u0441\u0442\u0438\u043B"
reloc,0x016A44,"  as for treason. He allowed a","  \u0432 \u0437\u0430\u043C\u043E\u043A \u0448\u0430\u0439\u043A\u0443 \u043F\u0438\u0440\u0430\u0442\u043E\u0432,"
reloc,0x016A46,"  group of pirates to enter the","  \u0438 \u0442\u0435 \u0432\u044B\u043F\u0443\u0441\u0442\u0438\u043B\u0438 \u043D\u0430 \u0432\u043E\u043B\u044E"
reloc,0x016A48,"  castle and free criminals.","  \u0432\u0441\u0435\u0445 \u043F\u0440\u0435\u0441\u0442\u0443\u043F\u043D\u0438\u043A\u043E\u0432."

# ---- villain 2, Hack the Rogue
string,0x016E67,"Name: Hack the Rogue","\u0418\u043C\u044F: \u0425\u0430\u043A \u041F\u0440\u043E\u0445\u0432\u043E\u0441\u0442"
string,0x016E7C,"Alias: The Spitter","\u041A\u043B\u0438\u0447\u043A\u0430: \u041F\u043B\u0435\u0432\u043E\u043A"
string,0x016E8F,"Reward: 6,000 gold","\u041D\u0430\u0433\u0440\u0430\u0434\u0430: 6000 \u0437\u043E\u043B."
string,0x016EA2,"Last Seen:","\u041A\u043E\u043D\u0442\u0438\u043D\u0435\u043D\u0442:"
string,0x016EAD,"Castle:"," \u0417\u0430\u043C\u043E\u043A:"
string,0x016EB5,"Distinguishing Features:","\u041E\u0441\u043E\u0431\u044B\u0435 \u043F\u0440\u0438\u043C\u0435\u0442\u044B:"
reloc,0x016A56,"  Bushy ebon beard stained","  \u0413\u0443\u0441\u0442\u0430\u044F \u0447\u0451\u0440\u043D\u0430\u044F \u0431\u043E\u0440\u043E\u0434\u0430 \u0432 \u0431\u0443\u0440\u044B\u0445"
reloc,0x016A58,"  with tobacco juice, numerous","  \u043F\u043E\u0442\u0451\u043A\u0430\u0445 \u0436\u0435\u0432\u0430\u0442\u0435\u043B\u044C\u043D\u043E\u0433\u043E \u0442\u0430\u0431\u0430\u043A\u0430,"
reloc,0x016A5A,"  battle scars, brash, arrogant","  \u043C\u043D\u043E\u0436\u0435\u0441\u0442\u0432\u043E \u0431\u043E\u0435\u0432\u044B\u0445 \u0448\u0440\u0430\u043C\u043E\u0432,"
reloc,0x016A5C,"  behavior.","  \u043D\u0430\u0433\u043B\u044B\u0435 \u0438 \u0437\u0430\u043D\u043E\u0441\u0447\u0438\u0432\u044B\u0435 \u043C\u0430\u043D\u0435\u0440\u044B."
reloc,0x016A5E,"Crimes: Along with many minor","\u041F\u0440\u0435\u0441\u0442\u0443\u043F\u043B\u0435\u043D\u0438\u044F: \u043F\u043E\u043C\u0438\u043C\u043E \u043C\u0435\u043B\u043A\u0438\u0445"
reloc,0x016A60,"  infractions, Hack is wanted","  \u043D\u0430\u0440\u0443\u0448\u0435\u043D\u0438\u0439, \u0425\u0430\u043A \u0440\u0430\u0437\u044B\u0441\u043A\u0438\u0432\u0430\u0435\u0442\u0441\u044F"
reloc,0x016A62,"  for conspiracy against the","  \u0437\u0430 \u0437\u0430\u0433\u043E\u0432\u043E\u0440 \u043F\u0440\u043E\u0442\u0438\u0432 \u041A\u043E\u0440\u043E\u043D\u044B"
reloc,0x016A64,"  Crown and grave-robbing.","  \u0438 \u0437\u0430 \u0440\u0430\u0437\u0433\u0440\u0430\u0431\u043B\u0435\u043D\u0438\u0435 \u043C\u043E\u0433\u0438\u043B."

# ---- villain 3, Princess Aimola
string,0x016FA8,"Name: Princess Aimola","\u0418\u043C\u044F: \u041F\u0440\u0438\u043D\u0446\u0435\u0441\u0441\u0430 \u0410\u0439\u043C\u043E\u043B\u0430"
string,0x016FBE,"Alias: Lady Deceit","\u041A\u043B\u0438\u0447\u043A\u0430: \u041B\u0435\u0434\u0438 \u041E\u0431\u043C\u0430\u043D"
string,0x016FD1,"Reward: 7,000 gold","\u041D\u0430\u0433\u0440\u0430\u0434\u0430: 7000 \u0437\u043E\u043B."
string,0x016FE4,"Last Seen:","\u041A\u043E\u043D\u0442\u0438\u043D\u0435\u043D\u0442:"
string,0x016FEF,"Castle:"," \u0417\u0430\u043C\u043E\u043A:"
string,0x016FF7,"Distinguishing Features:","\u041E\u0441\u043E\u0431\u044B\u0435 \u043F\u0440\u0438\u043C\u0435\u0442\u044B:"
reloc,0x016A72,"  Excessive use of make-up","  \u041E\u0431\u0438\u043B\u0438\u0435 \u043A\u043E\u0441\u043C\u0435\u0442\u0438\u043A\u0438, \u0441\u043A\u0440\u044B\u0432\u0430\u044E\u0449\u0435\u0439"
reloc,0x016A74,"  to hide aging features, ever-","  \u0441\u043B\u0435\u0434\u044B \u0432\u043E\u0437\u0440\u0430\u0441\u0442\u0430, \u043D\u0435\u0438\u0437\u043C\u0435\u043D\u043D\u044B\u0439"
reloc,0x016A76,"  present lace handkerchief.","  \u043A\u0440\u0443\u0436\u0435\u0432\u043D\u043E\u0439 \u043F\u043B\u0430\u0442\u043E\u043A."
reloc,0x016A78,"Crimes: The Princess violated","\u041F\u0440\u0435\u0441\u0442\u0443\u043F\u043B\u0435\u043D\u0438\u044F: \u043F\u0440\u0438\u043D\u0446\u0435\u0441\u0441\u0430 \u043D\u0430\u0440\u0443\u0448\u0438\u043B\u0430"
reloc,0x016A7A,"  her status as a visiting","  \u0441\u0442\u0430\u0442\u0443\u0441 \u043F\u043E\u0447\u0451\u0442\u043D\u043E\u0439 \u0433\u043E\u0441\u0442\u044C\u0438 \u043F\u0443\u0442\u0451\u043C"
reloc,0x016A7C,"  dignitary by encouraging a","  \u043F\u043E\u0434\u0441\u0442\u0440\u0435\u043A\u0430\u0442\u0435\u043B\u044C\u0441\u0442\u0432\u0430 \u043A \u0443\u0431\u0438\u0439\u0441\u0442\u0432\u0443"
reloc,0x016A7E,"  murder and joining the","  \u0438 \u0443\u0447\u0430\u0441\u0442\u0438\u044F \u0432 \u0437\u0430\u0433\u043E\u0432\u043E\u0440\u0435 \u043F\u0440\u043E\u0442\u0438\u0432"
reloc,0x016A80,"  conspiracy against the Crown.","  \u041A\u043E\u0440\u043E\u043D\u044B."

# ---- villain 4, Baron Johnno Makahl
string,0x0170F7,"Name: Baron Johnno Makahl","\u0418\u043C\u044F: \u0411\u0430\u0440\u043E\u043D \u0414\u0436\u043E\u043D\u043D\u043E \u041C\u0430\u043A\u0430\u043B"
reloc,0x016A84,"Alias: Johnno","\u041A\u043B\u0438\u0447\u043A\u0430: \u0414\u0436\u043E\u043D\u043D\u043E"
string,0x01711F,"Reward: 8,000 gold","\u041D\u0430\u0433\u0440\u0430\u0434\u0430: 8000 \u0437\u043E\u043B."
string,0x017132,"Last Seen:","\u041A\u043E\u043D\u0442\u0438\u043D\u0435\u043D\u0442:"
string,0x01713D,"Castle:"," \u0417\u0430\u043C\u043E\u043A:"
string,0x017145,"Distinguishing Features:","\u041E\u0441\u043E\u0431\u044B\u0435 \u043F\u0440\u0438\u043C\u0435\u0442\u044B:"
reloc,0x016A8E,"  Expensive and gaudy","  \u0414\u043E\u0440\u043E\u0433\u0430\u044F \u0438 \u0431\u0435\u0437\u0432\u043A\u0443\u0441\u043D\u0430\u044F \u043E\u0434\u0435\u0436\u0434\u0430,"
reloc,0x016A90,"  clothes, overweight, and","  \u0442\u0443\u0447\u043D\u043E\u0435 \u0441\u043B\u043E\u0436\u0435\u043D\u0438\u0435, \u043D\u0435\u043E\u043F\u0440\u044F\u0442\u043D\u0430\u044F"
reloc,0x016A92,"  a scruffy beard.","  \u0431\u043E\u0440\u043E\u0434\u0430."
reloc,0x016A94,"Crimes: Johnno is wanted for","\u041F\u0440\u0435\u0441\u0442\u0443\u043F\u043B\u0435\u043D\u0438\u044F: \u0414\u0436\u043E\u043D\u043D\u043E \u043F\u043E\u0432\u0438\u043D\u0435\u043D"
reloc,0x016A96,"  various crimes against the","  \u0432\u043E \u043C\u043D\u043E\u0433\u0438\u0445 \u0437\u043B\u043E\u0434\u0435\u044F\u043D\u0438\u044F\u0445 \u043F\u0440\u043E\u0442\u0438\u0432"
reloc,0x016A98,"  Kingdom, including leading a","  \u041A\u043E\u0440\u043E\u043B\u0435\u0432\u0441\u0442\u0432\u0430. \u041E\u043D \u0432\u043E\u0437\u0433\u043B\u0430\u0432\u0438\u043B"
reloc,0x016A9A,"  direct assualt against the","  \u043E\u0442\u043A\u0440\u044B\u0442\u043E\u0435 \u043D\u0430\u043F\u0430\u0434\u0435\u043D\u0438\u0435 \u043D\u0430 \u041A\u043E\u0440\u043E\u043D\u0443"
reloc,0x016A9C,"  Crown and conspiracy.","  \u0438 \u0443\u0447\u0430\u0441\u0442\u0432\u043E\u0432\u0430\u043B \u0432 \u0437\u0430\u0433\u043E\u0432\u043E\u0440\u0435."

# ---- villain 5, Dread Pirate Rob
string,0x017230,"Name: Dread Pirate Rob","\u0418\u043C\u044F: \u0423\u0436\u0430\u0441\u043D\u044B\u0439 \u041F\u0438\u0440\u0430\u0442 \u0420\u043E\u0431"
string,0x017247,"Alias: Terror of the Sea","\u041A\u043B\u0438\u0447\u043A\u0430: \u0413\u0440\u043E\u0437\u0430 \u043C\u043E\u0440\u0435\u0439"
string,0x017260,"Reward: 9,000 gold","\u041D\u0430\u0433\u0440\u0430\u0434\u0430: 9000 \u0437\u043E\u043B."
string,0x017273,"Last Seen:","\u041A\u043E\u043D\u0442\u0438\u043D\u0435\u043D\u0442:"
string,0x01727E,"Castle:"," \u0417\u0430\u043C\u043E\u043A:"
string,0x017286,"Distinguishing Features:","\u041E\u0441\u043E\u0431\u044B\u0435 \u043F\u0440\u0438\u043C\u0435\u0442\u044B:"
reloc,0x016AAA,"  Pencil thin moustache","  \u0422\u043E\u043D\u043A\u0438\u0435 \u0443\u0441\u0438\u043A\u0438 \u0438 \u0449\u0451\u0433\u043E\u043B\u044C\u0441\u043A\u0438"
reloc,0x016AAC,"  and elegantly trimmed beard,","  \u043F\u043E\u0434\u0441\u0442\u0440\u0438\u0436\u0435\u043D\u043D\u0430\u044F \u0431\u043E\u0440\u043E\u0434\u0430. \u041D\u0438\u043A\u043E\u0433\u0434\u0430"
reloc,0x016AAE,"  never without a rapier.","  \u043D\u0435 \u0440\u0430\u0441\u0441\u0442\u0430\u0451\u0442\u0441\u044F \u0441\u043E \u0441\u0432\u043E\u0435\u0439 \u0440\u0430\u043F\u0438\u0440\u043E\u0439."
reloc,0x016AB0,"Crimes: Rob is wanted for piracy","\u041F\u0440\u0435\u0441\u0442\u0443\u043F\u043B\u0435\u043D\u0438\u044F: \u043F\u0438\u0440\u0430\u0442\u0441\u0442\u0432\u043E,"
reloc,0x016AB2,"  as well a conspiracy and for","  \u0437\u0430\u0433\u043E\u0432\u043E\u0440 \u0438 \u043E\u0441\u0432\u043E\u0431\u043E\u0436\u0434\u0435\u043D\u0438\u0435"
reloc,0x016AB4,"  breaking out five traitors","  \u043F\u044F\u0442\u0438 \u0438\u0437\u043C\u0435\u043D\u043D\u0438\u043A\u043E\u0432, \u0447\u0442\u043E \u0431\u044B\u043B\u0438"
reloc,0x016AB6,"  sentenced to death in the","  \u043F\u0440\u0438\u0433\u043E\u0432\u043E\u0440\u0435\u043D\u044B \u043A \u0441\u043C\u0435\u0440\u0442\u0438"
reloc,0x016AB8,"  Royal Dungeons.","  \u0432 \u043A\u043E\u0440\u043E\u043B\u0435\u0432\u0441\u043A\u0438\u0445 \u043F\u043E\u0434\u0437\u0435\u043C\u0435\u043B\u044C\u044F\u0445."

# ---- villain 6, Canegor the Mystic
string,0x01737B,"Name: Canegor the Mystic","\u0418\u043C\u044F: \u041A\u0430\u043D\u0435\u0433\u043E\u0440 \u041C\u0438\u0441\u0442\u0438\u043A"
reloc,0x016abc,"Alias: The Majestic Sage","\u041A\u043B\u0438\u0447\u043A\u0430: \u041F\u0440\u0435\u0441\u0432\u0435\u0442\u043B\u044B\u0439 \u043C\u0443\u0434\u0440\u0435\u0446"
string,0x0173AD,"Reward: 10,000 gold","\u041D\u0430\u0433\u0440\u0430\u0434\u0430: 10000 \u0437\u043E\u043B."
string,0x0173C1,"Last Seen:","\u041A\u043E\u043D\u0442\u0438\u043D\u0435\u043D\u0442:"
string,0x0173CC,"Castle:"," \u0417\u0430\u043C\u043E\u043A:"
string,0x0173D4,"Distinguishing Features:","\u041E\u0441\u043E\u0431\u044B\u0435 \u043F\u0440\u0438\u043C\u0435\u0442\u044B:"
reloc,0x016ac6,"  Voluminous robes, bald","  \u041F\u0440\u043E\u0441\u0442\u043E\u0440\u043D\u044B\u0435 \u043E\u0434\u0435\u0436\u0434\u044B, \u043B\u044B\u0441\u0430\u044F"
reloc,0x016ac8,"  head, magic symbols engraved","  \u0433\u043E\u043B\u043E\u0432\u0430, \u043C\u0430\u0433\u0438\u0447\u0435\u0441\u043A\u0438\u0435 \u0441\u0438\u043C\u0432\u043E\u043B\u044B"
reloc,0x016aca,"  on body, levitating ability.","  \u043D\u0430 \u0442\u0435\u043B\u0435, \u0443\u043C\u0435\u043D\u0438\u0435 \u043B\u0435\u0432\u0438\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C."
reloc,0x016acc,"Crimes: Canegor is wanted for","\u041F\u0440\u0435\u0441\u0442\u0443\u043F\u043B\u0435\u043D\u0438\u044F: \u041A\u0430\u043D\u0435\u0433\u043E\u0440 \u043F\u043E\u0432\u0438\u043D\u0435\u043D"
reloc,0x016ace,"  grave robbing, conspiracy","  \u0432 \u043E\u0441\u043A\u0432\u0435\u0440\u043D\u0435\u043D\u0438\u0438 \u043C\u043E\u0433\u0438\u043B, \u0437\u0430\u0433\u043E\u0432\u043E\u0440\u0435"
reloc,0x016ad0,"  against the Crown, and","  \u043F\u0440\u043E\u0442\u0438\u0432 \u041A\u043E\u0440\u043E\u043D\u044B \u0438 \u0440\u0430\u0437\u0433\u0440\u0430\u0431\u043B\u0435\u043D\u0438\u0438"
string,0x017497,"  plundering the Royal Library.","  \u041A\u043E\u0440\u043E\u043B\u0435\u0432\u0441\u043A\u043E\u0439 \u0431\u0438\u0431\u043B\u0438\u043E\u0442\u0435\u043A\u0438."

# ---- villain 7, Sir Moradon the Cruel
string,0x0174B8,"Name:Sir Moradon the Cruel","\u0418\u043C\u044F: \u0421\u044D\u0440 \u041C\u043E\u0440\u0430\u0434\u043E\u043D \u0416\u0435\u0441\u0442\u043E\u043A\u0438\u0439"
string,0x0174D3,"Alias: None","\u041A\u043B\u0438\u0447\u043A\u0430: \u043D\u0435\u0442"
string,0x0174DF,"Reward: 12,000 gold","\u041D\u0430\u0433\u0440\u0430\u0434\u0430: 12000 \u0437\u043E\u043B."
string,0x0174F3,"Last Seen:","\u041A\u043E\u043D\u0442\u0438\u043D\u0435\u043D\u0442:"
string,0x0174FE,"Castle:"," \u0417\u0430\u043C\u043E\u043A:"
string,0x017506,"Distinguishing Features:","\u041E\u0441\u043E\u0431\u044B\u0435 \u043F\u0440\u0438\u043C\u0435\u0442\u044B:"
reloc,0x016ae2,"  Always wearing armor and","  \u0421\u043F\u0438\u0442 \u0438 \u0435\u0441\u0442 \u0432 \u0434\u043E\u0441\u043F\u0435\u0445\u0430\u0445, \u043D\u043E\u0441\u0438\u0442"
reloc,0x016ae4,"  concealed weapons, has two","  \u043F\u0440\u0438 \u0441\u0435\u0431\u0435 \u0441\u043A\u0440\u044B\u0442\u043E\u0435 \u043E\u0440\u0443\u0436\u0438\u0435."
reloc,0x016ae6,"  prominent front teeth and an","  \u0414\u0432\u0430 \u0442\u043E\u0440\u0447\u0430\u0449\u0438\u0445 \u043F\u0435\u0440\u0435\u0434\u043D\u0438\u0445 \u0437\u0443\u0431\u0430,"
reloc,0x016ae8,"  unkept beard.","  \u0438 \u043A\u043E\u0441\u043C\u0430\u0442\u0430\u044F \u0431\u043E\u0440\u043E\u0434\u0430."
reloc,0x016aea,"Crimes: Sir Moradon, an emissary","\u041F\u0440\u0435\u0441\u0442\u0443\u043F\u043B\u0435\u043D\u0438\u044F: \u0441\u044D\u0440 \u041C\u043E\u0440\u0430\u0434\u043E\u043D, \u043F\u043E\u0441\u043E\u043B"
reloc,0x016aec,"  from another land, is wanted","  \u0447\u0443\u0436\u043E\u0439 \u0437\u0435\u043C\u043B\u0438, \u0432\u0441\u0442\u0443\u043F\u0438\u043B \u0432 \u0437\u0430\u0433\u043E\u0432\u043E\u0440"
reloc,0x016aee,"  for joining a conspiracy to","  \u0440\u0430\u0434\u0438 \u0441\u0432\u0435\u0440\u0436\u0435\u043D\u0438\u044F \u041A\u043E\u0440\u043E\u043B\u0435\u0432\u0441\u0442\u0432\u0430"
reloc,0x016af0,"  topple the kingdom.","  \u0438 \u0435\u0433\u043E \u0437\u0430\u043A\u043E\u043D\u043D\u043E\u0433\u043E \u043A\u043E\u0440\u043E\u043B\u044F."

# ---- villain 8, Prince Barrowpine
string,0x0175FA,"Name: Prince Barrowpine","\u0418\u043C\u044F: \u041F\u0440\u0438\u043D\u0446 \u0411\u0430\u0440\u0440\u043E\u0443\u043F\u0430\u0439\u043D"
string,0x017612,"Alias: The Elf Lord","\u041A\u043B\u0438\u0447\u043A\u0430: \u041B\u043E\u0440\u0434 \u044D\u043B\u044C\u0444\u043E\u0432"
string,0x017626,"Reward: 14,000 gold","\u041D\u0430\u0433\u0440\u0430\u0434\u0430: 14000 \u0437\u043E\u043B."
string,0x01763A,"Last Seen:","\u041A\u043E\u043D\u0442\u0438\u043D\u0435\u043D\u0442:"
string,0x017645,"Castle:"," \u0417\u0430\u043C\u043E\u043A:"
string,0x01764D,"Distinguishing Features:","\u041E\u0441\u043E\u0431\u044B\u0435 \u043F\u0440\u0438\u043C\u0435\u0442\u044B:"
reloc,0x016afe,"  Pointed ears, sharp","  \u0417\u0430\u043E\u0441\u0442\u0440\u0451\u043D\u043D\u044B\u0435 \u0443\u0448\u0438, \u0438\u0437\u044F\u0449\u043D\u044B\u0435"
reloc,0x016b00,"  elfin features, pale blue eyes","  \u044D\u043B\u044C\u0444\u0438\u0439\u0441\u043A\u0438\u0435 \u0447\u0435\u0440\u0442\u044B, \u0433\u043B\u0430\u0437\u0430"
reloc,0x016b02,"  with no whites, glimmering","  \u0431\u043B\u0435\u0434\u043D\u043E-\u0433\u043E\u043B\u0443\u0431\u044B\u0435, \u0431\u0435\u0437 \u0431\u0435\u043B\u043A\u043E\u0432,"
reloc,0x016b04,"  enchanted coin.","  \u043C\u0435\u0440\u0446\u0430\u044E\u0449\u0430\u044F \u0432\u043E\u043B\u0448\u0435\u0431\u043D\u0430\u044F \u043C\u043E\u043D\u0435\u0442\u0430."
reloc,0x016b06,"Crimes: The prince is one of the","\u041F\u0440\u0435\u0441\u0442\u0443\u043F\u043B\u0435\u043D\u0438\u044F: \u043F\u0440\u0438\u043D\u0446 - \u043E\u0434\u0438\u043D"
reloc,0x016b08,"  leaders of the conspiracy","  \u0438\u0437 \u0433\u043B\u0430\u0432\u0430\u0440\u0435\u0439 \u0437\u0430\u0433\u043E\u0432\u043E\u0440\u0430 \u043F\u0440\u043E\u0442\u0438\u0432"
reloc,0x016b0a,"  against the Crown, he also","  \u041A\u043E\u0440\u043E\u043D\u044B. \u0422\u0430\u043A\u0436\u0435 \u043E\u043D \u0442\u043E\u0440\u0433\u0443\u0435\u0442"
reloc,0x016b0c,"  traffics stolen artifacts.","  \u043A\u0440\u0430\u0434\u0435\u043D\u044B\u043C\u0438 \u0430\u0440\u0442\u0435\u0444\u0430\u043A\u0442\u0430\u043C\u0438."

# ---- villain 9, Bargash Eyesore
string,0x017743,"Name: Bargash Eyesore","\u0418\u043C\u044F: \u0411\u0430\u0440\u0433\u0430\u0448 \u041E\u0431\u0440\u0430\u0437\u0438\u043D\u0430"
string,0x017759,"Alias: Old One Eye","\u041A\u043B\u0438\u0447\u043A\u0430: \u041E\u0434\u043D\u043E\u0433\u043B\u0430\u0437\u044B\u0439"
string,0x01776C,"Reward: 16,000 gold","\u041D\u0430\u0433\u0440\u0430\u0434\u0430: 16000 \u0437\u043E\u043B."
string,0x017780,"Last Seen:","\u041A\u043E\u043D\u0442\u0438\u043D\u0435\u043D\u0442:"
string,0x01778B,"Castle:"," \u0417\u0430\u043C\u043E\u043A:"
string,0x017793,"Distinguishing Features:","\u041E\u0441\u043E\u0431\u044B\u0435 \u043F\u0440\u0438\u043C\u0435\u0442\u044B:"
reloc,0x016b1a,"  Single eye centered in","  \u0415\u0434\u0438\u043D\u0441\u0442\u0432\u0435\u043D\u043D\u044B\u0439 \u0433\u043B\u0430\u0437 \u043F\u043E\u0441\u0440\u0435\u0434\u0438"
reloc,0x016b1c,"  middle of forehead, over ten","  \u043B\u0431\u0430, \u0440\u043E\u0441\u0442 \u0431\u043E\u043B\u0435\u0435 \u0442\u0440\u0451\u0445 \u043C\u0435\u0442\u0440\u043E\u0432,"
reloc,0x016b1e,"  feet tall, only hair on body","  \u043B\u0438\u043B\u043E\u0432\u0430\u044F \u043A\u043E\u0436\u0430, \u043D\u0430 \u0432\u0441\u0451\u043C \u0442\u0435\u043B\u0435"
reloc,0x016b20,"  is in beard.","  \u043D\u0438 \u0432\u043E\u043B\u043E\u0441\u043A\u0430, \u043A\u0440\u043E\u043C\u0435 \u0431\u043E\u0440\u043E\u0434\u044B."
reloc,0x016b22,"Crimes: Bargash is wanted for","\u041F\u0440\u0435\u0441\u0442\u0443\u043F\u043B\u0435\u043D\u0438\u044F: \u0411\u0430\u0440\u0433\u0430\u0448 \u043F\u043E\u0432\u0438\u043D\u0435\u043D"
reloc,0x016b24,"  conspiracy against the Crown","  \u0432 \u0437\u0430\u0433\u043E\u0432\u043E\u0440\u0435 \u043F\u0440\u043E\u0442\u0438\u0432 \u041A\u043E\u0440\u043E\u043D\u044B."
reloc,0x016b26,"  and for leading an outright","  \u041E\u043D \u0432\u043E\u0437\u0433\u043B\u0430\u0432\u0438\u043B \u0434\u0435\u0440\u0437\u043A\u043E\u0435"
reloc,0x016b28,"  attack against the King.","  \u043D\u0430\u043F\u0430\u0434\u0435\u043D\u0438\u0435 \u043D\u0430 \u0441\u0430\u043C\u043E\u0433\u043E \u041A\u043E\u0440\u043E\u043B\u044F."

# ---- villain 10, Rinaldus Drybone
reloc,0x016b2a,"Name: Rinaldus Drybone","\u0418\u043C\u044F: \u0420\u0438\u043D\u0430\u043B\u044C\u0434\u0443\u0441 \u041A\u043E\u0441\u0442\u043B\u044F\u0432\u044B\u0439"
string,0x01789F,"Alias: The Death Lord","\u041A\u043B\u0438\u0447\u043A\u0430: \u041B\u043E\u0440\u0434 \u0441\u043C\u0435\u0440\u0442\u0438"
string,0x0178B5,"Reward: 18,000 gold","\u041D\u0430\u0433\u0440\u0430\u0434\u0430: 18000 \u0437\u043E\u043B."
string,0x0178C9,"Last Seen:","\u041A\u043E\u043D\u0442\u0438\u043D\u0435\u043D\u0442:"
string,0x0178D4,"Castle:"," \u0417\u0430\u043C\u043E\u043A:"
string,0x0178DC,"Distinguishing Features:","\u041E\u0441\u043E\u0431\u044B\u0435 \u043F\u0440\u0438\u043C\u0435\u0442\u044B:"
reloc,0x016b36,"  Rinaldus is a magically","  \u0420\u0438\u043D\u0430\u043B\u044C\u0434\u0443\u0441 - \u043C\u0430\u0433\u0438\u0447\u0435\u0441\u043A\u0438"
reloc,0x016b38,"  animated skeleton, an undead,","  \u043E\u0436\u0438\u0432\u0448\u0438\u0439 \u0441\u043A\u0435\u043B\u0435\u0442, \u043D\u0435\u0436\u0438\u0442\u044C."
reloc,0x016b3a,"  he is easily identifiable by","  \u0415\u0433\u043E \u043B\u0435\u0433\u043A\u043E \u0443\u0437\u043D\u0430\u0442\u044C \u043F\u043E \u0434\u0440\u0435\u0432\u043D\u0435\u0439"
reloc,0x016b3c,"  the ancient crown he wears.","  \u043A\u043E\u0440\u043E\u043D\u0435, \u043A\u043E\u0442\u043E\u0440\u0443\u044E \u043E\u043D \u043D\u043E\u0441\u0438\u0442."
reloc,0x016b3e,"Crimes: Rinaldus is wanted for","\u041F\u0440\u0435\u0441\u0442\u0443\u043F\u043B\u0435\u043D\u0438\u044F: \u0420\u0438\u043D\u0430\u043B\u044C\u0434\u0443\u0441 \u043F\u043E\u0432\u0438\u043D\u0435\u043D"
reloc,0x016b40,"  conspiracy against the Crown","  \u0432 \u0437\u0430\u0433\u043E\u0432\u043E\u0440\u0435 \u043F\u0440\u043E\u0442\u0438\u0432 \u041A\u043E\u0440\u043E\u043D\u044B."
reloc,0x016b42,"  and leading a rebellion on the","  \u041E\u043D \u043F\u043E\u0434\u043D\u044F\u043B \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u0438\u0435"
reloc,0x016b44,"  continent of Saharia.","  \u043D\u0430 \u043A\u043E\u043D\u0442\u0438\u043D\u0435\u043D\u0442\u0435 \u0421\u0430\u0445\u0430\u0440\u0438\u044F."

# ---- villain 11, Ragface
reloc,0x016b46,"Name: Ragface","\u0418\u043C\u044F: \u041B\u043E\u0445\u043C\u043E\u0442\u043D\u0438\u043A"
string,0x0179F1,"Alias: None","\u041A\u043B\u0438\u0447\u043A\u0430: \u043D\u0435\u0442"
string,0x0179FD,"Reward: 20,000 gold","\u041D\u0430\u0433\u0440\u0430\u0434\u0430: 20000 \u0437\u043E\u043B."
string,0x017A11,"Last Seen:","\u041A\u043E\u043D\u0442\u0438\u043D\u0435\u043D\u0442:"
string,0x017A1C,"Castle:"," \u0417\u0430\u043C\u043E\u043A:"
string,0x017A24,"Distinguishing Features:","\u041E\u0441\u043E\u0431\u044B\u0435 \u043F\u0440\u0438\u043C\u0435\u0442\u044B:"
reloc,0x016b52,"  Ragface is an undead, he","  \u041B\u043E\u0445\u043C\u043E\u0442\u043D\u0438\u043A - \u043D\u0435\u0436\u0438\u0442\u044C, \u0441 \u0433\u043E\u043B\u043E\u0432\u044B"
reloc,0x016b54,"  is covered from head to foot","  \u0434\u043E \u043D\u043E\u0433 \u043E\u0431\u043C\u043E\u0442\u0430\u043D\u043D\u044B\u0439 \u0433\u043D\u0438\u044E\u0449\u0438\u043C\u0438"
reloc,0x016b56,"  in moldering green strips of","  \u0437\u0435\u043B\u0451\u043D\u044B\u043C\u0438 \u043B\u043E\u0441\u043A\u0443\u0442\u0430\u043C\u0438 \u0442\u043A\u0430\u043D\u0438."
reloc,0x016b58,"  cloth. A rotting smell follows","  \u0417\u0430 \u043D\u0438\u043C \u0442\u044F\u043D\u0435\u0442\u0441\u044F \u0442\u044F\u0436\u0451\u043B\u044B\u0439 \u0437\u0430\u043F\u0430\u0445"
reloc,0x016b5a,"  him.","  \u0440\u0430\u0437\u043B\u043E\u0436\u0435\u043D\u0438\u044F."
reloc,0x016b5c,"Crimes: Conspiracy against the","\u041F\u0440\u0435\u0441\u0442\u0443\u043F\u043B\u0435\u043D\u0438\u044F: \u0437\u0430\u0433\u043E\u0432\u043E\u0440 \u043F\u0440\u043E\u0442\u0438\u0432"
reloc,0x016b5e,"  Crown and leading an","  \u041A\u043E\u0440\u043E\u043D\u044B \u0438 \u0440\u0443\u043A\u043E\u0432\u043E\u0434\u0441\u0442\u0432\u043E \u043C\u044F\u0442\u0435\u0436\u043E\u043C"
reloc,0x016b60,"  insurrection in Saharia.","  \u0432 \u0421\u0430\u0445\u0430\u0440\u0438\u0438."

# ---- villain 12, Mahk Bellowspeak
string,0x017B0F,"Name: Mahk Bellowspeak","\u0418\u043C\u044F: \u041C\u0430\u043A \u0413\u043E\u0440\u043B\u043E\u043F\u0430\u043D"
reloc,0x016b64,"Alias: Bruiser","\u041A\u043B\u0438\u0447\u043A\u0430: \u0413\u0440\u043E\u043C\u0438\u043B\u0430"
string,0x017B35,"Reward: 25,000 gold","\u041D\u0430\u0433\u0440\u0430\u0434\u0430: 25000 \u0437\u043E\u043B."
string,0x017B49,"Last Seen:","\u041A\u043E\u043D\u0442\u0438\u043D\u0435\u043D\u0442:"
string,0x017B54,"Castle:"," \u0417\u0430\u043C\u043E\u043A:"
string,0x017B5C,"Distinguishing Features:","\u041E\u0441\u043E\u0431\u044B\u0435 \u043F\u0440\u0438\u043C\u0435\u0442\u044B:"
reloc,0x016b6e,"  Bright orange body hair","  \u042F\u0440\u043A\u043E-\u043E\u0440\u0430\u043D\u0436\u0435\u0432\u044B\u0435 \u0432\u043E\u043B\u043E\u0441\u044B \u0438 \u0431\u043E\u0440\u043E\u0434\u0430,"
reloc,0x016b70,"  on a fluorescent green body, a","  \u043A\u043E\u0436\u0430 \u044F\u0434\u043E\u0432\u0438\u0442\u043E-\u0437\u0435\u043B\u0451\u043D\u0430\u044F. \u041F\u0440\u0438\u0432\u044B\u0447\u043A\u0430"
reloc,0x016b72,"  tendency to shout for no","  \u043E\u0440\u0430\u0442\u044C \u0431\u0435\u0437 \u0432\u0441\u044F\u043A\u043E\u0439 \u0432\u0438\u0434\u0438\u043C\u043E\u0439"
reloc,0x016b74,"  apparent reason.","  \u043F\u0440\u0438\u0447\u0438\u043D\u044B."
reloc,0x016b76,"Crimes: Mahk is wanted for the","\u041F\u0440\u0435\u0441\u0442\u0443\u043F\u043B\u0435\u043D\u0438\u044F: \u041C\u0430\u043A \u043F\u043E\u0432\u0438\u043D\u0435\u043D"
reloc,0x016b78,"  conspiracy against the Crown,","  \u0432 \u0437\u0430\u0433\u043E\u0432\u043E\u0440\u0435 \u043F\u0440\u043E\u0442\u0438\u0432 \u041A\u043E\u0440\u043E\u043D\u044B,"
reloc,0x016b7a,"  leading a jail break, and for","  \u0432 \u043E\u0440\u0433\u0430\u043D\u0438\u0437\u0430\u0446\u0438\u0438 \u043F\u043E\u0431\u0435\u0433\u0430 \u0438\u0437 \u0442\u044E\u0440\u044C\u043C\u044B"
reloc,0x016b7c,"  piracy on the open seas.","  \u0438 \u0432 \u043C\u043E\u0440\u0441\u043A\u043E\u043C \u0440\u0430\u0437\u0431\u043E\u0435."

# ---- villain 13, Auric Whiteskin
string,0x017C58,"Name: Auric Whiteskin","\u0418\u043C\u044F: \u0410\u0443\u0440\u0438\u043A \u0411\u0435\u043B\u043E\u0448\u043A\u0443\u0440\u044B\u0439"
string,0x017C6E,"Alias: The Barbarian","\u041A\u043B\u0438\u0447\u043A\u0430: \u0412\u0430\u0440\u0432\u0430\u0440"
string,0x017C83,"Reward: 30,000 gold","\u041D\u0430\u0433\u0440\u0430\u0434\u0430: 30000 \u0437\u043E\u043B."
string,0x017C97,"Last Seen:","\u041A\u043E\u043D\u0442\u0438\u043D\u0435\u043D\u0442:"
string,0x017CA2,"Castle:"," \u0417\u0430\u043C\u043E\u043A:"
string,0x017CAA,"Distinguishing Features:","\u041E\u0441\u043E\u0431\u044B\u0435 \u043F\u0440\u0438\u043C\u0435\u0442\u044B:"
reloc,0x016b8a,"  Auric is heavily muscled","  \u0410\u0443\u0440\u0438\u043A \u043D\u0435\u0432\u0435\u0440\u043E\u044F\u0442\u043D\u043E \u043C\u0443\u0441\u043A\u0443\u043B\u0438\u0441\u0442"
reloc,0x016b8c,"  and wears a protective skin","  \u0438 \u043D\u043E\u0441\u0438\u0442 \u0437\u0430\u0449\u0438\u0442\u043D\u0443\u044E \u043D\u0430\u043A\u0438\u0434\u043A\u0443"
reloc,0x016b8e,"  made from the hides of baby","  \u0438\u0437 \u0448\u043A\u0443\u0440 \u043D\u043E\u0432\u043E\u0440\u043E\u0436\u0434\u0451\u043D\u043D\u044B\u0445"
reloc,0x016b90,"  lambs.","  \u044F\u0433\u043D\u044F\u0442."
reloc,0x016b92,"Crimes: Auric is wanted for","\u041F\u0440\u0435\u0441\u0442\u0443\u043F\u043B\u0435\u043D\u0438\u044F: \u0410\u0443\u0440\u0438\u043A \u043F\u043E\u0432\u0438\u043D\u0435\u043D"
reloc,0x016b94,"  conspiracy and for leading the","  \u0432 \u0437\u0430\u0433\u043E\u0432\u043E\u0440\u0435. \u041E\u043D \u0432\u043E\u0437\u0433\u043B\u0430\u0432\u0438\u043B"
reloc,0x016b96,"  rebellion of the continent","  \u043C\u044F\u0442\u0435\u0436 \u043D\u0430 \u043A\u043E\u043D\u0442\u0438\u043D\u0435\u043D\u0442\u0435"
reloc,0x016b98,"  Saharia.","  \u0421\u0430\u0445\u0430\u0440\u0438\u044F."

# ---- villain 14, Czar Nickolai the Mad
string,0x017D88,"Name:Czar Nickolai the Mad","\u0418\u043C\u044F: \u0426\u0430\u0440\u044C \u041D\u0438\u043A\u043E\u043B\u0430\u0439 \u0411\u0435\u0437\u0443\u043C\u043D\u044B\u0439"
reloc,0x016b9c,"Alias: The Mad Czar","\u041A\u043B\u0438\u0447\u043A\u0430: \u0411\u0435\u0437\u0443\u043C\u043D\u044B\u0439 \u0446\u0430\u0440\u044C"
string,0x017DB7,"Reward: 35,000 gold","\u041D\u0430\u0433\u0440\u0430\u0434\u0430: 35000 \u0437\u043E\u043B."
string,0x017DCB,"Last Seen:","\u041A\u043E\u043D\u0442\u0438\u043D\u0435\u043D\u0442:"
string,0x017DD6,"Castle:"," \u0417\u0430\u043C\u043E\u043A:"
string,0x017DDE,"Distinguishing Features:","\u041E\u0441\u043E\u0431\u044B\u0435 \u043F\u0440\u0438\u043C\u0435\u0442\u044B:"
reloc,0x016ba6,"  The Czar has eyes which","  \u0423 \u0446\u0430\u0440\u044F \u043F\u043E\u0441\u0442\u043E\u044F\u043D\u043D\u043E \u043C\u0435\u043D\u044F\u0435\u0442\u0441\u044F"
reloc,0x016ba8,"  change color constantly, also","  \u0446\u0432\u0435\u0442 \u0433\u043B\u0430\u0437, \u0430 \u043E\u0442 \u0435\u0433\u043E \u0442\u0435\u043B\u0430"
reloc,0x016baa,"  a sulphuric smell emanates","  \u0438\u0441\u0445\u043E\u0434\u0438\u0442 \u0441\u0442\u043E\u0439\u043A\u0438\u0439 \u0437\u0430\u043F\u0430\u0445"
reloc,0x016bac,"  from his body.","  \u0441\u0435\u0440\u044B."
reloc,0x016bae,"Crimes: The Czar is wanted for","\u041F\u0440\u0435\u0441\u0442\u0443\u043F\u043B\u0435\u043D\u0438\u044F: \u041D\u0438\u043A\u043E\u043B\u0430\u0439 \u043F\u043E\u0432\u0438\u043D\u0435\u043D"
reloc,0x016bb0,"  conspiracy against the Crown,","  \u0432 \u0437\u0430\u0433\u043E\u0432\u043E\u0440\u0435 \u043F\u0440\u043E\u0442\u0438\u0432 \u041A\u043E\u0440\u043E\u043D\u044B,"
reloc,0x016bb2,"  violating diplomatic status,","  \u0432 \u0437\u043B\u043E\u0443\u043F\u043E\u0442\u0440\u0435\u0431\u043B\u0435\u043D\u0438\u0438 \u0441\u0442\u0430\u0442\u0443\u0441\u043E\u043C"
reloc,0x016bb4,"  and murder.","  \u0434\u0438\u043F\u043B\u043E\u043C\u0430\u0442\u0430 \u0438 \u0432 \u0443\u0431\u0438\u0439\u0441\u0442\u0432\u0435."

# ---- villain 15, Magus Deathspell
reloc,0x016bb6,"Name: Magus Deathspell","\u0418\u043C\u044F: \u041C\u0430\u0433\u0443\u0441 \u0427\u0435\u0440\u043D\u043E\u043A\u043D\u0438\u0436\u043D\u0438\u043A"
string,0x017EE2,"Alias: None","\u041A\u043B\u0438\u0447\u043A\u0430: \u043D\u0435\u0442"
string,0x017EEE,"Reward: 40,000 gold","\u041D\u0430\u0433\u0440\u0430\u0434\u0430: 40000 \u0437\u043E\u043B."
string,0x017F02,"Last Seen:","\u041A\u043E\u043D\u0442\u0438\u043D\u0435\u043D\u0442:"
string,0x017F0D,"Castle:"," \u0417\u0430\u043C\u043E\u043A:"
string,0x017F15,"Distinguishing Features:","\u041E\u0441\u043E\u0431\u044B\u0435 \u043F\u0440\u0438\u043C\u0435\u0442\u044B:"
reloc,0x016bc2,"  Pupil-less eyes, flowing","  \u0413\u043B\u0430\u0437\u0430 \u0431\u0435\u0437 \u0437\u0440\u0430\u0447\u043A\u043E\u0432, \u0441\u0435\u0434\u0430\u044F"
reloc,0x016bc4,"  white beard, always wears","  \u043E\u043A\u043B\u0430\u0434\u0438\u0441\u0442\u0430\u044F \u0431\u043E\u0440\u043E\u0434\u0430, \u0432\u0441\u0435\u0433\u0434\u0430"
reloc,0x016bc6,"  crimson robes and a matching","  \u043D\u043E\u0441\u0438\u0442 \u0431\u0430\u0433\u0440\u043E\u0432\u044B\u0435 \u043E\u0434\u0435\u044F\u043D\u0438\u044F"
reloc,0x016bc8,"  skull cap.","  \u0438 \u0442\u0430\u043A\u0443\u044E \u0436\u0435 \u0448\u0430\u043F\u043E\u0447\u043A\u0443."
reloc,0x016bca,"Crimes: Magus is wanted for","\u041F\u0440\u0435\u0441\u0442\u0443\u043F\u043B\u0435\u043D\u0438\u044F: \u041C\u0430\u0433\u0443\u0441 \u043F\u043E\u0432\u0438\u043D\u0435\u043D"
reloc,0x016bcc,"  conspiracy against the Crown","  \u0432 \u0437\u0430\u0433\u043E\u0432\u043E\u0440\u0435 \u043F\u0440\u043E\u0442\u0438\u0432 \u041A\u043E\u0440\u043E\u043D\u044B"
reloc,0x016bce,"  and for practicing forbidden","  \u0438 \u0432 \u0437\u0430\u043D\u044F\u0442\u0438\u0438 \u0437\u0430\u043F\u0440\u0435\u0442\u043D\u043E\u0439"
reloc,0x016bd0,"  magics.","  \u043C\u0430\u0433\u0438\u0435\u0439."

# ---- villain 16, Urthrax Killspite
string,0x017FF5,"Name: Urthrax Killspite","\u0418\u043C\u044F: \u0423\u0440\u0442\u0440\u0430\u043A\u0441 \u0414\u0443\u0448\u0435\u0433\u0443\u0431"
reloc,0x016bd4,"Alias: The Demon King","\u041A\u043B\u0438\u0447\u043A\u0430: \u041A\u043E\u0440\u043E\u043B\u044C \u0434\u0435\u043C\u043E\u043D\u043E\u0432"
string,0x018023,"Reward: 45,000 gold","\u041D\u0430\u0433\u0440\u0430\u0434\u0430: 45000 \u0437\u043E\u043B."
string,0x018037,"Last Seen:","\u041A\u043E\u043D\u0442\u0438\u043D\u0435\u043D\u0442:"
string,0x018042,"Castle:"," \u0417\u0430\u043C\u043E\u043A:"
string,0x01804A,"Distinguishing Features:","\u041E\u0441\u043E\u0431\u044B\u0435 \u043F\u0440\u0438\u043C\u0435\u0442\u044B:"
reloc,0x016bde,"  Green, scaly skin,","  \u0417\u0435\u043B\u0451\u043D\u0430\u044F \u0447\u0435\u0448\u0443\u0439\u0447\u0430\u0442\u0430\u044F \u043A\u043E\u0436\u0430,"
reloc,0x016be0,"  glowing red eyes, horns","  \u0433\u043E\u0440\u044F\u0449\u0438\u0435 \u043A\u0440\u0430\u0441\u043D\u044B\u0435 \u0433\u043B\u0430\u0437\u0430, \u0440\u043E\u0433\u0430"
reloc,0x016be2,"  protruding from sides of head,","  \u043F\u043E \u0431\u043E\u043A\u0430\u043C \u0433\u043E\u043B\u043E\u0432\u044B, \u0440\u043E\u0441\u0442 \u0431\u043E\u043B\u0435\u0435"
reloc,0x016be4,"  over 7 feet tall.","  \u0434\u0432\u0443\u0445 \u043C\u0435\u0442\u0440\u043E\u0432."
reloc,0x016be6,"Crimes: Urthrax is wanted for","\u041F\u0440\u0435\u0441\u0442\u0443\u043F\u043B\u0435\u043D\u0438\u044F: \u0423\u0440\u0442\u0440\u0430\u043A\u0441 \u043F\u043E\u0432\u0438\u043D\u0435\u043D"
string,0x0180E5,"  conspiracy against the Crown.","  \u0432 \u0437\u0430\u0433\u043E\u0432\u043E\u0440\u0435 \u043F\u0440\u043E\u0442\u0438\u0432 \u041A\u043E\u0440\u043E\u043D\u044B."

# ---- villain 17, Arech Dragonbreath
string,0x018107,"Name: Arech Dragonbreath","\u0418\u043C\u044F: \u0410\u0440\u0435\u0445 \u041E\u0433\u043D\u0435\u0434\u044B\u0448\u0430\u0449\u0438\u0439"
reloc,0x016bf0,"Alias: Mastermind","\u041A\u043B\u0438\u0447\u043A\u0430: \u0422\u0451\u043C\u043D\u044B\u0439 \u0433\u0435\u043D\u0438\u0439"
string,0x018132,"Reward: 50,000 gold","\u041D\u0430\u0433\u0440\u0430\u0434\u0430: 50000 \u0437\u043E\u043B."
string,0x018146,"Last Seen:","\u041A\u043E\u043D\u0442\u0438\u043D\u0435\u043D\u0442:"
string,0x018151,"Castle:"," \u0417\u0430\u043C\u043E\u043A:"
string,0x018159,"Distinguishing Features:","\u041E\u0441\u043E\u0431\u044B\u0435 \u043F\u0440\u0438\u043C\u0435\u0442\u044B:"
reloc,0x016bfa,"  Arech is an immense","  \u0410\u0440\u0435\u0445 - \u043E\u0433\u0440\u043E\u043C\u043D\u044B\u0439 \u0434\u0440\u0430\u043A\u043E\u043D"
reloc,0x016bfc,"  dragon with a green body and","  \u0441 \u0437\u0435\u043B\u0451\u043D\u044B\u043C \u0442\u0435\u043B\u043E\u043C \u0438 \u0441\u0438\u043D\u0438\u043C\u0438"
reloc,0x016bfe,"  blue wings, he breathes fire.","  \u043A\u0440\u044B\u043B\u044C\u044F\u043C\u0438, \u043E\u043D \u0434\u044B\u0448\u0438\u0442 \u043E\u0433\u043D\u0451\u043C."
reloc,0x016c00,"Crimes: Arech is wanted for","\u041F\u0440\u0435\u0441\u0442\u0443\u043F\u043B\u0435\u043D\u0438\u044F: \u0410\u0440\u0435\u0445 \u043F\u043E\u0432\u0438\u043D\u0435\u043D"
reloc,0x016c02,"  leading the conspiracy against","  \u0432 \u0442\u043E\u043C, \u0447\u0442\u043E \u0432\u043E\u0437\u0433\u043B\u0430\u0432\u0438\u043B \u0437\u0430\u0433\u043E\u0432\u043E\u0440"
reloc,0x016c04,"  the Crown, arranging jail-","  \u043F\u0440\u043E\u0442\u0438\u0432 \u041A\u043E\u0440\u043E\u043D\u044B, \u0443\u0441\u0442\u0440\u043E\u0438\u043B \u043F\u043E\u0431\u0435\u0433\u0438"
reloc,0x016c06,"  breaks. formenting rebellion,","  \u0438\u0437 \u0442\u044E\u0440\u0435\u043C, \u0440\u0430\u0437\u0436\u0451\u0433 \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u0438\u0435"
string,0x018241,"  stealing the Sceptre of Order.","  \u0438 \u043F\u043E\u0445\u0438\u0442\u0438\u043B \u0421\u043A\u0438\u043F\u0435\u0442\u0440 \u043F\u043E\u0440\u044F\u0434\u043A\u0430."

# ==== TREASURE CHESTS =====================================================================
# Seven events, each a pointer table walked by one loop at file 0x9955; every line is drawn
# at col 1, so the box is 28 chars wide.

# ---- treasure: hidden gold cache
reloc,0x018561,"After scouring the area,","\u041E\u0431\u044B\u0441\u043A\u0430\u0432 \u043E\u043A\u0440\u0443\u0433\u0443, \u0432\u044B \u043D\u0430\u0445\u043E\u0434\u0438\u0442\u0435"
reloc,0x018563,"you fall upon a hidden","\u0442\u0430\u0439\u043D\u0438\u043A \u0441 \u0441\u043E\u043A\u0440\u043E\u0432\u0438\u0449\u0430\u043C\u0438."
reloc,0x018565,"treasure cache. You may:","\u0412\u044B \u043C\u043E\u0436\u0435\u0442\u0435:"
reloc,0x018567,"A) Take the ","A) \u0417\u0430\u0431\u0440\u0430\u0442\u044C "
reloc,0x009b78," gold."," \u0437\u043E\u043B\u043E\u0442\u0430."
reloc,0x018569,"B) Distribute the gold to","B) \u0420\u0430\u0437\u0434\u0430\u0442\u044C \u0432\u0441\u0451 \u0437\u043E\u043B\u043E\u0442\u043E"
reloc,0x01856b,"the peasants, increasing","\u043A\u0440\u0435\u0441\u0442\u044C\u044F\u043D\u0430\u043C, \u0442\u043E\u0433\u0434\u0430 \u0432\u0430\u0448\u0435"
reloc,0x01856d,"your leadership by ","\u043B\u0438\u0434\u0435\u0440\u0441\u0442\u0432\u043E \u0432\u044B\u0440\u0430\u0441\u0442\u0435\u0442 \u043D\u0430 "

# ---- treasure: mineral deposits
reloc,0x01856f,"After surveying the area,","\u041E\u0441\u043C\u043E\u0442\u0440\u0435\u0432 \u044D\u0442\u0438 \u0437\u0435\u043C\u043B\u0438, \u0432\u044B"
reloc,0x018571,"you discover that it is","\u043E\u0431\u043D\u0430\u0440\u0443\u0436\u0438\u0432\u0430\u0435\u0442\u0435 \u0431\u043E\u0433\u0430\u0442\u044B\u0435"
reloc,0x018573,"rich in mineral deposits.","\u0437\u0430\u043B\u0435\u0436\u0438 \u0440\u0443\u0434\u044B."
reloc,0x018575,"The King rewards you for","\u041A\u043E\u0440\u043E\u043B\u044C \u043D\u0430\u0433\u0440\u0430\u0436\u0434\u0430\u0435\u0442 \u0432\u0430\u0441 \u0437\u0430"
reloc,0x018577,"your find by increasing","\u043D\u0430\u0445\u043E\u0434\u043A\u0443 \u0438 \u043F\u043E\u0432\u044B\u0448\u0430\u0435\u0442 \u0432\u0430\u0448\u0435"
reloc,0x018579,"your weekly income by ","\u043D\u0435\u0434\u0435\u043B\u044C\u043D\u043E\u0435 \u0436\u0430\u043B\u043E\u0432\u0430\u043D\u044C\u0435 \u043D\u0430 "

# ---- treasure: genie in a bottle
reloc,0x01857b,"Traversing the area, you","\u0411\u0440\u043E\u0434\u044F \u043F\u043E \u043E\u043A\u0440\u0443\u0433\u0435, \u0432\u044B"
reloc,0x01857d,"stumble upon a time worn","\u043D\u0430\u0442\u044B\u043A\u0430\u0435\u0442\u0435\u0441\u044C \u043D\u0430 \u0434\u0440\u0435\u0432\u043D\u0438\u0439"
reloc,0x01857f,"cannister. Curious, you un-","\u0441\u043E\u0441\u0443\u0434. \u0418\u0437 \u043B\u044E\u0431\u043E\u043F\u044B\u0442\u0441\u0442\u0432\u0430 \u0432\u044B"
reloc,0x018581,"stop the bottle, releasing","\u043E\u0442\u043A\u0440\u044B\u0432\u0430\u0435\u0442\u0435 \u0435\u0433\u043E, \u0438 \u043D\u0430\u0440\u0443\u0436\u0443"
reloc,0x018583,"a powerful genie who raises","\u0432\u044B\u0440\u044B\u0432\u0430\u0435\u0442\u0441\u044F \u043C\u043E\u0433\u0443\u0447\u0438\u0439 \u0434\u0436\u0438\u043D\u043D."
reloc,0x018585,"your Spell Power by 1 and","\u041E\u043D \u043F\u043E\u0434\u043D\u0438\u043C\u0430\u0435\u0442 \u0432\u0430\u0448\u0443 \u0441\u0438\u043B\u0443"
reloc,0x018587,"vanishes.","\u043C\u0430\u0433\u0438\u0438 \u043D\u0430 1 \u0438 \u0438\u0441\u0447\u0435\u0437\u0430\u0435\u0442."

# ---- treasure: tribe of nomads
reloc,0x018589,"A tribe of nomads greet you","\u041F\u043B\u0435\u043C\u044F \u043A\u043E\u0447\u0435\u0432\u043D\u0438\u043A\u043E\u0432 \u0442\u0435\u043F\u043B\u043E"
reloc,0x01858b,"and your army warmly. Their","\u0432\u0441\u0442\u0440\u0435\u0447\u0430\u0435\u0442 \u0432\u0430\u0441 \u0438 \u0432\u0430\u0448\u0443 \u0430\u0440\u043C\u0438\u044E."
reloc,0x01858d,"shaman, in awe of your","\u0418\u0445 \u0448\u0430\u043C\u0430\u043D, \u043F\u043E\u0440\u0430\u0436\u0451\u043D\u043D\u044B\u0439 \u0432\u0430\u0448\u0435\u0439"
reloc,0x01858f,"prowess, teaches you the","\u0434\u043E\u0431\u043B\u0435\u0441\u0442\u044C\u044E, \u043E\u0442\u043A\u0440\u044B\u0432\u0430\u0435\u0442 \u0432\u0430\u043C"
reloc,0x018591,"secret of his tribe's magic.","\u0437\u0430\u0433\u0430\u0434\u043E\u0447\u043D\u044B\u0435 \u0440\u0438\u0442\u0443\u0430\u043B\u044B \u0441\u0432\u043E\u0435\u0433\u043E"
reloc,0x018593,"Your maximum spell capacity","\u043F\u043B\u0435\u043C\u0435\u043D\u0438. \u0412\u0430\u0448 \u043C\u0430\u043A\u0441\u0438\u043C\u0443\u043C"
reloc,0x018595,"is increased by ","\u0437\u0430\u043A\u043B\u0438\u043D\u0430\u043D\u0438\u0439 \u0432\u044B\u0440\u0430\u0441\u0442\u0430\u0435\u0442 \u043D\u0430 "

# ---- treasure: captured imp
reloc,0x018597,"You have captured a","\u0412\u044B \u043F\u043E\u0439\u043C\u0430\u043B\u0438 \u043F\u0440\u043E\u043A\u0430\u0437\u043B\u0438\u0432\u043E\u0433\u043E"
reloc,0x018599,"mischevious imp which has","\u0431\u0435\u0441\u0430, \u0447\u0442\u043E \u0434\u043E\u043D\u0438\u043C\u0430\u043B \u043F\u0430\u043A\u043E\u0441\u0442\u044F\u043C\u0438"
reloc,0x01859b,"been terrorizing the","\u0432\u0441\u044E \u043E\u043A\u0440\u0443\u0433\u0443. \u0412 \u043E\u0431\u043C\u0435\u043D \u043D\u0430 \u0441\u0432\u043E\u044E"
reloc,0x01859d,"region. In exchange for","\u0441\u0432\u043E\u0431\u043E\u0434\u0443 \u043E\u043D \u0434\u0435\u043B\u0438\u0442\u0441\u044F \u0441 \u0432\u0430\u043C\u0438"
reloc,0x01859f,"its release, you receive:","\u0437\u0430\u043A\u043B\u0438\u043D\u0430\u043D\u0438\u044F\u043C\u0438:"
reloc,0x009e4c," spell.",""

# ---- treasure: maps to another continent
reloc,0x0185a1,"Hidden within an ancient","\u0412 \u0441\u0442\u0430\u0440\u0438\u043D\u043D\u043E\u043C \u0441\u0443\u043D\u0434\u0443\u043A\u0435 \u0432\u044B"
reloc,0x0185a3,"chest, you find maps and","\u043D\u0430\u0445\u043E\u0434\u0438\u0442\u0435 \u043A\u0430\u0440\u0442\u044B, \u043E\u043F\u0438\u0441\u044B\u0432\u0430\u044E\u0449\u0438\u0435"
reloc,0x0185a5,"charts describing passage to","\u043C\u043E\u0440\u0441\u043A\u043E\u0439 \u043F\u0443\u0442\u044C \u043D\u0430 \u043A\u043E\u043D\u0442\u0438\u043D\u0435\u043D\u0442:"

# ---- treasure: magic orb, map completed
reloc,0x0185a7,"Peering through a magical","\u0417\u0430\u0433\u043B\u044F\u043D\u0443\u0432 \u0432 \u0432\u043E\u043B\u0448\u0435\u0431\u043D\u044B\u0439 \u0448\u0430\u0440,"
reloc,0x0185a9,"orb you are able to view the","\u0432\u044B \u0432\u0438\u0434\u0438\u0442\u0435 \u0432\u0435\u0441\u044C \u043A\u043E\u043D\u0442\u0438\u043D\u0435\u043D\u0442"
reloc,0x0185ab,"entire continent. Your map","\u043A\u0430\u043A \u043D\u0430 \u043B\u0430\u0434\u043E\u043D\u0438. \u041A\u0430\u0440\u0442\u0430 \u044D\u0442\u0438\u0445"
reloc,0x0185ad,"of this area is complete.","\u0437\u0435\u043C\u0435\u043B\u044C \u043F\u043E\u043B\u043D\u043E\u0441\u0442\u044C\u044E \u043E\u0442\u043A\u0440\u044B\u0442\u0430."

# ==== ARTIFACT CHESTS =====================================================================

# ---- the map fragment, appended to every artifact find
string,0x0160A3,"...and a piece of the map to","...\u0438 \u0447\u0430\u0441\u0442\u044C \u043A\u0430\u0440\u0442\u044B, \u0432\u0435\u0434\u0443\u0449\u0435\u0439"
string,0x0160C0,"the stolen scepter.","\u043A \u0421\u043A\u0438\u043F\u0435\u0442\u0440\u0443 \u043F\u043E\u0440\u044F\u0434\u043A\u0430."

# ---- artifact: Ring of Heroism
string,0x019650,"Ridding the countryside of","\u0412\u044B \u0438\u0437\u0431\u0430\u0432\u043B\u044F\u0435\u0442\u0435 \u0437\u0434\u0435\u0448\u043D\u0438\u0435 \u043A\u0440\u0430\u044F"
reloc,0x0183aa,"a ferocious beast, the","\u043E\u0442 \u0441\u0432\u0438\u0440\u0435\u043F\u043E\u0433\u043E \u0437\u0432\u0435\u0440\u044F. \u0417\u0430 \u044D\u0442\u043E"
reloc,0x0183ac,"Magistrate presents you","\u043C\u0430\u0433\u0438\u0441\u0442\u0440\u0430\u0442 \u0432\u0440\u0443\u0447\u0430\u0435\u0442 \u0432\u0430\u043C"
string,0x01969A,"with: The Ring of Heroism...","\u041A\u043E\u043B\u044C\u0446\u043E \u0433\u0435\u0440\u043E\u0438\u0437\u043C\u0430..."

# ---- artifact: Shield of Protection
string,0x0196B8,"Challenged to a joust by the","\u0412\u044B\u0437\u0432\u0430\u043D\u043D\u044B\u0439 \u043D\u0430 \u043F\u043E\u0435\u0434\u0438\u043D\u043E\u043A"
reloc,0x0183b4,"dread Dark Knight, you","\u0433\u0440\u043E\u0437\u043D\u044B\u043C \u0427\u0451\u0440\u043D\u044B\u043C \u0420\u044B\u0446\u0430\u0440\u0435\u043C, \u0432\u044B"
reloc,0x0183b6,"quickly dispose of him and","\u0431\u044B\u0441\u0442\u0440\u043E \u0440\u0430\u0441\u043F\u0440\u0430\u0432\u043B\u044F\u0435\u0442\u0435\u0441\u044C \u0441 \u043D\u0438\u043C"
reloc,0x0183b8,"receive: The Shield of","\u0438 \u043F\u043E\u043B\u0443\u0447\u0430\u0435\u0442\u0435 \u0429\u0438\u0442 \u0441\u0442\u043E\u0439\u043A\u043E\u0441\u0442\u0438..."
reloc,0x0183ba,"Protection...",""

# ---- artifact: Crown of Command
reloc,0x0183bc,"Resting on a throne in a","\u041D\u0430 \u0442\u0440\u043E\u043D\u0435 \u043F\u0440\u0438\u0437\u0440\u0430\u0447\u043D\u043E\u0433\u043E \u0437\u0430\u043C\u043A\u0430"
reloc,0x0183be,"phantom castle, you have","\u0432\u044B \u043D\u0430\u0445\u043E\u0434\u0438\u0442\u0435 \u041A\u043E\u0440\u043E\u043D\u0443 \u0432\u043B\u0430\u0441\u0442\u0438..."
string,0x01975E,"found: The Crown of Command.",""

# ---- artifact: Amulet of Augmentation
reloc,0x0183c6,"Hidden within an enchanted","\u0413\u043B\u0443\u0431\u043E\u043A\u043E \u0432 \u0437\u0430\u0447\u0430\u0440\u043E\u0432\u0430\u043D\u043D\u043E\u0439 \u0440\u043E\u0449\u0435"
reloc,0x0183c8,"grove, you find: The Amulet","\u0432\u044B \u043D\u0430\u0445\u043E\u0434\u0438\u0442\u0435 \u043C\u0438\u0441\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0439"
reloc,0x0183ca,"of Augmentation...","\u0410\u043C\u0443\u043B\u0435\u0442 \u0447\u0430\u0440\u043E\u0434\u0435\u0439\u0441\u0442\u0432\u0430..."

# ---- artifact: Articles of Nobility
string,0x0197C9,"Freeing a virtuous maiden","\u0412\u044B \u043E\u0441\u0432\u043E\u0431\u043E\u0436\u0434\u0430\u0435\u0442\u0435 \u044E\u043D\u0443\u044E"
reloc,0x0183d2,"from the clutches of a","\u0434\u043E\u0431\u0440\u043E\u0434\u0435\u0442\u0435\u043B\u044C\u043D\u0443\u044E \u0434\u0435\u0432\u0443 \u0438\u0437 \u043B\u0430\u043F"
reloc,0x0183d4,"despicable criminal, you","\u0433\u043D\u0443\u0441\u043D\u043E\u0433\u043E \u0437\u043B\u043E\u0434\u0435\u044F. \u0412 \u043D\u0430\u0433\u0440\u0430\u0434\u0443"
reloc,0x0183d6,"have been granted: The","\u043C\u0435\u0441\u0442\u043D\u044B\u0439 \u043B\u043E\u0440\u0434 \u0436\u0430\u043B\u0443\u0435\u0442 \u0432\u0430\u043C"
reloc,0x0183d8,"Articles of Nobility...","\u0414\u0432\u043E\u0440\u044F\u043D\u0441\u043A\u0443\u044E \u0433\u0440\u0430\u043C\u043E\u0442\u0443..."

# ---- artifact: Anchor of Admirality
reloc,0x0183da,"You discover ancient scrolls","\u0412\u044B \u043D\u0430\u0445\u043E\u0434\u0438\u0442\u0435 \u0434\u0440\u0435\u0432\u043D\u0438\u0435 \u0441\u0432\u0438\u0442\u043A\u0438"
reloc,0x0183dc,"that describe the patterns","\u0441 \u043E\u043F\u0438\u0441\u0430\u043D\u0438\u0435\u043C \u0442\u0435\u0447\u0435\u043D\u0438\u0439 \u0432\u0441\u0435\u0445"
reloc,0x0183de,"of the oceans. Mariners, in","\u043E\u043A\u0435\u0430\u043D\u043E\u0432. \u0412 \u0431\u043B\u0430\u0433\u043E\u0434\u0430\u0440\u043D\u043E\u0441\u0442\u044C"
reloc,0x0183e0,"gratitude, bestow upon you:","\u043C\u043E\u0440\u0435\u0445\u043E\u0434\u044B \u0434\u0430\u0440\u0443\u044E\u0442 \u0432\u0430\u043C"
reloc,0x0183e2,"The Anchor of Admirality...","\u0410\u0434\u043C\u0438\u0440\u0430\u043B\u044C\u0441\u043A\u0438\u0439 \u044F\u043A\u043E\u0440\u044C..."

# ---- artifact: Book of Necros
reloc,0x0183e4,"In the study of a deserted","\u0412 \u043A\u0430\u0431\u0438\u043D\u0435\u0442\u0435 \u0437\u0430\u0431\u0440\u043E\u0448\u0435\u043D\u043D\u043E\u0439"
reloc,0x0183e6,"wizard's tower, you have","\u0431\u0430\u0448\u043D\u0438 \u043C\u0430\u0433\u0430 \u0432\u044B \u043D\u0430\u0445\u043E\u0434\u0438\u0442\u0435"
string,0x019902,"found: The Book of Necros...","\u041A\u043D\u0438\u0433\u0443 \u041D\u0435\u043A\u0440\u043E\u0441\u0430..."

# ---- artifact: Sword of Prowess
string,0x019921,"Following rumors of a great","\u0421\u043B\u0435\u0434\u0443\u044F \u0441\u043B\u0443\u0445\u0430\u043C \u043E \u0432\u0435\u043B\u0438\u043A\u043E\u043C"
reloc,0x0183f0,"and powerful sword, you","\u0438 \u043C\u043E\u0433\u0443\u0447\u0435\u043C \u043C\u0435\u0447\u0435, \u0432\u044B \u043D\u0430\u0445\u043E\u0434\u0438\u0442\u0435"
reloc,0x0183f2,"defeat its fearsome guardian","\u0438 \u043F\u043E\u0431\u0435\u0436\u0434\u0430\u0435\u0442\u0435 \u0435\u0433\u043E \u0433\u0440\u043E\u0437\u043D\u043E\u0433\u043E"
reloc,0x0183f4,"and gain possession of: The","\u0441\u0442\u0440\u0430\u0436\u0430. \u0412\u0430\u043C \u0434\u043E\u0441\u0442\u0430\u0435\u0442\u0441\u044F \u041C\u0435\u0447"
string,0x01998E,"Sword of Prowess...","\u0434\u043E\u0431\u043B\u0435\u0441\u0442\u0438..."

# ==== SIGNPOSTS ===========================================================================
reloc,0x00a04f,"A sign reads:","\u0417\u043D\u0430\u043A \u0433\u043B\u0430\u0441\u0438\u0442:"

reloc,0x018288,"Treasure Island","\u041E\u0441\u0442\u0440\u043E\u0432 \u0441\u043E\u043A\u0440\u043E\u0432\u0438\u0449"

reloc,0x01828c,"Rent a boat and sail the","\u041D\u0430\u0439\u043C\u0438\u0442\u0435 \u043A\u043E\u0440\u0430\u0431\u043B\u044C \u0438 \u043F\u043B\u044B\u0432\u0438\u0442\u0435"
reloc,0x01828e,"seas. Explore the easy way!","\u043F\u043E \u043C\u043E\u0440\u044F\u043C - \u0442\u0430\u043A \u043B\u0435\u0433\u0447\u0435 \u0432\u0441\u0435\u0433\u043E!"

reloc,0x018290,"Six villains rule","\u041A\u043E\u043D\u0442\u0438\u043D\u0435\u043D\u0442\u0438\u0435\u0439 \u043F\u0440\u0430\u0432\u044F\u0442"
reloc,0x018292,"Continentia.","\u0448\u0435\u0441\u0442\u044C \u0437\u043B\u043E\u0434\u0435\u0435\u0432."

reloc,0x018294,"Aurange is north","\u0410\u0443\u0440\u0430\u043D\u0436 \u0436\u0438\u0432\u0451\u0442 \u043A \u0441\u0435\u0432\u0435\u0440\u0443"

reloc,0x018298,"The Sceptre will never be","\u0422\u0435\u0431\u0435 \u043D\u0438\u043A\u043E\u0433\u0434\u0430 \u043D\u0435 \u043D\u0430\u0439\u0442\u0438"
reloc,0x01829a,"found!","\u0421\u043A\u0438\u043F\u0435\u0442\u0440!"

reloc,0x01829c,"King's Treasure Garden","\u0421\u0430\u0434 \u043A\u043E\u0440\u043E\u043B\u0435\u0432\u0441\u043A\u0438\u0445 \u0441\u043E\u043A\u0440\u043E\u0432\u0438\u0449"

reloc,0x0182a0,"There are two artifacts per","\u041D\u0430 \u043A\u0430\u0436\u0434\u043E\u043C \u043A\u043E\u043D\u0442\u0438\u043D\u0435\u043D\u0442\u0435"
reloc,0x0182a2,"continent.","\u043F\u043E \u0434\u0432\u0430 \u0430\u0440\u0442\u0435\u0444\u0430\u043A\u0442\u0430."

reloc,0x0182a4,"Peasant Way","\u041A\u0440\u0435\u0441\u0442\u044C\u044F\u043D\u0441\u043A\u0438\u0439 \u043F\u0443\u0442\u044C"

reloc,0x0182a8,"Wonder Woods","\u0414\u0438\u0432\u043D\u044B\u0439 \u043B\u0435\u0441"

reloc,0x0182ac,"Pond of Peril","\u0413\u0438\u0431\u043B\u044B\u0439 \u043F\u0440\u0443\u0434"

reloc,0x0182b0,"It takes time to cross the","\u041F\u0435\u0440\u0435\u0441\u0435\u0447\u044C \u043F\u0443\u0441\u0442\u044B\u043D\u044E - \u0434\u0435\u043B\u043E"
reloc,0x0182b2,"desert.","\u043D\u0435\u0431\u044B\u0441\u0442\u0440\u043E\u0435."

reloc,0x0182b4,"Dead End","\u0422\u0443\u043F\u0438\u043A"

reloc,0x0182b8,"Irok guards the north.","\u0418\u0440\u043E\u043A \u0441\u0442\u0435\u0440\u0435\u0436\u0451\u0442 \u0441\u0435\u0432\u0435\u0440."

reloc,0x0182bc,"A-maze-ing Forest","\u041B\u0435\u0441-\u043B\u0430\u0431\u0438\u0440\u0438\u043D\u0442"

reloc,0x0182c0,"All maps are found in chests","\u0412\u0441\u0435 \u043A\u0430\u0440\u0442\u044B \u043B\u0435\u0436\u0430\u0442 \u0432 \u0441\u0443\u043D\u0434\u0443\u043A\u0430\u0445"

reloc,0x0182c4,"Bridge Port","\u0417\u0430\u043C\u043E\u0441\u0442\u044C\u0435"

reloc,0x0182c8,"Hidden Grove","\u0422\u0430\u0439\u043D\u0430\u044F \u0440\u043E\u0449\u0430"

reloc,0x0182cc,"Secret Pass","\u0422\u0430\u0439\u043D\u044B\u0439 \u043F\u0435\u0440\u0435\u0432\u0430\u043B"

reloc,0x0182d0,"Isle of Death","\u041E\u0441\u0442\u0440\u043E\u0432 \u0441\u043C\u0435\u0440\u0442\u0438"

reloc,0x0182d4,"Pirate's Cove","\u041F\u0438\u0440\u0430\u0442\u0441\u043A\u0430\u044F \u0431\u0443\u0445\u0442\u0430"

reloc,0x0182d8,"Boon Docks","\u0413\u043B\u0443\u0445\u0430\u044F \u0433\u0430\u0432\u0430\u043D\u044C"

reloc,0x0182dc,"Welcome to Kookamunga!","\u0412\u0430\u0441 \u043F\u0440\u0438\u0432\u0435\u0442\u0441\u0442\u0432\u0443\u0435\u0442 \u041A\u0443\u043A\u0430\u043C\u0443\u043D\u0433\u0430!"

reloc,0x0182e0,"Time is on our side.","\u0412\u0440\u0435\u043C\u044F \u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442 \u043D\u0430 \u043D\u0430\u0441."

reloc,0x0182e4,"Passage to Basefit.","\u0414\u043E\u0440\u043E\u0433\u0430 \u043D\u0430 \u0411\u0435\u0439\u0441\u0444\u0438\u0442."

reloc,0x0182e8,"The end is near.","\u041A\u043E\u043D\u0435\u0446 \u0431\u043B\u0438\u0437\u043E\u043A."

reloc,0x0182ec,"Treasure at the river's end.","\u041A\u043B\u0430\u0434 \u0432 \u0443\u0441\u0442\u044C\u0435 \u0440\u0435\u043A\u0438."

reloc,0x0182f0,"The ogres are back... and","\u041E\u0433\u0440\u044B \u0432\u0435\u0440\u043D\u0443\u043B\u0438\u0441\u044C... \u0438 \u043E\u043D\u0438"
reloc,0x0182f2,"they're hungry!","\u0433\u043E\u043B\u043E\u0434\u043D\u044B!"

reloc,0x0182f4,"Wood's End is south.","\u041E\u043F\u0443\u0448\u043A\u0430 - \u043A \u044E\u0433\u0443."

reloc,0x0182f8,"Undead are everywhere!","\u041F\u043E\u0432\u0441\u044E\u0434\u0443 \u043D\u0435\u0436\u0438\u0442\u044C!"

reloc,0x0182fc,"Peasants are fodder!","\u041A\u0440\u0435\u0441\u0442\u044C\u044F\u043D\u0435 - \u043F\u0443\u0448\u0435\u0447\u043D\u043E\u0435 \u043C\u044F\u0441\u043E!"

reloc,0x018300,"Monster Way","\u041F\u0443\u0442\u044C \u0447\u0443\u0434\u043E\u0432\u0438\u0449"

reloc,0x018304,"There is one town for each","\u041D\u0430 \u043A\u0430\u0436\u0434\u044B\u0439 \u0437\u0430\u043C\u043E\u043A \u0437\u0434\u0435\u0441\u044C"
reloc,0x018306,"castle.","\u043F\u043E \u043E\u0434\u043D\u043E\u043C\u0443 \u0433\u043E\u0440\u043E\u0434\u0443."

reloc,0x018308,"Remember, wherever you go","\u041F\u043E\u043C\u043D\u0438: \u043A\u0443\u0434\u0430 \u0431\u044B \u0442\u044B \u043D\u0438 \u0448\u0451\u043B,"
reloc,0x01830a,"there you are.","\u0442\u044B \u0443\u0436\u0435 \u0442\u0430\u043C."

reloc,0x01830c,"Forestria maze entrance!","\u0412\u0445\u043E\u0434 \u0432 \u043B\u0430\u0431\u0438\u0440\u0438\u043D\u0442 \u0424\u043E\u0440\u0435\u0441\u0442\u0440\u0438\u0438!"

reloc,0x018310,"Crossroads","\u041F\u0435\u0440\u0435\u043A\u0440\u0451\u0441\u0442\u043E\u043A"

reloc,0x018314,"No Trespassing!","\u041F\u0440\u043E\u0445\u043E\u0434\u0430 \u043D\u0435\u0442!"

reloc,0x018318,"Beware the moors!","\u0411\u0435\u0440\u0435\u0433\u0438\u0441\u044C \u0431\u043E\u043B\u043E\u0442!"

reloc,0x01831c,"You'll never find the","\u0417\u0434\u0435\u0441\u044C \u0442\u0435\u0431\u0435 \u0421\u043A\u0438\u043F\u0435\u0442\u0440\u0430"
reloc,0x01831e,"Sceptre here!","\u043D\u0435 \u043D\u0430\u0439\u0442\u0438!"

reloc,0x018320,"Your quest is doomed!","\u0422\u0432\u043E\u0439 \u043F\u043E\u0445\u043E\u0434 \u043E\u0431\u0440\u0435\u0447\u0451\u043D!"

reloc,0x018324,"Stay on the road!","\u0414\u0435\u0440\u0436\u0438\u0442\u0435\u0441\u044C \u0434\u043E\u0440\u043E\u0433\u0438!"

reloc,0x018328,"Don't go any farther!","\u0414\u0430\u043B\u044C\u0448\u0435 \u043D\u0435 \u0445\u043E\u0434\u0438!"

reloc,0x01832c,"Wrong Way!","\u041D\u0435 \u0442\u0443\u0434\u0430!"

reloc,0x018330,"Four villains rule Forestria","\u0424\u043E\u0440\u0435\u0441\u0442\u0440\u0438\u0435\u0439 \u043F\u0440\u0430\u0432\u044F\u0442 \u0447\u0435\u0442\u0432\u0435\u0440\u043E"

reloc,0x018334,"There's no turning back!","\u041D\u0430\u0437\u0430\u0434 \u0434\u043E\u0440\u043E\u0433\u0438 \u043D\u0435\u0442!"

reloc,0x018338,"Swamplands","\u0411\u043E\u043B\u043E\u0442\u043D\u044B\u0439 \u043A\u0440\u0430\u0439"

reloc,0x01833c,"Pirate's Treasure Trove","\u041F\u0438\u0440\u0430\u0442\u0441\u043A\u0430\u044F \u0441\u043E\u043A\u0440\u043E\u0432\u0438\u0449\u043D\u0438\u0446\u0430"

reloc,0x018340,"Corak was here!","\u0417\u0434\u0435\u0441\u044C \u0431\u044B\u043B \u041A\u043E\u0440\u0430\u043A!"

reloc,0x018344,"Thieves will be eaten!","\u0412\u043E\u0440\u043E\u0432 \u0442\u0443\u0442 \u0435\u0434\u044F\u0442!"

reloc,0x018348,"Pirates have no mercy!","\u041F\u0438\u0440\u0430\u0442\u044B \u043D\u0435 \u0437\u043D\u0430\u044E\u0442 \u043F\u043E\u0449\u0430\u0434\u044B!"

reloc,0x01834c,"The dead live!","\u041C\u0451\u0440\u0442\u0432\u044B\u0435 \u0436\u0438\u0432\u044B!"

reloc,0x018350,"There are five islands here.","\u0417\u0434\u0435\u0441\u044C \u043F\u044F\u0442\u044C \u043E\u0441\u0442\u0440\u043E\u0432\u043E\u0432."

reloc,0x018354,"Maximus will DIE!","\u041C\u0430\u043A\u0441\u0438\u043C\u0443\u0441 \u0421\u0414\u041E\u0425\u041D\u0415\u0422!"

reloc,0x018358,"Pool of Prosperity","\u041F\u0440\u0443\u0434 \u0438\u0437\u043E\u0431\u0438\u043B\u0438\u044F"

reloc,0x01835c,"Four villains rule here.","\u0417\u0434\u0435\u0441\u044C \u043F\u0440\u0430\u0432\u044F\u0442 \u0447\u0435\u0442\u044B\u0440\u0435 \u0437\u043B\u043E\u0434\u0435\u044F."

reloc,0x018360,"Down with the King!","\u0414\u043E\u043B\u043E\u0439 \u043A\u043E\u0440\u043E\u043B\u044F!"

reloc,0x018364,"The islands hide treasures.","\u041D\u0430 \u043E\u0441\u0442\u0440\u043E\u0432\u0430\u0445 \u0441\u043F\u0440\u044F\u0442\u0430\u043D\u044B \u043A\u043B\u0430\u0434\u044B."

reloc,0x018368,"Time, is on our side!","\u0412\u0440\u0435\u043C\u044F \u043D\u0430 \u043D\u0430\u0448\u0435\u0439 \u0441\u0442\u043E\u0440\u043E\u043D\u0435!"

reloc,0x01836c,"Welcome to Archipelia!","\u0412\u0430\u0441 \u043F\u0440\u0438\u0432\u0435\u0442\u0441\u0442\u0432\u0443\u0435\u0442 \u0410\u0440\u0445\u0438\u043F\u0435\u043B\u0438\u044F!"

reloc,0x018370,"Saharia is a volcano","\u0421\u0430\u0445\u0430\u0440\u0438\u044F - \u044D\u0442\u043E \u0432\u0443\u043B\u043A\u0430\u043D,"
reloc,0x018372,"surrounded by a desert.","\u043E\u043A\u0440\u0443\u0436\u0451\u043D\u043D\u044B\u0439 \u043F\u0443\u0441\u0442\u044B\u043D\u0435\u0439."

reloc,0x018374,"Three villains rule Saharia.","\u0421\u0430\u0445\u0430\u0440\u0438\u0435\u0439 \u043F\u0440\u0430\u0432\u044F\u0442 \u0442\u0440\u043E\u0435."

reloc,0x018378,"Your army will perish here!","\u0417\u0434\u0435\u0441\u044C \u0442\u0432\u043E\u0435 \u0432\u043E\u0439\u0441\u043A\u043E \u0441\u0433\u0438\u043D\u0435\u0442!"

reloc,0x01837c,"Oasis","\u041E\u0430\u0437\u0438\u0441"

reloc,0x018380,"Wading Pool","\u041B\u044F\u0433\u0443\u0448\u0430\u0442\u043D\u0438\u043A"

reloc,0x018384,"Oasis of Plenty","\u041E\u0430\u0437\u0438\u0441 \u0438\u0437\u043E\u0431\u0438\u043B\u0438\u044F"

reloc,0x018388,"There is no escaping the","\u041E\u0442 \u043F\u0440\u043E\u0440\u043E\u0447\u0435\u0441\u0442\u0432\u0430 \u043D\u0435 \u0443\u0439\u0442\u0438!"
reloc,0x01838a,"prophecy!",""

reloc,0x01838c,"Volcano Guardian","\u0421\u0442\u0440\u0430\u0436 \u0432\u0443\u043B\u043A\u0430\u043D\u0430"

reloc,0x018390,"Time is running out!","\u0412\u0440\u0435\u043C\u044F \u043D\u0430 \u0438\u0441\u0445\u043E\u0434\u0435!"

reloc,0x018394,"Treasure Trough","\u041A\u043B\u0430\u0434\u0435\u0437\u044C \u0441\u043E\u043A\u0440\u043E\u0432\u0438\u0449"

reloc,0x018398,"Rest Stop","\u041F\u0440\u0438\u0432\u0430\u043B"

reloc,0x01839c,"Treasure Zone","\u0417\u0435\u043C\u043B\u044F \u0441\u043E\u043A\u0440\u043E\u0432\u0438\u0449"

reloc,0x0183a0,"This place is a nightmare!","\u042D\u0442\u043E \u043C\u0435\u0441\u0442\u043E - \u0441\u0443\u0449\u0438\u0439 \u043A\u043E\u0448\u043C\u0430\u0440!"
`;

  // web/main.ts
  var DIR = "KBR";
  var patch = async (zip) => {
    const files = readZip(zip);
    logMessage("ZIP \u0440\u0430\u0441\u043F\u0430\u043A\u043E\u0432\u0430\u043D");
    const nwc = unpackNwc(requireFile(files, "KB.EXE"));
    for (const warning of nwc.warnings) logMessage(warning, "err");
    logMessage("NWC \u0440\u0430\u0441\u043F\u0430\u043A\u043E\u0432\u0430\u043D");
    const kbu2 = unpackExepack(nwc.image);
    logMessage("EXEPACK \u0440\u0430\u0441\u043F\u0430\u043A\u043E\u0432\u0430\u043D");
    if (sha2562(kbu2) !== KBU2_SHA256) {
      throw new Error("this is not the release the patch targets");
    }
    const patched = applyPatches({ base: kbu2, patchesCsv: patches_default, gatePickerAsm: gate_picker_default, nameTablesAsm: name_tables_default });
    const { rows } = patched.summary;
    logMessage(`\u041F\u0435\u0440\u0435\u0432\u0435\u0434\u0435\u043D\u043E ${rows} \u0441\u0442\u0440\u043E\u043A`);
    const [cc256, cc416] = await Promise.all(
      [256, 416].map((mode) => patchFont(requireFile(files, `${mode}.CC`)))
    );
    logMessage("\u041A\u0438\u0440\u0438\u043B\u043B\u0438\u0447\u0435\u0441\u043A\u0438\u0439 \u0448\u0440\u0438\u0444\u0442 \u0432\u0441\u0442\u0440\u043E\u0435\u043D \u0432 \u0440\u0435\u0441\u0443\u0440\u0441\u044B \u0438\u0433\u0440\u044B");
    return writeZip(
      /* @__PURE__ */ new Map([
        [`${DIR}/KBR.EXE`, patched.image],
        [`${DIR}/256.CC`, cc256],
        [`${DIR}/416.CC`, cc416],
        [`${DIR}/dosbox.conf`, new TextEncoder().encode(dosbox_default)]
      ])
    );
  };
  bindPicker(async (file) => {
    clearScreen();
    logMessage(`\u0424\u0430\u0439\u043B ${file.name} (${Math.floor(file.size / 1024)} \u041A\u0411)`);
    try {
      showDownloadBox(await patch(new Uint8Array(await file.arrayBuffer())));
      logMessage("\u0413\u041E\u0422\u041E\u0412\u041E");
    } catch (error) {
      logMessage(`\u041E\u0428\u0418\u0411\u041A\u0410: ${error instanceof Error ? error.message : String(error)}`, "err");
    }
  });
})();
