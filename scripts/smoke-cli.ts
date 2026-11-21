import {
  listModelConfigNames,
  loadModelConfig,
  loadSuiteConfig,
} from "../src/config/load";
import { pickGguf, modelBase, type HfFile } from "../src/llama/hf";
import { resolveLlama } from "../src/llama/resolve";
import { distinctStats, computePromptStats } from "../src/bench/metrics";
import { slopStats } from "../src/suites/creativity/checks";
import { tierPrompts } from "../src/suites/creativity/prompts";
import { buildPlan } from "../src/bench/plan";
import { runMockFlat } from "../src/ink/flat-mock";
import { writeRunReport, updateLeaderboard } from "../src/report/report";
import { runSuite, type RunSummary } from "../src/bench/runner";
import type { TierResult } from "../src/bench/runner";
import type { ModelConfig, SuiteConfig } from "../src/config/types";
import type { PlanItem } from "../src/bench/plan";
import type { Probe } from "../src/suites/creativity/prompts";
import type { PromptStats } from "../src/bench/metrics";

let failures = 0;

function ok(cond: boolean, label: string, detail = ""): void {
  if (cond) {
    process.stdout.write(`PASS  ${label}\n`);
  } else {
    failures++;
    process.stdout.write(`FAIL  ${label}${detail ? ` :: ${detail}` : ""}\n`);
  }
}

function expectThrows(fn: () => unknown, label: string): void {
  try {
    fn();
    ok(false, label, "expected throw did not happen");
  } catch {
    ok(true, label);
  }
}

const FOUR_B_FIXTURE: HfFile[] = [
  { path: ".gitattributes", size: 1756 },
  { path: "Qwen3.5-4B-Q4_K_M.gguf", size: 2707513696 },
  { path: "Qwen3.5-4B-Q6_K.gguf", size: 3464055136 },
  { path: "Qwen3.5-4B-Q8_0.gguf", size: 4482402656 },
  { path: "mmproj-Qwen3.5-4B-BF16.gguf", size: 675568768 },
  { path: "README.md", size: 2100 },
];

const TWO_B_FIXTURE: HfFile[] = [
  { path: "Qwen3.5-2B-Q4_0.gguf", size: 1214873856 },
  { path: "Qwen3.5-2B-Q4_K_M.gguf", size: 1280835840 },
  { path: "Qwen3.5-2B-Q4_K_S.gguf", size: 1217757440 },
  { path: "Qwen3.5-2B-Q6_K.gguf", size: 1574961408 },
  { path: "Qwen3.5-2B-UD-Q4_K_XL.gguf", size: 1339752704 },
  { path: "Qwen3.5-2B-BF16.gguf", size: 3775709216 },
  { path: "mmproj-F16.gguf", size: 668227264 },
  { path: "imatrix_unsloth.gguf_file", size: 1945728 },
];

