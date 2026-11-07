/**
 * @file The saved-scorecard record, shared by the log, the CSV import
 * and export, and the page, and the rules for what makes one valid.
 *
 * A scorecard reaches the log in three ways, each with its own tolerance:
 *
 * - {@link findSaveProblem}: saving the score sheet. Strict, since a person
 *   is there to fix it.
 * - {@link readImportedScorecard}: a row of an imported CSV. Puts back what a
 *   spreadsheet changes, and skips rows that aren't a scorecard.
 * - {@link normalizeStoredScorecard}: the log in local storage. Repairs what
 *   it can and keeps the rest, since the log is the only record.
 */

import { parseAnimal, parseFormat, parseSide } from "./scorecard-format.ts";
import type { Animal, ScorecardFormat, Side } from "./scorecard-format.ts";
import { getTodayAsIsoDate } from "./dates.ts";
import { ARROW_COUNT, MAXIMUM_ARROW_SCORE } from "./scoring.ts";
import type { ArrowScore } from "./scoring.ts";

/** How many digits a complete Shooter # has, set by the rows on the card. */
export const SHOOTER_NUMBER_LENGTH = 5;

/** Tells whether a Shooter # has all its digits, including any leading zeros. */
export function isCompleteShooterNumber(shooterNumber: string): boolean {
  return shooterNumber.length === SHOOTER_NUMBER_LENGTH && /^\d+$/.test(shooterNumber);
}

/** Tells whether a Shooter # has been started but not finished. */
export function isPartialShooterNumber(shooterNumber: string): boolean {
  return shooterNumber !== "" && !isCompleteShooterNumber(shooterNumber);
}

/**
 * Puts a name in the form used to compare names. Names that differ only in
 * capitalization or stray spaces are the same name.
 */
export function getNameKey(name: string): string {
  return name.trim().toLowerCase();
}

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
  format: ScorecardFormat;
  /** The side of the range shot from; null for Bullseye. */
  side: Side | null;
  /** The animal shot in Round 1; null for Bullseye. */
  firstAnimal: Animal | null;
  /** 30 scores in card order; null for blanks. */
  arrowScores: ArrowScore[];
  /** When it was saved, in milliseconds since 1970. */
  createdAt: number;
}

/** A scorecard that hasn't been given an id yet. */
export type NewScorecard = Omit<Scorecard, "id">;

/** Why a score sheet can't be saved yet. */
export type SaveProblem =
  "no-archer" | "partial-shooter-number" | "no-side" | "no-first-animal" | "no-scores";

/**
 * Checks a score sheet against the rules for a new scorecard, the strictest of
 * the three ways a scorecard reaches the log. Problems are checked in the order
 * a person fills the sheet in, and only the first is returned.
 *
 * @returns Null when the scorecard can be saved.
 */
export function findSaveProblem(scorecard: Omit<NewScorecard, "createdAt">): SaveProblem | null {
  if (scorecard.archer.trim() === "" && scorecard.shooterNumber === "") {
    return "no-archer";
  }
  if (isPartialShooterNumber(scorecard.shooterNumber)) {
    return "partial-shooter-number";
  }
  if (scorecard.format === "3d" && scorecard.side === null) {
    return "no-side";
  }
  if (scorecard.format === "3d" && scorecard.firstAnimal === null) {
    return "no-first-animal";
  }
  if (scorecard.arrowScores.every((score) => score === null)) {
    return "no-scores";
  }
  return null;
}

/** The text of one imported row, however the file arranged its columns. */
export interface ImportedCells {
  date: string;
  archer: string;
  shooterNumber: string;
  format: string;
  side: string;
  firstAnimal: string;
  /** In card order, Round 1 arrow 1 first. */
  arrows: readonly string[];
}

/**
 * Reads one imported row as a scorecard. Tolerates what a spreadsheet does to a
 * file it opens and re-saves: a Shooter # loses its leading zeros, and a date
 * turns into the US "M/D/YYYY" form. A blank date is today, a blank format is
 * Bullseye, a 3D row with no side is the left side, and a 3D row may have no
 * first animal, since a few old scorecards in the log were saved without one.
 *
 * @param createdAt Stands in for when the scorecard was saved.
 * @returns Null when the row isn't a scorecard: it has no name or Shooter #,
 *   every arrow is blank, or a cell holds something that can't be read.
 */
