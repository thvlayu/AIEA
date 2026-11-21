import path from "node:path";
import { readdir } from "node:fs/promises";
import { menuMain } from "./ui/menu";
import { runMock, runMockFlat } from "./ui/mock";
import { listModelConfigNames, loadModelConfig, loadSuiteConfig } from "./config/load";
import { resolveLlama, missingLlamaMessage } from "./llama/resolve";
import { runSuite } from "./bench/runner";
import { buildPlan } from "./bench/plan";
import { createRunConsole, emptyRunViewState, hooksFromConsole, failConsole } from "./ui/runscreen";
import { ensureModelFiles } from "./llama/hf";
import { RESULTS_DIR } from "./paths";

interface Flags {
  positional: string[];
  named: Record<string, string | boolean>;
}

function parseFlags(argv: string[]): Flags {
  const positional: string[] = [];
  const named: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        named[key] = next;
        i++;
      } else {
        named[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, named };
}

const USAGE = [
  "AIEA - Asa Intelligence Evaluation and Analysis",
  "",
  "usage: bun run aiea [command] [flags]",
  "",
  "commands:",
  "  (none)                interactive menu (needs a TTY)",
  "  mock                  preview the run screen with synthetic data",
  "  run --model NAME      run a suite against a model config",
  "      [--suite creativity] [--samples N] [--seed N] [--dry] [--json]",
  "  models list           list model configs",
  "  models download NAME  download the model file declared by a config",
  "  results [latest]      show results dir or print the latest report",
  "  help                  this text",
  "",
  "env:",
  "  AIEA_LLAMA_BIN        explicit path to llama-server / unified llama",
  "  AIEA_MODELS_DIR       override model download dir",
  "  AIEA_RESULTS_DIR      override results dir",
].join("\n");

async function cmdMock(flags: Flags): Promise<number> {
  const seed = Number(flags.named["seed"] ?? 20260101);
  if (process.stdout.isTTY) await runMock(Number.isFinite(seed) ? seed : 20260101);
  else await runMockFlat(Number.isFinite(seed) ? seed : 20260101);
  return 0;
}

async function cmdRun(flags: Flags): Promise<number> {
  const modelName = (flags.named["model"] as string | undefined) ?? flags.positional[0];
  if (!modelName) {
    process.stdout.write("run needs --model NAME (see: bun run aiea models list)\n");
    return 2;
  }
  const suiteName = (flags.named["suite"] as string | undefined) ?? "creativity";
  const model = await loadModelConfig(modelName);
  const suite = await loadSuiteConfig(suiteName);
  const dry = flags.named["dry"] === true;
  const samples = flags.named["samples"] !== undefined ? Number(flags.named["samples"]) : undefined;
  const seed = flags.named["seed"] !== undefined ? Number(flags.named["seed"]) : undefined;

  if (dry) {
    const plan = buildPlan(suite, seed ?? suite.defaults.seed, samples ?? suite.defaults.samples_per_prompt);
    process.stdout.write(
      `dry: ${plan.totalPrompts} prompts x ${samples ?? suite.defaults.samples_per_prompt} samples = ${plan.totalSamples} generations\n`,
    );
    for (const item of plan.items) {
      process.stdout.write(
        `dry: ${item.tierId} | ${item.probe.id} | ${item.sampleCount} samples | max_tokens ${item.maxTokens} | seedBase ${item.seedBase}\n`,
      );
    }
    return 0;
  }

  const binary = resolveLlama(model.runtime.binary);
  if (!binary) {
    process.stdout.write(missingLlamaMessage() + "\n");
    return 1;
  }

  if (process.stdout.isTTY) {
    const tierLabels = suite.tiers.filter((t) => t.enabled).map((t) => t.label);
    const state = emptyRunViewState({
      model: model.name,
      suite: suite.id,
      seed: seed ?? suite.defaults.seed,
      mock: false,
      tierLabels,
      samplesPerPrompt: samples ?? suite.defaults.samples_per_prompt,
    });
    const console_ = createRunConsole(state);
    const abortRef = { aborted: false };
    const { startKeys } = await import("./ui/keys");
    const keys = startKeys((k) => {
      if (k === "quit" || k === "esc") {
        abortRef.aborted = true;
        console_.log("abort requested by user");
        console_.render();
      }
    });
    try {
      const summary = await runSuite({
        model,
        suite,
        binary,
        samples,
        seed,
        abortRef,
        hooks: hooksFromConsole(console_),
      });
      process.stdout.write(`\nACI ${summary.aci.toFixed(1)} / 100\nreport: ${summary.outDir}\n`);
      return summary.aborted ? 1 : 0;
    } catch (err) {
      failConsole(console_, err as Error);
      return 1;
    } finally {
      keys.stop();
    }
  }

  const json = flags.named["json"] === true;
  try {
    const summary = await runSuite({
      model,
      suite,
      binary,
      samples,
      seed,
      hooks: {
        log: (line) => process.stdout.write(`aiea: ${line}\n`),
        fileProgress: ({ loaded, total }) => {
          if (total > 0) {
            process.stdout.write(
              `aiea: download ${(loaded / 1048576).toFixed(0)}/${(total / 1048576).toFixed(0)} MB\n`,
            );
          }
        },
      },
    });
    if (json) {
      process.stdout.write(
        JSON.stringify(
          {
            runId: summary.runId,
            aci: summary.aci,
            distinctRatio: summary.distinctRatio,
            modalShare: summary.modalShare,
            riverShare: summary.riverShare,
            slopPer100: summary.slopPer100,
            promptsDone: summary.promptsDone,
            samplesDone: summary.samplesDone,
            aborted: summary.aborted,
            outDir: summary.outDir,
          },
          null,
          2,
        ) + "\n",
      );
    } else {
      process.stdout.write(
        `\nAIEA-Creativity Index: ${summary.aci.toFixed(1)} / 100\nreport: ${path.join(summary.outDir, "report.md")}\n`,
      );
    }
    return summary.aborted ? 1 : 0;
  } catch (err) {
    process.stdout.write(`aiea: run failed: ${(err as Error).message}\n`);
    return 1;
  }
}

