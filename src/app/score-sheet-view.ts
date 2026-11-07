/**
 * @file Draws the {@link ScoreSheet} on the page: scorecard details, 30 arrow
 * pickers, the running totals, the list of spots to check and the save
 * message. Every control reports its edits to the sheet, and the whole view is
 * redrawn from each new state, so the page never holds a value of its own.
 */

import { createElement, getElement } from "./page-helpers.ts";
import type { ScoreSheet, SheetField, SheetState } from "./score-sheet.ts";
import {
  ANIMALS,
  FORMAT_LABELS,
  SCORECARD_FORMATS,
  SIDES,
  SIDE_LABELS,
} from "./scorecard-format.ts";
import {
  ARROWS_PER_ROUND,
  MAXIMUM_ARROW_SCORE,
  ROUND_COUNT,
  TEN_METER_ROUND_COUNT,
  describeArrow,
} from "./scoring.ts";

export class ScoreSheetView {
  private readonly sheet: ScoreSheet<HTMLCanvasElement>;

  private readonly elements = {
    panel: getElement("score-sheet-panel", HTMLElement),
    formatSelect: getElement("format-select", HTMLSelectElement),
    sideSelect: getElement("side-select", HTMLSelectElement),
    firstAnimalSelect: getElement("first-animal-select", HTMLSelectElement),
    archerInput: getElement("archer-input", HTMLInputElement),
    archerNames: getElement("archer-names", HTMLDataListElement),
    dateInput: getElement("scorecard-date-input", HTMLInputElement),
    shooterNumberInput: getElement("shooter-number-input", HTMLInputElement),
    shooterNumberHint: getElement("shooter-number-hint", HTMLElement),
    shooterNumberProblem: getElement("shooter-number-problem", HTMLElement),
    roundsContainer: getElement("rounds-container", HTMLDivElement),
    reviewList: getElement("review-list", HTMLDivElement),
    scorecardTotal: getElement("scorecard-total", HTMLSpanElement),
    tenMeterTotal: getElement("ten-meter-total", HTMLElement),
    fifteenMeterTotal: getElement("fifteen-meter-total", HTMLElement),
    tensCount: getElement("tens-count", HTMLElement),
    arrowsEntered: getElement("arrows-entered", HTMLElement),
    saveMessage: getElement("save-message", HTMLSpanElement),
  };

  private readonly arrowSelects: HTMLSelectElement[] = [];
  private readonly roundLabelElements: HTMLSpanElement[] = [];
  private readonly roundTotalElements: HTMLSpanElement[] = [];
  /** One per distance: 10 m, then 15 m. */
  private readonly distanceTotalElements: HTMLSpanElement[] = [];
  /** The names last put in the suggestions, so they're only rebuilt when the log changes. */
  private shownArcherNames: readonly string[] | null = null;

  constructor(sheet: ScoreSheet<HTMLCanvasElement>) {
    this.sheet = sheet;
    this.buildFormatControls();
    this.buildRoundRows();
    this.connectDetailControls();
    sheet.subscribe((state) => this.render(state));
    this.render(sheet.getState());
  }

  /** Fills the format, side and first animal drop-downs and reports changes. */
  private buildFormatControls(): void {
    const { formatSelect, sideSelect, firstAnimalSelect } = this.elements;
    formatSelect.append(
      ...SCORECARD_FORMATS.map((format) => new Option(FORMAT_LABELS[format], format)),
    );
    sideSelect.append(new Option("Choose a side", ""));
    sideSelect.append(...SIDES.map((side) => new Option(SIDE_LABELS[side], side)));
    firstAnimalSelect.append(new Option("Choose an animal", ""));
    firstAnimalSelect.append(...ANIMALS.map((animal) => new Option(animal, animal)));

    this.reportEdits(formatSelect, "change", "format");
    this.reportEdits(sideSelect, "change", "side");
    this.reportEdits(firstAnimalSelect, "change", "firstAnimal");
  }

