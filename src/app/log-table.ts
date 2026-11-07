/**
 * @file Shows the log as a table for one format at a time, with a tab for each
 * format and a delete button on each row.
 *
 * Not named log-view: the EasyPrivacy filter list blocks any file called
 * log-view.js, and that stops the whole app loading for anyone using it.
 */

import { createElement, getElement } from "./page-helpers.ts";
import { sortNewestFirst } from "./scorecard.ts";
import type { Scorecard } from "./scorecard.ts";
import { FORMAT_LABELS, SCORECARD_FORMATS, SIDE_LABELS } from "./scorecard-format.ts";
import type { ScorecardFormat } from "./scorecard-format.ts";
import { ROUND_COUNT, summarizeScorecard } from "./scoring.ts";
import type { ScorecardSummary } from "./scoring.ts";

/** How long a Delete button waits for its confirming second tap. */
const DELETE_CONFIRMATION_MILLISECONDS = 3500;

/** Shown when the log has no scorecards in a format. */
const createEmptyLogHtml = (format: ScorecardFormat): string => `
  <div class="empty-state">
    <b>No ${FORMAT_LABELS[format]} scorecards saved yet</b>
    Scan a card, check the score sheet, then choose Save to log. Scorecards
    collect here for export. To bring scorecards from another device, export them
    there and use Import CSV here.
  </div>`;

/** A saved scorecard together with its totals. */
interface ScorecardRow {
  scorecard: Scorecard;
  summary: ScorecardSummary;
}

/** One column of the table. */
interface TableColumn {
  heading: string;
  /** CSS classes for the cells. */
  className: string;
  getValue: (row: ScorecardRow) => string | number;
}

/** The Format column: the format, plus the side and first animal for 3D. */
function describeFormat({ format, side, firstAnimal }: Scorecard): string {
  const parts = [FORMAT_LABELS[format], side && SIDE_LABELS[side], firstAnimal];
  return parts.filter(Boolean).join(" · ");
}

/** The 10 and 15 meter totals only mean something in Bullseye. */
const DISTANCE_COLUMNS: TableColumn[] = [
  { heading: "10 m", className: "number-cell", getValue: (row) => row.summary.tenMeterTotal },
  { heading: "15 m", className: "number-cell", getValue: (row) => row.summary.fifteenMeterTotal },
];

/** Returns the table's columns for a format. */
const getTableColumns = (format: ScorecardFormat): TableColumn[] => [
  { heading: "Date", className: "align-left", getValue: (row) => row.scorecard.date },
  { heading: "Archer", className: "align-left", getValue: (row) => row.scorecard.archer || "—" },
  {
    heading: "Shooter #",
    className: "",
    getValue: (row) => row.scorecard.shooterNumber || "—",
  },
  { heading: "Format", className: "align-left", getValue: (row) => describeFormat(row.scorecard) },
  ...Array.from({ length: ROUND_COUNT }, (_, roundIndex): TableColumn => ({
    heading: `R${roundIndex + 1}`,
    className: "number-cell",
    getValue: (row) => row.summary.roundTotals[roundIndex],
  })),
  ...(format === "bullseye" ? DISTANCE_COLUMNS : []),
  { heading: "Total", className: "number-cell is-total", getValue: (row) => row.summary.total },
  { heading: "10s", className: "number-cell is-tens", getValue: (row) => row.summary.tensCount },
];

/** Returns the tab for a format. */
function getLogTab(format: ScorecardFormat): HTMLButtonElement {
  return getElement(`log-tab-${format}`, HTMLButtonElement);
}

/**
 * Connects the format tabs: a click chooses a tab, and the left and right arrow
 * keys move between them.
 *
 * @param onSelect Called with the chosen format.
 */
export function connectLogTabs(onSelect: (format: ScorecardFormat) => void): void {
  SCORECARD_FORMATS.forEach((format, formatIndex) => {
    const tab = getLogTab(format);
    tab.addEventListener("click", () => onSelect(format));
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }
      event.preventDefault();
      const step = event.key === "ArrowRight" ? 1 : SCORECARD_FORMATS.length - 1;
      const nextFormat = SCORECARD_FORMATS[(formatIndex + step) % SCORECARD_FORMATS.length];
      onSelect(nextFormat);
      getLogTab(nextFormat).focus();
    });
  });
}

/**
 * Draws the log table for one format and updates its tabs.
 *
 * @param scorecards The whole log.
 * @param format The format to show.
 * @param onDelete Called after a delete is confirmed.
 */
export function renderLog(
  scorecards: readonly Scorecard[],
  format: ScorecardFormat,
  onDelete: (scorecardId: string) => void,
): void {
  for (const tabFormat of SCORECARD_FORMATS) {
    const count = scorecards.filter((scorecard) => scorecard.format === tabFormat).length;
    const tab = getLogTab(tabFormat);
    const isActive = tabFormat === format;
    tab.textContent = `${FORMAT_LABELS[tabFormat]} (${count})`;
    tab.setAttribute("aria-selected", String(isActive));
    tab.tabIndex = isActive ? 0 : -1;
  }

  const container = getElement("log-table", HTMLDivElement);
  container.setAttribute("aria-labelledby", getLogTab(format).id);
  const matching = scorecards.filter((scorecard) => scorecard.format === format);
  if (matching.length === 0) {
    container.innerHTML = createEmptyLogHtml(format);
    return;
  }

  const tableColumns = getTableColumns(format);

  const table = createElement("table");
  const headerRow = createElement("tr");
  for (const column of tableColumns) {
    // Headings line up with their cells: left for text, right for numbers.
    const headingClass = column.className.includes("align-left") ? "align-left" : "";
    headerRow.append(createElement("th", { className: headingClass, text: column.heading }));
  }
  const deleteHeading = createElement("th");
  deleteHeading.append(createElement("span", { className: "visually-hidden", text: "Delete" }));
  headerRow.append(deleteHeading);
  table.createTHead().append(headerRow);

  const body = table.createTBody();
  for (const scorecard of sortNewestFirst(matching)) {
    const row: ScorecardRow = { scorecard, summary: summarizeScorecard(scorecard.arrowScores) };
    const tableRow = createElement("tr");
    for (const column of tableColumns) {
      tableRow.append(
        createElement("td", { className: column.className, text: column.getValue(row) }),
      );
    }
    const deleteCell = createElement("td");
    deleteCell.append(createDeleteButton(scorecard, onDelete));
    tableRow.append(deleteCell);
    body.append(tableRow);
  }

  container.replaceChildren(table);
}

/**
 * Creates a Delete button that needs a second tap to confirm, so a stray
 * tap can't lose a scorecard.
 */
function createDeleteButton(
  scorecard: Scorecard,
  onDelete: (scorecardId: string) => void,
): HTMLButtonElement {
  const button = createElement("button", {
    className: "button is-quiet delete-button",
    text: "Delete",
  });
  button.type = "button";
  button.setAttribute(
    "aria-label",
    `Delete ${scorecard.archer || "scorecard"} on ${scorecard.date}`,
  );

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
    onDelete(scorecard.id);
  });
  return button;
}
