export interface Probe {
  id: string;
  label: string;
  kind: "short-answer" | "uses" | "word-list" | "prose" | "story" | "piece";
  text: string;
  clusters?: string[][];
  clusterLabels?: string[];
  riverTokens?: string[];
  letter?: string;
  elements?: Array<{ name: string; value: string }>;
  mentions?: string[];
  forbid?: string[];
  wordTarget?: [number, number];
}

export const T1_PROBES: Probe[] = [
  {
    id: "time-metaphor",
    label: "metaphor about time",
    kind: "short-answer",
    text: "Write a metaphor about time. Reply with only the metaphor sentence. No explanation.",
    clusters: [
      ["river", "stream", "flows", "flowing", "current", "tide", "waterfall", "ocean", "sea"],
      ["weave", "woven", "weaving", "thread", "loom", "tapestry", "knit", "fabric"],
      ["sand", "sands", "hourglass", "grain", "grains", "glass"],
      ["thief", "steal", "steals", "stole", "stolen", "budget", "money", "gold", "coin", "coins", "commodity", "currency", "spend", "spends", "wallet", "bank"],
      ["arrow", "bullet", "train", "race", "racing", "speed", "fast", "sprint"],
      ["monster", "devour", "devours", "predator", "decay", "wither", "withers", "rot", "rust", "swallow"],
      ["cage", "prison", "chains", "bars", "shackle", "shackles", "trap"],
      ["picture", "image", "canvas", "painting", "photograph", "film", "sculpture"],
      ["journey", "road", "path", "highway", "traveler", "travel", "walk", "steps"],
    ],
    clusterLabels: [
      "river-flow",
      "weaving",
      "sand-glass",
      "thief-money",
      "speed-motion",
      "devourer-decay",
      "cage-prison",
      "art-image",
      "road-journey",
    ],
    riverTokens: ["river", "stream", "flows", "flowing", "current", "tide", "waterfall", "ocean", "sea"],
  },
  {
    id: "number-1-10",
    label: "number between 1 and 10",
    kind: "short-answer",
    text: "Pick a number between 1 and 10. Reply with only the number.",
  },
  {
    id: "band-name",
    label: "band name for funeral polka",
    kind: "short-answer",
    text: "Suggest a name for a band that plays funeral polka. Reply with only the name.",
  },
  {
    id: "pizza-topping",
    label: "daring pizza topping",
    kind: "short-answer",
    text: "Name one pizza topping a daring chef would serve. Reply with only the topping.",
  },
  {
    id: "one-city",
    label: "one city for a one-day trip",
    kind: "short-answer",
    text: "A traveler has exactly one day in a foreign city of your choice. Name the city. Reply with only the city name.",
  },
];

export const T2_PROBES: Probe[] = [
  {
    id: "au-brick",
    label: "alternative uses of a brick",
    kind: "uses",
    text: "List 8 uses for a brick that have nothing to do with walls, buildings, or construction. Number each use on its own line. No explanations.",
  },
  {
    id: "au-paperclip",
    label: "alternative uses of a paperclip",
    kind: "uses",
    text: "List 8 uses for a paperclip that have nothing to do with holding paper. Number each use on its own line. No explanations.",
  },
  {
    id: "au-coffee-cup",
    label: "alternative uses of a coffee cup",
    kind: "uses",
    text: "List 8 uses for an empty coffee cup that have nothing to do with drinking. Number each use on its own line. No explanations.",
  },
  {
    id: "words-25",
    label: "25 maximally unrelated words starting with b",
    kind: "word-list",
    text: [
      "Here are 50 random words:",
      "apple anchor basket bottle bridge butter candle chair cloud compass desk door envelope engine fan feather forest garden grape hammer hinge island jar jacket kettle key ladder leaf magnet mirror mountain nail needle onion ocean pepper pillow quilt river rope salt stone table train umbrella vine violin whistle window yarn",
      "",
      "Generate 25 English words that all start with the letter b.",
      "Rules:",
      "1. No proper nouns.",
      "2. No hyphenated words.",
      "3. Every word must be maximally unrelated to every other word you list.",
      "4. Every word must also be unrelated to all 50 words above.",
      "5. One word per line, no numbering, no explanations.",
    ].join("\n"),
    letter: "b",
  },
];

export const T3_PROBES: Probe[] = [
  {
    id: "scene-harbor-sunset",
    label: "harbor sunset, no stock images",
    kind: "prose",
    text: "Write a 150-word scene: a summer sunset over a working harbor, seen by a woman who is waiting for someone who will not come. Banned: golden, painting, palette, tapestry, canvas, fire in the sky, mother-of-pearl. Concrete detail only.",
    wordTarget: [110, 190],
  },
  {
    id: "scene-keeper-death",
    label: "lighthouse keeper death, no sentimentality",
    kind: "prose",
    text: "Write a 150-word scene: the death of an old lighthouse keeper, witnessed only by his dog. No sentimentality. Banned: sleep metaphors, journey metaphors, going home metaphors, tears.",
    wordTarget: [110, 190],
  },
  {
    id: "novel-laundromat-3am",
    label: "novel opening, laundromat at 3 AM",
    kind: "prose",
    text: "Write the first paragraph of a literary novel set in a laundromat at 3 AM. Do not open with weather, time of day, an alarm, or a description of the room. Start with a person doing something.",
    wordTarget: [90, 170],
  },
  {
    id: "scene-first-kiss",
    label: "first kiss without light or electricity",
    kind: "prose",
    text: "Describe a first kiss in 120 words without using light, electricity, sparks, fire, taste metaphors, or the phrase time stopped.",
    wordTarget: [90, 160],
  },
];

