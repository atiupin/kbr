/**
 * The screen: one 80-column DOS page, drawn here instead of typed into the markup, so no
 * line is padded by hand. A box is a frame around lines of plain text, and a line carries
 * two marks — `{y|…}` for colour, a DOS attribute byte in text form, and a tab where the
 * leftover space goes, which is what right-aligns and centres.
 */

const WIDTH = 80;

const GAP = "\t";

const MARKUP = /\{(\w+)\|([^}]*)\}/g;

type Frame = { side: string; bar: string; nw: string; ne: string; sw: string; se: string };

const DOUBLE: Frame = { side: "║", bar: "═", nw: "╔", ne: "╗", sw: "╚", se: "╝" };
const SINGLE: Frame = { side: "│", bar: "─", nw: "┌", ne: "┐", sw: "└", se: "┘" };

type Cell = string | HTMLElement;

const buildSpan = (className: string, text: string): HTMLElement => {
  const span = document.createElement("b");
  span.className = className;
  span.textContent = text;
  return span;
};

const widthOf = (cells: readonly Cell[]): number =>
  cells.reduce(
    (total, cell) =>
      total + (typeof cell === "string" ? cell : (cell.textContent ?? "")).length,
    0,
  );

/** Markup to cells: coloured runs become spans, gap markers survive as their own cell. */
const paintText = (text: string): Cell[] => {
  const cells: Cell[] = [];

  const pushPlain = (plain: string): void => {
    for (const [index, piece] of plain.split(GAP).entries()) {
      if (index > 0) cells.push(GAP);
      if (piece !== "") cells.push(piece);
    }
  };

  let at = 0;
  for (const match of text.matchAll(MARKUP)) {
    pushPlain(text.slice(at, match.index));
    cells.push(buildSpan(match[1], match[2]));
    at = match.index + match[0].length;
  }
  pushPlain(text.slice(at));

  return cells;
};

/**
 * One row, edge to edge: the free space is split evenly between the gap markers and the
 * remainder lands in the last of them, so the row always closes on column 80. An empty
 * side is a row belonging to no box, which spends nothing on edges.
 */
const buildRow = (side: string, ...cells: Cell[]): DocumentFragment => {
  const [head, tail] = side === "" ? ["", ""] : [`${side} `, ` ${side}`];

  const groups: Cell[][] = [[]];
  for (const cell of cells) {
    if (cell === GAP) groups.push([]);
    else groups[groups.length - 1].push(cell);
  }
  // A row marking no gap still has one: everything left over goes to its right.
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

const drawBox = (target: HTMLElement, frame: Frame, lines: readonly string[]): void => {
  const rule = (left: string, right: string): string =>
    `${left}${frame.bar.repeat(WIDTH - 2)}${right}\n`;

  target.replaceChildren(
    rule(frame.nw, frame.ne),
    ...lines.map((line) => buildRow(frame.side, ...paintText(line))),
    rule(frame.sw, frame.se),
  );
};

const INTRO = [
  "{y|Русская версия KING'S BOUNTY 1990 для DOS}\t{c|Перевел АЛЕКСАНДР ТЮПИН}",
  "",
  "Этот патчер собирает русскую версию из вашей копии игры прямо в браузере.",
  "",
  "1. Найдите оригинальную версию игры. Она в статусе abandonware, так что это",
  "   нетрудно. Это должен быть ZIP-архив, с файлами {w|KB.EXE}, {w|256.CC} и {w|416.CC}.",
  "2. Закиньте ее в патчер ниже и убедитесь, что все прошло хорошо.",
  "3. Скачайте {w|kbr.zip}, распакуйте и запустите {w|KBR.EXE} через DOSBox.",
  "",
  "NB: игра делалась под управление с цифровой клавиатуры, так что иногда там",
  "нужно ходить по диагонали, особенно в бою. Если у вас такого богатства нет,",
  "то это не страшно — используйте цифры {w|1}, {w|3}, {w|7}, {w|9} — быстро привыкнете.",
];

const DROP = [
  "",
  "\tПеретащите сюда ZIP со своей копией игры\t",
  "\tили нажмите, чтобы выбрать файл\t",
  "",
];

type LogKind = "ok" | "err";

const LOG_BADGES: Record<LogKind, string> = { ok: "[OK]", err: "[!!]" };

const introBox = document.getElementById("intro-box") as HTMLPreElement;
const dropBox = document.getElementById("drop-box") as HTMLPreElement;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const logBox = document.getElementById("log-box") as HTMLPreElement;
const downloadBox = document.getElementById("download-box") as HTMLAnchorElement;

/** Hard-wrapped rather than clipped: an error message is the one thing worth reading. */
const wrapText = (text: string, width: number): string[] => {
  const rows: string[] = [];
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

/** The log wears no frame: loose rows on the page, edge to edge, a badge starting each. */
export const logMessage = (text: string, kind: LogKind = "ok"): void => {
  const badge = buildSpan(kind, LOG_BADGES[kind]);

  for (const [index, row] of wrapText(text, WIDTH - 5).entries()) {
    logBox.append(index === 0 ? buildRow("", badge, " ", row) : buildRow("", "     ", row));
  }

  logBox.hidden = false;
};

export const clearScreen = (): void => {
  logBox.replaceChildren();
  logBox.hidden = true;
  downloadBox.hidden = true;
};

export const showDownloadBox = (zip: Uint8Array): void => {
  downloadBox.href = URL.createObjectURL(
    new Blob([zip as BlobPart], { type: "application/zip" }),
  );
  downloadBox.download = "kbr.zip";

  drawBox(downloadBox, SINGLE, ["", "\tСкачать kbr.zip\t", ""]);
  downloadBox.hidden = false;
};

/** The `window` listeners keep a drop that misses the box from navigating the page to it. */
export const bindPicker = (onFile: (zip: File) => void): void => {
  const onPicked = (file: File | null | undefined): void => {
    if (file != null) onFile(file);
  };

  dropBox.addEventListener("click", () => fileInput.click());

  // Clearing the input is what lets the same file be picked again after a failed run.
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
