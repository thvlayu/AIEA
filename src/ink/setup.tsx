import { useEffect, useState } from "react";
import { Text } from "ink";
import { ConfigForm, Frame, Kv, SelectList, type FormField } from "./components";
import { applyOverrides, listModelConfigNames, loadModelConfig, loadSuiteConfig } from "../config/load";
import type { ModelConfig, ReasoningEffort, SuiteConfig } from "../config/types";
import type { SetupResult } from "./engine";
import { buildPlan } from "../bench/plan";

type Step = "specimen" | "specimen-config" | "teacher" | "teacher-config" | "suite-config" | "confirm" | "error";

const MOCK_MODELS = ["mock-student-4b (synthetic)", "mock-student-2b (synthetic)"];
const MOCK_TEACHERS = ["none (heuristic only)", "mock-teacher-8b (synthetic)"];

const EFFORT_CHOICES: ReasoningEffort[] = ["none", "low", "high"];

function number(v: string | undefined, fallback: number): number {
  const n = parseFloat(v ?? "");
  return Number.isFinite(n) ? n : fallback;
}

function modelFields(cfg: ModelConfig): FormField[] {
  return [
    { key: "temperature", label: "temperature", kind: "number", initial: String(cfg.sampling.temperature), hint: "0.0 - 2.0" },
    { key: "top_p", label: "top p", kind: "number", initial: String(cfg.sampling.top_p), hint: "0.0 - 1.0" },
    { key: "top_k", label: "top k", kind: "number", initial: String(cfg.sampling.top_k), hint: "1 - 200" },
    { key: "min_p", label: "min p", kind: "number", initial: String(cfg.sampling.min_p), hint: "0.0 - 1.0" },
    { key: "repeat_penalty", label: "repeat penalty", kind: "number", initial: String(cfg.sampling.repeat_penalty), hint: "0.8 - 2.0" },
    { key: "context", label: "context", kind: "number", initial: String(cfg.runtime.context), hint: "kv size, tokens" },
    { key: "ngl", label: "gpu layers", kind: "number", initial: String(cfg.runtime.ngl), hint: "99 = all layers" },
    { key: "port", label: "port", kind: "number", initial: String(cfg.runtime.port), hint: "1024 - 65535" },
    {
      key: "effort",
      label: "reasoning effort",
      kind: "choice",
      initial: cfg.reasoning.effort,
      choices: [...EFFORT_CHOICES],
      hint: "left/right cycles",
    },
  ];
}

function applyForm(cfg: ModelConfig, values: Record<string, string>): ModelConfig {
  return applyOverrides(cfg, {
    sampling: {
      temperature: Math.max(0, Math.min(2, number(values["temperature"], cfg.sampling.temperature))),
      top_p: Math.max(0, Math.min(1, number(values["top_p"], cfg.sampling.top_p))),
      top_k: Math.max(1, Math.round(number(values["top_k"], cfg.sampling.top_k))),
      min_p: Math.max(0, Math.min(1, number(values["min_p"], cfg.sampling.min_p))),
      repeat_penalty: Math.max(0.8, Math.min(2, number(values["repeat_penalty"], cfg.sampling.repeat_penalty))),
    },
    runtime: {
      context: Math.max(512, Math.round(number(values["context"], cfg.runtime.context))),
      ngl: Math.max(0, Math.round(number(values["ngl"], cfg.runtime.ngl))),
      port: Math.max(1024, Math.min(65535, Math.round(number(values["port"], cfg.runtime.port)))),
    },
    reasoning: { effort: (values["effort"] as ReasoningEffort) ?? cfg.reasoning.effort },
  });
}

const MOCK_MCFG: ModelConfig = {
  name: "mock-student-4b (synthetic)",
  hf: "mock/hf (synthetic)",
  quant: "Q4_K_M",
  file: null,
  local_path: null,
  reasoning: { effort: "none" },
  sampling: { temperature: 0.9, top_p: 0.95, top_k: 40, min_p: 0.05, repeat_penalty: 1.05 },
  runtime: { binary: "auto", port: 8750, context: 8192, ngl: 99, threads: 0, load_timeout_sec: 600 },
};

const MOCK_TCFG: ModelConfig = {
  name: "mock-teacher-8b (synthetic)",
  hf: "mock/hf (synthetic)",
  quant: "Q4_K_M",
  file: null,
  local_path: null,
  reasoning: { effort: "none" },
  sampling: { temperature: 0.3, top_p: 0.9, top_k: 20, min_p: 0.05, repeat_penalty: 1 },
  runtime: { binary: "auto", port: 8751, context: 8192, ngl: 99, threads: 0, load_timeout_sec: 600 },
};

