import { useState } from "react";
import { render, Text, useApp } from "ink";
import { SetupFlow } from "./setup";
import { RunScreen, SummaryScreen } from "./run";
import { createMockEngine, createRealEngine, type SetupResult } from "./engine";
import type { RunSummary } from "../bench/runner";

function App({ mock }: { mock: boolean }) {
  const { exit } = useApp();
  const [phase, setPhase] = useState<"setup" | "run" | "summary">("setup");
  const [setup, setSetup] = useState<SetupResult | null>(null);
  const [summary, setSummary] = useState<RunSummary | null>(null);

  if (phase === "setup") {
    return (
      <SetupFlow
        mock={mock}
        onDone={(r) => {
          setSetup(r);
          setPhase("run");
        }}
        onCancel={() => exit()}
      />
    );
  }
  if (phase === "run" && setup) {
    const engine = setup.mock ? createMockEngine(setup.seed) : createRealEngine(setup);
    return (
      <RunScreen
        setup={setup}
        engine={engine}
        onDone={(s) => {
          setSummary(s);
          setPhase("summary");
        }}
        onExit={() => exit()}
      />
    );
  }
  if (phase === "summary" && summary && setup) {
    return <SummaryScreen summary={summary} mock={setup.mock} onExit={() => exit()} />;
  }
  return <Text dimColor>waiting for state...</Text>;
}

export async function runApp(mock: boolean): Promise<void> {
  const instance = render(<App mock={mock} />);
  await instance.waitUntilExit();
}
