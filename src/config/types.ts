export type ReasoningEffort = "none" | "low" | "high";

export interface ModelSampling {
  temperature: number;
  top_p: number;
  top_k: number;
  min_p: number;
  repeat_penalty: number;
}

export interface ModelRuntime {
  binary: string;
  port: number;
  context: number;
  ngl: number;
  threads: number;
  load_timeout_sec: number;
}

export interface ModelConfig {
  name: string;
  hf: string | null;
  quant: string | null;
  file: string | null;
  local_path: string | null;
  reasoning: { effort: ReasoningEffort };
  sampling: ModelSampling;
  runtime: ModelRuntime;
}

export interface SuiteTier {
  id: string;
  label: string;
  enabled: boolean;
  weight: number;
  prompts: number;
  max_tokens: number;
  word_window: [number, number] | null;
}

export interface SuiteConfig {
  id: string;
  title: string;
  defaults: { samples_per_prompt: number; seed: number; max_tokens: number };
  judge: { model: string } | null;
  output_dir: string;
  tiers: SuiteTier[];
}
