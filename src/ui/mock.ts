import { emptyRunViewState, createRunConsole, sleep, failConsole, type RunConsole } from "./runscreen";
import { pad } from "./ansi";
import type { TierRow } from "./runscreen";

const TIER_LABELS = [
  "Tier 1 Mode Collapse Probe",
  "Tier 2 Constrained Divergence",
  "Tier 3 Slop Resistance",
  "Tier 4 Literature Craft",
  "Tier 5 Associative Leap",
];

const TIER_PROMPTS = [5, 4, 4, 3, 3];
const TIER_WEIGHTS = [0.25, 0.2, 0.2, 0.2, 0.15];

const LOG_POOL = [
  "sample {s}/{S} complete :: {tok} tok/s :: distinct {d}/{S}",
  "pairwise sim {sim} :: clusters {cl}",
  "modal share {ms}% :: top answer \"{top}\"",
  "river cluster hit {rh}/5",
  "slop check: {sl} weighted hits / 100 words",
  "ttcw programmatic: {tc}/8 pass",
  "word-list adherence {ad}% :: {bl} rule violations",
  "elements present {el}/6 :: window ok",
  "judge clustering: {jg}/{S} groups",
];

const TOPS = ["7", "3", "river of time", "The Static", "anchovy and pear", "Kyoto", "9", "The Bells"];

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length]!;
}

export async function runMock(seed = 20260101): Promise<void> {
  const state = emptyRunViewState({
    model: "mock-model (synthetic)",
    suite: "creativity",
    seed,
    mock: true,
    tierLabels: TIER_LABELS,
    samplesPerPrompt: 5,
  });
  state.tiers.forEach((t: TierRow, i) => {
    t.promptsTotal = TIER_PROMPTS[i]!;
    t.samplesTotal = TIER_PROMPTS[i]! * 5;
  });
  const c: RunConsole = createRunConsole(state);
  const t0 = performance.now();
  const scores: number[] = [];
  try {
    let step = 0;
    for (let ti = 0; ti < TIER_LABELS.length; ti++) {
      const tier = state.tiers[ti]!;
      const tierScore = 0.35 + ((ti * 7 + seed) % 40) / 100;
      for (let p = 0; p < TIER_PROMPTS[ti]!; p++) {
        for (let s = 0; s < 5; s++) {
          step++;
          state.active = {
            tierLabel: tier.label,
            promptLabel: `prompt ${p + 1}/${tier.promptsTotal}`,
            sampleIdx: s + 1,
            samplesTotal: 5,
          };
          await sleep(45);
          state.elapsedMs = performance.now() - t0;
          if (s === 4 || step % 2 === 0) {
            const line = pick(LOG_POOL, step)
              .replaceAll("{s}", String(s + 1))
              .replaceAll("{S}", "5")
              .replaceAll("{tok}", String(40 + ((step * 13) % 45)))
              .replaceAll("{d}", String(2 + (step % 4)))
              .replaceAll("{sim}", (0.2 + ((step * 7) % 30) / 100).toFixed(2))
              .replaceAll("{cl}", String(3 + (step % 4)))
              .replaceAll("{ms}", String(20 + ((step * 11) % 50)))
              .replaceAll("{top}", pick(TOPS, step))
              .replaceAll("{rh}", String(step % 3))
              .replaceAll("{sl}", (0.5 + ((step * 17) % 60) / 10).toFixed(1))
              .replaceAll("{tc}", String(4 + (step % 5)))
              .replaceAll("{bl}", String(step % 3))
              .replaceAll("{el}", String(4 + (step % 3)))
              .replaceAll("{ad}", String(88 + (step % 12)))
              .replaceAll("{jg}", String(4 + (step % 5)));
            c.log(line);
          }
          tier.samplesDone++;
          c.render();
        }
        tier.promptsDone++;
        tier.score = tierScore * (0.85 + (p % 3) * 0.075);
        c.log(`prompt complete :: tier score ${(tier.score! * 100).toFixed(1)}`);
        c.render();
      }
      scores.push(tier.score!);
      c.log(`tier complete: ${tier.label}`);
      c.render();
    }
    const aci = scores.reduce((acc, s, i) => acc + s * TIER_WEIGHTS[i]!, 0) * 100;
    state.active = null;
    state.aci = aci;
    state.status = "done";
    state.elapsedMs = performance.now() - t0;
    c.log(`MOCK COMPLETE :: AIEA-Creativity Index ${aci.toFixed(1)} / 100`);
    c.log("no model ran; every number above is synthetic");
    c.render();
    c.close();
  } catch (err) {
    failConsole(c, err as Error);
  }
}

export async function runMockFlat(seed = 20260101): Promise<void> {
  const lines: string[] = [];
  lines.push("AIEA MOCK RUN | synthetic data | no model ran");
  lines.push(`model mock-model (synthetic) | suite creativity | seed ${seed}`);
  lines.push("");
  let step = 0;
  let aci = 0;
  for (let ti = 0; ti < TIER_LABELS.length; ti++) {
    const tierScore = 0.35 + ((ti * 7 + seed) % 40) / 100;
    for (let p = 0; p < TIER_PROMPTS[ti]!; p++) {
      for (let s = 0; s < 5; s++) {
        step++;
        await sleep(35);
      }
      step++;
      lines.push(
        `MOCK ${TIER_LABELS[ti]} | prompt ${p + 1}/${TIER_PROMPTS[ti]} | score ${((tierScore * (0.85 + (p % 3) * 0.075)) * 100).toFixed(1)}`,
      );
    }
    aci += tierScore * TIER_WEIGHTS[ti]!;
  }
  lines.push("");
  lines.push(`AIEA-Creativity Index: ${(aci * 100).toFixed(1)} / 100 (synthetic)`);
  lines.push("tier breakdown:");
  TIER_LABELS.forEach((l, i) => {
    const tierScore = 0.35 + ((i * 7 + seed) % 40) / 100;
    lines.push(`  ${pad(l, 32)} weight ${TIER_WEIGHTS[i]!.toFixed(2)} score ${(tierScore * 100).toFixed(1)}`);
  });
  lines.push("");
  lines.push("This is the exact run screen you will see with a real model; TTY terminals");
  lines.push("get the live panel version instead of these lines.");
  process.stdout.write(lines.join("\n") + "\n");
}
