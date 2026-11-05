/**
 * @file The photo panel: shows the photo, runs the reader on it, and draws
 * the reader's overlay.
 */

import { analyzeCard } from "../reader/analyze-card.ts";
import type { CardReadResult } from "../reader/analyze-card.ts";
import { drawScaledCopy } from "./image-loading.ts";
import type { DecodedImage } from "./image-loading.ts";
import { getElement } from "./page-helpers.ts";
import { drawReaderOverlay } from "./reader-overlay.ts";
import type { ReviewFlag } from "./score-sheet.ts";
import type { ArrowScore } from "./scoring.ts";

/** The look of the badge in the panel's corner. */
export type BadgeKind = "sample" | "read" | "manual" | "error";

const BADGES: Record<BadgeKind, { text: string; className: string }> = {
  sample: { text: "Sample card", className: "badge is-sample" },
  read: { text: "Read", className: "badge" },
  manual: { text: "By hand", className: "badge" },
  error: { text: "Couldn't read", className: "badge is-error" },
};

export class PhotoPanel {
  /** The element that photos can be dropped onto. */
  readonly dropZone = getElement("photo-drop-zone", HTMLDivElement);

  private readonly canvas = getElement("photo-canvas", HTMLCanvasElement);
  private readonly statusElement = getElement("photo-status", HTMLDivElement);
  private readonly badgeElement = getElement("photo-source-badge", HTMLSpanElement);
  private readonly overlayCheckbox = getElement("show-overlay-checkbox", HTMLInputElement);

  /** The current photo, already scaled. */
  private photo: HTMLCanvasElement | null = null;
  /** What the reader found in the current photo. */
  private reading: CardReadResult | null = null;

  /** Registers a function to call when the overlay checkbox is changed. */
  onOverlayToggle(listener: () => void): void {
    this.overlayCheckbox.addEventListener("change", listener);
  }

  /** Shows a photo and reads the card in it. */
  async readCard(image: DecodedImage): Promise<CardReadResult> {
    this.setStatus("Reading the card…");
    // Let the browser paint the status message before the reader takes over
    // the main thread for a moment.
    await new Promise((resolve) => setTimeout(resolve, 20));

    const photo = drawScaledCopy(image);
    this.photo = photo;
    this.reading = runReader(photo);
    return this.reading;
  }

  /** Removes the reader's results, for entering scores by hand. Keeps the photo. */
  clearReading(): void {
    this.reading = null;
  }

  /**
   * Redraws the photo and, if enabled, the reader's overlay.
   *
   * @param arrowScores Current scores on the sheet.
   * @param arrowFlags Current review flags on the sheet.
   */
  draw(arrowScores: readonly ArrowScore[], arrowFlags: readonly ReviewFlag[]): void {
    const { canvas, photo } = this;
    if (!photo) {
      return;
    }
    if (canvas.width !== photo.width || canvas.height !== photo.height) {
      canvas.width = photo.width;
      canvas.height = photo.height;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    context.drawImage(photo, 0, 0);
    if (this.reading && this.overlayCheckbox.checked) {
      drawReaderOverlay(context, this.reading, arrowScores, arrowFlags);
    }
  }

  /**
   * Shows a message under the photo.
   *
   * @param isProblem Problems are shown in the warning colour.
   */
  setStatus(message: string, { isProblem = false }: { isProblem?: boolean } = {}): void {
    this.statusElement.textContent = message;
    this.statusElement.classList.toggle("is-problem", isProblem);
  }

  /** Sets the badge in the panel's corner. */
  setBadge(kind: BadgeKind): void {
    this.badgeElement.textContent = BADGES[kind].text;
    this.badgeElement.className = BADGES[kind].className;
  }
}

/**
 * Runs the reader on a canvas, turning any unexpected error into a failed
 * read so the page keeps working.
 */
function runReader(photo: HTMLCanvasElement): CardReadResult {
  try {
    const context = photo.getContext("2d", { willReadFrequently: true });
    if (!context) {
      throw new Error("This browser can't read image pixels.");
    }
    const pixels = context.getImageData(0, 0, photo.width, photo.height);
    return analyzeCard(pixels.data, photo.width, photo.height);
  } catch (error) {
    console.error(error);
    return { ok: false, error: "Something went wrong while reading this photo.", timingMarks: [] };
  }
}
