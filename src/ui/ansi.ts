export const RESET = "\x1b[0m";
export const BOLD = "\x1b[1m";
export const DIM = "\x1b[2m";
export const RED = "\x1b[31m";
export const GREEN = "\x1b[32m";
export const YELLOW = "\x1b[33m";
export const BLUE = "\x1b[34m";
export const MAGENTA = "\x1b[35m";
export const CYAN = "\x1b[36m";
export const GRAY = "\x1b[90m";

export const CLEAR = "\x1b[2J\x1b[H";
export const HIDE_CURSOR = "\x1b[?25l";
export const SHOW_CURSOR = "\x1b[?25h";

export function moveTo(row: number, col: number): string {
  return `\x1b[${row};${col}H`;
}

export function paint(code: string, text: string): string {
  return `${code}${text}${RESET}`;
}

export function truncate(s: string, w: number): string {
  if (s.length <= w) return s;
  return s.slice(0, Math.max(0, w - 3)) + "...";
}

export function pad(s: string, w: number): string {
  return truncate(s, w).padEnd(w, " ");
}

export function padStart(s: string, w: number): string {
  return truncate(s, w).padStart(w, " ");
}

export function bar(frac: number, width: number): string {
  const f = Math.max(0, Math.min(1, frac));
  const filled = Math.round(f * width);
  return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
}

export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
