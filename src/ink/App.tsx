import { useEffect, useRef, useState } from "react";
import { Box, Text, render, useApp, useWindowSize } from "ink";
import {
  Arrow,
  GRAY,
  GradientText,
  FlowText,
  PromptInput,
  RED_DEEP,
  Table,
  WHITE,
  type CommandHint,
  type TableColumn,
} from "./components";
import { SetupFlow } from "./setup";
import { RunScreen, SummaryScreen } from "./run";
import { createMockEngine, createRealEngine, mockStudentCfg, type SetupResult } from "./engine";
import type { RunSummary } from "../bench/runner";
import {
  listModelConfigNames,
  listSuiteNames,
  loadModelConfig,
  loadSuiteConfig,
} from "../config/load";
import type { ModelConfig } from "../config/types";

const MOCK_MODELS = ["mock-student-4b", "mock-student-2b"];

const COMMANDS: CommandHint[] = [
  { name: "help", usage: "help" },
  { name: "run", usage: "run <model> | run <suite> <model> | run all [suite]" },
  { name: "mock", usage: "mock [model] | mock all   (synthetic, no model)" },
  { name: "models", usage: "models" },
  { name: "suites", usage: "suites" },
  { name: "teacher", usage: "teacher <model|none>   judge for scored tiers" },
  { name: "samples", usage: "samples <n>   samples per prompt" },
  { name: "seed", usage: "seed <n>" },
  { name: "setup", usage: "setup   guided specimen + teacher + config" },
  { name: "clear", usage: "clear" },
  { name: "exit", usage: "exit" },
];

type Msg =
  | { kind: "text"; text: string; dim?: boolean }
  | { kind: "section"; text: string }
  | { kind: "cmd"; cmd: string; rest?: string }
  | { kind: "error"; text: string }
  | { kind: "aci"; model: string; aci: number; note?: string }
  | { kind: "table"; columns: TableColumn[]; rows: Array<Record<string, string>> }
  | { kind: "spacer" };

function welcomeMsgs(): Msg[] {
  return [{ kind: "text", text: "loading models and suites...", dim: true }];
}

function helpMsgs(): Msg[] {
  return [
    { kind: "cmd", cmd: "run", rest: "<model> | run <suite> <model> | run all [suite]" },
    { kind: "cmd", cmd: "mock", rest: "[model] | mock all   (synthetic, no model)" },
    { kind: "cmd", cmd: "models", rest: "list configured models" },
    { kind: "cmd", cmd: "suites", rest: "list available suites" },
    { kind: "cmd", cmd: "teacher", rest: "<model|none>   judge model for scored tiers" },
    { kind: "cmd", cmd: "samples", rest: "<n>   samples per prompt" },
    { kind: "cmd", cmd: "seed", rest: "<n>   reproducible runs" },
    { kind: "cmd", cmd: "setup", rest: "guided specimen + teacher + config" },
    { kind: "cmd", cmd: "clear", rest: undefined },
    { kind: "cmd", cmd: "exit", rest: undefined },
    { kind: "text", text: "teacher, samples and seed persist for this session only", dim: true },
  ];
}

const MODEL_COLUMNS: TableColumn[] = [
  { key: "model", label: "model", width: 22 },
  { key: "origin", label: "origin", width: 44 },
  { key: "quant", label: "quant", width: 10 },
  { key: "effort", label: "effort", width: 7 },
  { key: "port", label: "port", width: 6, align: "right" },
];

const SUITE_COLUMNS: TableColumn[] = [
  { key: "suite", label: "suite", width: 14 },
  { key: "title", label: "title", width: 30 },
  { key: "tiers", label: "tiers", width: 6, align: "right" },
  { key: "samples", label: "samples", width: 8, align: "right" },
  { key: "seed", label: "seed", width: 10, align: "right" },
];

