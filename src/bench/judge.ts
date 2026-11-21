import { chat, type ChatMessage } from "../llama/client";
import type { ModelSampling } from "../config/types";

export interface JudgeClient {
  port: number;
  sampling: ModelSampling;
  seed: number;
  label: string;
}

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

const DISTINCT_SYSTEM: ChatMessage = {
  role: "system",
  content:
    "You are a strict novelty judge. You group model responses by underlying idea, ignoring surface paraphrase. Two responses are the same idea if a reader would say they are restatements of one another. You answer with JSON only.",
};

export interface JudgeDistinct {
  distinctCount: number;
  groups: number[][];
}

export async function judgeDistinct(
  judge: JudgeClient,
  texts: string[],
): Promise<JudgeDistinct | null> {
  const numbered = texts.map((t, i) => `${i + 1}. ${t.replace(/\s+/g, " ").slice(0, 400)}`).join("\n");
  const user: ChatMessage = {
    role: "user",
    content: [
      `Group the ${texts.length} responses below by underlying idea.`,
      "Responses that are paraphrases of the same idea share a group.",
      'Answer with JSON only, in this exact shape: {"groups": [[1,2],[3],[4,5]]}',
      "Every response number must appear in exactly one group.",
      "",
      numbered,
    ].join("\n"),
  };
  const res = await chat(judge.port, [DISTINCT_SYSTEM, user], judge.sampling, judge.seed, 400);
  const json = extractJson(res.content) as { groups?: unknown } | null;
  if (!json || !Array.isArray(json.groups)) return null;
  const groups: number[][] = [];
  const seen = new Set<number>();
  for (const g of json.groups) {
    if (!Array.isArray(g)) continue;
    const ids = g
      .map((x) => Math.round(Number(x)))
      .filter((x) => Number.isInteger(x) && x >= 1 && x <= texts.length && !seen.has(x));
    for (const id of ids) seen.add(id);
    if (ids.length > 0) groups.push(ids);
  }
  for (let i = 1; i <= texts.length; i++) {
    if (!seen.has(i)) groups.push([i]);
  }
  return { distinctCount: groups.length, groups };
}

const TTCW_SYSTEM: ChatMessage = {
  role: "system",
  content:
    "You are a creative-writing assessor trained on the Torrance Test of Creative Writing. You judge stories honestly and harshly. You answer with JSON only.",
};

export const TTCW_JUDGE_TESTS = [
  "originality_theme: the story gives an average reader an idea they have not met before",
  "originality_structure: the form or structure of the story is itself original",
  "flexibility_of_perspective: the story shifts viewpoint or frame without confusion",
  "elaboration_depth: details extend and enrich rather than decorate",
  "surprise: at least one moment genuinely surprises without cheating",
  "emotional_truth: the emotion is earned by the events, not asserted",
];

export async function judgeTtcw(
  judge: JudgeClient,
  story: string,
): Promise<Record<string, boolean> | null> {
  const user: ChatMessage = {
    role: "user",
    content: [
      "Judge the story below. For each test answer true or false.",
      'Answer with JSON only, in this exact shape: {"originality_theme": true, ...}',
      "",
      ...TTCW_JUDGE_TESTS,
      "",
      "STORY:",
      story.slice(0, 6000),
    ].join("\n"),
  };
  const res = await chat(judge.port, [TTCW_SYSTEM, user], judge.sampling, judge.seed, 400);
  const json = extractJson(res.content) as Record<string, unknown> | null;
  if (!json) return null;
  const out: Record<string, boolean> = {};
  for (const t of TTCW_JUDGE_TESTS) {
    const key = t.split(":")[0]!.trim();
    if (typeof json[key] === "boolean") out[key] = json[key] as boolean;
  }
  return Object.keys(out).length > 0 ? out : null;
}