async function cmdModels(flags: Flags): Promise<number> {
  const sub = flags.positional[0] ?? "list";
  if (sub === "list") {
    const names = await listModelConfigNames();
    for (const n of names) {
      try {
        const cfg = await loadModelConfig(n);
        process.stdout.write(
          `${padCol(n, 22)} ${padCol(cfg.hf ?? cfg.local_path ?? "-", 44)} ${padCol(cfg.quant ?? "-", 10)} ${padCol(
            cfg.reasoning.effort,
            6,
          )} port ${cfg.runtime.port}\n`,
        );
      } catch (err) {
        process.stdout.write(`${padCol(n, 22)} INVALID: ${(err as Error).message}\n`);
      }
    }
    return 0;
  }
  if (sub === "download") {
    const name = flags.positional[1];
    if (!name) {
      process.stdout.write("download needs a config name: bun run aiea models download qwen3.5-4b-q4\n");
      return 2;
    }
    const cfg = await loadModelConfig(name);
    if (!cfg.hf) {
      process.stdout.write(`config ${name} declares local_path; nothing to download\n`);
      return 0;
    }
    try {
      const files = await ensureModelFiles(cfg.hf, { quant: cfg.quant, file: cfg.file }, {
        log: (line) => process.stdout.write(`aiea: ${line}\n`),
        progress: (loaded, total) =>
          process.stdout.write(
            `aiea: download ${(loaded / 1048576).toFixed(0)}/${(total / 1048576).toFixed(0)} MB\n`,
          ),
      });
      for (const f of files) process.stdout.write(`aiea: ready ${f}\n`);
      return 0;
    } catch (err) {
      process.stdout.write(`aiea: download failed: ${(err as Error).message}\n`);
      return 1;
    }
  }
  process.stdout.write("unknown models subcommand (list | download)\n");
  return 2;
}

async function cmdResults(flags: Flags): Promise<number> {
  const sub = flags.positional[0] ?? "list";
  let dirs: string[] = [];
  try {
    const entries = await readdir(RESULTS_DIR, { withFileTypes: true });
    dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort().reverse();
  } catch {
    /* none */
  }
  if (sub === "latest") {
    if (dirs.length === 0) {
      process.stdout.write("no runs yet\n");
      return 0;
    }
    const report = await Bun.file(path.join(RESULTS_DIR, dirs[0]!, "report.md")).text();
    process.stdout.write(report);
    return 0;
  }
  if (dirs.length === 0) {
    process.stdout.write("no runs yet\n");
    return 0;
  }
  for (const d of dirs) process.stdout.write(`${d}\n`);
  return 0;
}

function padCol(s: string, w: number): string {
  return s.length <= w ? s.padEnd(w) : s.slice(0, w - 3) + "...";
}

async function main(): Promise<number> {
  const argv = Bun.argv.slice(2);
  const cmd = argv[0];
  const flags = parseFlags(argv.slice(1));
  if (cmd === undefined || cmd === "menu") {
    await menuMain();
    return 0;
  }
  switch (cmd) {
    case "mock":
      return cmdMock(flags);
    case "run":
      return cmdRun(flags);
    case "models":
      return cmdModels(flags);
    case "results":
      return cmdResults(flags);
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(USAGE + "\n");
      return 0;
    default:
      process.stdout.write(`unknown command: ${cmd}\n\n` + USAGE + "\n");
      return 2;
  }
}

const code = await main();
process.exit(code);
