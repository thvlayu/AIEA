import path from "node:path";
import { RESULTS_DIR, ensureDir } from "../paths";
import type { ModelConfig, SuiteConfig } from "../config/types";
import type { RunSummary } from "../bench/runner";

function pct(x: number): string {
  return (x * 100).toFixed(1);
}

function excerpt(text: string, chars = 220): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > chars ? flat.slice(0, chars) + "..." : flat;
}

export async function writeRunReport(
  outDir: string,
  summary: RunSummary,
  model: ModelConfig,
  suite: SuiteConfig,
): Promise<void> {
  await ensureDir(outDir);
  const modelOrigin = model.local_path
    ? `local: ${model.local_path}`
    : `hf: ${model.hf} quant: ${model.quant ?? "-"} file: ${model.file ?? "-"}`;

  const lines: string[] = [];
  lines.push(`# AIEA-Creativity Report`);
  lines.push("");
  lines.push(`- run: ${summary.runId}`);
  lines.push(`- model: ${summary.model}`);
  lines.push(`- origin: ${modelOrigin}`);
  lines.push(`- suite: ${summary.suite} (${suite.title})`);
  lines.push(
    `- sampling: temperature ${model.sampling.temperature}, top_p ${model.sampling.top_p}, top_k ${model.sampling.top_k}, min_p ${model.sampling.min_p}, repeat_penalty ${model.sampling.repeat_penalty}`,
  );
  lines.push(`- reasoning effort: ${model.reasoning.effort}`);
  lines.push(
    `- judge: ${suite.judge ? suite.judge.model : "none (heuristic-only)"}`,
  );
  lines.push(`- aborted: ${summary.aborted}`);
  lines.push(`- elapsed: ${(summary.elapsedMs / 1000).toFixed(1)}s`);
  lines.push("");

  lines.push(`## Composite`);
  lines.push("");
  lines.push(`AIEA-Creativity Index: **${summary.aci.toFixed(1)} / 100**`);
  lines.push("");
  if (summary.tiers.length > 0) {
    lines.push(`| tier | weight | prompts | score |`);
    lines.push(`|---|---|---|---|`);
    for (const t of summary.tiers) {
      lines.push(
        `| ${t.label} | ${t.weight.toFixed(2)} | ${t.promptsDone}/${t.promptsTotal} | ${(t.score * 100).toFixed(1)} |`,
      );
    }
  }
  lines.push("");

  lines.push(`## Run-level metrics`);
  lines.push("");
  lines.push(`- distinct ratio (mean over prompts): ${pct(summary.distinctRatio)}%`);
  lines.push(`- modal answer share (mean over t1 probes): ${pct(summary.modalShare)}%`);
  lines.push(`- time-is-a-river cluster share: ${pct(summary.riverShare)}%`);
  lines.push(`- slop density (weighted hits per 100 words, mean): ${summary.slopPer100.toFixed(2)}`);
  lines.push("");

  lines.push(`## Per prompt`);
  lines.push("");
  for (const { item, stats, texts } of summary.perPrompt) {
    lines.push(`### ${item.tierId} / ${item.probe.id}`);
    lines.push("");
    lines.push(`- score: ${(stats.score * 100).toFixed(1)}`);
    lines.push(`- distinct: ${stats.distinctCount}/${texts.length} (ratio ${pct(stats.distinctRatio)}%, mean pair sim ${stats.meanPairSim.toFixed(3)})`);
    if (stats.fluency > 0 && item.probe.kind !== "short-answer") {
      lines.push(`- fluency: ${stats.fluency.toFixed(2)}`);
    }
    if (item.probe.kind === "short-answer" || item.probe.kind === "prose") {
      lines.push(`- modal share: ${pct(stats.modalShare)}% (top: ${stats.modalLabel})`);
      if (item.probe.id === "time-metaphor") {
        lines.push(`- river cluster share: ${pct(stats.riverShare)}%`);
      }
    }
    if (item.probe.kind === "word-list") {
      lines.push(`- adherence: ${pct(stats.adherence)}%`);
    }
    if (item.probe.kind === "story") {
      lines.push(`- elements present: ${pct(stats.elementsPresentRatio)}%`);
      lines.push(`- ttcw pass rate: ${pct(stats.ttcwPassRatio)}%`);
      lines.push(`- word window ok: ${pct(stats.windowOk)}%`);
    }
    if (item.probe.kind === "piece") {
      lines.push(`- concept mention: ${pct(stats.conceptMentionRatio)}%`);
    }
    lines.push(`- slop: ${stats.slopPer100.toFixed(2)} weighted hits per 100 words (mean ${stats.slopWeighted.toFixed(2)} per sample)`);
    lines.push(`- mean words: ${stats.wordCountMean.toFixed(0)}`);
    lines.push("");
    lines.push(`Samples:`);
    texts.forEach((t, i) => {
      lines.push(`${i + 1}. ${excerpt(t) || "(empty)"}`);
    });
    lines.push("");
  }

  lines.push(`## Method`);
  lines.push("");
  lines.push(
    `Samples per prompt use distinct derived seeds (run seed * 10000 + tier * 1000 + prompt * 10, sample * 100).`,
  );
  lines.push(
    `Distinctness: token jaccard (45%) + char bigram dice (55%); a sample counts distinct when its max similarity to any other sample is below 0.6.`,
  );
  lines.push(`Slop: weighted lexicon hits (words and phrases) per 100 generated words.`);
  lines.push(
    `TTCW: programmatic subset of the Torrance creative-writing checklist (dialogue, sensory detail, sentence length variance, lexical richness, stock opening, slop density, specifics, word window); judge-only tests activate when a judge model is configured.`,
  );

  await Bun.write(path.join(outDir, "report.md"), lines.join("\n") + "\n");
  await Bun.write(
    path.join(outDir, "report.json"),
    JSON.stringify(
      {
        summary: {
          runId: summary.runId,
          model: summary.model,
          suite: summary.suite,
          aci: summary.aci,
          distinctRatio: summary.distinctRatio,
          modalShare: summary.modalShare,
          riverShare: summary.riverShare,
          slopPer100: summary.slopPer100,
          promptsDone: summary.promptsDone,
          promptsTotal: summary.promptsTotal,
          samplesDone: summary.samplesDone,
          samplesTotal: summary.samplesTotal,
          elapsedMs: summary.elapsedMs,
          aborted: summary.aborted,
          dry: summary.dry,
        },
        tiers: summary.tiers,
        perPrompt: summary.perPrompt.map(({ item, stats, texts }) => ({
          tier: item.tierId,
          probe: item.probe.id,
          label: item.probe.label,
          seeds: Array.from({ length: texts.length }, (_, i) => item.seedBase * 100 + i),
          stats,
          texts,
        })),
      },
      null,
      2,
    ),
  );
}

export async function updateLeaderboard(summary: RunSummary): Promise<void> {
  await ensureDir(RESULTS_DIR);
  const file = path.join(RESULTS_DIR, "leaderboard.json");
  let board: { entries: Array<Record<string, unknown>> } = { entries: [] };
  try {
    const raw = await Bun.file(file).json();
    if (raw && Array.isArray(raw.entries)) board = raw;
  } catch {
    /* first entry */
  }
  board.entries = board.entries.filter((e) => e.model !== summary.model || e.runId !== summary.runId);
  board.entries.push({
    runId: summary.runId,
    model: summary.model,
    suite: summary.suite,
    aci: Number(summary.aci.toFixed(2)),
    distinctRatio: Number(summary.distinctRatio.toFixed(4)),
    modalShare: Number(summary.modalShare.toFixed(4)),
    riverShare: Number(summary.riverShare.toFixed(4)),
    slopPer100: Number(summary.slopPer100.toFixed(3)),
    promptsDone: summary.promptsDone,
    samplesDone: summary.samplesDone,
    aborted: summary.aborted,
    date: new Date().toISOString(),
  });
  board.entries.sort((a, b) => Number(b.aci) - Number(a.aci));
  await Bun.write(file, JSON.stringify(board, null, 2));
}
