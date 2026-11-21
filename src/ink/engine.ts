import type { ModelConfig, SuiteConfig } from "../config/types";
import type { PlanItem } from "../bench/plan";
import type { PromptStats } from "../bench/metrics";
import type { RunHooks, RunSummary } from "../bench/runner";
import type { Probe } from "../suites/creativity/prompts";
import { tierPrompts } from "../suites/creativity/prompts";
import { runSuite } from "../bench/runner";
import { resolveLlama, missingLlamaMessage } from "../llama/resolve";

export interface SetupResult {
  mock: boolean;
  model: ModelConfig;
  suite: SuiteConfig;
  teacher: ModelConfig | null;
  samples: number;
  seed: number;
  judgeOverrides?: {
    sampling?: Partial<ModelConfig["sampling"]>;
    runtime?: Partial<ModelConfig["runtime"]>;
    reasoning?: { effort?: ModelConfig["reasoning"]["effort"] };
  };
}

export interface RunEngine {
  label: string;
  start: (hooks: RunHooks) => Promise<RunSummary>;
  abort: () => void;
}

export function createRealEngine(s: SetupResult): RunEngine {
  const abortRef = { aborted: false };
  return {
    label: `${s.model.name} -> ${s.suite.id}`,
    async start(hooks) {
      const binary = resolveLlama(s.model.runtime.binary);
      if (!binary) throw new Error(missingLlamaMessage());
      return runSuite({
        model: s.model,
        suite: s.suite,
        binary,
        samples: s.samples,
        seed: s.seed,
        judgeOverrides: s.teacher ? s.judgeOverrides : undefined,
        abortRef,
        hooks,
      });
    },
    abort() {
      abortRef.aborted = true;
    },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const TIER_DEFS = [
  { id: "t1_mode_collapse", label: "Tier 1 Mode Collapse Probe", weight: 0.25, prompts: 5, maxTokens: 128, wordWindow: null },
  { id: "t2_constrained_divergence", label: "Tier 2 Constrained Divergence", weight: 0.2, prompts: 4, maxTokens: 512, wordWindow: null },
  { id: "t3_slop_resistance", label: "Tier 3 Slop Resistance", weight: 0.2, prompts: 4, maxTokens: 400, wordWindow: null },
  { id: "t4_literature_craft", label: "Tier 4 Literature Craft", weight: 0.2, prompts: 3, maxTokens: 1400, wordWindow: [600, 800] as [number, number] },
  { id: "t5_associative_leap", label: "Tier 5 Associative Leap", weight: 0.15, prompts: 3, maxTokens: 700, wordWindow: null },
];

function det(seed: number, salt: number, lo: number, hi: number): number {
  const x = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
  const frac = x - Math.floor(x);
  return lo + frac * (hi - lo);
}

const SHORT_POOL = [
  "Time is a river.",
  "Time is a locked filing cabinet.",
  "Time is an unpaid invoice.",
  "Time is a river that carries us.",
  "Time is a carpenter who never measures.",
  "Time is the only debt that collects itself.",
  "7",
  "3",
  "The Static",
  "Anchovy and Pear",
  "Kyoto",
  "Marakesh",
];

const STORY_POOL = [
  "The kettle screamed and stopped. Nobody moved. Outside, the fairground lay in three feet of silt, and she pried the barometer from the wreck of her truck with a serving fork.",
  "Flour in the mouth before words. She ironed the dress flat with a book, wrapped it in butcher paper, and thought about the road they were about to lose.",
  "Snow came sideways through the bus doors. He set the broken watch face-up on the table and lost the first game in eleven moves on purpose.",
];

function mockText(probe: Probe, idx: number, seed: number): string {
  const salt = seed + idx;
  switch (probe.kind) {
    case "short-answer": {
      const pool = probe.id === "number-1-10" ? ["7", "7", "3", "9", "7"] : SHORT_POOL;
      return pool[Math.floor(det(salt, 3, 0, pool.length))]!;
    }
    case "uses": {
      const lines = [
        "1. doorstop for a crooked trailer",
        "2. bookmark pressed into wet clay",
        "3. weight for a kite line in a storm",
        "4. loom for braiding copper wire",
        "5. cold plate for a dying campfire",
        "6. stencil for paint dots",
        "7. musical tone in a junk orchestra",
        "8. grind stone for turmeric paste",
      ];
      return lines.slice(0, 4 + Math.floor(det(salt, 5, 0, 5))).join("\n");
    }
    case "word-list": {
      const words = ["bakery", "boulder", "brine", "bayonet", "beacon", "bramble", "broker", "brine", "burlap", "blister", "bail", "basil", "brine"];
      return [...new Set(words)].slice(0, 25).join("\n");
    }
    case "prose": {
      const base = STORY_POOL[Math.floor(det(salt, 7, 0, STORY_POOL.length))]!;
      return `${base} The tide of ordinary hours kept moving. Somewhere a gull worked at a candy wrapper like a locksmith.`;
    }
    case "story": {
      const base = STORY_POOL[Math.floor(det(salt, 11, 0, STORY_POOL.length))]!;
      return `${base} ${base} By the third day she had stopped calling it loss and started calling it weather. ${base}`;
    }
    case "piece": {
      const base = probe.id === "ad-silence" ? "Silence does what noise promises. Hold it to your ear for ten seconds; the day reassembles itself. $0.00 per minute." : STORY_POOL[0]!;
      return base;
    }
  }
}

function fakeStats(probe: Probe, idx: number, seed: number): PromptStats {
  const s = seed + idx;
  const base: PromptStats = {
    probeId: probe.id,
    label: probe.label,
    score: 0,
    distinctRatio: det(s, 1, 0.4, 1),
    distinctCount: 3,
    meanPairSim: det(s, 2, 0.15, 0.45),
    modalShare: det(s, 3, 0.2, 0.6),
    modalLabel: "river-flow",
    riverShare: probe.id === "time-metaphor" ? det(s, 4, 0, 0.6) : 0,
    slopPer100: det(s, 5, 0.2, 3.5),
    slopWeighted: det(s, 6, 0.5, 4),
    fluency: probe.kind === "short-answer" ? 5 : det(s, 7, 0.6, 1),
    adherence: det(s, 8, 0.8, 1),
    elementsPresentRatio: det(s, 9, 0.6, 1),
    ttcwPassRatio: det(s, 10, 0.4, 0.9),
    windowOk: det(s, 11, 0, 1) > 0.3 ? 1 : 0,
    conceptMentionRatio: det(s, 12, 0.5, 1),
    wordCountMean: probe.kind === "story" ? det(s, 13, 580, 820) : det(s, 13, 90, 260),
  };
  base.distinctCount = Math.max(1, Math.round(base.distinctRatio * 5));
  switch (probe.kind) {
    case "short-answer":
      base.score = probe.id === "time-metaphor"
        ? 0.4 * (1 - base.modalShare) + 0.3 * (1 - base.riverShare) + 0.3 * base.distinctRatio
        : 0.6 * (1 - base.modalShare) + 0.4 * base.distinctRatio;
      break;
    case "uses":
      base.score = 0.5 * base.fluency + 0.5 * base.distinctRatio;
      break;
    case "word-list":
      base.score = 0.6 * base.adherence + 0.4 * (0.5 * base.fluency + 0.5 * base.distinctRatio);
      break;
    case "prose":
      base.score = Math.max(0, 1 - base.slopPer100 / 8);
      break;
    case "story":
      base.score = 0.4 * base.elementsPresentRatio + 0.4 * base.ttcwPassRatio + 0.2 * base.windowOk;
      break;
    case "piece":
      base.score = 0.5 * base.conceptMentionRatio + 0.3 * Math.max(0, 1 - base.slopPer100 / 8) + 0.2 * base.windowOk;
      break;
  }
  base.score = Math.max(0, Math.min(1, base.score));
  return base;
}

function mockLogLine(step: number, sampleIdx: number): string {
  const pool = [
    `sample ${sampleIdx}/5 complete :: ${Math.round(det(step, 21, 38, 85))} tok/s :: distinct ${Math.round(det(step, 22, 2, 5))}/5`,
    `pairwise sim ${det(step, 23, 0.18, 0.42).toFixed(2)} :: clusters ${Math.round(det(step, 24, 3, 6))}`,
    `modal share ${Math.round(det(step, 25, 20, 60))}% :: top answer "${SHORT_POOL[Math.floor(det(step, 26, 0, SHORT_POOL.length))]!}"`,
    `river cluster hit ${Math.floor(det(step, 27, 0, 3))}/5`,
    `slop check: ${det(step, 28, 0.3, 3.4).toFixed(1)} weighted hits / 100 words`,
    `ttcw programmatic: ${Math.round(det(step, 29, 4, 9))}/8 pass`,
    `judge clustering: ${Math.round(det(step, 30, 4, 5))}/5 groups`,
  ];
  return pool[step % pool.length]!;
}

export function createMockEngine(seed: number): RunEngine {
  return {
    label: "mock -> creativity (synthetic)",
    abort() {
      /* mock has nothing to abort */
    },
    async start(hooks) {
      for (let i = 1; i <= 8; i++) {
        hooks.fileProgress?.({ label: "downloading mock-model", loaded: i * 320_000_000, total: 2_560_000_000 });
        await sleep(50);
      }
      hooks.log?.("cached: mock-model (synthetic)");
      hooks.log?.("llama-server healthy on 127.0.0.1:8750 (synthetic)");
      hooks.log?.("teacher: none configured; heuristic-only scoring (synthetic)");
      const startedAt = Date.now();
      const perPrompt: RunSummary["perPrompt"] = [];
      const tiers: RunSummary["tiers"] = [];
      const totalPrompts = TIER_DEFS.reduce((s, t) => s + t.prompts, 0);
      const totalSamples = totalPrompts * 5;
      let samplesDone = 0;
      let step = 0;
      let seedBase = seed * 10000;
      for (let ti = 0; ti < TIER_DEFS.length; ti++) {
        const tier = TIER_DEFS[ti]!;
        hooks.log?.(`tier: ${tier.label}`);
        let tierScoreSum = 0;
        const bank = tierPrompts(tier.id).slice(0, tier.prompts);
        for (let p = 0; p < tier.prompts; p++) {
          const probe = bank[p]!;
          const texts: string[] = [];
          for (let s = 0; s < 5; s++) {
            step++;
            hooks.active?.({
              tierLabel: tier.label,
              promptLabel: probe.label,
              sampleIdx: s + 1,
              samplesTotal: 5,
            });
            await sleep(45);
            texts.push(mockText(probe, step, seed));
            samplesDone++;
            hooks.sampleDone?.({ tierLabel: tier.label, samplesDone, samplesTotal: totalSamples });
            if (step % 2 === 0) hooks.log?.(mockLogLine(step, s + 1));
          }
          const stats = fakeStats(probe, step, seed);
          seedBase += 10;
          const item: PlanItem = {
            tierIdx: ti,
            tierId: tier.id,
            tierLabel: tier.label,
            probe,
            sampleCount: 5,
            seedBase,
            maxTokens: tier.maxTokens,
            wordWindow: tier.wordWindow,
          };
          perPrompt.push({ item, texts, stats });
          tierScoreSum += stats.score;
          hooks.promptDone?.({
            tierLabel: tier.label,
            promptsDone: p + 1,
            promptsTotal: tier.prompts,
            score: stats.score,
            stats: {
              label: stats.label,
              score: stats.score,
              distinctRatio: stats.distinctRatio,
              distinctCount: stats.distinctCount,
              modalShare: stats.modalShare,
              slopPer100: stats.slopPer100,
            },
          });
          hooks.log?.(
            `prompt ${probe.id}: score ${(stats.score * 100).toFixed(1)} distinct ${stats.distinctCount}/5 modal ${(stats.modalShare * 100).toFixed(0)}% slop ${stats.slopPer100.toFixed(1)}/100w`,
          );
        }
        const tierScore = tierScoreSum / tier.prompts;
        tiers.push({ id: tier.id, label: tier.label, weight: tier.weight, score: tierScore, promptsDone: tier.prompts, promptsTotal: tier.prompts });
        hooks.tierDone?.({ tierId: tier.id, tierLabel: tier.label, score: tierScore });
      }
      const aci = (tiers.reduce((s, t) => s + t.weight * t.score, 0) / tiers.reduce((s, t) => s + t.weight, 0)) * 100;
      const summary: RunSummary = {
        runId: `mock-${seed}`,
        outDir: "(mock: synthetic run, nothing written)",
        model: "mock-model (synthetic)",
        suite: "creativity",
        dry: false,
        aborted: false,
        aci,
        distinctRatio: perPrompt.reduce((s, p) => s + p.stats.distinctRatio, 0) / perPrompt.length,
        modalShare: perPrompt.reduce((s, p) => s + p.stats.modalShare, 0) / perPrompt.length,
        riverShare: perPrompt.reduce((s, p) => s + p.stats.riverShare, 0) / perPrompt.length,
        slopPer100: perPrompt.reduce((s, p) => s + p.stats.slopPer100, 0) / perPrompt.length,
        promptsDone: totalPrompts,
        promptsTotal: totalPrompts,
        samplesDone: totalSamples,
        samplesTotal: totalSamples,
        elapsedMs: Date.now() - startedAt,
        tiers,
        perPrompt,
      };
      hooks.done?.(summary);
      return summary;
    },
  };
}
