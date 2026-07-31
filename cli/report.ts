export const heading = (text: string): void => {
  console.log(`\n=== ${text} ${"=".repeat(Math.max(0, 60 - text.length))}`);
};

export const step = (n: number, total: number, what: string): void => {
  heading(`${n}/${total}  ${what}`);
};

export const line = (text: string): void => {
  console.log(`  ${text}`);
};

/** One name/status/detail row, columns aligned so a run scans vertically. */
export const item = (status: string, name: string, detail = ""): void => {
  console.log(`  ${name.padEnd(10)}  ${status.padEnd(9)}  ${detail}`.trimEnd());
};
