import type { Probe } from "../suites/creativity/prompts";
import { RIVER_TOKENS, STORY_STOCK_OPENINGS } from "../suites/creativity/lexicon";
import {
  checkUses,
  checkWordList,
  checkStory,
  checkMentions,
  slopStats,
  countWords,
  splitSentences,
  SEED_WORDS,
} from "../suites/creativity/checks";
import {
  clusterCount,
  maxSimToSet,
  meanPairwiseDistance,
  minPairwiseDistance,
  type SemanticsContext,
} from "../suites/creativity/semantics";

export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9'’-]+/g) ?? [];
}

function charBigrams(text: string): Set<string> {
  const s = text.toLowerCase().replace(/[^a-z]/g, "");
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

function dice(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return a.size + b.size > 0 ? (2 * inter) / (a.size + b.size) : 0;
}

export function pairSim(ta: string[], tb: string[], ga: Set<string>, gb: Set<string>): number {
  const setA = new Set(ta);
  const setB = new Set(tb);
  return 0.45 * jaccard(setA, setB) + 0.55 * dice(ga, gb);
}

export function meanPairSim(texts: string[]): number {
  if (texts.length < 2) return 0;
  const toks = texts.map(tokenize);
  const grams = texts.map(charBigrams);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      sum += pairSim(toks[i]!, toks[j]!, grams[i]!, grams[j]!);
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

export interface DistinctStats {
  distinctRatio: number;
  distinctCount: number;
  meanPairSim: number;
}

export function distinctStats(texts: string[]): DistinctStats {
  if (texts.length < 2) return { distinctRatio: 1, distinctCount: texts.length, meanPairSim: 0 };
  const toks = texts.map(tokenize);
  const grams = texts.map(charBigrams);
  let distinctCount = 0;
  for (let i = 0; i < texts.length; i++) {
    let maxSim = 0;
    for (let j = 0; j < texts.length; j++) {
      if (i === j) continue;
      const s = pairSim(toks[i]!, toks[j]!, grams[i]!, grams[j]!);
      if (s > maxSim) maxSim = s;
    }
    if (maxSim < 0.6) distinctCount++;
  }
  return {
    distinctRatio: distinctCount / texts.length,
    distinctCount,
    meanPairSim: meanPairSim(texts),
  };
}

export function greedyClusters(texts: string[], threshold = 0.5): number[][] {
  const toks = texts.map(tokenize);
  const grams = texts.map(charBigrams);
  const clusters: number[][] = [];
  for (let i = 0; i < texts.length; i++) {
    let placed = false;
    for (const c of clusters) {
      const rep = c[0]!;
      if (pairSim(toks[i]!, toks[rep]!, grams[i]!, grams[rep]!) >= threshold) {
        c.push(i);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push([i]);
  }
  return clusters;
}

function normalizeShort(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export interface ModalStats {
  share: number;
  label: string;
  sizes: Array<{ label: string; count: number }>;
}

export function modalShare(texts: string[], probe: Probe): ModalStats {
  const n = Math.max(1, texts.length);
  if (probe.clusters && probe.clusters.length > 0) {
    const counts = new Map<number, number>();
    let otherKey = -1;
    for (const t of texts) {
      const lower = t.toLowerCase();
      let hit = -1;
      probe.clusters.forEach((tokens, ci) => {
        if (hit !== -1) return;
        if (tokens.some((tok) => lower.includes(tok))) hit = ci;
      });
      const key = hit === -1 ? --otherKey : hit;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    let bestKey = 0;
    let bestCount = -1;
    for (const [k, c] of counts) {
      if (c > bestCount) {
        bestCount = c;
        bestKey = k;
      }
    }
    const sizes = [...counts.entries()]
      .map(([k, c]) => ({
        label: k >= 0 ? probe.clusterLabels?.[k] ?? `cluster-${k}` : `other-${Math.abs(k)}`,
        count: c,
      }))
      .sort((a, b) => b.count - a.count);
    return { share: bestCount / n, label: sizes[0]?.label ?? "unknown", sizes };
  }
  const allShort = texts.every((t) => t.length <= 24);
  const clusters = allShort
    ? (() => {
        const map = new Map<string, number[]>();
        texts.forEach((t, i) => {
          const key = normalizeShort(t) || `blank-${i}`;
          const arr = map.get(key) ?? [];
          arr.push(i);
          map.set(key, arr);
        });
        return [...map.values()];
      })()
    : greedyClusters(texts);
  clusters.sort((a, b) => b.length - a.length);
  const sizes = clusters.map((c, i) => ({
    label: c.length > 0 ? `"${(normalizeShort(texts[c[0]!] ?? "") || "?").slice(0, 18)}"` : `c${i}`,
    count: c.length,
  }));
  return { share: (clusters[0]?.length ?? 0) / n, label: sizes[0]?.label ?? "unknown", sizes };
}

export function riverShareOf(texts: string[], tokens: string[] | undefined): number {
  if (!tokens || tokens.length === 0 || texts.length === 0) return 0;
  const use = tokens.length > 0 ? tokens : RIVER_TOKENS;
  let hits = 0;
  for (const t of texts) {
    const lower = t.toLowerCase();
    if (use.some((tok) => lower.includes(tok))) hits++;
  }
  return hits / texts.length;
}

export interface TtcwCheck {
  name: string;
  pass: boolean;
  judgeOnly: boolean;
  note?: string;
}

export const TTCW_JUDGE_ONLY = [
  "originality_theme",
  "originality_structure",
  "flexibility_of_perspective",
  "elaboration_depth",
  "surprise",
  "emotional_truth",
];

export function ttcwChecks(text: string, window: [number, number] | null): TtcwCheck[] {
  const words = countWords(text);
  const sentences = splitSentences(text);
  const lower = text.toLowerCase();
  const toks = tokenize(text);
  const checks: TtcwCheck[] = [];

  checks.push({ name: "dialogue_present", pass: /["“]/.test(text), judgeOnly: false });

  const sensory = ["smell", "scent", "odor", "aroma", "taste", "salty", "bitter", "sour", "sweet", "texture", "rough", "smooth", "warm", "cold", "damp", "sticky", "prickl", "itchy", "grit", "chill", "humid"];
  checks.push({ name: "sensory_detail", pass: sensory.some((s) => lower.includes(s)), judgeOnly: false });

  const lens = sentences.map((s) => countWords(s)).filter((n) => n > 0);
  if (lens.length >= 2) {
    const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
    const variance = lens.reduce((a, b) => a + (b - mean) * (b - mean), 0) / lens.length;
    checks.push({ name: "sentence_length_variance", pass: Math.sqrt(variance) >= 5, judgeOnly: false });
  } else {
    checks.push({ name: "sentence_length_variance", pass: false, judgeOnly: false, note: "too few sentences" });
  }

  if (words >= 120 && toks.length > 0) {
    const uniq = new Set(toks).size;
    checks.push({ name: "lexical_richness", pass: uniq / toks.length >= 0.38, judgeOnly: false });
  } else {
    checks.push({ name: "lexical_richness", pass: true, judgeOnly: false, note: "n/a short text" });
  }

  const first = sentences[0] ?? "";
  checks.push({
    name: "no_stock_opening",
    pass: !STORY_STOCK_OPENINGS.some((re) => re.test(first)),
    judgeOnly: false,
  });

  const slop = slopStats(text);
  checks.push({ name: "low_slop_density", pass: slop.per100 < 2, judgeOnly: false });

  const hasNumeral = /\d/.test(text);
  const hasCapitalizedToken = toks.some((t, i) => i > 0 && /^[A-Z]/.test(text[text.toLowerCase().indexOf(t)] ?? ""));
  checks.push({ name: "concrete_specifics", pass: hasNumeral || hasCapitalizedToken, judgeOnly: false });

  if (window) {
    const ok = words >= window[0] * 0.9 && words <= window[1] * 1.1;
    checks.push({ name: "word_window", pass: ok, judgeOnly: false, note: `${words} words` });
  } else {
    checks.push({ name: "word_window", pass: true, judgeOnly: false, note: "no window set" });
  }

  for (const name of TTCW_JUDGE_ONLY) {
    checks.push({ name, pass: false, judgeOnly: true });
  }
  return checks;
}

export interface PromptStats {
  probeId: string;
  label: string;
  score: number;
  semantic: boolean;
  distinctRatio: number;
  distinctCount: number;
  meanPairSim: number;
  modalShare: number;
  modalLabel: string;
  riverShare: number;
  slopPer100: number;
  slopWeighted: number;
  fluency: number;
  adherence: number;
  elementsPresentRatio: number;
  ttcwPassRatio: number;
  ttcwProgrammatic: number;
  windowOk: number;
  conceptMentionRatio: number;
  wordCountMean: number;
  clicheProximity: number;
  semDiversity: number;
  minPairDist: number;
  slopSim: number;
  flexibility: number;
  originality: number;
  elaboration: number;
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function scoreFromStats(
  probe: Probe,
  stats: PromptStats,
  semantic: boolean,
  distinctOverride: number | null,
): number {
  const distinct = distinctOverride ?? stats.distinctRatio;
  let s = 0;
  switch (probe.kind) {
    case "short-answer": {
      if (probe.id === "time-metaphor") {
        if (semantic) {
          s = 0.35 * (1 - stats.modalShare) + 0.35 * (1 - stats.clicheProximity) + 0.3 * stats.semDiversity;
        } else {
          s = 0.4 * (1 - stats.modalShare) + 0.3 * (1 - stats.riverShare) + 0.3 * distinct;
        }
      } else {
        s = semantic
          ? 0.5 * (1 - stats.modalShare) + 0.5 * stats.semDiversity
          : 0.6 * (1 - stats.modalShare) + 0.4 * distinct;
      }
      break;
    }
    case "uses": {
      if (semantic) {
        s = 0.25 * stats.fluency + 0.25 * stats.flexibility + 0.3 * stats.originality + 0.2 * stats.elaboration;
      } else {
        s = 0.5 * stats.fluency + 0.5 * distinct;
      }
      break;
    }
    case "word-list": {
      if (semantic) {
        s = 0.3 * stats.adherence + 0.5 * stats.semDiversity + 0.2 * stats.minPairDist;
      } else {
        s = 0.6 * stats.adherence + 0.4 * (0.5 * stats.fluency + 0.5 * distinct);
      }
      break;
    }
    case "prose": {
      const slopTerm = 1 - Math.min(1, stats.slopPer100 / 8);
      s = semantic ? 0.6 * slopTerm + 0.4 * (1 - stats.slopSim) : slopTerm;
      break;
    }
    case "story": {
      if (semantic) {
        s =
          0.3 * stats.elementsPresentRatio +
          0.35 * stats.ttcwPassRatio +
          0.15 * stats.windowOk +
          0.1 * stats.semDiversity +
          0.1 * (1 - stats.slopSim);
      } else {
        s = 0.4 * stats.elementsPresentRatio + 0.4 * stats.ttcwPassRatio + 0.2 * stats.windowOk;
      }
      break;
    }
    case "piece": {
      if (semantic) {
        s =
          0.35 * stats.conceptMentionRatio +
          0.25 * (1 - Math.min(1, stats.slopPer100 / 8)) +
          0.15 * stats.windowOk +
          0.25 * stats.semDiversity;
      } else {
        s = 0.5 * stats.conceptMentionRatio + 0.3 * (1 - Math.min(1, stats.slopPer100 / 8)) + 0.2 * stats.windowOk;
      }
      break;
    }
  }
  return clamp01(s);
}

export async function computePromptStats(
  probe: Probe,
  texts: string[],
  sem: SemanticsContext | null = null,
): Promise<PromptStats> {
  const dist = distinctStats(texts);
  const slops = texts.map(slopStats);
  const slopPer100 = mean(slops.map((s) => s.per100));
  const slopWeighted = mean(slops.map((s) => s.weighted));
  const words = texts.map(countWords);
  const wordCountMean = mean(words);
  const modal = modalShare(texts, probe);
  const river = riverShareOf(texts, probe.riverTokens);

  const stats: PromptStats = {
    probeId: probe.id,
    label: probe.label,
    score: 0,
    semantic: false,
    distinctRatio: dist.distinctRatio,
    distinctCount: dist.distinctCount,
    meanPairSim: dist.meanPairSim,
    modalShare: modal.share,
    modalLabel: modal.label,
    riverShare: river,
    slopPer100,
    slopWeighted,
    fluency: 0,
    adherence: 1,
    elementsPresentRatio: 0,
    ttcwPassRatio: 0,
    ttcwProgrammatic: 0,
    windowOk: 1,
    conceptMentionRatio: 0,
    wordCountMean,
    clicheProximity: 0,
    semDiversity: 0,
    minPairDist: 0,
    slopSim: 0,
    flexibility: 0,
    originality: 0,
    elaboration: 0,
  };

  switch (probe.kind) {
    case "short-answer":
      stats.fluency = texts.length;
      break;
    case "uses": {
      const usesList = texts.map(checkUses);
      stats.fluency = mean(usesList.map((u) => clamp01(u.uses / 8)));
      break;
    }
    case "word-list": {
      const letter = probe.letter ?? "b";
      const checks = texts.map((t) => checkWordList(t, letter, SEED_WORDS));
      stats.adherence = mean(
        checks.map((c) =>
          clamp01(1 - (c.badLetter + c.repeats + c.seedHits + c.properNounLike) / Math.max(1, c.count)),
        ),
      );
      stats.fluency = mean(checks.map((c) => clamp01(c.count / 25)));
      break;
    }
    case "story": {
      if (probe.elements) {
        const storyChecks = texts.map((t) => checkStory(t, probe.elements!, probe.wordTarget ?? null));
        stats.elementsPresentRatio = mean(storyChecks.map((c) => (c.total > 0 ? c.present / c.total : 0)));
        stats.windowOk = mean(storyChecks.map((c) => (c.windowOk ? 1 : 0)));
      }
      const ttcw = texts.map((t) => ttcwChecks(t, probe.wordTarget ?? null));
      const real = ttcw[0]?.filter((c) => !c.judgeOnly) ?? [];
      stats.ttcwProgrammatic = mean(
        ttcw.map((checks) => {
          const prog = checks.filter((c) => !c.judgeOnly);
          return prog.filter((c) => c.pass).length;
        }),
      );
      stats.ttcwPassRatio = mean(
        ttcw.map((checks) => {
          const prog = checks.filter((c) => !c.judgeOnly);
          return prog.length > 0 ? prog.filter((c) => c.pass).length / prog.length : 0;
        }),
      );
      void real;
      break;
    }
    case "piece": {
      const mentions = texts.map((t) => checkMentions(t, probe.mentions ?? [], probe.forbid ?? []));
      stats.conceptMentionRatio = mean(mentions.map((m) => m.mentionRatio));
      if (probe.wordTarget) {
        const [lo, hi] = probe.wordTarget;
        stats.windowOk = mean(words.map((w) => (w >= lo * 0.85 && w <= hi * 1.15 ? 1 : 0)));
      }
      break;
    }
  }

  if (sem && texts.length > 0) {
    try {
      const vecs = await sem.embedder.embed(texts);
      stats.semantic = true;
      stats.distinctCount = clusterCount(vecs);
      stats.distinctRatio = stats.distinctCount / texts.length;
      stats.semDiversity = clamp01(meanPairwiseDistance(vecs) / 0.8);
      stats.minPairDist = clamp01(minPairwiseDistance(vecs) / 0.8);
      stats.clicheProximity = mean(vecs.map((v) => maxSimToSet(v, sem.canon.timeVecs.map((e) => e.vec))));
      stats.slopSim = mean(vecs.map((v) => maxSimToSet(v, sem.canon.slopVecs)));
      if (probe.kind === "uses") {
        const lines = texts.flatMap((t) => checkUses(t).lines.slice(0, 12));
        if (lines.length > 0) {
          const lineVecs = await sem.embedder.embed(lines);
          const typical = sem.canon.typical[probe.id];
          if (typical && typical.length > 0) {
            stats.originality = clamp01(1 - mean(lineVecs.map((v) => maxSimToSet(v, typical))));
          }
          stats.flexibility = clamp01(clusterCount(lineVecs, 0.7) / 8);
          stats.elaboration = clamp01(mean(lines.map((l) => countWords(l))) / 12);
        }
      }
      if (probe.kind === "short-answer" && probe.id !== "time-metaphor") {
        stats.clicheProximity = 0;
      }
    } catch {
      stats.semantic = false;
    }
  }

  stats.score = scoreFromStats(probe, stats, stats.semantic, null);
  return stats;
}
