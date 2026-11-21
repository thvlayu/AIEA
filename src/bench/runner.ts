import path from "node:path";
import { stat } from "node:fs/promises";
import { RESULTS_DIR, ensureDir, stamp, sanitizeName } from "../paths";
import type {
  ModelConfig,
  ModelRuntime,
  ModelSampling,
  ReasoningEffort,
  SuiteConfig,
} from "../config/types";
import { applyOverrides, loadModelConfig } from "../config/load";
import type { LlamaBinary } from "../llama/resolve";
import { ensureModelFiles } from "../llama/hf";
import { startServer } from "../llama/server";
import { chat } from "../llama/client";
import { buildPlan, type PlanItem } from "./plan";
import { computePromptStats, scoreFromStats, type PromptStats } from "./metrics";
import { judgeDistinct, judgeTtcw, type JudgeClient } from "./judge";
import { makeEmbedder, precomputeCanon, type SemanticsContext } from "../suites/creativity/semantics";
import { TTCW_JUDGE_ONLY } from "./metrics";
import { writeRunReport, updateLeaderboard } from "../report/report";

export interface RunHooks {
  log?: (line: string) => void;
  active?: (info: { tierLabel: string; promptLabel: string; sampleIdx: number; samplesTotal: number }) => void;
  sampleDone?: (info: { tierLabel: string; samplesDone: number; samplesTotal: number }) => void;
  promptDone?: (info: {
    tierLabel: string;
    promptsDone: number;
    promptsTotal: number;
    score: number;
    stats?: { label: string; score: number; distinctRatio: number; distinctCount: number; modalShare: number; slopPer100: number };
  }) => void;
  tierDone?: (info: { tierId: string; tierLabel: string; score: number }) => void;
  fileProgress?: (info: { label: string; loaded: number; total: number }) => void;
  done?: (summary: RunSummary) => void;
}

export interface TierResult {
  id: string;
  label: string;
  weight: number;
  score: number;
  promptsDone: number;
  promptsTotal: number;
}

export interface RunSummary {
  runId: string;
  outDir: string;
  model: string;
  suite: string;
  dry: boolean;
  aborted: boolean;
  aci: number;
  distinctRatio: number;
  modalShare: number;
  riverShare: number;
  slopPer100: number;
  promptsDone: number;
  promptsTotal: number;
  samplesDone: number;
  samplesTotal: number;
  elapsedMs: number;
  tiers: TierResult[];
  perPrompt: Array<{ item: PlanItem; texts: string[]; stats: PromptStats }>;
}

export interface RunOptions {
  model: ModelConfig;
  suite: SuiteConfig;
  binary: LlamaBinary;
  samples?: number;
  seed?: number;
  dry?: boolean;
  judgeOverrides?: {
    sampling?: Partial<ModelSampling>;
    runtime?: Partial<ModelRuntime>;
    reasoning?: { effort?: ReasoningEffort };
  };
  abortRef?: { aborted: boolean };
  hooks?: RunHooks;
}

