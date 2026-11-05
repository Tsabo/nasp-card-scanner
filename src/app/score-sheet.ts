/**
 * @file The editable score sheet: archer details, 30 arrow pickers, the
 * running totals, and the list of spots the reader wants checked.
 */

import { getTodayAsIsoDate } from "./dates.ts";
import { createElement, getElement } from "./page-helpers.ts";
import {
  ARROWS_PER_ROUND,
  ARROW_COUNT,
  MAXIMUM_ARROW_SCORE,
  ROUND_COUNT,
  TEN_METER_ROUND_COUNT,
  createBlankScores,
  describeArrow,
  isRoundIncomplete,
  summarizeScorecard,
} from "./scoring.ts";
import type { ArrowScore } from "./scoring.ts";

/** Shown in the review list when the shooter number wasn't read cleanly. */
const SHOOTER_NUMBER_REVIEW_MESSAGE = "Some shooter-number digits weren't marked clearly";

/** Why an arrow needs checking, or null when it doesn't. */
export type ReviewFlag = string | null;

/** What the reader found, ready to show on the sheet. */
export interface SheetContents {
  arrowScores: ArrowScore[];
  /** Why each arrow needs checking, or null. */
  arrowFlags: ReviewFlag[];
  /** Digits read; may be partial or empty. */
  shooterNumber: string;
  shooterNumberNeedsReview: boolean;
}

/** The details typed in above the arrows. */
export interface ScorecardDetails {
  archer: string;
  /** "YYYY-MM-DD". */
  date: string;
  shooterNumber: string;
}

/** An entry in the "needs a look" list. */
interface ReviewItem {
  label: string;
  message: string;
  /** The control to focus when the entry is tapped. */
  target: HTMLElement;
}

export class ScoreSheet {
  private arrowScores: ArrowScore[] = createBlankScores();
  private arrowFlags: ReviewFlag[] = new Array<ReviewFlag>(ARROW_COUNT).fill(null);
  private shooterNumberNeedsReview = false;
  private readonly changeListeners: Array<() => void> = [];

  private readonly elements = {
    archerInput: getElement("archer-input", HTMLInputElement),
    archerNames: getElement("archer-names", HTMLDataListElement),
    dateInput: getElement("scorecard-date-input", HTMLInputElement),
    shooterNumberInput: getElement("shooter-number-input", HTMLInputElement),
    roundsContainer: getElement("rounds-container", HTMLDivElement),
    reviewList: getElement("review-list", HTMLDivElement),
    scorecardTotal: getElement("scorecard-total", HTMLSpanElement),
    tenMeterTotal: getElement("ten-meter-total", HTMLElement),
    fifteenMeterTotal: getElement("fifteen-meter-total", HTMLElement),
    tensCount: getElement("tens-count", HTMLElement),
    arrowsEntered: getElement("arrows-entered", HTMLElement),
  };

  private readonly arrowSelects: HTMLSelectElement[] = [];
  private readonly roundTotalElements: HTMLSpanElement[] = [];
  /** One per distance: 10 m, then 15 m. */
  private readonly distanceTotalElements: HTMLSpanElement[] = [];

  constructor() {
    this.buildRoundRows();
    this.elements.dateInput.value = getTodayAsIsoDate();
    this.elements.shooterNumberInput.addEventListener("input", () =>
      this.handleShooterNumberInput(),
    );
    this.render();
  }

  /** Registers a function to call whenever an arrow score changes. */
  onChange(listener: () => void): void {
    this.changeListeners.push(listener);
  }

  /** Fills the sheet with what the reader found. */
  showReading(contents: SheetContents): void {
    this.arrowScores = [...contents.arrowScores];
    this.arrowFlags = [...contents.arrowFlags];
    this.shooterNumberNeedsReview = contents.shooterNumberNeedsReview;
    this.elements.shooterNumberInput.value = contents.shooterNumber;
    this.render();
  }

  /** Blanks every arrow and the shooter number, ready for typing in by hand. */
  clear(): void {
    this.showReading({
      arrowScores: createBlankScores(),
      arrowFlags: new Array<ReviewFlag>(ARROW_COUNT).fill(null),
      shooterNumber: "",
      shooterNumberNeedsReview: false,
    });
  }

