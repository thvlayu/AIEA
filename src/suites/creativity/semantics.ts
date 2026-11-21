import { embeddings } from "../../llama/client";
import { SLOP_EXEMPLARS, TIME_CANON, TYPICAL_USES } from "./canon";

export interface Embedder {
  label: string;
  embed: (texts: string[]) => Promise<number[][]>;
}

function normalize(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum);
  return norm > 0 ? v.map((x) => x / norm) : v;
}

export function makeEmbedder(port: number, label: string): Embedder {
  return {
    label,
    async embed(texts: string[]) {
      if (texts.length === 0) return [];
      const out: number[][] = [];
      const batch = 16;
      for (let i = 0; i < texts.length; i += batch) {
        const vecs = await embeddings(port, texts.slice(i, i + batch));
        for (const v of vecs) out.push(normalize(v));
      }
      return out;
    },
  };
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function meanPairwiseDistance(vecs: number[][]): number {
  if (vecs.length < 2) return 0;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < vecs.length; i++) {
    for (let j = i + 1; j < vecs.length; j++) {
      sum += 1 - cosine(vecs[i]!, vecs[j]!);
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

export function minPairwiseDistance(vecs: number[][]): number {
  if (vecs.length < 2) return 2;
  let min = 2;
  for (let i = 0; i < vecs.length; i++) {
    for (let j = i + 1; j < vecs.length; j++) {
      const d = 1 - cosine(vecs[i]!, vecs[j]!);
      if (d < min) min = d;
    }
  }
  return min;
}

export function maxSimToSet(v: number[], set: number[][]): number {
  let max = -1;
  for (const s of set) {
    const sim = cosine(v, s);
    if (sim > max) max = sim;
  }
  return Math.max(0, max);
}

export function clusterCount(vecs: number[][], simThreshold = 0.75): number {
  const clusters: number[][] = [];
  for (let i = 0; i < vecs.length; i++) {
    let placed = false;
    for (const c of clusters) {
      const rep = c[0]!;
      if (cosine(vecs[i]!, vecs[rep]!) >= simThreshold) {
        c.push(i);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push([i]);
  }
  return clusters.length;
}

export interface Canon {
  timeVecs: Array<{ label: string; vec: number[] }>;
  slopVecs: number[][];
  typical: Record<string, number[][]>;
}

export async function precomputeCanon(embedder: Embedder): Promise<Canon> {
  const flat = TIME_CANON.flatMap((c) => c.exemplars.map((e) => ({ label: c.label, text: e })));
  const timeRaw = await embedder.embed(flat.map((f) => f.text));
  const slopVecs = await embedder.embed(SLOP_EXEMPLARS);
  const typical: Record<string, number[][]> = {};
  for (const [pid, uses] of Object.entries(TYPICAL_USES)) {
    typical[pid] = await embedder.embed(uses);
  }
  return {
    timeVecs: flat.map((f, i) => ({ label: f.label, vec: timeRaw[i] ?? [] })),
    slopVecs,
    typical,
  };
}

export interface SemanticsContext {
  embedder: Embedder;
  canon: Canon;
}