async function buildModelsMsgs(mockMode: boolean): Promise<Msg[]> {
  if (mockMode) {
    return [
      { kind: "section", text: "models available" },
      {
        kind: "table",
        columns: MODEL_COLUMNS,
        rows: MOCK_MODELS.map((n) => ({
          model: n,
          origin: "mock/hf (synthetic)",
          quant: "Q4_K_M",
          effort: "none",
          port: "8750",
        })),
      },
    ];
  }
  const msgs: Msg[] = [{ kind: "section", text: "models available" }];
  try {
    const names = await listModelConfigNames();
    const rows: Array<Record<string, string>> = [];
    for (const n of names) {
      try {
        const c = await loadModelConfig(n);
        rows.push({
          model: n,
          origin: c.local_path ?? `${c.hf ?? "-"}`,
          quant: c.quant ?? "-",
          effort: c.reasoning.effort,
          port: String(c.runtime.port),
        });
      } catch (err) {
        rows.push({
          model: n,
          origin: `INVALID: ${(err as Error).message.slice(0, 40)}`,
          quant: "-",
          effort: "-",
          port: "-",
        });
      }
    }
    msgs.push({ kind: "table", columns: MODEL_COLUMNS, rows });
  } catch (err) {
    msgs.push({ kind: "error", text: (err as Error).message });
  }
  return msgs;
}

async function buildSuitesMsgs(): Promise<Msg[]> {
  const msgs: Msg[] = [{ kind: "section", text: "suites available" }];
  try {
    const names = await listSuiteNames();
    const rows: Array<Record<string, string>> = [];
    for (const n of names) {
      try {
        const sc = await loadSuiteConfig(n);
        rows.push({
          suite: sc.id,
          title: sc.title,
          tiers: String(sc.tiers.filter((t) => t.enabled).length),
          samples: String(sc.defaults.samples_per_prompt),
          seed: String(sc.defaults.seed),
        });
      } catch (err) {
        rows.push({
          suite: n,
          title: `INVALID: ${(err as Error).message.slice(0, 30)}`,
          tiers: "-",
          samples: "-",
          seed: "-",
        });
      }
    }
    msgs.push({ kind: "table", columns: SUITE_COLUMNS, rows });
  } catch (err) {
    msgs.push({ kind: "error", text: (err as Error).message });
  }
  return msgs;
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const two = (n: number) => String(n).padStart(2, "0");
  const d = now;
  return (
    <Text dimColor>
      {d.getFullYear()}-{two(d.getMonth() + 1)}-{two(d.getDate())} {two(d.getHours())}:{two(d.getMinutes())}:
      {two(d.getSeconds())}
    </Text>
  );
}

function rule(width: number): string {
  return "─".repeat(Math.max(10, width - 2));
}

function MsgView({ m }: { m: Msg }) {
  switch (m.kind) {
    case "text":
      return (
        <Text color={m.dim ? GRAY : WHITE} dimColor={m.dim}>
          {m.text}
        </Text>
      );
    case "section":
      return (
        <Text bold color="white">
          {m.text}
        </Text>
      );
    case "cmd":
      return (
        <Box gap={1}>
          <Arrow />
          <Text color="white">{m.cmd}</Text>
          {m.rest ? <Text color={GRAY}>{m.rest}</Text> : null}
        </Box>
      );
    case "error":
      return (
        <Box gap={1}>
          <Arrow />
          <Text color={RED_DEEP}>{m.text}</Text>
        </Box>
      );
    case "aci":
      return (
        <Box gap={1}>
          <Arrow />
          <Text color="white">{m.model}</Text>
          <GradientText text={m.aci.toFixed(1)} bold />
          <Text dimColor>{m.note ?? "/ 100 ACI"}</Text>
        </Box>
      );
    case "table":
      return <Table columns={m.columns} rows={m.rows} />;
    case "spacer":
      return <Text> </Text>;
  }
}