async function main(): Promise<void> {
  process.stdout.write("AIEA smoke\n\n");

  const names = await listModelConfigNames();
  ok(names.length >= 2, `model configs discoverable (${names.length})`);
  ok(names.includes("qwen3.5-4b-q4") && names.includes("qwen3.5-2b-q4"), "both example configs present");

  const m4 = await loadModelConfig("qwen3.5-4b-q4");
  ok(m4.name === "qwen3.5-4b-q4", "4B config loads", m4.name);
  ok(m4.hf === "lmstudio-community/Qwen3.5-4B-GGUF", "4B hf repo correct");
  ok(m4.quant === "Q4_K_M", "4B quant tag correct");
  ok(m4.reasoning.effort === "none", "4B reasoning effort none");
  ok(m4.sampling.temperature === 0.9 && m4.sampling.top_k === 40, "4B sampling defaults parsed");

  const m2 = await loadModelConfig("qwen3.5-2b-q4");
  ok(m2.hf === "unsloth/Qwen3.5-2B-GGUF", "2B hf repo correct");
  ok(m2.runtime.context === 8192, "2B runtime defaults parsed");

  const suite = await loadSuiteConfig("creativity");
  ok(suite.tiers.length === 5, "suite has 5 tiers");
  const weightSum = suite.tiers.filter((t) => t.enabled).reduce((s, t) => s + t.weight, 0);
  ok(Math.abs(weightSum - 1) < 0.001, "tier weights sum to 1", String(weightSum));
  ok(suite.judge === null, "judge slot null by default");

  const bankCounts = ["t1_mode_collapse", "t2_constrained_divergence", "t3_slop_resistance", "t4_literature_craft", "t5_associative_leap"].map(
    (id) => tierPrompts(id).length,
  );
  ok(
    JSON.stringify(bankCounts) === JSON.stringify([5, 4, 4, 3, 3]),
    "prompt banks match tier prompt counts",
    JSON.stringify(bankCounts),
  );

  const plan = buildPlan(suite, suite.defaults.seed, suite.defaults.samples_per_prompt);
  ok(plan.totalPrompts === 19, "plan totals 19 prompts", String(plan.totalPrompts));
  ok(plan.totalSamples === 95, "plan totals 95 samples", String(plan.totalSamples));
  const seeds = new Set(plan.items.map((i) => i.seedBase));
  ok(seeds.size === plan.items.length, "seed bases unique per prompt");

  const pick4 = pickGguf(FOUR_B_FIXTURE, { quant: "Q4_K_M", base: modelBase("lmstudio-community/Qwen3.5-4B-GGUF") });
  ok(pick4.file === "Qwen3.5-4B-Q4_K_M.gguf", "4B quant picker exact match", pick4.file);
  ok(pick4.shards.length === 1, "4B picker ignores mmproj", String(pick4.shards.length));

  const pick2 = pickGguf(TWO_B_FIXTURE, { quant: "Q4_K_M", base: modelBase("unsloth/Qwen3.5-2B-GGUF") });
  ok(pick2.file === "Qwen3.5-2B-Q4_K_M.gguf", "2B quant picker exact match", pick2.file);
  const pickUd = pickGguf(TWO_B_FIXTURE, { quant: "UD-Q4_K_XL", base: "Qwen3.5-2B" });
  ok(pickUd.file === "Qwen3.5-2B-UD-Q4_K_XL.gguf", "unsloth dynamic quant picker", pickUd.file);
  expectThrows(() => pickGguf(TWO_B_FIXTURE, { quant: "Q4_K_K", base: "Qwen3.5-2B" }), "invalid quant rejected (Q4_K_K)");

  const same = ["the ship sails at dawn", "the ship sails at dawn", "the ship sails at dawn"];
  ok(distinctStats(same).distinctRatio === 0, "identical texts are 0% distinct");
  const varied = [
    "the ship sails at dawn",
    "quantum taxation policy",
    "a fridge humming in an empty flat",
    "grief explained through chess",
    "the ethics of vending machines",
  ];
  ok(distinctStats(varied).distinctRatio === 1, "varied texts are 100% distinct");

  const slopText = "It stands as a testament to their bond, a tapestry of dreams. He began to delve into the shimmering waters.";
  const slop = slopStats(slopText);
  ok(slop.weighted > 0, "slop lexicon fires on stock phrases", String(slop.weighted));
  ok(slop.matched.includes("testament to") && slop.matched.includes("tapestry"), "phrase hits recorded", slop.matched.join(","));

  const clean = "The queue moved. Nobody looked up. Somewhere a kettle screamed and stopped.";
  ok(slopStats(clean).weighted === 0, "clean prose scores zero slop");

  const timeProbe = tierPrompts("t1_mode_collapse")[0]!;
  const collapsed = [
    "Time is a river.",
    "Time flows like a river to the sea.",
    "Time is a river that carries us.",
    "Time is a locked filing cabinet.",
    "Time is an unpaid invoice.",
  ];
  const stats = computePromptStats(timeProbe, collapsed);
  ok(stats.riverShare === 0.6, "river cluster share 3/5", String(stats.riverShare));
  ok(stats.modalShare >= 0.6, "modal share catches collapse", String(stats.modalShare));

  const binary = resolveLlama();
  if (binary) {
    process.stdout.write(`NOTE  llama found: ${binary.path} (${binary.mode}, from ${binary.source})\n`);
  } else {
    process.stdout.write("NOTE  llama not installed on this machine (expected; runs happen on the experiment VM)\n");
  }
  ok(true, "llama resolution executed without throwing");

  const dry = await runSuite({
    model: m4,
    suite,
    binary: { path: "bun", mode: "server", source: "smoke-dummy" },
    dry: true,
  });
  ok(dry.dry === true, "dry run flagged dry");
  ok(dry.promptsTotal === 19 && dry.samplesTotal === 95, "dry run plan totals", `${dry.promptsTotal}/${dry.samplesTotal}`);

  await runMockFlat();

  const fakeSummary: RunSummary = {
    runId: "smoke-fake-run",
    outDir: "",
    model: "smoke-model",
    suite: "creativity",
    dry: false,
    aborted: false,
    aci: 61.25,
    distinctRatio: 0.8,
    modalShare: 0.4,
    riverShare: 0.2,
    slopPer100: 1.4,
    promptsDone: 1,
    promptsTotal: 1,
    samplesDone: 5,
    samplesTotal: 5,
    elapsedMs: 1234,
    tiers: [
      {
        id: "t1_mode_collapse",
        label: "Tier 1 Mode Collapse Probe",
        weight: 0.25,
        score: 0.6125,
        promptsDone: 1,
        promptsTotal: 1,
      } as TierResult,
    ],
    perPrompt: [
      {
        item: {
          tierIdx: 0,
          tierId: "t1_mode_collapse",
          tierLabel: "Tier 1 Mode Collapse Probe",
          probe: timeProbe as Probe,
          sampleCount: 5,
          seedBase: 1,
          maxTokens: 128,
          wordWindow: null,
        } as PlanItem,
        texts: collapsed,
        stats: stats as PromptStats,
      },
    ],
  };
  await writeRunReport(".\\results\\smoke", fakeSummary, m4 as ModelConfig, suite as SuiteConfig);
  const md = await Bun.file(".\\results\\smoke\\report.md").text();
  ok(md.includes("AIEA-Creativity Report"), "report.md written");
  ok(md.includes("61.3"), "report contains ACI", md.split("\n").slice(0, 12).join(" | "));
  await updateLeaderboard({ ...fakeSummary, outDir: ".\\results\\smoke" });
  const board = await Bun.file(".\\results\\leaderboard.json").json();
  ok(Array.isArray(board.entries) && board.entries.length >= 1, "leaderboard updated");

  process.stdout.write(`\n${failures === 0 ? "SMOKE PASS" : `SMOKE FAIL (${failures} failures)`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

await main();
