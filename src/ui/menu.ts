import path from "node:path";
import { readdir } from "node:fs/promises";
import {
  BOLD,
  CLEAR,
  CYAN,
  DIM,
  GRAY,
  GREEN,
  HIDE_CURSOR,
  RED,
  SHOW_CURSOR,
  YELLOW,
  pad,
  paint,
  RESET,
} from "./ansi";
import { startKeys, waitAnyKey } from "./keys";
import { listModelConfigNames, loadModelConfig, loadSuiteConfig, listSuiteNames } from "../config/load";
import { resolveLlama, missingLlamaMessage } from "../llama/resolve";
import { buildPlan } from "../bench/plan";
import { runSuite, type RunSummary } from "../bench/runner";
import { ensureModelFiles, fmtMB } from "../llama/hf";
import { createRunConsole, emptyRunViewState, hooksFromConsole, failConsole } from "./runscreen";
import { runMock, runMockFlat } from "./mock";
import { BENCHMARKS_DIR, CONFIGS_MODELS_DIR, MODELS_DIR, RESULTS_DIR } from "../paths";

const HEADER = "AIEA | Asa Intelligence Evaluation and Analysis | suite: AIEA-Creativity (AIEA-C) v0.1";

function drawFrame(title: string, body: string[], footer: string): void {
  const lines: string[] = [];
  lines.push(paint(BOLD + CYAN, pad(title, 120)));
  lines.push(paint(GRAY, "-".repeat(100)));
  for (const b of body) lines.push(b);
  lines.push("");
  lines.push(paint(DIM, footer));
  process.stdout.write(CLEAR + HIDE_CURSOR + lines.join("\n") + "\n" + RESET);
}

function pickFromList(title: string, options: string[], subs: string[] = []): Promise<number | null> {
  let sel = 0;
  const draw = () =>
    drawFrame(
      title,
      options.map((o, i) =>
        i === sel ? paint(CYAN + BOLD, `> ${o}`) + paint(DIM, `   ${subs[i] ?? ""}`) : `  ${o}` + paint(DIM, `   ${subs[i] ?? ""}`),
      ),
      "arrows move | enter select | esc back",
    );
  draw();
  return new Promise((resolve) => {
    const r = startKeys((k) => {
      if (k === "up") {
        sel = (sel + options.length - 1) % options.length;
        draw();
      } else if (k === "down") {
        sel = (sel + 1) % options.length;
        draw();
      } else if (k === "enter") {
        r.stop();
        resolve(sel);
      } else if (k === "esc" || k === "quit") {
        r.stop();
        resolve(null);
      }
    });
  });
}

async function showMessage(title: string, lines: string[]): Promise<void> {
  drawFrame(title, lines, "any key to return");
  await waitAnyKey();
}

async function runFlow(): Promise<void> {
  const names = await listModelConfigNames();
  if (names.length === 0) {
    await showMessage("Run Benchmark", ["no model configs found in configs/models/", "drop a YAML in there first"]);
    return;
  }
  const modelIdx = await pickFromList("Run Benchmark | pick model", names);
  if (modelIdx === null) return;
  const cfg = await loadModelConfig(names[modelIdx]!);

  const suites = await listSuiteNames();
  const suiteIdx = await pickFromList("Run Benchmark | pick suite", suites, suites.map((s) => `benchmarks/${s}.yaml`));
  if (suiteIdx === null) return;
  const suite = await loadSuiteConfig(suites[suiteIdx]!);

  const binary = resolveLlama(cfg.runtime.binary);
  if (!binary) {
    await showMessage("Run Benchmark | llama missing", missingLlamaMessage().split("\n").map((l) => paint(RED, l)));
    return;
  }

  const samples = suite.defaults.samples_per_prompt;
  const plan = buildPlan(suite, suite.defaults.seed, samples);
  const tierLabels = suite.tiers.filter((t) => t.enabled).map((t) => t.label);
  const state = emptyRunViewState({
    model: cfg.name,
    suite: suite.id,
    seed: suite.defaults.seed,
    mock: false,
    tierLabels,
    samplesPerPrompt: samples,
  });
  state.tiers.forEach((t) => {
    const tier = suite.tiers.find((st) => st.label === t.label)!;
    const count = plan.items.filter((i) => i.tierId === tier.id).length;
    t.promptsTotal = count;
    t.samplesTotal = count * samples;
  });
  const console_ = createRunConsole(state);
  const hooks = hooksFromConsole(console_);
  const abortRef = { aborted: false };
  const keys = startKeys((k) => {
    if (k === "quit" || k === "esc") {
      abortRef.aborted = true;
      console_.log("abort requested by user");
      console_.render();
    }
  });
  try {
    const summary = await runSuite({
      model: cfg,
      suite,
      binary,
      samples,
      seed: suite.defaults.seed,
      abortRef,
      hooks,
    });
    await showRunSummary(summary);
  } catch (err) {
    failConsole(console_, err as Error);
    await showMessage("Run failed", (err as Error).message.split("\n").slice(0, 12).map((l) => paint(RED, l)));
  } finally {
    keys.stop();
  }
}

