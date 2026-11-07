/**
 * @file The photo panel: runs the reader on a photo, and draws the photo, the
 * reader's overlay, the badge and the status message from the Score sheet's
 * state. The Score sheet decides what they say.
 */

import { analyzeCard } from "../reader/analyze-card.ts";
import type { CardReadResult } from "../reader/analyze-card.ts";
import { drawScaledCopy } from "./image-loading.ts";
import type { DecodedImage } from "./image-loading.ts";
import { getElement } from "./page-helpers.ts";
import { drawReaderOverlay } from "./reader-overlay.ts";
import type { BadgeKind, CardPhoto, SheetState } from "./score-sheet.ts";

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

  /** Registers a function to call when the overlay checkbox is changed. */
  onOverlayToggle(listener: () => void): void {
    this.overlayCheckbox.addEventListener("change", listener);
  }

  /** Scales a photo and reads the card in it. */
  async readCard(image: DecodedImage): Promise<CardPhoto<HTMLCanvasElement>> {
    // Let the browser paint the "Reading the card…" status before the reader
    // takes over the main thread for a moment.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const photo = drawScaledCopy(image);
    return { image: photo, reading: runReader(photo) };
  }

  /** Redraws the badge, the status message, the photo and, if enabled, the reader's overlay. */
  render(state: SheetState<HTMLCanvasElement>): void {
    const { status } = state;
    this.badgeElement.textContent = BADGES[status.badge].text;
    this.badgeElement.className = BADGES[status.badge].className;
    this.statusElement.textContent = status.text;
    this.statusElement.classList.toggle("is-problem", status.isProblem);

    const { canvas } = this;
    canvas.hidden = state.photo === null;
    if (!state.photo) {
      return;
    }
    const { image: photo, reading, rings } = state.photo;
    if (canvas.width !== photo.width || canvas.height !== photo.height) {
      canvas.width = photo.width;
      canvas.height = photo.height;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    context.drawImage(photo, 0, 0);
    if (this.overlayCheckbox.checked) {
      drawReaderOverlay(context, reading, rings);
    }
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
