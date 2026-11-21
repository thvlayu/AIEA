import type { ModelSampling } from "../config/types";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  content: string;
  reasoning: string;
  promptTokens: number;
  completionTokens: number;
  ms: number;
}

interface ChatApiResponse {
  choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export async function chat(
  port: number,
  messages: ChatMessage[],
  sampling: ModelSampling,
  seed: number,
  maxTokens: number,
  signal?: AbortSignal,
): Promise<ChatResult> {
  const t0 = performance.now();
  const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal,
    body: JSON.stringify({
      messages,
      temperature: sampling.temperature,
      top_p: sampling.top_p,
      top_k: Math.round(sampling.top_k),
      min_p: sampling.min_p,
      repeat_penalty: sampling.repeat_penalty,
      seed,
      max_tokens: Math.round(maxTokens),
      stream: false,
    }),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    throw new Error(`chat completions returned HTTP ${res.status}: ${body}`);
  }
  const data = (await res.json()) as ChatApiResponse;
  const msg = data.choices?.[0]?.message ?? {};
  const content = (msg.content ?? "").trim();
  const reasoning = (msg.reasoning_content ?? "").trim();
  return {
    content,
    reasoning,
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
    ms: Math.round(performance.now() - t0),
  };
}
