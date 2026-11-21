import { SLOP_WORDS, SLOP_PHRASES } from "./lexicon";

export function countWords(text: string): number {
  const m = text.match(/[A-Za-z0-9'’-]+/g);
  return m ? m.length : 0;
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function lineItems(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((line) => line.length > 0 && !/^(here|sure|certainly|i )/i.test(line));
}

export function letterOf(word: string): string {
  const first = word.trim().replace(/^[^a-z]/i, "").charAt(0).toLowerCase();
  return first;
}

export interface UsesCheck {
  uses: number;
  lines: string[];
}

export function checkUses(text: string): UsesCheck {
  const lines = lineItems(text);
  return { uses: lines.length, lines };
}

export interface WordListCheck {
  words: string[];
  count: number;
  badLetter: number;
  repeats: number;
  seedHits: number;
  properNounLike: number;
}

export function checkWordList(text: string, letter: string, seeds: string[]): WordListCheck {
  const seedsLower = new Set(seeds.map((s) => s.toLowerCase()));
  const lines = lineItems(text);
  const words: string[] = [];
  let badLetter = 0;
  let properNounLike = 0;
  const seen = new Set<string>();
  let repeats = 0;
  let seedHits = 0;
  for (const raw of lines) {
    const word = raw.split(/\s+/)[0] ?? "";
    const cleaned = word.replace(/[^A-Za-z'’-]/g, "");
    if (!cleaned) continue;
    words.push(cleaned);
    if (letterOf(cleaned) !== letter.toLowerCase()) badLetter++;
    const lower = cleaned.toLowerCase();
    if (seen.has(lower)) repeats++;
    seen.add(lower);
    if (seedsLower.has(lower)) seedHits++;
    if (/^[A-Z]/.test(cleaned) && cleaned !== "I") properNounLike++;
  }
  return { words, count: words.length, badLetter, repeats, seedHits, properNounLike };
}

export interface StoryCheck {
  present: number;
  total: number;
  missing: string[];
  words: number;
  windowOk: boolean;
}

export function checkStory(
  text: string,
  elements: Array<{ name: string; value: string }>,
  window: [number, number] | null,
): StoryCheck {
  const lower = text.toLowerCase();
  const missing: string[] = [];
  let present = 0;
  for (const el of elements) {
    const needle = el.value.toLowerCase();
    if (lower.includes(needle)) present++;
    else missing.push(`${el.name}: ${el.value}`);
  }
  const words = countWords(text);
  const windowOk = window ? words >= window[0] * 0.9 && words <= window[1] * 1.1 : true;
  return { present, total: elements.length, missing, words, windowOk };
}

export interface MentionCheck {
  mentionRatio: number;
  forbidden: string[];
}

export function checkMentions(text: string, mentions: string[], forbid: string[]): MentionCheck {
  const lower = text.toLowerCase();
  let found = 0;
  for (const m of mentions) if (lower.includes(m.toLowerCase())) found++;
  const forbidden = forbid.filter((f) => lower.includes(f.toLowerCase()));
  const base = mentions.length === 0 ? 1 : found / mentions.length;
  const mentionRatio = forbidden.length > 0 ? 0 : base;
  return { mentionRatio, forbidden };
}

export interface SlopStats {
  hits: number;
  weighted: number;
  per100: number;
  matched: string[];
}

export function slopStats(text: string): SlopStats {
  const lower = text.toLowerCase();
  const words = Math.max(1, countWords(text));
  const matched: string[] = [];
  let weighted = 0;
  for (const { term, weight } of SLOP_PHRASES) {
    let idx = lower.indexOf(term);
    while (idx !== -1) {
      weighted += weight;
      matched.push(term);
      idx = lower.indexOf(term, idx + term.length);
    }
  }
  for (const { term, weight } of SLOP_WORDS) {
    const re = new RegExp(`\\b${term}\\b`, "g");
    const hits = (lower.match(re) ?? []).length;
    if (hits > 0) {
      weighted += weight * hits;
      matched.push(term);
    }
  }
  const per100 = (weighted / words) * 100;
  return { hits: matched.length, weighted, per100, matched: [...new Set(matched)] };
}

export const SEED_WORDS = [
  "apple", "anchor", "basket", "bottle", "bridge", "butter", "candle", "chair", "cloud", "compass",
  "desk", "door", "envelope", "engine", "fan", "feather", "forest", "garden", "grape", "hammer",
  "hinge", "island", "jar", "jacket", "kettle", "key", "ladder", "leaf", "magnet", "mirror",
  "mountain", "nail", "needle", "onion", "ocean", "pepper", "pillow", "quilt", "river", "rope",
  "salt", "stone", "table", "train", "umbrella", "vine", "violin", "whistle", "window", "yarn",
];
