/**
 * @file Converts the practice log to and from spreadsheet formats.
 *
 * - CSV (comma-separated values) for downloading and importing.
 * - Tab-separated text for pasting straight into Excel or Google Sheets.
 *
 * Every arrow is exported, so a downloaded CSV can be imported again on
 * another device without losing anything.
 */

import { getTodayAsIsoDate } from "./dates.ts";
import type { NewPracticeRound, PracticeRound } from "./practice-round.ts";
import {
  ARROWS_PER_END,
  ARROW_COUNT,
  END_COUNT,
  MAXIMUM_ARROW_SCORE,
  summarizeRound,
} from "./scoring.ts";
import type { ArrowScore } from "./scoring.ts";

/** The heading for each arrow column, such as "E3A4" for End 3, arrow 4. */
export const ARROW_COLUMN_HEADINGS: readonly string[] = Object.freeze(
  Array.from({ length: ARROW_COUNT }, (_, arrowIndex) => {
    const endNumber = Math.floor(arrowIndex / ARROWS_PER_END) + 1;
    const arrowNumber = (arrowIndex % ARROWS_PER_END) + 1;
    return `E${endNumber}A${arrowNumber}`;
  }),
);

/** Column headings, in order. */
export const COLUMN_HEADINGS: readonly string[] = Object.freeze([
  "Date",
  "Archer",
  "Shooter #",
  ...Array.from({ length: END_COUNT }, (_, endIndex) => `End ${endIndex + 1}`),
  "10 m",
  "15 m",
  "Total",
  "10s",
  ...ARROW_COLUMN_HEADINGS,
]);

/**
 * Byte-order mark. Excel needs it to read a CSV file as UTF-8, so names
 * with accents survive.
 */
const BYTE_ORDER_MARK = "﻿";

/**
 * Builds a CSV file from the rounds, ready to download.
 *
 * @param rounds In the order they should appear.
 */
export function createCsv(rounds: readonly PracticeRound[]): string {
  const lines = [COLUMN_HEADINGS, ...rounds.map(getRoundCells)].map((cells) =>
    cells.map(quoteCsvCell).join(","),
  );
  return BYTE_ORDER_MARK + lines.join("\r\n");
}

/**
 * Builds tab-separated text from the rounds, for pasting into a spreadsheet.
 *
 * @param rounds In the order they should appear.
 */
export function createTabSeparatedText(rounds: readonly PracticeRound[]): string {
  return [COLUMN_HEADINGS, ...rounds.map(getRoundCells)]
    .map((cells) => cells.map((cell) => String(cell).replace(/[\t\r\n]/g, " ")).join("\t"))
    .join("\n");
}

/** Returns one round's values in {@link COLUMN_HEADINGS} order. */
function getRoundCells(round: PracticeRound): Array<string | number> {
  const summary = summarizeRound(round.arrowScores);
  return [
    round.date,
    round.archer,
    round.shooterNumber,
    ...summary.endTotals,
    summary.tenMeterTotal,
    summary.fifteenMeterTotal,
    summary.total,
    summary.tensCount,
    ...round.arrowScores.map((score) => score ?? ""),
  ];
}

/**
 * Wraps a value in quotes when it contains a comma, quote or line break,
 * doubling any quotes inside it (the standard CSV rule).
 */
function quoteCsvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Splits CSV text into rows of cells. Handles quoted cells containing
 * commas, quotes and line breaks. Blank lines are dropped.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let isInsideQuotes = false;

  const source = text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text;

  for (let position = 0; position < source.length; position++) {
    const character = source[position];

    if (isInsideQuotes) {
      if (character !== '"') {
        currentCell += character;
      } else if (source[position + 1] === '"') {
        // Two quotes in a row inside a quoted cell stand for one quote.
        currentCell += '"';
        position++;
      } else {
        isInsideQuotes = false;
      }
    } else if (character === '"') {
      isInsideQuotes = true;
    } else if (character === ",") {
      currentRow.push(currentCell);
      currentCell = "";
    } else if (character === "\n" || character === "\r") {
      // Treat \r\n as a single line break.
      if (character === "\r" && source[position + 1] === "\n") {
        position++;
      }
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = "";
    } else {
      currentCell += character;
    }
  }

  if (currentCell !== "" || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }
  return rows.filter((row) => row.some((cell) => cell.trim() !== ""));
}

/** Thrown when a file isn't a CSV this app exported. */
export class UnrecognizedCsvError extends Error {
  constructor() {
    super("That CSV wasn't exported from this page, so it can't be imported.");
    this.name = "UnrecognizedCsvError";
  }
}

/** The rounds read from a CSV file. */
export interface CsvImport {
  rounds: NewPracticeRound[];
  /** Rows skipped because a score wasn't a whole number from 0 to 10. */
  unreadableRowCount: number;
}

/**
 * Reads rounds from a CSV file exported by this app. Columns may be in any
 * order, and extra columns are ignored, so a file that has been opened and
 * re-saved in a spreadsheet still imports.
 *
 * @throws {UnrecognizedCsvError} When the date or arrow columns are missing.
 */
export function readRoundsFromCsv(text: string): CsvImport {
  const [headingRow = [], ...dataRows] = parseCsv(text);
  const headings = headingRow.map((heading) => heading.trim());
  const columnOf = (heading: string): number => headings.indexOf(heading);

  const dateColumn = columnOf("Date");
  const archerColumn = columnOf("Archer");
  const shooterColumn = columnOf("Shooter #");
  const arrowColumns = ARROW_COLUMN_HEADINGS.map(columnOf);
  if (dateColumn < 0 || arrowColumns.some((column) => column < 0)) {
    throw new UnrecognizedCsvError();
  }

  const rounds: NewPracticeRound[] = [];
  let unreadableRowCount = 0;
  const importedAt = Date.now();

  for (const row of dataRows) {
    const cellAt = (column: number): string => (column >= 0 ? (row[column] ?? "").trim() : "");
    const arrowScores = arrowColumns.map((column) => parseArrowScore(cellAt(column)));
    if (!arrowScores.every(isValidScore)) {
      unreadableRowCount++;
      continue;
    }
    rounds.push({
      date: cellAt(dateColumn) || getTodayAsIsoDate(),
      archer: cellAt(archerColumn),
      shooterNumber: cellAt(shooterColumn),
      arrowScores,
      // Keep imported rounds in file order when they share a date.
      createdAt: importedAt + rounds.length,
    });
  }
  return { rounds, unreadableRowCount };
}

/**
 * Reads one arrow cell.
 *
 * @returns The score, null for a blank cell, or undefined when the cell
 *   isn't a valid score.
 */
function parseArrowScore(cell: string): ArrowScore | undefined {
  if (cell === "") {
    return null;
  }
  const score = Number(cell);
  return Number.isInteger(score) && score >= 0 && score <= MAXIMUM_ARROW_SCORE ? score : undefined;
}

/** Type guard: true when a parsed cell held a valid score or was blank. */
function isValidScore(score: ArrowScore | undefined): score is ArrowScore {
  return score !== undefined;
}