export function readImportedScorecard(
  cells: ImportedCells,
  createdAt: number,
): NewScorecard | null {
  const date = cells.date.trim() === "" ? getTodayAsIsoDate() : readDate(cells.date);
  const archer = cells.archer.trim();
  const shooterNumber = padShooterNumber(cells.shooterNumber.trim());
  const formatCell = cells.format.trim();
  const format = formatCell === "" ? "bullseye" : parseFormat(formatCell);
  const sideCell = cells.side.trim();
  const side = format !== "3d" ? null : sideCell === "" ? "left" : parseSide(sideCell);
  const firstAnimalCell = cells.firstAnimal.trim();
  const firstAnimal =
    format !== "3d" || firstAnimalCell === "" ? null : parseAnimal(firstAnimalCell);
  const arrowScores = cells.arrows.map((cell) => readArrowScore(cell.trim()));

  if (
    date === null ||
    format === null ||
    (format === "3d" && side === null) ||
    (format === "3d" && firstAnimalCell !== "" && firstAnimal === null) ||
    (shooterNumber !== "" && !isCompleteShooterNumber(shooterNumber)) ||
    (archer === "" && shooterNumber === "") ||
    arrowScores.length !== ARROW_COUNT ||
    !arrowScores.every(isArrowScore) ||
    arrowScores.every((score) => score === null)
  ) {
    return null;
  }
  return { date, archer, shooterNumber, format, side, firstAnimal, arrowScores, createdAt };
}

/** Type guard: true for a whole number from 0 to 10. */
function isPossibleScore(score: unknown): score is number {
  return (
    typeof score === "number" &&
    Number.isInteger(score) &&
    score >= 0 &&
    score <= MAXIMUM_ARROW_SCORE
  );
}

/** Type guard: true when an arrow cell held a valid score or was blank. */
function isArrowScore(score: ArrowScore | undefined): score is ArrowScore {
  return score !== undefined;
}

/**
 * Puts back the leading zeros a spreadsheet drops from a number, so "123"
 * becomes "00123". Anything that isn't 1 to 4 digits is returned unchanged.
 */
function padShooterNumber(shooterNumber: string): string {
  return /^\d{1,4}$/.test(shooterNumber)
    ? shooterNumber.padStart(SHOOTER_NUMBER_LENGTH, "0")
    : shooterNumber;
}

/**
 * Reads a date written as "YYYY-MM-DD", or as "M/D/YYYY", which is how a US
 * spreadsheet re-saves one.
 *
 * @returns The date as "YYYY-MM-DD", or null when it isn't a real date in
 *   either form.
 */
function readDate(text: string): string | null {
  const trimmed = text.trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  const usMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  const [year, month, day] = isoMatch
    ? [isoMatch[1], isoMatch[2], isoMatch[3]].map(Number)
    : usMatch
      ? [usMatch[3], usMatch[1], usMatch[2]].map(Number)
      : [NaN, NaN, NaN];
  // A date like February 30 rolls over into March, so it won't match.
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Reads one arrow cell.
 *
 * @returns The score, null for a blank cell, or undefined when the cell
 *   isn't a whole number from 0 to 10.
 */
function readArrowScore(cell: string): ArrowScore | undefined {
  if (cell === "") {
    return null;
  }
  const score = Number(cell);
  return /^\d+$/.test(cell) && score <= MAXIMUM_ARROW_SCORE ? score : undefined;
}

/**
 * Builds a key that is the same for two scorecards with the same date, archer,
 * shooter number, format, side, first animal and arrows. Used to skip duplicates on
 * import.
 */
export function getScorecardIdentity(scorecard: NewScorecard): string {
  return [
    scorecard.date,
    getNameKey(scorecard.archer),
    padShooterNumber(scorecard.shooterNumber),
    scorecard.format,
    scorecard.side ?? "",
    scorecard.firstAnimal ?? "",
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
 * Converts a record read from storage into a {@link Scorecard}. The most
 * tolerant of the three ways a scorecard reaches the log, because the log is the
 * only record of these archers: anything it can repair, it does, and the rest
 * is kept as it was.
 *
 * - Accepts the field names used by the first version of the app (`shooter`,
 *   `arrows`).
 * - Scorecards saved before formats existed count as Bullseye, and 3D
 *   scorecards saved before sides existed count as the left side.
 * - Arrows are made exactly 30, with blanks for any missing, and a score
 *   that can't be right becomes a blank.
 * - A US "M/D/YYYY" date saved by an earlier import becomes "YYYY-MM-DD".
 *
 * @returns Null only when the stored value isn't a record at all.
 */
export function normalizeStoredScorecard(stored: unknown): Scorecard | null {
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) {
    return null;
  }
  const record = stored as Record<string, unknown>;
  const storedArrows: unknown = record.arrowScores ?? record.arrows;
  const arrowList: readonly unknown[] = Array.isArray(storedArrows) ? storedArrows : [];
  const arrowScores = Array.from({ length: ARROW_COUNT }, (_, arrowIndex) => {
    const score = arrowList[arrowIndex];
    return isPossibleScore(score) ? score : null;
  });
  const date = String(record.date ?? "");
  const format = parseFormat(String(record.format ?? "")) ?? "bullseye";
  return {
    id: String(record.id ?? ""),
    date: readDate(date) ?? date,
    archer: String(record.archer ?? ""),
    shooterNumber: String(record.shooterNumber ?? record.shooter ?? ""),
    format,
    side: format === "3d" ? (parseSide(String(record.side ?? "")) ?? "left") : null,
    firstAnimal: format === "3d" ? parseAnimal(String(record.firstAnimal ?? "")) : null,
    arrowScores,
    createdAt: Number(record.createdAt) || 0,
  };
}
