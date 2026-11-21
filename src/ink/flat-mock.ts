const TIER_LABELS = [
  "Tier 1 Mode Collapse Probe",
  "Tier 2 Constrained Divergence",
  "Tier 3 Slop Resistance",
  "Tier 4 Literature Craft",
  "Tier 5 Associative Leap",
];

const TIER_PROMPTS = [5, 4, 4, 3, 3];
const TIER_WEIGHTS = [0.25, 0.2, 0.2, 0.2, 0.15];

function pad(s: string, w: number): string {
  return s.length <= w ? s.padEnd(w) : s.slice(0, w - 3) + "...";
}

export async function runMockFlat(seed = 20260101): Promise<void> {
  const lines: string[] = [];
  lines.push("AIEA MOCK RUN | synthetic data | no model ran");
  lines.push(`model mock-model (synthetic) | suite creativity | seed ${seed}`);
  lines.push("(run from a real terminal for the interactive Ink UI: bun run dev:mock)");
  lines.push("");
  let aci = 0;
  for (let ti = 0; ti < TIER_LABELS.length; ti++) {
    const tierScore = 0.35 + ((ti * 7 + seed) % 40) / 100;
    for (let p = 0; p < TIER_PROMPTS[ti]!; p++) {
      await new Promise((r) => setTimeout(r, 35));
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
  process.stdout.write(lines.join("\n") + "\n");
}
