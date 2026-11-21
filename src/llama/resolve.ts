import path from "node:path";
import fs from "node:fs";
import { ROOT } from "../paths";

export interface LlamaBinary {
  path: string;
  mode: "server" | "serve";
  source: string;
}

const EXE = process.platform === "win32" ? ".exe" : "";

function usable(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function modeFor(p: string): "server" | "serve" {
  const base = path.basename(p).replace(/\.exe$/i, "").toLowerCase();
  return base === "llama" ? "serve" : "server";
}

export function resolveLlama(override?: string): LlamaBinary | null {
  const dirSep = process.platform === "win32" ? ";" : ":";
  const candidates: Array<{ p: string; source: string }> = [];
  const envBin = process.env.AIEA_LLAMA_BIN;
  if (envBin) candidates.push({ p: path.resolve(envBin), source: "AIEA_LLAMA_BIN" });
  if (override && override !== "auto") {
    candidates.push({ p: path.resolve(override), source: "model config runtime.binary" });
  }
  const pathDirs = (process.env.PATH ?? "").split(dirSep);
  for (const name of ["llama-server", "llama"]) {
    for (const d of pathDirs) {
      if (!d) continue;
      candidates.push({ p: path.join(d, name + EXE), source: "PATH" });
    }
  }
  for (const name of ["llama-server", "llama"]) {
    candidates.push({ p: path.join(ROOT, "llama", name + EXE), source: "./llama (extracted binaries)" });
  }
  for (const name of ["llama-server", "llama"]) {
    candidates.push({ p: path.join(ROOT, name + EXE), source: "project root" });
  }
  for (const c of candidates) {
    if (usable(c.p)) return { path: c.p, mode: modeFor(c.p), source: c.source };
  }
  return null;
}

export const RESOLUTION_ORDER_DOC = [
  "1. env AIEA_LLAMA_BIN (path to llama-server or the unified llama binary)",
  "2. model config runtime.binary (if not: auto)",
  "3. llama-server / llama found on PATH",
  "4. ./llama/llama-server or ./llama/llama (extracted prebuilt release binaries)",
  "5. llama-server / llama in the project root",
].join("\n");

export function missingLlamaMessage(): string {
  return [
    "No llama.cpp binary found.",
    "",
    "Resolution order tried:",
    RESOLUTION_ORDER_DOC,
    "",
    "Fix any one of them and retry. The unified llama binary (llama serve) and",
    "classic llama-server are both supported and auto-detected.",
  ].join("\n");
}
