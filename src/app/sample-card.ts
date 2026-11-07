/**
 * @file The sample card shown when the app opens, and its blank twin, shown
 * while scores are entered by hand with rings for what's typed. Both are
 * drawn by scripts/make-sample-card.py, which also stores where the blank
 * card's timing marks and bubbles are, so the app doesn't have to run the
 * reader on it.
 */

import type { CardReadSuccess } from "../reader/analyze-card.ts";
import { ROW_COUNT, SCORE_ROW_COUNT, getBubbleCount } from "../reader/card-layout.ts";
import type { Point } from "../reader/geometry.ts";

/** The filled-in sample, read when the app opens. */
export const SAMPLE_CARD_URL = "assets/sample-card.jpg";

/** The same photo with nothing filled in. */
export const BLANK_CARD_URL = "assets/sample-card-blank.jpg";

/** Where the blank card's timing marks and bubbles are; see {@link BlankCardLayout}. */
export const BLANK_CARD_LAYOUT_URL = "assets/sample-card-blank.json";

/** Where things are on the blank card's photo, in its pixels. */
export interface BlankCardLayout {
  width: number;
  height: number;
  /** One per row of bubbles: 30 arrows, then 5 Shooter # digits. */
  timingMarks: Point[];
  /** One per row, each with the centers of its bubbles from 0 up. */
  rows: Point[][];
}

/**
 * Checks that stored data is a blank card's layout.
 *
 * @throws {Error} When it isn't.
 */
export function readBlankCardLayout(data: unknown): BlankCardLayout {
  const layout = data as Partial<BlankCardLayout> | null;
  const isPoint = (point: unknown): point is Point =>
    typeof point === "object" &&
    point !== null &&
    typeof (point as Point).x === "number" &&
    typeof (point as Point).y === "number";
  const isLayout =
    typeof layout === "object" &&
    layout !== null &&
    typeof layout.width === "number" &&
    typeof layout.height === "number" &&
    Array.isArray(layout.timingMarks) &&
    layout.timingMarks.length === ROW_COUNT &&
    layout.timingMarks.every(isPoint) &&
    Array.isArray(layout.rows) &&
    layout.rows.length === ROW_COUNT &&
    layout.rows.every(
      (centers, rowIndex) =>
        Array.isArray(centers) &&
        centers.length === getBubbleCount(rowIndex) &&
        centers.every(isPoint),
    );
  if (!isLayout) {
    throw new Error("The blank sample card's layout is damaged.");
  }
  return layout as BlankCardLayout;
}

/**
 * Builds what the reader would find on the blank card: every bubble empty,
 * in the places the layout gives.
 *
 * @param scale How much the photo was shrunk to show it, such as 0.5 for half size.
 */
export function createBlankReading(layout: BlankCardLayout, scale: number): CardReadSuccess {
  const place = ({ x, y }: Point): Point => ({ x: x * scale, y: y * scale });
  const rows = layout.rows.map((centers) => ({
    value: null,
    flag: null,
    centers: centers.map(place),
    fills: new Array<number>(centers.length).fill(0),
  }));
  return {
    ok: true,
    scores: rows.slice(0, SCORE_ROW_COUNT),
    shooter: rows.slice(SCORE_ROW_COUNT),
    timingMarks: layout.timingMarks.map((mark) => ({ ...place(mark), wasDetected: true })),
    diagnostics: { fitScore: 1 },
  };
}