async function showRunSummary(summary: RunSummary): Promise<void> {
  const lines: string[] = [];
  lines.push(
    summary.dry
      ? paint(YELLOW, "dry run: plan validated, no model loaded")
      : paint(GREEN + BOLD, `AIEA-Creativity Index: ${summary.aci.toFixed(1)} / 100`),
  );
  lines.push("");
  if (!summary.dry) {
    lines.push(paint(BOLD, pad("tier", 34) + pad("weight", 8) + pad("prompts", 10) + pad("score", 8)));
    for (const t of summary.tiers) {
      lines.push(
        `${pad(t.label, 34)}${pad(t.weight.toFixed(2), 8)}${pad(`${t.promptsDone}/${t.promptsTotal}`, 10)}${pad(
          (t.score * 100).toFixed(1),
          8,
        )}`,
      );
    }
    lines.push("");
    lines.push(`distinct ratio ${(summary.distinctRatio * 100).toFixed(1)}% | modal ${(
      summary.modalShare * 100
    ).toFixed(1)}% | river ${(summary.riverShare * 100).toFixed(1)}% | slop ${summary.slopPer100.toFixed(2)}/100w`);
  }
  lines.push(`samples: ${summary.samplesDone}/${summary.samplesTotal} | elapsed ${(summary.elapsedMs / 1000).toFixed(1)}s`);
  if (summary.aborted) lines.push(paint(YELLOW, "run was aborted; partial report still written"));
  lines.push(`report: ${path.join(summary.outDir, "report.md")}`);
  await showMessage(summary.dry ? "Dry run complete" : "Run complete", lines);
}

async function mockFlow(): Promise<void> {
  if (process.stdout.isTTY) {
    await runMock();
  } else {
    await runMockFlat();
  }
  await waitAnyKey().catch(() => undefined);
}

async function modelsFlow(): Promise<void> {
  for (;;) {
    const names = await listModelConfigNames();
    if (names.length === 0) {
      await showMessage("Manage Models", ["no model configs found in configs/models/"]);
      return;
    }
    const cfgs = await Promise.all(names.map((n) => loadModelConfig(n).catch((e: Error) => null)));
    const cached = await listCachedModels();
    const subs = cfgs.map((cfg, i) => {
      if (!cfg) return paint(RED, "invalid config");
      const hasLocal = cfg.local_path ? "local file" : cached.some((c) => matchesCfg(c, cfg)) ? "cached" : "not downloaded";
      return `${hasLocal} | ${cfg.hf ?? cfg.local_path} | ${cfg.quant ?? "-"} | ${cfg.reasoning.effort}`;
    });
    const idx = await pickFromList("Manage Models | pick model config", names, subs);
    if (idx === null) return;
    const cfg = cfgs[idx]!;
    if (!cfg) continue;
    const action = await pickFromList(`Manage Models | ${cfg.name}`, ["download from huggingface", "show details"]);
    if (action === null) return;
    if (action === 0) {
      if (!cfg.hf) {
        await showMessage("Manage Models", [paint(RED, "config has no hf field; it uses a local file")]);
        continue;
      }
      await downloadFlow(cfg.name, cfg.hf, cfg.quant, cfg.file);
    } else {
      const details = [
        `name: ${cfg.name}`,
        `hf: ${cfg.hf ?? "-"}`,
        `quant: ${cfg.quant ?? "-"}`,
        `file: ${cfg.file ?? "-"}`,
        `local_path: ${cfg.local_path ?? "-"}`,
        `reasoning.effort: ${cfg.reasoning.effort}`,
        `sampling: ${JSON.stringify(cfg.sampling)}`,
        `runtime: ${JSON.stringify(cfg.runtime)}`,
      ];
      await showMessage(`Model config | ${cfg.name}`, details);
    }
  }
}

async function listCachedModels(): Promise<string[]> {
  try {
    const entries = await readdir(MODELS_DIR);
    return entries.filter((e) => e.toLowerCase().endsWith(".gguf"));
  } catch {
    return [];
  }
}

function matchesCfg(cachedFile: string, cfg: { quant: string | null; hf: string | null }): boolean {
  const q = cfg.quant?.toLowerCase();
  if (q && cachedFile.toLowerCase().includes(q)) return true;
  const base = cfg.hf?.split("/").pop()?.replace(/-GGUF$/i, "").toLowerCase();
  return base ? cachedFile.toLowerCase().includes(base) : false;
}