  /** Reports edits to the archer, Shooter # and date. */
  private connectDetailControls(): void {
    const { archerInput, shooterNumberInput, dateInput } = this.elements;
    this.reportEdits(archerInput, "input", "archer");
    this.reportEdits(shooterNumberInput, "input", "shooterNumber");
    this.reportEdits(dateInput, "input", "date");
    shooterNumberInput.addEventListener("blur", () => this.sheet.finishShooterNumber());
  }

  /** Tells the sheet whenever a control's value changes. */
  private reportEdits(
    control: HTMLInputElement | HTMLSelectElement,
    eventName: "input" | "change",
    field: SheetField,
  ): void {
    control.addEventListener(eventName, () => this.sheet.edit(field, control.value));
  }

  /**
   * Creates the six round rows, each with five arrow pickers and a total,
   * plus a heading before each distance.
   */
  private buildRoundRows(): void {
    const container = this.elements.roundsContainer;
    container.replaceChildren();

    for (let roundIndex = 0; roundIndex < ROUND_COUNT; roundIndex++) {
      if (roundIndex === 0 || roundIndex === TEN_METER_ROUND_COUNT) {
        const heading = createElement("div", { className: "distance-heading" });
        const distanceTotal = createElement("span", { className: "numeric", text: 0 });
        heading.append(
          createElement("h3", { text: roundIndex === 0 ? "10 meters" : "15 meters" }),
          distanceTotal,
        );
        this.distanceTotalElements.push(distanceTotal);
        container.append(heading);
      }

      const row = createElement("div", { className: "round-row" });
      const roundLabel = createElement("span", { className: "round-label" });
      this.roundLabelElements.push(roundLabel);
      row.append(roundLabel);
      for (let arrowInRound = 0; arrowInRound < ARROWS_PER_ROUND; arrowInRound++) {
        const select = this.createArrowSelect(roundIndex * ARROWS_PER_ROUND + arrowInRound);
        this.arrowSelects.push(select);
        row.append(select);
      }
      const roundTotal = createElement("span", { className: "round-total" });
      this.roundTotalElements.push(roundTotal);
      row.append(roundTotal);
      container.append(row);
    }
  }

  /** Creates the drop-down for one arrow: blank, then 0 to 10. */
  private createArrowSelect(arrowIndex: number): HTMLSelectElement {
    const select = createElement("select", { className: "arrow-select" });
    select.id = `arrow-select-${arrowIndex}`;
    select.setAttribute("aria-label", describeArrow(arrowIndex).replace(" · ", ", "));

    select.append(new Option("–", ""));
    for (let score = 0; score <= MAXIMUM_ARROW_SCORE; score++) {
      select.append(new Option(String(score), String(score)));
    }
    this.reportEdits(select, "change", arrowIndex);
    return select;
  }

  /** Returns the control for a field on the sheet. */
  private getControl(field: SheetField): HTMLElement {
    const { elements } = this;
    switch (field) {
      case "archer":
        return elements.archerInput;
      case "shooterNumber":
        return elements.shooterNumberInput;
      case "date":
        return elements.dateInput;
      case "format":
        return elements.formatSelect;
      case "side":
        return elements.sideSelect;
      case "firstAnimal":
        return elements.firstAnimalSelect;
      default:
        return this.arrowSelects[field];
    }
  }

