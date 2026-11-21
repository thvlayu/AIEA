import { useEffect, useMemo, useReducer, useRef } from "react";
import path from "node:path";
import { Box, Text, useInput } from "ink";
import { Bar, Frame, Kv, Spinner, Table, scoreColor, type TableColumn } from "./components";
import type { RunEngine, SetupResult } from "./engine";
import type { RunHooks, RunSummary } from "../bench/runner";
import { buildPlan } from "../bench/plan";

export interface TierRowView {
  label: string;
  promptsDone: number;
  promptsTotal: number;
  samplesDone: number;
  samplesTotal: number;
  score: number | null;
}

class RunStore {
  tiers: TierRowView[];
  active: { tierLabel: string; promptLabel: string; sampleIdx: number; samplesTotal: number } | null = null;
  download: { label: string; loaded: number; total: number } | null = null;
  log: string[] = [];
  status: "running" | "done" | "error" | "aborted" = "running";
  aci: number | null = null;
  error: string | null = null;
  lastPrompt: { label: string; score: number; distinct: string; modal: string; slop: string } | null = null;
  startedAt = Date.now();

  private listeners = new Set<() => void>();
  private emitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(setup: SetupResult) {
    const plan = buildPlan(setup.suite, setup.seed, setup.samples);
    this.tiers = setup.suite.tiers
      .filter((t) => t.enabled)
      .map((t) => {
        const count = plan.items.filter((i) => i.tierId === t.id).length;
        return {
          label: t.label,
          promptsDone: 0,
          promptsTotal: count,
          samplesDone: 0,
          samplesTotal: count * setup.samples,
          score: null,
        };
      });
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(): void {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      for (const l of this.listeners) l();
    }, 50);
  }

  hooks(): RunHooks {
    return {
      log: (line) => {
        this.log.push(line);
        if (this.log.length > 200) this.log.splice(0, this.log.length - 200);
        this.emit();
      },
      active: (info) => {
        this.active = info;
        this.emit();
      },
      sampleDone: (info) => {
        const tier = this.tiers.find((t) => t.label === info.tierLabel);
        if (tier) tier.samplesDone = info.samplesDone;
        this.emit();
      },
      promptDone: (info) => {
        const tier = this.tiers.find((t) => t.label === info.tierLabel);
        if (tier) {
          tier.promptsDone = info.promptsDone;
          tier.score = info.score;
        }
        if (info.stats) {
          this.lastPrompt = {
            label: info.stats.label,
            score: info.stats.score,
            distinct: `${Math.round(info.stats.distinctRatio * 100)}% (${info.stats.distinctCount})`,
            modal: `${Math.round(info.stats.modalShare * 100)}%`,
            slop: info.stats.slopPer100.toFixed(1),
          };
        }
        this.emit();
      },
      tierDone: (info) => {
        this.log.push(`tier complete: ${info.tierLabel} score ${(info.score * 100).toFixed(1)}`);
        this.emit();
      },
      fileProgress: (info) => {
        this.download = info;
        this.emit();
      },
      done: (summary) => {
        this.active = null;
        this.download = null;
        this.status = summary.aborted ? "aborted" : "done";
        this.aci = summary.aci;
        this.emit();
      },
    };
  }

  fail(err: Error): void {
    this.status = "error";
    this.error = err.message;
    this.log.push(`error: ${err.message.split("\n")[0]}`);
    this.emit();
  }
}