async function downloadFlow(name: string, hf: string, quant: string | null, file: string | null): Promise<void> {
  let last = { loaded: 0, total: 0 };
  const drawDl = () => {
    const frac = last.total > 0 ? last.loaded / last.total : 0;
    const mb = `${(last.loaded / 1048576).toFixed(0)}/${(last.total / 1048576).toFixed(0)} MB`;
    drawFrame(`Downloading | ${name}`, ["", `  ${"█".repeat(Math.round(frac * 40)).padEnd(40, "░")}  ${mb}`], "downloading...");
  };
  try {
    const files = await ensureModelFiles(hf, { quant, file }, {
      log: (line) => {
        drawFrame(`Downloading | ${name}`, ["", `  ${line}`], "downloading...");
      },
      progress: (loaded, total) => {
        last = { loaded, total };
        drawDl();
      },
    });
    const total = files.reduce(async (acc, f) => acc, Promise.resolve(0));
    void total;
    await showMessage("Download complete", files.map((f) => paint(GREEN, f)));
  } catch (err) {
    await showMessage(
      "Download failed",
      (err as Error).message.split("\n").slice(0, 10).map((l) => paint(RED, l)),
    );
  }
}

async function resultsFlow(): Promise<void> {
  let dirs: string[] = [];
  try {
    const entries = await readdir(RESULTS_DIR, { withFileTypes: true });
    dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort().reverse();
  } catch {
    /* no results dir yet */
  }
  if (dirs.length === 0) {
    await showMessage("Results", ["no runs yet", `results live in ${RESULTS_DIR}`]);
    return;
  }
  const boardLines: string[] = [];
  try {
    const board = await Bun.file(path.join(RESULTS_DIR, "leaderboard.json")).json();
    for (const e of board.entries.slice(0, 8)) {
      boardLines.push(`${pad(String(e.aci), 8)} ${pad(String(e.model), 24)} ${String(e.runId)}`);
    }
  } catch {
    boardLines.push("(no leaderboard yet)");
  }
  const idx = await pickFromList(
    "Results | recent runs",
    dirs.slice(0, 20),
    dirs.slice(0, 20).map(() => ""),
  );
  if (idx === null) return;
  const reportPath = path.join(RESULTS_DIR, dirs[idx]!, "report.md");
  try {
    const md = await Bun.file(reportPath).text();
    await showMessage(`Report | ${dirs[idx]!}`, md.split("\n").slice(0, 40).map((l) => l));
  } catch {
    await showMessage("Results", [paint(RED, `no report.md in ${dirs[idx]!}`)]);
  }
}

async function configsFlow(): Promise<void> {
  const lines: string[] = [];
  lines.push(paint(BOLD, "model configs (drop-in, YAML):"));
  lines.push(`  ${CONFIGS_MODELS_DIR}`);
  lines.push(paint(DIM, "  fields: name, hf, quant, file, local_path, reasoning.effort, sampling.*, runtime.*"));
  lines.push("");
  lines.push(paint(BOLD, "suite configs:"));
  lines.push(`  ${BENCHMARKS_DIR}`);
  lines.push(paint(DIM, "  fields: id, title, defaults.samples_per_prompt, defaults.seed, judge, tiers[]"));
  lines.push("");
  lines.push(paint(BOLD, "downloads land in:"));
  lines.push(`  ${MODELS_DIR}`);
  lines.push("");
  lines.push(paint(BOLD, "results land in:"));
  lines.push(`  ${RESULTS_DIR}`);
  await showMessage("Configs and Docs", lines);
}

export async function menuMain(): Promise<void> {
  if (process.stdout.isTTY !== true) {
    const lines = [
      "Interactive TUI needs a real terminal (TTY).",
      "",
      "Use CLI commands instead:",
      "  bun run aiea              interactive menu",
      "  bun run mock              mock run preview (works headless too)",
      "  bun run aiea run --model qwen3.5-4b-q4",
      "  bun run aiea run --model qwen3.5-4b-q4 --dry",
      "  bun run aiea models list | models download <name>",
      "  bun run aiea results",
    ];
    process.stdout.write(lines.join("\n") + "\n");
    return;
  }
  const actions: Array<{ label: string; run: () => Promise<void> }> = [
    { label: "Run Benchmark", run: runFlow },
    { label: "Mock Preview (see the run screen, no model)", run: mockFlow },
    { label: "Manage Models (download / inspect)", run: modelsFlow },
    { label: "View Results", run: resultsFlow },
    { label: "Configs and Docs", run: configsFlow },
    { label: "Exit", run: async () => undefined },
  ];
  for (;;) {
    const idx = await pickFromList(
      HEADER,
      actions.map((a) => a.label),
    );
    if (idx === null || idx === actions.length - 1) break;
    await actions[idx]!.run();
  }
  process.stdout.write(SHOW_CURSOR + CLEAR);
}
