# AIEA

Asa Intelligence Evaluation and Analysis. A local-first benchmark runner for open-weight
language models served by llama.cpp. The first suite is **AIEA-Creativity (AIEA-C)**.

Nothing here hardcodes a model, a sampling value, or a prompt count. Everything lives in
drop-in YAML configs.

## Why creativity, and why this shape

The design is anchored on published findings about LLM mode collapse:

- **Artificial Hivemind** (Jiang et al., NeurIPS 2025) had 25 models each write 50
  metaphors about time; the vast majority collapsed to "time is a river". That exact probe
  opens our benchmark, and that exact failure has its own tracked metric.
- **NoveltyBench** (Zhang et al.) measures `distinctk` (how many of k samples are
  meaningfully different) and `utilityk` (good AND new). We adopt the sampling protocol
  and the distinct-count metric.
- **Springboards' Flint** write-up ("How we built Flint") shows that turning temperature up
  destroys coherence before novelty appears; so AIEA-C always scores divergence and
  quality separately, never as one blended "vibe" number.
- **TTCW** (Chakrabarty et al., "Art or Artifice?") supplies the 14-test creative-writing
  checklist; we implement the programmatically checkable subset locally and leave the
  judgment-dependent tests to the optional judge model.
- **Lech Mazur's divergent and writing benchmarks** inform tier 2 (constrained word
  generation with rule adherence) and tier 4 (mandatory-element briefs with a word window).

## The five tiers

| Tier | Name | What it does | Difficulty |
|---|---|---|---|
| 1 | Mode Collapse Probe | metaphor about time, number 1-10, band name, pizza topping, one city. X samples each | easy |
| 2 | Constrained Divergence | alternative uses test x3, plus 25 maximally-unrelated words with letter and seed-list constraints | medium |
| 3 | Slop Resistance | prose scenes written under trap conditions; scored by a weighted AI-cliche lexicon | medium-hard |
| 4 | Literature Craft | 600-800 word stories with six mandatory elements each; TTCW programmatic tests | hard |
| 5 | Associative Leap | bind unrelated concepts into one piece with hard exclusions | hardest |

Default plan: 5 samples per prompt, 19 prompts, 95 generations per run. All counts are
config values, not constants.

## Scoring

Every prompt yields a 0-1 score; tier score is the mean over its prompts; the composite
**AIEA-Creativity Index (ACI)** is the weighted mean over tiers, 0-100.

- **Distinctness**: token Jaccard (45%) + character bigram Dice (55%); a sample counts as
  distinct when its max similarity to any other sample is below 0.6. With a judge model
  configured, NoveltyBench-style idea clustering replaces the heuristic for tiers 1-2.
- **Modal share** (tier 1): fraction of samples that fall in the same answer cluster,
  including the canonical "time is a river" cluster tracked separately as **river share**.
