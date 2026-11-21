import {
  BOLD,
  CLEAR,
  CYAN,
  DIM,
  GRAY,
  GREEN,
  HIDE_CURSOR,
  MAGENTA,
  RED,
  RESET,
  SHOW_CURSOR,
  YELLOW,
  bar,
  fmtElapsed,
  pad,
  paint,
  padStart,
} from "./ansi";
import type { RunHooks, RunSummary } from "../bench/runner";

export interface TierRow {
  label: string;
  promptsDone: number;
  promptsTotal: number;
  samplesDone: number;
  samplesTotal: number;
  score: number | null;
}

export interface RunViewState {
  title: string;
  model: string;
  suite: string;
  seed: number;
  mock: boolean;
  status: "running" | "done" | "error" | "aborted";
  elapsedMs: number;
  tiers: TierRow[];
  active: { tierLabel: string; promptLabel: string; sampleIdx: number; samplesTotal: number } | null;
  download: { label: string; loaded: number; total: number } | null;
  log: string[];
  aci: number | null;
  errorText: string | null;
}

export function emptyRunViewState(opts: {
  model: string;
  suite: string;
  seed: number;
  mock: boolean;
  tierLabels: string[];
  samplesPerPrompt: number;
}): RunViewState {
  return {
    title: opts.mock ? "MOCK RUN" : "RUN",
    model: opts.model,
    suite: opts.suite,
    seed: opts.seed,
    mock: opts.mock,
    status: "running",
    elapsedMs: 0,
    tiers: opts.tierLabels.map((label) => ({
      label,
      promptsDone: 0,
      promptsTotal: 0,
      samplesDone: 0,
      samplesTotal: 0,
      score: null,
    })),
    active: null,
    download: null,
    log: [],
    aci: null,
    errorText: null,
  };
}

const MAX_LOG = 60;

export interface RunConsole {
  state: RunViewState;
  isTty: boolean;
  log: (line: string) => void;
  render: () => void;
  close: () => void;
}

