import path from "node:path";
import { mkdir } from "node:fs/promises";

export const ROOT = path.resolve(import.meta.dir, "..");

export const CONFIGS_MODELS_DIR = path.join(ROOT, "configs", "models");
export const BENCHMARKS_DIR = path.join(ROOT, "benchmarks");

export const MODELS_DIR = process.env.AIEA_MODELS_DIR
  ? path.resolve(process.env.AIEA_MODELS_DIR)
  : path.join(ROOT, "models");

export const RESULTS_DIR = process.env.AIEA_RESULTS_DIR
  ? path.resolve(process.env.AIEA_RESULTS_DIR)
  : path.join(ROOT, "results");

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export function stamp(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    String(d.getFullYear()) +
    p(d.getMonth() + 1) +
    p(d.getDate()) +
    "-" +
    p(d.getHours()) +
    p(d.getMinutes()) +
    p(d.getSeconds())
  );
}

export function sanitizeName(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}