function useRunStore(store: RunStore): void {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => store.subscribe(() => force()), [store]);
}

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function RunScreen({
  setup,
  engine,
  onDone,
  onExit,
}: {
  setup: SetupResult;
  engine: RunEngine;
  onDone: (s: RunSummary) => void;
  onExit: () => void;
}) {
  const store = useMemo(() => new RunStore(setup), [setup]);
  useRunStore(store);
  const [, forceTick] = useReducer((x: number) => x + 1, 0);
  const startedRef = useRef(false);
  const startedAt = store.startedAt;

  useEffect(() => {
    const t = setInterval(forceTick, 250);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    engine
      .start(store.hooks())
      .then((s) => onDone(s))
      .catch((err: Error) => store.fail(err));
    return () => {
      engine.abort();
    };
  }, [engine, store, onDone]);

  useInput((input, key) => {
    if (input === "q" || key.escape) {
      if (store.status === "error") onExit();
      else {
        engine.abort();
        store.hooks().log?.("abort requested by user");
      }
    }
  });

  const elapsed = Date.now() - startedAt;
  const title = `${setup.mock ? "MOCK RUN" : "RUN"} | ${setup.model.name} | suite ${setup.suite.id} | seed ${setup.seed} | ${fmtElapsed(elapsed)}${
    setup.mock ? " | synthetic data" : ""
  }`;

  const footer =
    store.status === "error"
      ? "esc exit"
      : store.status === "running"
        ? "q abort | ctrl-c quit"
        : "";

  return (
    <Frame title={title} footer={footer}>
      {store.tiers.map((t) => (
        <Box key={t.label} gap={1}>
          <Box width={30}>
            <Text>{t.label}</Text>
          </Box>
          <Bar frac={t.promptsTotal > 0 ? t.promptsDone / t.promptsTotal : 0} width={12} />
          <Text dimColor>
            {t.promptsDone}/{t.promptsTotal} prompts
          </Text>
          <Text dimColor>
            {t.samplesDone}/{t.samplesTotal} samples
          </Text>
          <Text color={t.score === null ? "gray" : scoreColor(t.score)}>
            {t.score === null ? "  -  " : (t.score * 100).toFixed(1).padStart(6)}
          </Text>
        </Box>
      ))}

      {store.download ? (
        <Box gap={1} marginTop={1}>
          <Box width={30}>
            <Text>{store.download.label}</Text>
          </Box>
          <Bar
            frac={store.download.total > 0 ? store.download.loaded / store.download.total : 0}
            width={26}
            color="magenta"
          />
          <Text dimColor>
            {Math.round(store.download.loaded / 1048576)}/{Math.round(store.download.total / 1048576)} MB
          </Text>
        </Box>
      ) : null}

      <Box marginTop={1}>
        {store.active ? (
          <Spinner label={`${store.active.tierLabel} :: ${store.active.promptLabel} :: sample ${store.active.sampleIdx}/${store.active.samplesTotal}`} />
        ) : (
          <Text dimColor>{store.status === "running" ? "preparing..." : ""}</Text>
        )}
      </Box>

      {store.lastPrompt ? (
        <Box marginTop={1} flexDirection="column">
          <Text bold>latest prompt</Text>
          <Kv k={store.lastPrompt.label} v={`score ${(store.lastPrompt.score * 100).toFixed(1)} | distinct ${store.lastPrompt.distinct} | modal ${store.lastPrompt.modal} | slop ${store.lastPrompt.slop}/100w`} />
        </Box>
      ) : null}

      <Box marginTop={1} flexDirection="column">
        {store.log.slice(-5).map((l, i) => (
          <Text key={`${i}-${l}`} dimColor wrap="truncate-end">
            {l}
          </Text>
        ))}
      </Box>

      {store.status === "error" ? (
        <Box marginTop={1}>
          <Text color="red">{store.error?.split("\n")[0]}</Text>
        </Box>
      ) : null}
    </Frame>
  );
}

const SUMMARY_COLUMNS: TableColumn[] = [
  { key: "tier", label: "tier", width: 30 },
  { key: "weight", label: "weight", width: 7, align: "right" },
  { key: "prompts", label: "prompts", width: 8, align: "right" },
  { key: "score", label: "score", width: 7, align: "right" },
];

const PROMPT_COLUMNS: TableColumn[] = [
  { key: "probe", label: "probe", width: 26 },
  { key: "score", label: "score", width: 7, align: "right" },
  { key: "distinct", label: "distinct", width: 10, align: "right" },
  { key: "modal", label: "modal", width: 7, align: "right" },
  { key: "river", label: "river", width: 7, align: "right" },
  { key: "slop", label: "slop", width: 6, align: "right" },
];

export function SummaryScreen({
  summary,
  mock,
  onExit,
}: {
  summary: RunSummary;
  mock: boolean;
  onExit: () => void;
}) {
  useInput((input, key) => {
    if (key.return || input === "q" || key.escape) onExit();
  });
  const tierRows = summary.tiers.map((t) => ({
    tier: t.label,
    weight: t.weight.toFixed(2),
    prompts: `${t.promptsDone}/${t.promptsTotal}`,
    score: (t.score * 100).toFixed(1),
  }));
  return (
    <Frame
      title={`${mock ? "MOCK" : "RUN"} COMPLETE | ${summary.model} | suite ${summary.suite}`}
      footer="enter to exit"
    >
      <Text bold color={summary.aborted ? "yellow" : "green"}>
        {summary.aborted ? "ABORTED | partial " : ""}AIEA-Creativity Index: {summary.aci.toFixed(1)} / 100
      </Text>
      <Box marginTop={1}>
        <Table columns={SUMMARY_COLUMNS} rows={tierRows} />
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          distinct {(summary.distinctRatio * 100).toFixed(1)}% | modal {(summary.modalShare * 100).toFixed(1)}% | river{" "}
          {(summary.riverShare * 100).toFixed(1)}% | slop {summary.slopPer100.toFixed(2)}/100w | samples{" "}
          {summary.samplesDone}/{summary.samplesTotal} | {(summary.elapsedMs / 1000).toFixed(1)}s
        </Text>
      </Box>
      {summary.tiers.map((t) => {
        const rows = summary.perPrompt
          .filter((p) => p.item.tierId === t.id)
          .map((p) => ({
            probe: p.item.probe.id,
            score: (p.stats.score * 100).toFixed(1),
            distinct: `${p.stats.distinctCount}/${p.texts.length}`,
            modal: `${Math.round(p.stats.modalShare * 100)}%`,
            river: `${Math.round(p.stats.riverShare * 100)}%`,
            slop: p.stats.slopPer100.toFixed(1),
          }));
        return (
          <Box key={t.id} marginTop={1} flexDirection="column">
            <Text bold>{t.label}</Text>
            <Table columns={PROMPT_COLUMNS} rows={rows} />
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text dimColor>report: {mock ? "(mock: synthetic run, nothing written)" : path.join(summary.outDir, "report.md")}</Text>
      </Box>
      {summary.aborted ? <Text color="yellow">run was aborted; partial report still written</Text> : null}
    </Frame>
  );
}
