import path from "node:path";
import { stat } from "node:fs/promises";
import { MODELS_DIR, ensureDir } from "../paths";

export interface HfFile {
  path: string;
  size: number;
}

export interface PickResult {
  file: string;
  size: number;
  shards: string[];
}

export function repoUrl(repo: string): string {
  return repo.startsWith("http") ? repo.replace(/\/$/, "") : `https://huggingface.co/${repo}`;
}

export function rawFileUrl(repo: string, file: string): string {
  return `${repoUrl(repo)}/resolve/main/${file}`;
}

export function repoId(repo: string): string {
  return repo.replace(/^https?:\/\/huggingface\.co\//, "").replace(/\/$/, "");
}

export async function listRepoFiles(repo: string): Promise<HfFile[]> {
  const id = repoId(repo);
  const res = await fetch(`https://huggingface.co/api/models/${id}/tree/main`);
  if (!res.ok) throw new Error(`huggingface API returned HTTP ${res.status} for ${id}`);
  const arr = (await res.json()) as Array<Record<string, unknown>>;
  return arr.map((e) => {
    const lfs = (e as { lfs?: { size?: number } }).lfs;
    return { path: String(e["path"]), size: Number(lfs?.size ?? e["size"] ?? 0) };
  });
}

export function modelBase(repo: string): string {
  const last = repoId(repo).split("/").pop() ?? "model";
  return last.replace(/-GGUF$/i, "");
}

const SHARD_RE = /-(\d{5})-of-(\d{5})\.gguf$/i;

export function pickGguf(
  files: HfFile[],
  opts: { quant?: string | null; file?: string | null; base: string },
): PickResult {
  const ggufs = files.filter(
    (f) => f.path.toLowerCase().endsWith(".gguf") && !f.path.toLowerCase().startsWith("mmproj"),
  );
  if (opts.file) {
    const hit = ggufs.find((f) => f.path === opts.file || f.path.endsWith("/" + opts.file));
    if (!hit) {
      throw new Error(`declared file "${opts.file}" was not found among gguf files of the repo`);
    }
    return { file: hit.path, size: hit.size, shards: [hit.path] };
  }
  if (!opts.quant) throw new Error("config declares hf without quant or file: cannot pick a model file");
  const q = opts.quant.toUpperCase();
  const matching = ggufs.filter((f) => f.path.toUpperCase().includes(q));
  if (matching.length === 0) {
    throw new Error(
      `no gguf matching quant "${opts.quant}". Available: ${ggufs.map((f) => f.path).join(", ")}`,
    );
  }
  const exact = `${opts.base}-${opts.quant}.gguf`;
  const exactHit = matching.find((f) => f.path === exact);
  const sorted = [...matching].sort((a, b) => b.size - a.size);
  const chosen = exactHit ?? sorted[0]!;
  const shardMatch = chosen.path.match(SHARD_RE);
  if (shardMatch) {
    const prefix = chosen.path.slice(0, chosen.path.length - shardMatch[0].length);
    const shards = ggufs
      .filter((f) => f.path.startsWith(prefix) && SHARD_RE.test(f.path))
      .sort((a, b) => a.path.localeCompare(b.path));
    const total = shards.reduce((s, f) => s + f.size, 0);
    return { file: chosen.path, size: total, shards: shards.map((f) => f.path) };
  }
  return { file: chosen.path, size: chosen.size, shards: [chosen.path] };
}

export function fmtMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

async function download(url: string, dest: string, onProgress?: (loaded: number, total: number) => void) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status} for ${url}`);
  const total = Number(res.headers.get("content-length") ?? 0);
  const sink = Bun.file(dest).writer();
  const reader = res.body.getReader();
  let loaded = 0;
  let lastReport = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        sink.write(value);
        loaded += value.byteLength;
      }
      if (onProgress && total > 0 && loaded - lastReport > 64 * 1024 * 1024) {
        lastReport = loaded;
        onProgress(loaded, total);
      }
    }
  } finally {
    await sink.end();
  }
}

export async function ensureModelFiles(
  repo: string,
  opts: { quant?: string | null; file?: string | null },
  hooks: { log: (line: string) => void; progress?: (loaded: number, total: number) => void },
): Promise<string[]> {
  await ensureDir(MODELS_DIR);
  const files = await listRepoFiles(repo);
  const pick = pickGguf(files, { quant: opts.quant, file: opts.file, base: modelBase(repo) });
  const sizeByPath = new Map(files.map((f) => [f.path, f.size]));
  const outPaths: string[] = [];
  for (const shard of pick.shards) {
    const dest = path.join(MODELS_DIR, path.basename(shard));
    outPaths.push(dest);
    const expected = sizeByPath.get(shard) ?? 0;
    const st = await stat(dest).catch(() => null);
    if (st && expected > 0 && Math.abs(st.size - expected) < 1024 * 1024) {
      hooks.log(`cached: ${dest} (${fmtMB(expected)} MB)`);
      continue;
    }
    hooks.log(`downloading ${shard} (${fmtMB(expected)} MB)`);
    await download(rawFileUrl(repo, shard), dest, hooks.progress);
    hooks.log(`downloaded: ${dest}`);
  }
  return outPaths;
}
