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
**AIEA-Creativity Index (ACI)** is the weighted mean over tiers, 0-100. Two scoring
engines coexist and the report says which one ran:

**Semantic engine (active when the embedder starts).** A small embedding model
(nomic-embed-text-v1.5, GGUF, ~150 MB, served with `--embeddings --pooling mean`) turns
every sample into a unit vector. On top of it:

- **Cliche proximity** (mode-collapse detector): max cosine similarity of each sample
  against a canonical exemplar set covering the classic time-metaphor clusters - river,
  weaving, sands, thief, arrow, devourer, cage, painting, journey (Artificial Hivemind).
  Tier 1 weights it at 35%.
- **Semantic diversity** (DAT / Forward Flow, Olson et al., PNAS 2021): mean pairwise
  cosine distance between samples, normalized; plus worst-pair distance. Drives tiers 1,
  4, 5 and the word task.
- **AUT originality** (SemDis method, Beaty & Johnson 2020): distance between each
  generated use and a canon of *typical uses* for the object (brick, paperclip, coffee
  cup). Tier 2 uses score fluency, flexibility (semantic cluster count), originality,
  elaboration.
- **Slop similarity**: samples are also compared against exemplar AI-slop sentences,
  combined with the weighted lexicon density in tier 3 and tier 4.
- **Distinct clusters** replace token clusters: samples are grouped at cosine 0.75.

**Judge engine (optional).** With `judge` configured, a second llama-server scores
response grouping on tiers 1-2 (NoveltyBench-style idea clusters) and the six
judgment-dependent TTCW tests on tier 4, and the affected score terms are recomputed
from the same formula (`scoreFromStats`) so judge and heuristics cannot drift.

**Token fallback (no embedder).** Token jaccard (45%) + character bigram Dice (55%),
similarity below 0.6 counts as distinct; the tier formulas shift to their heuristic
weights. Every run reports which engine was active, and the report prints the semantic
measures per prompt.

**Always on:** modal share and river share (tier 1), rule adherence (tier 2), the
weighted slop lexicon, TTCW programmatic tests, word windows, and forbidden-token checks
(tier 5).

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

The interactive path is built with [Ink](https://github.com/vadimdemedes/ink) 7 (React for
terminals). It is a full-screen, borderless command shell in the style of a type-driven
eval CLI: white text on the terminal background, gray for secondary information, and a
heart-red to deep-red gradient as the only accent (wordmark, bars, spinner, ACI number,
selection arrow). The arrow glyph is `❯` everywhere. Nothing is boxed except the input
line at the bottom of the screen.

`bun run aiea` opens the shell. Commands:

```
help                          all commands
run <model>                   run the creativity suite on one model
run <suite> <model>           run a specific suite on one model
run all [suite]               every configured model, one by one
mock [model] | mock all       synthetic runs, no model needed
models                        list configured models
suites                        list available suites
teacher <model|none>          set the judge model for scored tiers
samples <n>                   samples per prompt
seed <n>                      reproducible runs
setup                         guided specimen + teacher + config wizard
clear | exit
```

The home screen auto-loads and renders the Models Available and Suites Available tables
on start, with a live clock in the header. Every arrow glyph is the off-white `❯`; the
only gradient accents are the flowing AIEA wordmark, bars, spinner, and ACI number.

Type a command into the `❯` input box at the bottom. The input has command-prefix
suggestions and arrow-key history. `teacher`, `samples` and `seed` persist for the
session, so after the first setup a whole model lineup runs with three keystrokes.

When a run starts, the input is replaced by the live run view: per-tier gradient progress
bars (prompts and samples), a spinner on the active sample, a "latest prompt" metrics
card, and a rolling log. `q` or `esc` aborts; a partial report is still written. The
summary view shows the ACI, a tier table, run-level metrics, and a per-prompt metrics
table for every tier (distinct, modal share, river share, slop density), then returns to
the command shell.

`bun run dev:mock` runs the exact same shell in mock mode: synthetic student, synthetic
teacher, fabricated outputs and metrics at accelerated speed. In mock mode every command
works (`run all`, `teacher`, `samples`...) so the full workflow can be reviewed without a
GPU. Headless (non-TTY) invocations fall back to flat mock lines automatically.

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

Single-GPU budget (T4, 16 GB), worst case per run:

- student model, Q4_K_M: Spark-X2.6-4B 2.62 GB / K2-Horizon-3.7B 3.25 GB / Qwen3.5-4B ~2.5 GB
- KV cache at 8192 context: well under 1 GB
- embedder (nomic-embed Q8_0): ~0.15 GB
- teacher: 0 GB during generation - `judge_mode: sequential` (the default) fully releases
  the student server before the judge loads, so two big models are never resident at the
  same time; the judge phase runs after generation finishes

Both Spark-X2.6-4B and K2-Horizon-3.7B are reasoning models and both declare enormous
native context windows (1M and 512K); their configs pin `context: 8192` deliberately and
disable thinking with `reasoning.effort: none`. The suite YAMLs control everything else.

## Status and honest gaps

- Heuristic scoring path: implemented and smoke-tested (config loading, HF file
  resolution, metrics, planning, report and leaderboard writing).
- Semantic scoring path: implemented (canon precompute, embeddings client, semantic
  formulas, graceful token fallback) but never yet exercised against a live
  llama-server; first VM session must verify the `/v1/embeddings` round trip and the
  nomic-embed serving flags (`--embeddings --pooling mean`; older builds may want
  `--embedding`).
- Sequential judge phase: implemented (student released before judge loads) but
  unverified end to end.
- Ink interactive UI: implemented and typechecked; JSX/Ink/React render pipeline verified
  under Bun with a component probe. Full TTY walkthrough (arrow keys, config forms, live
  run screen) still needs one real-terminal session to confirm.
- HF download path: implemented with resume-less chunked download; it has not been
  exercised on a real network run yet. First VM session should verify it.

## License

Not yet decided. All rights reserved by the repository owner until a license is added.
