/**
 * @file Shows the practice log as a table, with a delete button on each row.
 */

import { createElement, getElement } from "./page-helpers.ts";
import { sortNewestFirst } from "./practice-round.ts";
import type { PracticeRound } from "./practice-round.ts";
import { END_COUNT, summarizeRound } from "./scoring.ts";
import type { RoundSummary } from "./scoring.ts";

/** How long a Delete button waits for its confirming second tap. */
const DELETE_CONFIRMATION_MILLISECONDS = 3500;

/** Shown when the log is empty. */
const EMPTY_LOG_HTML = `
  <div class="empty-state">
    <b>No rounds saved yet</b>
    Scan a card, check the score sheet, then choose Save to practice log. Rounds
    collect here for export. To bring rounds from another device, export them
    there and use Import CSV here.
  </div>`;

/** A saved round together with its totals. */
interface RoundRow {
  round: PracticeRound;
  summary: RoundSummary;
}

/** One column of the table. */
interface TableColumn {
  heading: string;
  /** CSS classes for the cells. */
  className: string;
  getValue: (row: RoundRow) => string | number;
}

const TABLE_COLUMNS: TableColumn[] = [
  { heading: "Date", className: "align-left", getValue: (row) => row.round.date },
  { heading: "Archer", className: "align-left", getValue: (row) => row.round.archer || "—" },
  { heading: "Shooter #", className: "", getValue: (row) => row.round.shooterNumber || "—" },
  ...Array.from({ length: END_COUNT }, (_, endIndex): TableColumn => ({
    heading: `E${endIndex + 1}`,
    className: "number-cell",
    getValue: (row) => row.summary.endTotals[endIndex],
  })),
  { heading: "10 m", className: "number-cell", getValue: (row) => row.summary.tenMeterTotal },
  { heading: "15 m", className: "number-cell", getValue: (row) => row.summary.fifteenMeterTotal },
  { heading: "Total", className: "number-cell is-total", getValue: (row) => row.summary.total },
  { heading: "10s", className: "number-cell is-tens", getValue: (row) => row.summary.tensCount },
];

/**
 * Draws the practice log table.
 *
 * @param onDelete Called after a delete is confirmed.
 */
export function renderPracticeLog(
  rounds: readonly PracticeRound[],
  onDelete: (roundId: string) => void,
): void {
  const container = getElement("practice-log-table", HTMLDivElement);
  if (rounds.length === 0) {
    container.innerHTML = EMPTY_LOG_HTML;
    return;
  }

  const table = createElement("table");
  const headerRow = createElement("tr");
  for (const column of TABLE_COLUMNS) {
    // Headings line up with their cells: left for text, right for numbers.
    const headingClass = column.className.includes("align-left") ? "align-left" : "";
    headerRow.append(createElement("th", { className: headingClass, text: column.heading }));
  }
  const deleteHeading = createElement("th");
  deleteHeading.append(createElement("span", { className: "visually-hidden", text: "Delete" }));
  headerRow.append(deleteHeading);
  table.createTHead().append(headerRow);

  const body = table.createTBody();
  for (const round of sortNewestFirst(rounds)) {
    const row: RoundRow = { round, summary: summarizeRound(round.arrowScores) };
    const tableRow = createElement("tr");
    for (const column of TABLE_COLUMNS) {
      tableRow.append(
        createElement("td", { className: column.className, text: column.getValue(row) }),
      );
    }
    const deleteCell = createElement("td");
    deleteCell.append(createDeleteButton(round, onDelete));
    tableRow.append(deleteCell);
    body.append(tableRow);
  }

  container.replaceChildren(table);
}

/**
 * Creates a Delete button that needs a second tap to confirm, so a stray
 * tap can't lose a round.
 */
function createDeleteButton(
  round: PracticeRound,
  onDelete: (roundId: string) => void,
): HTMLButtonElement {
  const button = createElement("button", {
    className: "button is-quiet delete-button",
    text: "Delete",
  });
  button.type = "button";
  button.setAttribute("aria-label", `Delete ${round.archer || "round"} on ${round.date}`);

  let confirmationTimer: ReturnType<typeof setTimeout> | null = null;

  button.addEventListener("click", () => {
    if (confirmationTimer === null) {
      // First tap: ask for confirmation, and give up after a few seconds.
      button.classList.add("is-confirming");
      button.textContent = "Confirm";
      confirmationTimer = setTimeout(() => {
        confirmationTimer = null;
        button.classList.remove("is-confirming");
        button.textContent = "Delete";
      }, DELETE_CONFIRMATION_MILLISECONDS);
      return;
    }
    // Second tap: delete.
    clearTimeout(confirmationTimer);
    button.disabled = true;
    onDelete(round.id);
  });
  return button;
}

/**
 * Returns the distinct archer names in the log, alphabetically, for the
 * name suggestions on the score sheet.
 */
export function getArcherNames(rounds: readonly PracticeRound[]): string[] {
  const names = new Set(rounds.map((round) => round.archer).filter((name) => name !== ""));
  return [...names].sort((first, second) => first.localeCompare(second));
}