export function SetupFlow({
  mock,
  onDone,
  onCancel,
}: {
  mock: boolean;
  onDone: (r: SetupResult) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<Step>("specimen");
  const [modelCfg, setModelCfg] = useState<ModelConfig | null>(mock ? MOCK_MCFG : null);
  const [teacherCfg, setTeacherCfg] = useState<ModelConfig | null>(null);
  const [teacherOn, setTeacherOn] = useState(false);
  const [suite, setSuite] = useState<SuiteConfig | null>(null);
  const [samples, setSamples] = useState<string>("5");
  const [seed, setSeed] = useState<string>("20260101");
  const [error, setError] = useState<string | null>(null);

  function pickSpecimen(name: string) {
    if (mock) {
      setModelCfg(MOCK_MCFG);
      setStep("specimen-config");
      return;
    }
    void loadModelConfig(name)
      .then((cfg) => {
        setModelCfg(cfg);
        setStep("specimen-config");
      })
      .catch((err: Error) => {
        setError(err.message);
        setStep("error");
      });
  }

  function pickTeacher(name: string) {
    if (name.startsWith("none")) {
      setTeacherOn(false);
      setTeacherCfg(null);
      pickSuite("creativity");
      return;
    }
    if (mock) {
      setTeacherOn(true);
      setTeacherCfg(MOCK_TCFG);
      setStep("teacher-config");
      return;
    }
    void loadModelConfig(name)
      .then((cfg) => {
        setTeacherOn(true);
        setTeacherCfg(cfg);
        setStep("teacher-config");
      })
      .catch((err: Error) => {
        setError(err.message);
        setStep("error");
      });
  }

  function pickSuite(name: string) {
    void loadSuiteConfig(name)
      .then((s) => {
        setSuite(s);
        setSamples(String(s.defaults.samples_per_prompt));
        setSeed(String(s.defaults.seed));
        setStep("suite-config");
      })
      .catch((err: Error) => {
        setError(err.message);
        setStep("error");
      });
  }

  function finishSuite(values: Record<string, string>) {
    setSamples(String(Math.max(1, Math.min(50, Math.round(number(values["samples"], 5))))));
    setSeed(String(Math.round(number(values["seed"], 20260101))));
    setStep("confirm");
  }

  function startRun(values: Record<string, string>) {
    if (!modelCfg || !suite) return;
    const result: SetupResult = {
      mock,
      model: modelCfg,
      suite: teacherOn ? { ...suite, judge: { model: teacherCfg?.name ?? "" } } : { ...suite, judge: null },
      teacher: teacherOn ? teacherCfg : null,
      samples: Math.max(1, Math.min(50, Math.round(number(values["samples"], 5)))),
      seed: Math.round(number(values["seed"], 20260101)),
      judgeOverrides: teacherCfg
        ? {
            sampling: {
              temperature: teacherCfg.sampling.temperature,
              top_p: teacherCfg.sampling.top_p,
              top_k: teacherCfg.sampling.top_k,
            },
            runtime: { port: teacherCfg.runtime.port },
            reasoning: { effort: teacherCfg.reasoning.effort },
          }
        : undefined,
    };
    onDone(result);
  }

  if (step === "error") {
    return (
      <Frame title="Setup error" footer="esc to exit">
        <Text color="red">{error}</Text>
      </Frame>
    );
  }

  if (step === "specimen") {
    return (
      <SpecimenPicker
        mock={mock}
        onPick={pickSpecimen}
        onCancel={onCancel}
        onError={(msg) => {
          setError(msg);
          setStep("error");
        }}
      />
    );
  }

  if (step === "specimen-config" && modelCfg) {
    return (
      <ConfigForm
        title={`Specimen config | ${modelCfg.name}`}
        fields={modelFields(modelCfg)}
        onConfirm={(values) => {
          setModelCfg(applyForm(modelCfg, values));
          setStep("teacher");
        }}
        onCancel={onCancel}
      />
    );
  }

  if (step === "teacher") {
    return <TeacherPicker mock={mock} onPick={pickTeacher} onCancel={() => setStep("specimen-config")} />;
  }

  if (step === "teacher-config" && teacherCfg) {
    return (
      <ConfigForm
        title={`Teacher config | ${teacherCfg.name}`}
        fields={modelFields(teacherCfg)}
        onConfirm={(values) => {
          setTeacherCfg(applyForm(teacherCfg, values));
          pickSuite("creativity");
        }}
        onCancel={() => setStep("teacher")}
      />
    );
  }

  if (step === "suite-config" && suite) {
    return (
      <ConfigForm
        title={`Suite | ${suite.id}`}
        fields={[
          { key: "samples", label: "samples per prompt", kind: "number", initial: samples, hint: "X samples" },
          { key: "seed", label: "run seed", kind: "number", initial: seed, hint: "reproducible" },
        ]}
        onConfirm={finishSuite}
        onCancel={() => setStep("teacher")}
      />
    );
  }

  if (step === "confirm" && suite && modelCfg) {
    const plan = buildPlan(suite, number(seed, 20260101), Math.round(number(samples, 5)));
    const teacherLabel = teacherOn ? (teacherCfg?.name ?? "?") : "none (heuristic only)";
    return (
      <Frame title="Confirm run" footer="enter on a row to choose | esc back">
        <Kv k="specimen" v={modelCfg.name} />
        <Kv k="origin" v={modelCfg.local_path ?? `${modelCfg.hf ?? "-"} (${modelCfg.quant ?? "-"})`} />
        <Kv k="teacher" v={teacherLabel} />
        <Kv k="suite" v={suite.id} />
        <Kv k="samples" v={`${samples} per prompt`} />
        <Kv k="seed" v={seed} />
        <Kv k="generations" v={`${plan.totalPrompts} prompts x ${samples} = ${plan.totalSamples}`} />
        {modelCfg.hf && !modelCfg.local_path ? (
          <Text dimColor>model file downloads to models/ on first run if not cached</Text>
        ) : null}
        <SelectList
          title="Ready"
          options={["start run", "change suite config"]}
          onDone={(i) => {
            if (i === 0) startRun({ samples, seed });
            else setStep("suite-config");
          }}
          onCancel={() => setStep("suite-config")}
        />
      </Frame>
    );
  }

  return <Text dimColor>loading...</Text>;
}

function SpecimenPicker({
  mock,
  onPick,
  onCancel,
  onError,
}: {
  mock: boolean;
  onPick: (name: string) => void;
  onCancel: () => void;
  onError: (msg: string) => void;
}) {
  const [names, setNames] = useState<string[] | null>(mock ? MOCK_MODELS : null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  useEffect(() => {
    if (mock) return;
    let alive = true;
    void listModelConfigNames()
      .then((n) => {
        if (alive) setNames(n);
      })
      .catch((err: Error) => {
        if (alive) {
          setLoadErr(err.message);
          onError(err.message);
        }
      });
    return () => {
      alive = false;
    };
  }, [mock]);
  if (loadErr) {
    return (
      <Frame title="Specimen">
        <Text color="red">{loadErr}</Text>
      </Frame>
    );
  }
  if (!names) {
    return (
      <Frame title="Specimen">
        <Text dimColor>loading configs...</Text>
      </Frame>
    );
  }
  return (
    <SelectList
      title="Specimen | pick model"
      options={names}
      subs={names.map((n) => `configs/models/${n}.yaml`)}
      onDone={(i) => onPick(names[i] ?? "")}
      onCancel={onCancel}
    />
  );
}

function TeacherPicker({
  mock,
  onPick,
  onCancel,
}: {
  mock: boolean;
  onPick: (name: string) => void;
  onCancel: () => void;
}) {
  const [names, setNames] = useState<string[] | null>(mock ? MOCK_TEACHERS : null);
  useEffect(() => {
    if (mock) return;
    let alive = true;
    void listModelConfigNames()
      .then((n) => {
        if (alive) setNames(n);
      })
      .catch(() => {
        if (alive) setNames([]);
      });
    return () => {
      alive = false;
    };
  }, [mock]);
  if (!names) {
    return (
      <Frame title="Teacher">
        <Text dimColor>loading configs...</Text>
      </Frame>
    );
  }
  const options = names;
  const subs = options.map((o) =>
    o.startsWith("none") ? "heuristic scoring only" : o.startsWith("mock-") ? "synthetic" : `configs/models/${o}.yaml`,
  );
  return (
    <SelectList title="Teacher | pick judge model" options={options} subs={subs} onDone={(i) => onPick(options[i] ?? "")} onCancel={onCancel} />
  );
}
