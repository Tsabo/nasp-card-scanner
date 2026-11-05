/**
 * @file The saved-scorecard record, shared by the practice log, the CSV import
 * and export, and the page.
 */

import type { ArrowScore } from "./scoring.ts";

/** One saved scorecard. */
export interface Scorecard {
  /** Unique within this browser's log. */
  id: string;
  /** "YYYY-MM-DD". */
  date: string;
  /** Archer's name; may be empty. */
  archer: string;
  /** Five-digit shooter number; may be empty. */
  shooterNumber: string;
  /** 30 scores in card order; null for blanks. */
  arrowScores: ArrowScore[];
  /** When it was saved, in milliseconds since 1970. */
  createdAt: number;
}

/** A scorecard that hasn't been given an id yet. */
export type NewScorecard = Omit<Scorecard, "id">;

/**
 * Builds a key that is the same for two scorecards with the same date, archer,
 * shooter number and arrows. Used to skip duplicates on import.
 */
export function getScorecardIdentity(scorecard: NewScorecard): string {
  return [
    scorecard.date,
    scorecard.archer.toLowerCase(),
    scorecard.shooterNumber,
    scorecard.arrowScores.map((score) => score ?? "").join("."),
  ].join("|");
}

/**
 * Sorts scorecards newest first: by date, then by when they were saved.
 *
 * @returns A new, sorted array.
 */
export function sortNewestFirst(scorecards: readonly Scorecard[]): Scorecard[] {
  return [...scorecards].sort(
    (first, second) => second.date.localeCompare(first.date) || second.createdAt - first.createdAt,
  );
}

/**
 * Converts a record read from storage into a {@link Scorecard}, filling
 * in anything missing. Also accepts the field names used by the first
 * version of the app (`shooter`, `arrows`).
 *
 * @returns Null when the record is unusable.
 */
export function normalizeStoredScorecard(stored: unknown): Scorecard | null {
  if (typeof stored !== "object" || stored === null) {
    return null;
  }
  const record = stored as Record<string, unknown>;
  const arrowScores = record.arrowScores ?? record.arrows;
  if (!Array.isArray(arrowScores)) {
    return null;
  }
  return {
    id: String(record.id ?? ""),
    date: String(record.date ?? ""),
    archer: String(record.archer ?? ""),
    shooterNumber: String(record.shooterNumber ?? record.shooter ?? ""),
    arrowScores: arrowScores.map((score: unknown) => (typeof score === "number" ? score : null)),
    createdAt: Number(record.createdAt) || 0,
  };
}