  /** Updates everything on the sheet from the sheet's state. */
  private render(state: SheetState<HTMLCanvasElement>): void {
    const { elements } = this;
    elements.panel.classList.toggle("is-three-d", state.format === "3d");
    elements.formatSelect.value = state.format;
    elements.sideSelect.value = state.side ?? "";
    elements.firstAnimalSelect.value = state.firstAnimal ?? "";
    setInputValue(elements.dateInput, state.date);

    this.roundLabelElements.forEach((element, roundIndex) => {
      element.textContent = state.roundLabels[roundIndex];
    });
    this.arrowSelects.forEach((select, arrowIndex) => {
      const score = state.arrowScores[arrowIndex];
      const flag = state.arrowFlags[arrowIndex];
      select.value = score === null ? "" : String(score);
      select.classList.toggle("is-ten", score === MAXIMUM_ARROW_SCORE);
      select.classList.toggle("is-empty", score === null);
      select.classList.toggle("needs-review", flag !== null);
      select.title = flag ?? "";
    });

    const { summary } = state;
    this.roundTotalElements.forEach((element, roundIndex) => {
      element.textContent = String(summary.roundTotals[roundIndex]);
      element.classList.toggle("is-incomplete", state.roundIncomplete[roundIndex]);
    });
    this.distanceTotalElements[0].textContent = String(summary.tenMeterTotal);
    this.distanceTotalElements[1].textContent = String(summary.fifteenMeterTotal);
    elements.scorecardTotal.textContent = String(summary.total);
    elements.tenMeterTotal.textContent = String(summary.tenMeterTotal);
    elements.fifteenMeterTotal.textContent = String(summary.fifteenMeterTotal);
    elements.tensCount.textContent = String(summary.tensCount);
    elements.arrowsEntered.textContent = String(summary.arrowsEntered);

    this.renderArcherFields(state);
    this.renderReviewList(state);
    elements.saveMessage.textContent = state.saveMessage.text;
    elements.saveMessage.classList.toggle("is-problem", state.saveMessage.isProblem);

    if (state.focusRequest !== null) {
      this.getControl(state.focusRequest).focus();
    }
  }

  /** Shows the archer and Shooter #, whether the number needs attention, and the name suggestions. */
  private renderArcherFields(state: SheetState<HTMLCanvasElement>): void {
    const {
      archerInput,
      archerNames,
      shooterNumberInput,
      shooterNumberHint,
      shooterNumberProblem,
    } = this.elements;
    setInputValue(archerInput, state.archer);
    setInputValue(shooterNumberInput, state.shooterNumber);

    const isUnfinished = state.shooterNumberProblem !== null;
    shooterNumberHint.classList.toggle("is-hidden", isUnfinished);
    shooterNumberProblem.classList.toggle("is-hidden", !isUnfinished);
    shooterNumberProblem.textContent = state.shooterNumberProblem ?? "";
    shooterNumberInput.setAttribute("aria-invalid", String(isUnfinished));
    shooterNumberInput.classList.toggle("needs-review", state.shooterNumberNeedsReview);

    // Rebuilding the suggestions while someone types would close the list.
    if (state.archerNames !== this.shownArcherNames) {
      this.shownArcherNames = state.archerNames;
      archerNames.replaceChildren(
        ...state.archerNames.map((name) => {
          const option = createElement("option");
          option.value = name;
          return option;
        }),
      );
    }
  }

  /**
   * Lists every spot a person should check. Each entry is a button that jumps
   * to the control in question.
   */
  private renderReviewList(state: SheetState<HTMLCanvasElement>): void {
    const items = state.reviewItems;
    const list = this.elements.reviewList;
    list.replaceChildren();
    if (items.length === 0) {
      return;
    }

    list.append(
      createElement("div", {
        className: "review-heading",
        text: items.length === 1 ? "1 spot needs a look" : `${items.length} spots need a look`,
      }),
    );
    for (const item of items) {
      const button = createElement("button", { className: "review-item" });
      button.type = "button";
      button.append(
        createElement("b", { text: item.label }),
        createElement("span", { text: item.message }),
      );
      button.addEventListener("click", () => this.getControl(item.field).focus());
      list.append(button);
    }
  }
}

/** Writes an input's value only when it differs, so the cursor doesn't jump while someone types. */
function setInputValue(input: HTMLInputElement, value: string): void {
  if (input.value !== value) {
    input.value = value;
  }
}
