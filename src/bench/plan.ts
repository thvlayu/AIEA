import type { SuiteConfig } from "../config/types";
import { tierPrompts, type Probe } from "../suites/creativity/prompts";

export interface PlanItem {
  tierIdx: number;
  tierId: string;
  tierLabel: string;
  probe: Probe;
  sampleCount: number;
  seedBase: number;
  maxTokens: number;
  wordWindow: [number, number] | null;
}

export interface RunPlan {
  items: PlanItem[];
  totalPrompts: number;
  totalSamples: number;
  maxTokensByTier: Array<{ tierId: string; maxTokens: number }>;
}

export function buildPlan(suite: SuiteConfig, runSeed: number, samplesPerPrompt: number): RunPlan {
  const items: PlanItem[] = [];
  for (const tier of suite.tiers) {
    if (!tier.enabled) continue;
    const bank = tierPrompts(tier.id);
    if (bank.length < tier.prompts) {
      throw new Error(
        `suite tier "${tier.id}" wants ${tier.prompts} prompts but the prompt bank has only ${bank.length}`,
      );
    }
    const tierIdx = suite.tiers.indexOf(tier);
    bank.slice(0, tier.prompts).forEach((probe, promptIdx) => {
      const seedBase = runSeed * 10000 + tierIdx * 1000 + promptIdx * 10;
      items.push({
        tierIdx,
        tierId: tier.id,
        tierLabel: tier.label,
        probe,
        sampleCount: samplesPerPrompt,
        seedBase,
        maxTokens: tier.max_tokens || suite.defaults.max_tokens,
        wordWindow: tier.word_window,
      });
    });
  }
  const totalPrompts = items.length;
  const totalSamples = items.reduce((s, i) => s + i.sampleCount, 0);
  return { items, totalPrompts, totalSamples, maxTokensByTier: [] };
}