- **Slop density**: weighted lexicon hits (words and phrases: tapestry, testament to,
  beacon of, symphony of, shivers down, breath she didn't know she was holding, ...) per
  100 generated words.
- **Rule adherence** (tier 2): wrong letter, repeats, seed-list collisions, proper nouns.
- **TTCW pass rate** (tier 4): dialogue, sensory detail, sentence-length variance, lexical
  richness, stock opening, slop density, concrete specifics, word window; the six
  judge-only tests activate when a judge is configured.
- **Concept binding** (tier 5): required concept mentions, forbidden-word violations,
  length window.

## Install

Requires [Bun](https://bun.sh). No npm, no npx, no other runtime.

```
bun install
bun run typecheck
bun run scripts/smoke-cli.ts
```

## Usage

```
bun run aiea          # interactive Ink UI: specimen, teacher, configs, run
bun run dev:mock      # same UI with synthetic data; no model needed
bun run aiea run --model qwen3.5-4b-q4
bun run aiea run --model qwen3.5-4b-q4 --dry
bun run aiea run --model qwen3.5-4b-q4 --samples 8 --seed 42 --json
bun run aiea models list
bun run aiea models download qwen3.5-2b-q4
bun run aiea results
bun run aiea results latest
```

`bun run aiea run` works headless (no TTY) and prints flat progress lines, so it can be
launched over ssh or inside a Colab VM session without an interactive terminal.

## Interactive UI

The interactive path is built with [Ink](https://github.com/vadimdemedes/ink) (React for
terminals). `bun run aiea` walks through:

1. **Specimen** - pick the model under test from `configs/models/`.
2. **Specimen config** - edit temperature, top_p, top_k, min_p, repeat penalty, context,
   GPU layers, port, reasoning effort. Edits are run-scoped overrides; YAMLs are not
   rewritten.
3. **Teacher** - pick the judge model, or "none" for heuristic-only scoring.
4. **Teacher config** - same fields, applied to the judge server via run-scoped overrides.
5. **Suite** - confirm samples per prompt and run seed.
6. **Run screen** - live per-tier progress bars (prompts and samples), spinner on the
   active sample, a "latest prompt" metrics card, and a rolling log pane. `q` or `esc`
   aborts; a partial report is still written.
7. **Summary screen** - the ACI, a tier table, run-level metrics, and a per-prompt
   metrics table for every tier (distinct, modal share, river share, slop density).

`bun run dev:mock` runs the exact same flow with a synthetic student, a synthetic
teacher, fabricated outputs, and fabricated metrics, at accelerated speed. It exists so
the UI can be reviewed without a GPU. Headless (non-TTY) invocations fall back to flat
mock lines automatically.

## The llama binary

Resolution order, first hit wins:

1. `AIEA_LLAMA_BIN` environment variable (path to `llama-server` or the unified `llama`)
2. `runtime.binary` in the model config (if not `auto`)
3. `llama-server` / `llama` on PATH
4. `./llama/llama-server` or `./llama/llama` (extracted prebuilt release binaries)
5. project root

The unified `llama` binary is auto-detected and invoked as `llama serve ...`; the classic
`llama-server` is invoked directly. Windows `.exe` suffixes are tried automatically.

## Model configs

Drop a YAML file into `configs/models/`. Minimal form:

```yaml
name: qwen3.5-4b-q4
hf: lmstudio-community/Qwen3.5-4B-GGUF
quant: Q4_K_M
reasoning:
  effort: none
sampling:
  temperature: 0.9
  top_p: 0.95
  top_k: 40
  min_p: 0.05
  repeat_penalty: 1.05
runtime:
  binary: auto
  port: 8750
  context: 8192
  ngl: 99
```

- `hf` accepts a repo id or URL; the downloader lists the repo via the HF API and picks
  the file whose name contains the `quant` tag (exact `base-quant.gguf` preferred,
  sharded repos supported, `mmproj` files excluded).
- `file` pins an exact filename instead of the quant tag. `local_path` skips the network
  entirely and points at a gguf on disk.
- `reasoning.effort: none` maps to llama.cpp's `--reasoning-budget 0` plus
  `--chat-template-kwargs {"enable_thinking": false}`. The OpenAI-style
  `reasoning_effort` request field is not supported by llama-server, which is why this
  mapping is explicit. Models without thinking tokens are unaffected.
- Sampling fields are passed per request: temperature, top_p, top_k, min_p,
  repeat_penalty. Seeds are derived per sample (run seed, tier, prompt, sample index) so
  every run is reproducible and samples never share a seed.

## Suite configs

`benchmarks/creativity.yaml` controls everything: `samples_per_prompt`, `seed`,
per-tier `prompts` count, `max_tokens`, `word_window`, tier `weights`, and the judge slot:

```yaml
judge: null            # or judge: { model: qwen3.5-4b-q4 }
```

With a judge configured, the runner spawns a second llama-server (port +1 if the judge
config uses the same port) and uses it for idea clustering on tiers 1-2 and the six
judgment-dependent TTCW tests on tier 4. If the judge fails to start or errors, the run
falls back to heuristic scoring with a log line saying so.

## Results

Each run writes `results/<run-id>/`:

- `report.md` human-readable report with the ACI, tier table, per-prompt metrics and
  sample excerpts
- `report.json` full machine-readable record including every raw sample
- `samples.jsonl` one line per generation
- `llama-server.log` server stderr/stdout

`results/leaderboard.json` accumulates one entry per run, sorted by ACI.

## Where experiments run

This repository is developed on a weak machine that never runs models. Actual benchmark
runs are executed on a dedicated GPU VM (typically a Colab T4): clone the repo, install
Bun, run `bun run aiea models download <name>`, then `bun run aiea run --model <name>`.
The `-ngl 99` default offloads all layers; on a T4 use the 2B config for comfort and the
4B config with `runtime.ngl` lowered if memory is tight.

## Status and honest gaps

- Heuristic scoring path: implemented and smoke-tested (config loading, HF file
  resolution, metrics, planning, report and leaderboard writing).
- Ink interactive UI: implemented and typechecked; JSX/Ink/React render pipeline verified
  under Bun with a component probe. Full TTY walkthrough (arrow keys, config forms, live
  run screen) still needs one real-terminal session to confirm.
- Judge path: fully wired but only exercisable once a judge model is configured; treat it
  as unverified until then.
- HF download path: implemented with resume-less chunked download; it has not been
  exercised on a real network run yet. First VM session should verify it.

## License

Not yet decided. All rights reserved by the repository owner until a license is added.