export async function runSuite(opts: RunOptions): Promise<RunSummary> {
  const { model, suite, binary, hooks } = opts;
  const log = (line: string) => hooks?.log?.(line);
  const abortRef = opts.abortRef ?? { aborted: false };
  const startedAt = Date.now();

  const samplesPerPrompt = Math.max(1, Math.round(opts.samples ?? suite.defaults.samples_per_prompt));
  const runSeed = Math.round(opts.seed ?? suite.defaults.seed);
  const plan = buildPlan(suite, runSeed, samplesPerPrompt);

  const runId = `${stamp()}-${sanitizeName(model.name)}-${sanitizeName(suite.id)}`;
  const resultsRoot = RESULTS_DIR;
  const outDir = path.join(resultsRoot, runId);
  await ensureDir(outDir);

  log(`run ${runId}`);
  log(`model ${model.name} | suite ${suite.id} | samples ${samplesPerPrompt} | seed ${runSeed}`);
  log(
    `plan: ${plan.totalPrompts} prompts x ${samplesPerPrompt} samples = ${plan.totalSamples} generations across ${
      suite.tiers.filter((t) => t.enabled).length
    } tiers`,
  );

  if (opts.dry) {
    const summary = emptySummary(runId, outDir, model, suite, plan, true, false, startedAt);
    hooks?.done?.(summary);
    return summary;
  }

  let modelPath: string;
  if (model.local_path) {
    const st = await stat(model.local_path).catch(() => null);
    if (!st || !st.isFile()) {
      throw new Error(`local_path does not exist or is not a file: ${model.local_path}`);
    }
    modelPath = model.local_path;
    log(`model file: ${modelPath} (local)`);
  } else if (model.hf) {
    const files = await ensureModelFiles(model.hf, { quant: model.quant, file: model.file }, {
      log,
      progress: (loaded, total) =>
        hooks?.fileProgress?.({ label: `downloading ${model.name}`, loaded, total }),
    });
    modelPath = files[0]!;
  } else {
    throw new Error(`model config ${model.name} has neither local_path nor hf`);
  }

  log(`starting llama (${binary.mode}) from ${binary.path}`);
  const server = await startServer(binary, model, modelPath, outDir);
  log(`llama-server healthy on 127.0.0.1:${server.port} (log: ${server.logPath})`);

  let embedderServer: Awaited<ReturnType<typeof startServer>> | null = null;
  let sem: SemanticsContext | null = null;
  if (suite.embedder) {
    try {
      const eFiles = await ensureModelFiles(
        suite.embedder.hf,
        { quant: suite.embedder.quant, file: suite.embedder.file },
        { log, progress: (loaded, total) => hooks?.fileProgress?.({ label: "downloading embedder", loaded, total }) },
      );
      const eCfg: ModelConfig = {
        ...model,
        name: "embedder",
        runtime: { ...model.runtime, port: suite.embedder.port, context: 2048 },
      };
      embedderServer = await startServer(binary, eCfg, eFiles[0]!, outDir, {
        extraArgs: ["--embeddings", "--pooling", "mean"],
      });
      const embedder = makeEmbedder(suite.embedder.port, "nomic-embed");
      const canon = await precomputeCanon(embedder);
      sem = { embedder, canon };
      log(`embedder healthy on 127.0.0.1:${suite.embedder.port}; semantic scoring active`);
    } catch (err) {
      log(`embedder unavailable (${(err as Error).message.split("\n")[0]}); token-metric fallback`);
      sem = null;
      if (embedderServer) {
        await embedderServer.stop();
        embedderServer = null;
      }
    }
  } else {
    log("no embedder configured; token-metric fallback for semantic measures");
  }

  let judgeServer: Awaited<ReturnType<typeof startServer>> | null = null;
  let judge: JudgeClient | null = null;
  const concurrentJudge = suite.judge !== null && suite.judge_mode === "concurrent";
  if (concurrentJudge && suite.judge) {
    try {
      const jcfg = applyOverrides(await loadModelConfig(suite.judge.model), opts.judgeOverrides);
      const jport = jcfg.runtime.port === model.runtime.port ? model.runtime.port + 1 : jcfg.runtime.port;
      const jModel = jcfg.local_path
        ? jcfg.local_path
        : (await ensureModelFiles(jcfg.hf!, { quant: jcfg.quant, file: jcfg.file }, { log }))[0]!;
      judgeServer = await startServer(binary, { ...jcfg, runtime: { ...jcfg.runtime, port: jport } }, jModel, outDir);
      judge = { port: judgeServer.port, sampling: jcfg.sampling, seed: runSeed + 1, label: jcfg.name };
      log(`judge ${jcfg.name} healthy on 127.0.0.1:${judgeServer.port} (concurrent)`);
    } catch (err) {
      log(`judge unavailable (${(err as Error).message.split("\n")[0]}); heuristic-only scoring`);
      judge = null;
    }
  } else if (suite.judge) {
    log(`judge ${suite.judge.model} queued for sequential phase after generation`);
  }

  const samplesSink = Bun.file(path.join(outDir, "samples.jsonl")).writer();
  const perPrompt: RunSummary["perPrompt"] = [];
  const tiersById = new Map<string, TierResult>();
  for (const tier of suite.tiers) {
    if (!tier.enabled) continue;
    tiersById.set(tier.id, {
      id: tier.id,
      label: tier.label,
      weight: tier.weight,
      score: 0,
      promptsDone: 0,
      promptsTotal: plan.items.filter((i) => i.tierId === tier.id).length,
    });
  }

  let aborted = false;
  let samplesDone = 0;
  let lastTierId = "";
  let serverStopped = false;

  try {
    for (const item of plan.items) {
      if (abortRef.aborted) {
        aborted = true;
        log("abort requested; stopping after this prompt");
        break;
      }
      const tier = tiersById.get(item.tierId)!;
      if (item.tierId !== lastTierId) {
        lastTierId = item.tierId;
        log(`tier: ${item.tierLabel}`);
      }
      const texts: string[] = [];
      for (let s = 0; s < item.sampleCount; s++) {
        if (abortRef.aborted) {
          aborted = true;
          break;
        }
        hooks?.active?.({
          tierLabel: item.tierLabel,
          promptLabel: item.probe.label,
          sampleIdx: s + 1,
          samplesTotal: item.sampleCount,
        });
        const seed = item.seedBase * 100 + s;
        let content = "";
        let reasoningLen = 0;
        try {
          const res = await chat(
            server.port,
            [{ role: "user", content: item.probe.text }],
            model.sampling,
            seed,
            item.maxTokens,
          );
          content = res.content;
          reasoningLen = res.reasoning.length;
          if (reasoningLen > 0) {
            log(`warning: reasoning channel carried ${reasoningLen} chars (reasoning.effort=none did not hold)`);
          }
        } catch (err) {
          log(`generation failed on ${item.probe.id} sample ${s + 1}: ${(err as Error).message.split("\n")[0]}`);
        }
        texts.push(content);
        samplesDone++;
        await samplesSink.write(
          JSON.stringify({
            tier: item.tierId,
            prompt: item.probe.id,
            sample: s + 1,
            seed,
            text: content,
          }) + "\n",
        );
        hooks?.sampleDone?.({ tierLabel: item.tierLabel, samplesDone, samplesTotal: plan.totalSamples });
      }
      if (texts.length === 0) continue;
      const stats = await computePromptStats(item.probe, texts, sem);

      if (judge && (item.probe.kind === "short-answer" || item.probe.kind === "uses")) {
        try {
          const jd = await judgeDistinct(judge, texts);
          if (jd) {
            const ratio = jd.distinctCount / texts.length;
            log(
              `judge: ${item.probe.id} -> ${jd.distinctCount}/${texts.length} distinct (semantic said ${stats.distinctCount})`,
            );
            stats.distinctCount = jd.distinctCount;
            stats.distinctRatio = ratio;
            stats.score = scoreFromStats(item.probe, stats, stats.semantic, ratio);
          }
        } catch (err) {
          log(`judge failed on ${item.probe.id}: ${(err as Error).message.split("\n")[0]}`);
        }
      }

      perPrompt.push({ item, texts, stats });
      tier.promptsDone++;
      tier.score =
        perPrompt.filter((p) => p.item.tierId === item.tierId).reduce((s, p) => s + p.stats.score, 0) /
        tier.promptsDone;
      hooks?.promptDone?.({
        tierLabel: item.tierLabel,
        promptsDone: tier.promptsDone,
        promptsTotal: tier.promptsTotal,
        score: tier.score,
        stats: {
          label: stats.label,
          score: stats.score,
          distinctRatio: stats.distinctRatio,
          distinctCount: stats.distinctCount,
          modalShare: stats.modalShare,
          slopPer100: stats.slopPer100,
        },
      });
      log(
        `prompt ${item.probe.id}: score ${(stats.score * 100).toFixed(1)} distinct ${stats.distinctCount}/${texts.length} modal ${(stats.modalShare * 100).toFixed(0)}% slop ${stats.slopPer100.toFixed(1)}/100w${stats.semantic ? ` cliché ${(stats.clicheProximity * 100).toFixed(0)}%` : ""}`,
      );
    }

    if (suite.judge && suite.judge_mode === "sequential" && perPrompt.length > 0) {
      log(`judge phase (sequential): releasing student model`);
      await server.stop();
      serverStopped = true;
      try {
        const jcfg = applyOverrides(await loadModelConfig(suite.judge.model), opts.judgeOverrides);
        const jport = jcfg.runtime.port === model.runtime.port ? model.runtime.port + 1 : jcfg.runtime.port;
        const jModel = jcfg.local_path
          ? jcfg.local_path
          : (await ensureModelFiles(jcfg.hf!, { quant: jcfg.quant, file: jcfg.file }, { log }))[0]!;
        judgeServer = await startServer(
          binary,
          { ...jcfg, runtime: { ...jcfg.runtime, port: jport } },
          jModel,
          outDir,
        );
        judge = { port: judgeServer.port, sampling: jcfg.sampling, seed: runSeed + 1, label: jcfg.name };
        log(`judge ${jcfg.name} healthy on 127.0.0.1:${jport}`);
        for (const p of perPrompt) {
          if (abortRef.aborted) break;
          try {
            if (p.item.probe.kind === "short-answer" || p.item.probe.kind === "uses") {
              const jd = await judgeDistinct(judge, p.texts);
              if (jd) {
                const ratio = jd.distinctCount / p.texts.length;
                p.stats.distinctCount = jd.distinctCount;
                p.stats.distinctRatio = ratio;
                p.stats.score = scoreFromStats(p.item.probe, p.stats, p.stats.semantic, ratio);
                log(`judge: ${p.item.probe.id} -> ${jd.distinctCount}/${p.texts.length} distinct groups`);
              }
            } else if (p.item.probe.kind === "story") {
              const jt = await judgeTtcw(judge, p.texts[0] ?? "");
              if (jt) {
                let judgePassed = 0;
                for (const name of TTCW_JUDGE_ONLY) {
                  if (jt[name] === true) judgePassed++;
                }
                p.stats.ttcwPassRatio = (p.stats.ttcwProgrammatic + judgePassed) / (8 + TTCW_JUDGE_ONLY.length);
                p.stats.score = scoreFromStats(p.item.probe, p.stats, p.stats.semantic, null);
                log(`judge ttcw: ${p.item.probe.id} -> ${judgePassed}/${TTCW_JUDGE_ONLY.length} judge tests pass`);
              }
            }
          } catch (err) {
            log(`judge failed on ${p.item.probe.id}: ${(err as Error).message.split("\n")[0]}`);
          }
          for (const tier of tiersById.values()) {
            const tierStats = perPrompt.filter((x) => x.item.tierId === tier.id);
            if (tierStats.length > 0) {
              tier.score = tierStats.reduce((s, x) => s + x.stats.score, 0) / tierStats.length;
            }
          }
        }
      } catch (err) {
        log(`judge phase failed (${(err as Error).message.split("\n")[0]}); keeping student-side scores`);
      }
    }
  } finally {
    await samplesSink.end();
    if (!serverStopped) await server.stop();
    if (judgeServer) await judgeServer.stop();
    if (embedderServer) await embedderServer.stop();
  }

  const enabled = [...tiersById.values()];
  const weightSum = enabled.reduce((s, t) => s + t.weight, 0);
  const aci = weightSum > 0 ? (enabled.reduce((s, t) => s + t.weight * t.score, 0) / weightSum) * 100 : 0;

  const summary = emptySummary(runId, outDir, model, suite, plan, false, aborted, startedAt);
  summary.aci = aci;
  summary.tiers = enabled;
  summary.perPrompt = perPrompt;
  summary.promptsDone = perPrompt.length;
  summary.samplesDone = samplesDone;
  const withStats = perPrompt.map((p) => p.stats);
  summary.distinctRatio = meanOf(withStats.map((s) => s.distinctRatio));
  summary.modalShare = meanOf(withStats.map((s) => s.modalShare));
  summary.riverShare = meanOf(withStats.map((s) => s.riverShare));
  summary.slopPer100 = meanOf(withStats.map((s) => s.slopPer100));

  await writeRunReport(outDir, summary, model, suite);
  await updateLeaderboard(summary);
  log(`ACI ${aci.toFixed(1)} / 100 | report: ${path.join(outDir, "report.md")}`);
  hooks?.done?.(summary);
  return summary;
}

function meanOf(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function emptySummary(
  runId: string,
  outDir: string,
  model: ModelConfig,
  suite: SuiteConfig,
  plan: ReturnType<typeof buildPlan>,
  dry: boolean,
  aborted: boolean,
  startedAt: number,
): RunSummary {
  return {
    runId,
    outDir,
    model: model.name,
    suite: suite.id,
    dry,
    aborted,
    aci: 0,
    distinctRatio: 0,
    modalShare: 0,
    riverShare: 0,
    slopPer100: 0,
    promptsDone: 0,
    promptsTotal: plan.totalPrompts,
    samplesDone: 0,
    samplesTotal: plan.totalSamples,
    elapsedMs: Date.now() - startedAt,
    tiers: [],
    perPrompt: [],
  };
}