  /** Returns a copy of the current scores. */
  getArrowScores(): ArrowScore[] {
    return [...this.arrowScores];
  }

  /** Returns a copy of the current review flags. */
  getArrowFlags(): ReviewFlag[] {
    return [...this.arrowFlags];
  }

  getScorecardDetails(): ScorecardDetails {
    return {
      archer: this.elements.archerInput.value.trim(),
      date: this.elements.dateInput.value || getTodayAsIsoDate(),
      shooterNumber: this.elements.shooterNumberInput.value.trim(),
    };
  }

  /** Empties the archer's name, so the next card isn't saved under the last archer. */
  clearArcher(): void {
    this.elements.archerInput.value = "";
  }

  /** Moves the keyboard focus to the archer's name. */
  focusArcher(): void {
    this.elements.archerInput.focus();
  }

  /** Moves the keyboard focus to Round 1, arrow 1. */
  focusFirstArrow(): void {
    this.arrowSelects[0].focus();
  }

  /** Offers these names as suggestions while typing the archer's name. */
  setArcherSuggestions(names: readonly string[]): void {
    this.elements.archerNames.replaceChildren(
      ...names.map((name) => {
        const option = createElement("option");
        option.value = name;
        return option;
      }),
    );
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
      row.append(
        createElement("span", { className: "round-label", text: `Round ${roundIndex + 1}` }),
      );
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

    select.addEventListener("change", () => {
      this.arrowScores[arrowIndex] = select.value === "" ? null : Number(select.value);
      // A person has now checked this arrow, so it no longer needs review.
      this.arrowFlags[arrowIndex] = null;
      this.render();
      this.changeListeners.forEach((listener) => listener());
    });
    return select;
  }

  /** Keeps the shooter number to five digits as it's typed. */
  private handleShooterNumberInput(): void {
    const input = this.elements.shooterNumberInput;
    input.value = input.value.replace(/\D/g, "").slice(0, 5);
    this.shooterNumberNeedsReview = false;
    this.render();
  }

  /** Updates everything on the sheet from the current scores and flags. */
  private render(): void {
    const summary = summarizeScorecard(this.arrowScores);

    this.arrowSelects.forEach((select, arrowIndex) => {
      const score = this.arrowScores[arrowIndex];
      const flag = this.arrowFlags[arrowIndex];
      select.value = score === null ? "" : String(score);
      select.classList.toggle("is-ten", score === MAXIMUM_ARROW_SCORE);
      select.classList.toggle("is-empty", score === null);
      select.classList.toggle("needs-review", flag !== null);
      select.title = flag ?? "";
    });

    this.roundTotalElements.forEach((element, roundIndex) => {
      element.textContent = String(summary.roundTotals[roundIndex]);
      element.classList.toggle("is-incomplete", isRoundIncomplete(this.arrowScores, roundIndex));
    });

    this.distanceTotalElements[0].textContent = String(summary.tenMeterTotal);
    this.distanceTotalElements[1].textContent = String(summary.fifteenMeterTotal);
    this.elements.scorecardTotal.textContent = String(summary.total);
    this.elements.tenMeterTotal.textContent = String(summary.tenMeterTotal);
    this.elements.fifteenMeterTotal.textContent = String(summary.fifteenMeterTotal);
    this.elements.tensCount.textContent = String(summary.tensCount);
    this.elements.arrowsEntered.textContent = String(summary.arrowsEntered);
    this.elements.shooterNumberInput.classList.toggle(
      "needs-review",
      this.shooterNumberNeedsReview,
    );

    this.renderReviewList();
  }

  /**
   * Lists every spot the reader wants a person to check. Each entry is a
   * button that jumps to the arrow in question.
   */
  private renderReviewList(): void {
    const items: ReviewItem[] = [];
    this.arrowFlags.forEach((flag, arrowIndex) => {
      if (flag !== null) {
        items.push({
          label: describeArrow(arrowIndex),
          message: flag,
          target: this.arrowSelects[arrowIndex],
        });
      }
    });
    if (this.shooterNumberNeedsReview) {
      items.push({
        label: "Shooter #",
        message: SHOOTER_NUMBER_REVIEW_MESSAGE,
        target: this.elements.shooterNumberInput,
      });
    }

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
      button.addEventListener("click", () => item.target.focus());
      list.append(button);
    }
  }
}