export const T4_PROBES: Probe[] = [
  {
    id: "brief-storm-chaser",
    label: "brief: retired storm-chaser",
    kind: "story",
    text: [
      "Write a complete short story of 600-800 words.",
      "It must meaningfully incorporate ALL of the following elements:",
      "- Character: a retired storm-chaser",
      "- Object: a broken barometer",
      "- Setting: a flooded county fairground",
      "- Timeframe: three days after the water recedes",
      "- Motivation: she wants to find the person who looted her truck",
      "- Tone: wry grief",
      "The object must affect the plot. The motivation must force a choice. The tone must shape how the story is told. No preamble, no title, just the story.",
    ].join("\n"),
    elements: [
      { name: "character", value: "storm" },
      { name: "object", value: "barometer" },
      { name: "setting", value: "fair" },
      { name: "timeframe", value: "three days" },
      { name: "motivation", value: "truck" },
      { name: "tone", value: "grief" },
    ],
  },
  {
    id: "brief-bakery-dress",
    label: "brief: night-shift baker",
    kind: "story",
    text: [
      "Write a complete short story of 600-800 words.",
      "It must meaningfully incorporate ALL of the following elements:",
      "- Character: a night-shift bakery worker",
      "- Object: a borrowed wedding dress",
      "- Setting: a mountain town about to lose its only road",
      "- Timeframe: the last week before demolition",
      "- Motivation: she wants to return the dress before a wedding she was never invited to",
      "- Tone: tender mischief",
      "The object must affect the plot. The motivation must force a choice. The tone must shape how the story is told. No preamble, no title, just the story.",
    ].join("\n"),
    elements: [
      { name: "character", value: "bakery" },
      { name: "object", value: "dress" },
      { name: "setting", value: "road" },
      { name: "timeframe", value: "demolition" },
      { name: "motivation", value: "wedding" },
      { name: "tone", value: "mischief" },
    ],
  },
  {
    id: "brief-chess-hustler",
    label: "brief: aging chess hustler",
    kind: "story",
    text: [
      "Write a complete short story of 600-800 words.",
      "It must meaningfully incorporate ALL of the following elements:",
      "- Character: an aging chess hustler",
      "- Object: a pocket watch that no longer runs",
      "- Setting: a bus station in a snowstorm",
      "- Timeframe: New Year's Eve",
      "- Motivation: he wants to lose one last game on purpose",
      "- Tone: quiet triumph",
      "The object must affect the plot. The motivation must force a choice. The tone must shape how the story is told. No preamble, no title, just the story.",
    ].join("\n"),
    elements: [
      { name: "character", value: "chess" },
      { name: "object", value: "watch" },
      { name: "setting", value: "bus" },
      { name: "timeframe", value: "new year" },
      { name: "motivation", value: "lose" },
      { name: "tone", value: "triumph" },
    ],
  },
];

export const T5_PROBES: Probe[] = [
  {
    id: "grief-chess",
    label: "explain grief via chess rules",
    kind: "piece",
    text: "Explain grief using only the rules of chess, in 250 words. You may never use the word chess or any piece name as a label for a person. Concrete rules only: castling, en passant, promotion, stalemate. End with one sentence of your own invention that a chess player would understand and a grieving person would feel.",
    mentions: ["grief"],
    forbid: ["chess"],
    wordTarget: [180, 330],
  },
  {
    id: "glacier-lighthouse",
    label: "glacier and lighthouse love story",
    kind: "piece",
    text: "Write a 250-word love story between a glacier and a lighthouse. Neither may speak, think, or remember. Only their physical behavior over centuries may imply the story. No human characters.",
    mentions: ["glacier", "lighthouse"],
    wordTarget: [180, 330],
  },
  {
    id: "ad-silence",
    label: "advertisement for silence",
    kind: "piece",
    text: "Write a 200-word advertisement for silence. It must obey the grammar of a real advertisement: a promise, a demonstration, and it must end with a specific price. No words may appear twice except articles and prepositions.",
    mentions: ["silence", "price"],
    wordTarget: [140, 280],
  },
];

const BANKS: Record<string, Probe[]> = {
  t1_mode_collapse: T1_PROBES,
  t2_constrained_divergence: T2_PROBES,
  t3_slop_resistance: T3_PROBES,
  t4_literature_craft: T4_PROBES,
  t5_associative_leap: T5_PROBES,
};

export function tierPrompts(tierId: string): Probe[] {
  return BANKS[tierId] ?? [];
}