export function App({ mock }: { mock: boolean }) {
  const { exit } = useApp();
  const { columns, rows } = useWindowSize();
  const [mode, setMode] = useState<"home" | "setup" | "run" | "summary">("home");
  const [msgs, setMsgs] = useState<Msg[]>(welcomeMsgs());
  const [setup, setSetup] = useState<SetupResult | null>(null);
  const [summary, setSummary] = useState<RunSummary | null>(null);

  const teacherRef = useRef<string | null>(null);
  const samplesRef = useRef<number | null>(null);
  const seedRef = useRef<number | null>(null);
  const suiteRef = useRef<string>("creativity");
  const queueRef = useRef<string[]>([]);
  const summaryRef = useRef<RunSummary | null>(null);

  useEffect(() => {
    process.stdout.write("\x1b[?25l");
    return () => {
      process.stdout.write("\x1b[?25h");
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const models = await buildModelsMsgs(mock);
      const suites = await buildSuitesMsgs();
      const loaded: Msg[] = [
        ...models,
        { kind: "spacer" },
        ...suites,
        { kind: "spacer" },
        { kind: "text", text: "type a command below; help lists everything", dim: true },
      ];
      if (alive) setMsgs(loaded);
    })().catch((err: Error) => {
      if (alive) setMsgs([{ kind: "error", text: err.message }]);
    });
    return () => {
      alive = false;
    };
  }, [mock]);

  const push = (m: Msg | Msg[]) => setMsgs((prev) => [...prev, ...(Array.isArray(m) ? m : [m])]);

  async function startRunFor(modelName: string, suiteName: string, isMock: boolean): Promise<void> {
    try {
      const mcfg = isMock ? mockStudentCfg(modelName) : await loadModelConfig(modelName);
      const suite = await loadSuiteConfig(suiteName);
      let teacher: ModelConfig | null = null;
      if (!isMock && teacherRef.current) {
        teacher = await loadModelConfig(teacherRef.current);
      }
      const result: SetupResult = {
        mock: isMock,
        model: mcfg,
        suite: teacher ? { ...suite, judge: { model: teacher.name } } : { ...suite, judge: null },
        teacher,
        samples: samplesRef.current ?? suite.defaults.samples_per_prompt,
        seed: seedRef.current ?? suite.defaults.seed,
        judgeOverrides: teacher
          ? {
              sampling: teacher.sampling,
              runtime: { port: teacher.runtime.port },
              reasoning: { effort: teacher.reasoning.effort },
            }
          : undefined,
      };
      setSetup(result);
      setMode("run");
    } catch (err) {
      push({ kind: "error", text: (err as Error).message.split("\n")[0] ?? "run failed" });
      advanceQueue();
    }
  }

  function advanceQueue(): void {
    const next = queueRef.current.shift();
    if (next) {
      push({
        kind: "text",
        text: `next: ${next}${queueRef.current.length > 0 ? ` (${queueRef.current.length} left in queue)` : ""}`,
        dim: true,
      });
      void startRunFor(next, suiteRef.current, mock);
    } else {
      setMode("home");
    }
  }

  function afterSummary(): void {
    const s = summaryRef.current;
    if (s) {
      push({ kind: "aci", model: s.model, aci: s.aci, note: s.aborted ? "/ 100 ACI (aborted)" : undefined });
      if (s.aborted) queueRef.current = [];
    }
    advanceQueue();
  }

  async function exec(raw: string): Promise<void> {
    const line = raw.trim();
    if (!line) return;
    const parts = line.split(/\s+/);
    const cmd = parts[0]!.toLowerCase();
    const rest = parts.slice(1);

    switch (cmd) {
      case "help": {
        push(helpMsgs());
        return;
      }
      case "models": {
        push(await buildModelsMsgs(mock));
        return;
      }
      case "suites": {
        push(await buildSuitesMsgs());
        return;
      }
      case "run":
      case "mock": {
        const isMock = cmd === "mock" || mock;
        if (rest.length === 0) {
          push({ kind: "error", text: "run needs arguments. try: run <model> | run <suite> <model> | run all [suite]" });
          return;
        }
        if (rest[0]!.toLowerCase() === "all") {
          const suiteName = rest[1] ?? "creativity";
          try {
            await loadSuiteConfig(suiteName);
          } catch (err) {
            push({ kind: "error", text: (err as Error).message.split("\n")[0] ?? "suite missing" });
            return;
          }
          const names = isMock ? MOCK_MODELS : await listModelConfigNames();
          if (names.length === 0) {
            push({ kind: "error", text: "no model configs found in configs/models/" });
            return;
          }
          suiteRef.current = suiteName;
          queueRef.current = names.slice(1);
          push({
            kind: "text",
            text: `running ${names.length} model${names.length > 1 ? "s" : ""} one by one on suite ${suiteName}`,
            dim: true,
          });
          void startRunFor(names[0]!, suiteName, isMock);
          return;
        }
        let modelName: string;
        let suiteName: string;
        if (rest.length >= 2) {
          suiteName = rest[0]!;
          modelName = rest[1]!;
        } else {
          const one = rest[0]!;
          let isSuite = false;
          try {
            await loadSuiteConfig(one);
            isSuite = true;
          } catch {
            isSuite = false;
          }
          if (isSuite) {
            push({ kind: "error", text: `"${one}" is a suite. give a model too: run ${one} <model>` });
            return;
          }
          modelName = one;
          suiteName = "creativity";
        }
        if (isMock && !MOCK_MODELS.includes(modelName)) {
          push({ kind: "text", text: `mock has no model "${modelName}"; using ${MOCK_MODELS[0]}`, dim: true });
          modelName = MOCK_MODELS[0]!;
        }
        suiteRef.current = suiteName;
        queueRef.current = [];
        void startRunFor(modelName, suiteName, isMock);
        return;
      }
      case "teacher": {
        const arg = rest[0];
        if (!arg) {
          push({ kind: "text", text: `teacher is ${teacherRef.current ?? "none"}`, dim: true });
          return;
        }
        if (arg.toLowerCase() === "none") {
          teacherRef.current = null;
          push({ kind: "text", text: "teacher set to none (heuristic-only scoring)" });
          return;
        }
        if (mock) {
          teacherRef.current = arg;
          push({ kind: "text", text: `teacher set to ${arg} (mock)` });
          return;
        }
        try {
          await loadModelConfig(arg);
          teacherRef.current = arg;
          push({ kind: "text", text: `teacher set to ${arg}` });
        } catch {
          push({ kind: "error", text: `no model config "${arg}" in configs/models/` });
        }
        return;
      }
      case "samples": {
        const n = parseInt(rest[0] ?? "", 10);
        if (!Number.isFinite(n) || n < 1) {
          push({ kind: "error", text: "samples needs a positive integer: samples 5" });
          return;
        }
        samplesRef.current = Math.min(50, n);
        push({ kind: "text", text: `samples per prompt set to ${samplesRef.current}` });
        return;
      }
      case "seed": {
        const n = parseInt(rest[0] ?? "", 10);
        if (!Number.isFinite(n)) {
          push({ kind: "error", text: "seed needs an integer: seed 42" });
          return;
        }
        seedRef.current = n;
        push({ kind: "text", text: `seed set to ${n}` });
        return;
      }
      case "setup": {
        setMode("setup");
        return;
      }
      case "clear": {
        setMsgs(welcomeMsgs());
        return;
      }
      case "exit":
      case "quit": {
        exit();
        return;
      }
      default: {
        push({ kind: "error", text: `unknown command "${cmd}". type help` });
        return;
      }
    }
  }

  if (mode === "setup") {
    return (
      <SetupFlow
        mock={mock}
        onDone={(r) => {
          setSetup(r);
          setMode("run");
        }}
        onCancel={() => setMode("home")}
      />
    );
  }

  if (mode === "run" && setup) {
    const engine = setup.mock ? createMockEngine(setup.seed) : createRealEngine(setup);
    return (
      <RunScreen
        setup={setup}
        engine={engine}
        onDone={(s) => {
          summaryRef.current = s;
          setSummary(s);
          setMode("summary");
        }}
        onExit={() => {
          queueRef.current = [];
          setMode("home");
        }}
      />
    );
  }

  if (mode === "summary" && summary) {
    return <SummaryScreen summary={summary} mock={setup?.mock ?? mock} onExit={afterSummary} />;
  }

  const budget = Math.max(4, rows - 10);
  let used = 0;
  const visible: Array<[number, Msg]> = [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]!;
    const cost = m.kind === "table" ? m.rows.length + 3 : m.kind === "spacer" ? 2 : 1;
    if (used + cost > budget && visible.length > 0) break;
    used += cost;
    visible.unshift([i, m]);
  }

  return (
    <Box flexDirection="column" height={rows} overflow="hidden">
      <Box gap={2}>
        <FlowText text="AIEA" bold />
        <Text dimColor>Asa Intelligence Evaluation and Analysis</Text>
        <Box flexGrow={1} />
        <Clock />
      </Box>
      <Text dimColor>{rule(columns)}</Text>

      <Box flexDirection="column" flexGrow={1} overflow="hidden" paddingTop={1}>
        {visible.map(([i, m]) => (
          <MsgView key={i} m={m} />
        ))}
      </Box>

      <PromptInput commands={COMMANDS} onSubmit={(t) => void exec(t)} placeholder="type a command (help)" />
    </Box>
  );
}

export async function runApp(mock: boolean): Promise<void> {
  const restoreCursor = () => {
    process.stdout.write("\x1b[?25h");
  };
  process.on("exit", restoreCursor);
  const instance = render(<App mock={mock} />);
  await instance.waitUntilExit();
  restoreCursor();
}
