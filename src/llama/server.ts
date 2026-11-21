import path from "node:path";
import { ensureDir } from "../paths";
import type { ModelConfig } from "../config/types";
import type { LlamaBinary } from "./resolve";

export interface StartedServer {
  port: number;
  logPath: string;
  stop: () => Promise<void>;
}

export function buildServerArgs(cfg: ModelConfig, modelPath: string, bin: LlamaBinary): string[] {
  const rt = cfg.runtime;
  const args: string[] = [];
  if (bin.mode === "serve") args.push("serve");
  args.push("-m", modelPath);
  args.push("--host", "127.0.0.1", "--port", String(rt.port));
  args.push("-c", String(rt.context));
  args.push("-ngl", String(rt.ngl));
  if (rt.threads > 0) args.push("-t", String(rt.threads));
  if (cfg.reasoning.effort === "none") {
    args.push("--reasoning-budget", "0");
    args.push("--chat-template-kwargs", '{"enable_thinking": false}');
  }
  return args;
}

function startPump(stream: ReadableStream<Uint8Array>, logPath: string, tail: string[]) {
  const dec = new TextDecoder();
  (async () => {
    const reader = stream.getReader();
    try {
      const sink = Bun.file(logPath).writer();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = dec.decode(value, { stream: true });
          tail.push(chunk);
          if (tail.length > 200) tail.splice(0, tail.length - 200);
          await sink.write(chunk);
        }
      } finally {
        await sink.end();
      }
    } catch {
      /* stream closed */
    }
  })();
}

function tailText(tail: string[]): string {
  const text = tail.join("").split(/\r?\n/).filter(Boolean).slice(-12).join("\n");
  return text.length > 0 ? text : "(no output captured)";
}

async function waitExit(proc: Bun.Subprocess<"ignore", "pipe", "pipe">, ms: number): Promise<boolean> {
  const t = new Promise<boolean>((resolve) => {
    void proc.exited.then(() => resolve(true));
    setTimeout(() => resolve(false), ms);
  });
  return t;
}

export async function startServer(
  bin: LlamaBinary,
  cfg: ModelConfig,
  modelPath: string,
  logDir: string,
): Promise<StartedServer> {
  await ensureDir(logDir);
  const logPath = path.join(logDir, "llama-server.log");
  const args = buildServerArgs(cfg, modelPath, bin);
  const proc = Bun.spawn([bin.path, ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const tail: string[] = [];
  if (proc.stderr) startPump(proc.stderr, logPath, tail);
  if (proc.stdout) startPump(proc.stdout, logPath, tail);

  const deadline = Date.now() + cfg.runtime.load_timeout_sec * 1000;
  for (;;) {
    if (proc.exitCode !== null) {
      throw new Error(`llama process exited with code ${proc.exitCode} during startup\n${tailText(tail)}`);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${cfg.runtime.port}/health`);
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) {
      proc.kill("SIGKILL");
      throw new Error(
        `llama server did not become healthy within ${cfg.runtime.load_timeout_sec}s\n${tailText(tail)}`,
      );
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  const stop = async () => {
    try {
      proc.kill("SIGTERM");
    } catch {
      /* already gone */
    }
    const exited = await waitExit(proc, 3000);
    if (!exited) {
      try {
        proc.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }
  };
  return { port: cfg.runtime.port, logPath, stop };
}