export function createRunConsole(state: RunViewState): RunConsole {
  const isTty = process.stdout.isTTY === true;
  let lastDraw = 0;

  const log = (line: string) => {
    state.log.push(line);
    if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
    if (!isTty) process.stdout.write(paint(GRAY, `  ${line}`) + "\n");
  };

  const render = () => {
    if (!isTty) return;
    const now = performance.now();
    if (now - lastDraw < 30) return;
    lastDraw = now;
    const cols = Math.max(60, process.stdout.columns ?? 100);
    const rows = process.stdout.rows ?? 24;
    const out: string[] = [];

    const head = `${state.title} | model ${state.model} | suite ${state.suite} | seed ${state.seed} | ${fmtElapsed(state.elapsedMs)}${
      state.mock ? " | synthetic data" : ""
    }`;
    out.push(paint(BOLD + CYAN, pad(head, cols - 1)));
    out.push(paint(GRAY, "─".repeat(Math.min(cols - 1, 100))));

    for (const t of state.tiers) {
      const pctPrompts = t.promptsTotal > 0 ? t.promptsDone / t.promptsTotal : 0;
      const score =
        t.score === null
          ? paint(DIM, "  -  ")
          : paint(t.score >= 0.6 ? GREEN : t.score >= 0.35 ? YELLOW : RED, ` ${(t.score * 100).toFixed(1).padStart(5)} `);
      out.push(
        ` ${pad(t.label, 32)} ${paint(CYAN, bar(pctPrompts, 10))} ${padStart(`${t.promptsDone}/${t.promptsTotal}`, 7)} ${paint(GRAY, "samples")} ${padStart(
          `${t.samplesDone}/${t.samplesTotal}`,
          8,
        )} ${score}`,
      );
    }

    if (state.download) {
      const frac = state.download.total > 0 ? state.download.loaded / state.download.total : 0;
      out.push("");
      out.push(
        ` ${pad(state.download.label, 30)} ${paint(MAGENTA, bar(frac, 30))} ${padStart(
          `${(state.download.loaded / 1048576).toFixed(0)}/${(state.download.total / 1048576).toFixed(0)} MB`,
          14,
        )}`,
      );
    }

    if (state.active && state.status === "running") {
      out.push("");
      out.push(
        ` ${paint(YELLOW, ">")} ${pad(state.active.tierLabel, 32)} ${pad(state.active.promptLabel, 38)} ${paint(
          YELLOW,
          `sample ${state.active.sampleIdx}/${state.active.samplesTotal}`,
        )}`,
      );
    }

    out.push(paint(GRAY, "─".repeat(Math.min(cols - 1, 100))));
    const logView = state.log.slice(-(rows - out.length - 3 > 4 ? rows - out.length - 3 : 4));
    for (const line of logView) out.push(paint(DIM, pad(` ${truncateLine(line, cols - 3)}`, cols - 1)));

    const foot = state.status === "done"
      ? paint(GREEN + BOLD, ` DONE  ACI ${state.aci?.toFixed(1) ?? "-"} / 100 `)
      : state.status === "error"
        ? paint(RED + BOLD, " FAILED ")
        : state.status === "aborted"
          ? paint(YELLOW + BOLD, " ABORTED ")
          : paint(DIM, " running ");
    out.push(`${foot} ${paint(DIM, "q abort | ctrl-c quit")}`);
    out.push(paint(GRAY, "─".repeat(Math.min(cols - 1, 100))));

    process.stdout.write(CLEAR + HIDE_CURSOR + out.join("\n") + "\n" + RESET);
  };

  const close = () => {
    if (!isTty) return;
    const summary = state.log.slice(-8);
    process.stdout.write(SHOW_CURSOR + "\n" + summary.map((l) => `  ${l}`).join("\n") + "\n" + RESET);
  };

  return { state, isTty, log, render, close };
}

function truncateLine(line: string, w: number): string {
  return line.length <= w ? line : line.slice(0, Math.max(0, w - 3)) + "...";
}

export function hooksFromConsole(c: RunConsole): RunHooks {
  return {
    log: (line) => {
      c.log(line);
      c.render();
    },
    active: (info) => {
      c.state.active = info;
      c.render();
    },
    sampleDone: (info) => {
      const tier = c.state.tiers.find((t) => t.label === info.tierLabel);
      if (tier) tier.samplesDone = info.samplesDone;
      c.render();
    },
    promptDone: (info) => {
      const tier = c.state.tiers.find((t) => t.label === info.tierLabel);
      if (tier) {
        tier.promptsDone = info.promptsDone;
        tier.score = info.score;
      }
      c.render();
    },
    tierDone: (info) => {
      c.log(`tier complete: ${info.tierLabel} score ${(info.score * 100).toFixed(1)}`);
      c.render();
    },
    fileProgress: (info) => {
      c.state.download = { label: info.label, loaded: info.loaded, total: info.total };
      c.render();
    },
    done: (summary: RunSummary) => {
      c.state.elapsedMs = summary.elapsedMs;
      c.state.active = null;
      c.state.download = null;
      if (summary.dry) {
        c.state.status = "done";
        c.state.aci = null;
      } else if (summary.aborted) {
        c.state.status = "aborted";
        c.state.aci = summary.aci;
      } else {
        c.state.status = "done";
        c.state.aci = summary.aci;
      }
      c.log(`finished: ${summary.promptsDone}/${summary.promptsTotal} prompts, ${summary.samplesDone}/${summary.samplesTotal} samples`);
      c.render();
      c.close();
    },
  };
}

export function failConsole(c: RunConsole, err: Error): void {
  c.state.status = "error";
  c.state.errorText = err.message;
  c.state.active = null;
  c.log(`error: ${err.message.split("\n")[0]}`);
  c.render();
  c.close();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
