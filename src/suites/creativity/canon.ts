export interface CanonCluster {
  label: string;
  exemplars: string[];
}

export const TIME_CANON: CanonCluster[] = [
  {
    label: "river-flow",
    exemplars: [
      "Time is a river.",
      "Time flows like a river to the sea.",
      "Time is a stream that carries us along.",
    ],
  },
  {
    label: "weaving",
    exemplars: [
      "Time weaves a tapestry of days.",
      "The loom of hours threads our lives together.",
    ],
  },
  {
    label: "sand-glass",
    exemplars: [
      "Time is sand slipping through an hourglass.",
      "The sands of time are running out.",
    ],
  },
  {
    label: "thief-money",
    exemplars: [
      "Time is a thief that steals our years.",
      "Time is money.",
      "Time is a currency you can only spend.",
    ],
  },
  {
    label: "speed-motion",
    exemplars: [
      "Time is an arrow flying forward.",
      "Time is a speeding train that never stops.",
      "Time marches on.",
    ],
  },
  {
    label: "devourer-decay",
    exemplars: [
      "Time devours all things.",
      "Time is a monster that eats the years.",
    ],
  },
  {
    label: "cage-prison",
    exemplars: [
      "Time is a prison with no doors.",
      "Time locks us in chains of routine.",
    ],
  },
  {
    label: "art-image",
    exemplars: [
      "Time is a photograph slowly fading.",
      "Time paints a canvas of memories.",
    ],
  },
  {
    label: "road-journey",
    exemplars: [
      "Time is a road we all must walk.",
      "Time is a journey from birth to death.",
    ],
  },
];

export const TYPICAL_USES: Record<string, string[]> = {
  "au-brick": [
    "build a wall",
    "build a house",
    "throw through a window",
    "paperweight",
    "doorstop",
    "hammer for nails",
    "step stool",
    "projectile in a riot",
  ],
  "au-paperclip": [
    "hold papers together",
    "pick a lock",
    "bookmark for a book",
    "pull a zipper",
    "reset an electronics button",
    "fuse wire",
    "hang ornaments",
    "uncork a small bottle",
  ],
  "au-coffee-cup": [
    "drink coffee",
    "pen and pencil holder",
    "small plant pot",
    "measuring cup in a pinch",
    "candle holder",
    "soup bowl",
    "paperweight",
    "paint water pot",
  ],
};

export const SLOP_EXEMPLARS: string[] = [
  "The sunset painted the sky in breathtaking hues of gold and crimson.",
  "A single tear rolled down her cheek as she realized the depth of his sacrifice.",
  "The town was a tapestry of vibrant cultures woven together over centuries.",
  "Her heart pounded like a drum as a shiver ran down her spine.",
  "Little did she know, everything was about to change.",
  "The air was thick with tension as the weight of his words settled over the room.",
  "In the heart of the city, a beacon of hope shone as a testament to their resilience.",
  "It was then that she understood the true meaning of family.",
  "The forest was a symphony of sounds, a dance of light and shadow.",
  "He couldn't help but feel a sense of wonder at the ethereal beauty of the scene.",
];
