/**
 * @file The two scorecard formats, Bullseye and 3D, and the rotation of animals
 * an archer follows in 3D.
 */

export const SCORECARD_FORMATS = ["bullseye", "3d"] as const;

/** What a scorecard was shot at. */
export type ScorecardFormat = (typeof SCORECARD_FORMATS)[number];

/** How each format is written on the page and in exports. */
export const FORMAT_LABELS: Readonly<Record<ScorecardFormat, string>> = Object.freeze({
  bullseye: "Bullseye",
  "3d": "3D",
});

/** The 3D targets, in the order an archer on the left side moves through them. */
export const ANIMALS = [
  "Alert Turkey",
  "Coyote",
  "Cinnamon Bear / Black Bear",
  "Pronghorn Antelope",
  "Alert Deer / White-tailed Deer",
  "Standing Stone Sheep / Mountain Sheep",
] as const;

export type Animal = (typeof ANIMALS)[number];

export const SIDES = ["left", "right"] as const;

/** The side of the 3D range an archer shot from. It sets which way they move. */
export type Side = (typeof SIDES)[number];

/** How each side is written on the page and in exports. */
export const SIDE_LABELS: Readonly<Record<Side, string>> = Object.freeze({
  left: "Left",
  right: "Right",
});

/** Where the most recently chosen format is remembered. */
const FORMAT_STORAGE_KEY = "nasp-scorecard-format";

/**
 * Lists the animal for each round. After each round the archer moves to the
 * next animal: from the turkey toward the sheep on the left side, and from the
 * sheep toward the turkey on the right. At the end of the line they go back to
 * the other end.
 *
 * @returns One animal per round, starting with Round 1.
 */
export function getRoundAnimals(firstAnimal: Animal, side: Side): Animal[] {
  const order = side === "left" ? [...ANIMALS] : [...ANIMALS].reverse();
  const firstIndex = order.indexOf(firstAnimal);
  return order.map((_, roundIndex) => order[(firstIndex + roundIndex) % order.length]);
}

/**
 * Reads a format from text, ignoring capitalization.
 *
 * @returns Null when the text isn't a format.
 */
export function parseFormat(text: string): ScorecardFormat | null {
  const wanted = text.trim().toLowerCase();
  return SCORECARD_FORMATS.find((format) => format === wanted) ?? null;
}

/**
 * Reads an animal from text, ignoring capitalization.
 *
 * @returns Null when the text isn't one of the animals.
 */
export function parseAnimal(text: string): Animal | null {
  const wanted = text.trim().toLowerCase();
  return ANIMALS.find((animal) => animal.toLowerCase() === wanted) ?? null;
}

/**
 * Reads a side from text, ignoring capitalization.
 *
 * @returns Null when the text isn't a side.
 */
export function parseSide(text: string): Side | null {
  const wanted = text.trim().toLowerCase();
  return SIDES.find((side) => side === wanted) ?? null;
}

/**
 * Reads the most recently chosen format.
 *
 * @returns Bullseye when none is remembered or storage can't be read.
 */
export function loadRememberedFormat(storage: Storage = globalThis.localStorage): ScorecardFormat {
  try {
    return parseFormat(storage.getItem(FORMAT_STORAGE_KEY) ?? "") ?? "bullseye";
  } catch {
    return "bullseye";
  }
}

/**
 * Remembers the chosen format for next time. If the browser refuses, the page
 * simply starts on Bullseye next time.
 */
export function rememberFormat(
  format: ScorecardFormat,
  storage: Storage = globalThis.localStorage,
): void {
  try {
    storage.setItem(FORMAT_STORAGE_KEY, format);
  } catch {
    // Nothing depends on this being remembered.
  }
}
