import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { BENCHMARKS_DIR, CONFIGS_MODELS_DIR } from "../paths";
import type {
  ModelConfig,
  ModelRuntime,
  ModelSampling,
  ReasoningEffort,
  SuiteConfig,
  SuiteTier,
} from "./types";

type YamlApi = { parse: (text: string) => unknown };
const yaml = (Bun as unknown as { YAML?: YamlApi }).YAML;

export function parseYaml(text: string): Record<string, unknown> {
  if (!yaml) throw new Error("Bun.YAML is not available in this Bun build");
  const doc = yaml.parse(text);
  if (doc === null || doc === undefined) return {};
  if (typeof doc !== "object") throw new Error("YAML document must be a mapping");
  return doc as Record<string, unknown>;
}

function fail(src: string, msg: string): never {
  throw new Error(`${src}: ${msg}`);
}

function str(doc: Record<string, unknown>, key: string, src: string): string {
  const v = doc[key];
  if (typeof v !== "string" || v.length === 0) fail(src, `field "${key}" must be a non-empty string`);
  return v;
}

function optStr(doc: Record<string, unknown>, key: string): string | null {
  const v = doc[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(doc: Record<string, unknown>, key: string, fallback: number, src: string): number {
  const v = doc[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v !== "number" || !Number.isFinite(v)) fail(src, `field "${key}" must be a number`);
  return v;
}

function bool(doc: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = doc[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v !== "boolean") throw new Error(`field "${key}" must be a boolean`);
  return v;
}

const REASONING_EFFORTS: ReasoningEffort[] = ["none", "low", "high"];

const SAMPLING_DEFAULTS: ModelSampling = {
  temperature: 0.9,
  top_p: 0.95,
  top_k: 40,
  min_p: 0,
  repeat_penalty: 1.05,
};

const RUNTIME_DEFAULTS: ModelRuntime = {
  binary: "auto",
  port: 8750,
  context: 8192,
  ngl: 99,
  threads: 0,
  load_timeout_sec: 600,
};

function readSampling(doc: Record<string, unknown>): ModelSampling {
  const s = (doc.sampling ?? {}) as Record<string, unknown>;
  return {
    temperature: num(s, "temperature", SAMPLING_DEFAULTS.temperature, "sampling"),
    top_p: num(s, "top_p", SAMPLING_DEFAULTS.top_p, "sampling"),
    top_k: num(s, "top_k", SAMPLING_DEFAULTS.top_k, "sampling"),
    min_p: num(s, "min_p", SAMPLING_DEFAULTS.min_p, "sampling"),
    repeat_penalty: num(s, "repeat_penalty", SAMPLING_DEFAULTS.repeat_penalty, "sampling"),
  };
}

function readRuntime(doc: Record<string, unknown>): ModelRuntime {
  const r = (doc.runtime ?? {}) as Record<string, unknown>;
  const out: ModelRuntime = {
    binary: typeof r.binary === "string" && r.binary.length > 0 ? r.binary : RUNTIME_DEFAULTS.binary,
    port: num(r, "port", RUNTIME_DEFAULTS.port, "runtime"),
    context: num(r, "context", RUNTIME_DEFAULTS.context, "runtime"),
    ngl: num(r, "ngl", RUNTIME_DEFAULTS.ngl, "runtime"),
    threads: num(r, "threads", RUNTIME_DEFAULTS.threads, "runtime"),
    load_timeout_sec: num(r, "load_timeout_sec", RUNTIME_DEFAULTS.load_timeout_sec, "runtime"),
  };
  out.port = Math.round(out.port);
  out.context = Math.round(out.context);
  out.ngl = Math.round(out.ngl);
  out.threads = Math.round(out.threads);
  return out;
}

export async function listModelConfigNames(): Promise<string[]> {
  try {
    const entries = await readdir(CONFIGS_MODELS_DIR);
    return entries
      .filter((e) => e.endsWith(".yaml") || e.endsWith(".yml"))
      .map((e) => e.replace(/\.ya?ml$/, ""))
      .sort();
  } catch {
    return [];
  }
}

export function applyOverrides(
  base: ModelConfig,
  ovr?: { sampling?: Partial<ModelSampling>; runtime?: Partial<ModelRuntime>; reasoning?: { effort?: ReasoningEffort } },
): ModelConfig {
  if (!ovr) return base;
  return {
    ...base,
    sampling: { ...base.sampling, ...(ovr.sampling ?? {}) },
    runtime: { ...base.runtime, ...(ovr.runtime ?? {}) },
    reasoning: { effort: ovr.reasoning?.effort ?? base.reasoning.effort },
  };
}

export async function loadModelConfig(nameOrPath: string): Promise<ModelConfig> {
  const p =
    nameOrPath.endsWith(".yaml") || nameOrPath.endsWith(".yml") || nameOrPath.includes(path.sep)
      ? path.resolve(nameOrPath)
      : path.join(CONFIGS_MODELS_DIR, `${nameOrPath}.yaml`);
  const src = path.relative(process.cwd(), p);
  let text: string;
  try {
    text = await readFile(p, "utf8");
  } catch {
    throw new Error(`model config not found: ${src}`);
  }
  const doc = parseYaml(text);
  const name = str(doc, "name", src);
  const hf = optStr(doc, "hf");
  const quant = optStr(doc, "quant");
  const file = optStr(doc, "file");
  const localPath = optStr(doc, "local_path");
  if (!hf && !localPath) fail(src, `set either "hf" (repo id or URL) or "local_path" to an existing gguf file`);
  if (!hf && !file) fail(src, `with "local_path" you can omit "file"; otherwise set "hf"`);
  const reasoning = (doc.reasoning ?? {}) as Record<string, unknown>;
  const effort = reasoning.effort;
  const effortOk = typeof effort === "string" && (REASONING_EFFORTS as string[]).includes(effort);
  if (effort !== undefined && !effortOk) {
    fail(src, `reasoning.effort must be one of: ${REASONING_EFFORTS.join(", ")}`);
  }
  return {
    name,
    hf,
    quant,
    file,
    local_path: localPath ? path.resolve(localPath) : null,
    reasoning: { effort: effortOk ? (effort as ReasoningEffort) : "none" },
    sampling: readSampling(doc),
    runtime: readRuntime(doc),
  };
}

export async function listSuiteNames(): Promise<string[]> {
  try {
    const entries = await readdir(BENCHMARKS_DIR);
    return entries
      .filter((e) => e.endsWith(".yaml") || e.endsWith(".yml"))
      .map((e) => e.replace(/\.ya?ml$/, ""))
      .sort();
  } catch {
    return [];
  }
}

export async function loadSuiteConfig(name = "creativity"): Promise<SuiteConfig> {
  const p = path.join(BENCHMARKS_DIR, `${name}.yaml`);
  const src = path.relative(process.cwd(), p);
  let text: string;
  try {
    text = await readFile(p, "utf8");
  } catch {
    throw new Error(`suite config not found: ${src}`);
  }
  const doc = parseYaml(text);
  const id = str(doc, "id", src);
  const title = str(doc, "title", src);
  const defaultsRaw = (doc.defaults ?? {}) as Record<string, unknown>;
  const samples = num(defaultsRaw, "samples_per_prompt", 5, src);
  const seed = num(defaultsRaw, "seed", 20260101, src);
  const maxTokens = num(defaultsRaw, "max_tokens", 512, src);
  if (!Number.isInteger(samples) || samples < 1) fail(src, "defaults.samples_per_prompt must be a positive integer");
  const judgeRaw = doc.judge;
  let judge: { model: string } | null = null;
  if (judgeRaw !== null && judgeRaw !== undefined) {
    const j = judgeRaw as Record<string, unknown>;
    if (typeof j.model !== "string" || j.model.length === 0) {
      fail(src, 'judge must be null or an object like { model: "<model-config-name>" }');
    }
    judge = { model: j.model as string };
  }
  const outputDir = optStr(doc, "output_dir") ?? "results";
  const judgeModeRaw = doc.judge_mode;
  let judgeMode: "sequential" | "concurrent" = "sequential";
  if (typeof judgeModeRaw === "string") {
    if (judgeModeRaw !== "sequential" && judgeModeRaw !== "concurrent") {
      fail(src, 'judge_mode must be "sequential" or "concurrent"');
    }
    judgeMode = judgeModeRaw;
  }
  let embedder: { hf: string; quant: string | null; file: string | null; port: number } | null = null;
  if (doc.embedder !== null && doc.embedder !== undefined) {
    const e = doc.embedder as Record<string, unknown>;
    if (typeof e.hf !== "string" || e.hf.length === 0) {
      fail(src, 'embedder must be null or an object like { hf: "<gguf repo>", quant?: "...", file?: "...", port?: 8752 }');
    }
    embedder = {
      hf: e.hf as string,
      quant: optStr(e, "quant"),
      file: optStr(e, "file"),
      port: Math.max(1024, Math.min(65535, Math.round(num(e, "port", 8752, src)))),
    };
  }
  const tiersRaw = doc.tiers;
  if (!Array.isArray(tiersRaw) || tiersRaw.length === 0) fail(src, "tiers must be a non-empty list");
  const tiers: SuiteTier[] = tiersRaw.map((raw, i) => {
    const t = raw as Record<string, unknown>;
    const tid = typeof t.id === "string" && t.id.length > 0 ? t.id : `tier-${i + 1}`;
    const label = typeof t.label === "string" && t.label.length > 0 ? t.label : tid;
    const windowRaw = t.word_window;
    let window: [number, number] | null = null;
    if (Array.isArray(windowRaw) && windowRaw.length === 2) {
      window = [Number(windowRaw[0]), Number(windowRaw[1])];
      if (!Number.isFinite(window[0]) || !Number.isFinite(window[1])) window = null;
    }
    return {
      id: tid,
      label,
      enabled: bool(t, "enabled", true),
      weight: num(t, "weight", 0, src),
      prompts: Math.round(num(t, "prompts", 0, src)),
      max_tokens: Math.round(num(t, "max_tokens", maxTokens, src)),
      word_window: window,
    };
  });
  const ids = new Set<string>();
  for (const t of tiers) {
    if (ids.has(t.id)) fail(src, `duplicate tier id "${t.id}"`);
    ids.add(t.id);
    if (t.prompts < 1) fail(src, `tier ${t.id}: prompts must be >= 1`);
  }
  const weightSum = tiers.filter((t) => t.enabled).reduce((s, t) => s + t.weight, 0);
  if (tiers.some((t) => t.enabled) && (weightSum < 0.9 || weightSum > 1.1)) {
    fail(src, `weights of enabled tiers must sum to ~1.0 (got ${weightSum.toFixed(3)})`);
  }
  return {
    id,
    title,
    defaults: { samples_per_prompt: samples, seed, max_tokens: maxTokens },
    judge,
    judge_mode: judgeMode,
    embedder,
    output_dir: outputDir,
    tiers,
  };
}
