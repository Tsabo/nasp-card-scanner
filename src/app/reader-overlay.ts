/**
 * @file Draws what the reader saw on top of the photo: the timing marks it
 * found, a dot on every bubble, and a ring around each chosen bubble.
 * Seeing this makes misreads easy to spot.
 */

import type { CardReadResult, RowResult } from "../reader/analyze-card.ts";
import { readCssVariable } from "./page-helpers.ts";
import type { ReviewFlag } from "./score-sheet.ts";
import { ARROW_COUNT } from "./scoring.ts";
import type { ArrowScore } from "./scoring.ts";

/** Colour of the small dot drawn on every bubble. */
const BUBBLE_DOT_COLOR = "rgba(127, 127, 127, 0.55)";

/** Overlay colours, read from the stylesheet so they follow light and dark mode. */
interface OverlayColors {
  read: string;
  review: string;
  timingMark: string;
}

/**
 * Draws the overlay for a reading.
 *
 * The rings follow the score sheet rather than the original reading, so an
 * arrow the coach corrects moves its ring to the corrected bubble.
 *
 * @param context Already showing the photo.
 * @param arrowScores Current scores on the sheet.
 * @param arrowFlags Current review flags on the sheet.
 */
export function drawReaderOverlay(
  context: CanvasRenderingContext2D,
  reading: CardReadResult,
  arrowScores: readonly ArrowScore[],
  arrowFlags: readonly ReviewFlag[],
): void {
  const colors: OverlayColors = {
    read: readCssVariable("--color-accent"),
    review: readCssVariable("--color-review"),
    timingMark: readCssVariable("--color-timing-mark"),
  };
  const canvasWidth = context.canvas.width;

  // Timing marks. A dashed box means the mark was hidden and its position was inferred.
  const markHalfWidth = Math.max(4, canvasWidth / 220);
  context.strokeStyle = colors.timingMark;
  context.lineWidth = Math.max(1.5, canvasWidth / 700);
  for (const mark of reading.timingMarks) {
    context.setLineDash(mark.wasDetected ? [] : [3, 3]);
    context.strokeRect(
      mark.x - markHalfWidth,
      mark.y - markHalfWidth * 0.6,
      2 * markHalfWidth,
      1.2 * markHalfWidth,
    );
  }
  context.setLineDash([]);

  if (!reading.ok) {
    return;
  }

  const rows = [...reading.scores, ...reading.shooter];
  rows.forEach((row, rowIndex) => {
    const isArrowRow = rowIndex < ARROW_COUNT;
    const chosenBubble = isArrowRow ? arrowScores[rowIndex] : row.value;
    const needsReview = isArrowRow ? arrowFlags[rowIndex] !== null : row.flag !== null;
    drawRow(context, row, chosenBubble, needsReview, colors);
  });
}

/**
 * Draws one row: a dot on each bubble, then a ring on the chosen bubble, or
 * a dashed line through a row with nothing chosen that needs review.
 */
function drawRow(
  context: CanvasRenderingContext2D,
  row: RowResult,
  chosenBubble: number | null,
  needsReview: boolean,
  colors: OverlayColors,
): void {
  const { centers } = row;
  const bubbleSpacing = Math.hypot(centers[1].x - centers[0].x, centers[1].y - centers[0].y);
  const ringRadius = bubbleSpacing * 0.36;

  context.fillStyle = BUBBLE_DOT_COLOR;
  for (const center of centers) {
    context.beginPath();
    context.arc(center.x, center.y, Math.max(1.2, ringRadius * 0.12), 0, 2 * Math.PI);
    context.fill();
  }

  const chosenCenter = chosenBubble === null ? undefined : centers[chosenBubble];
  if (chosenCenter) {
    context.strokeStyle = needsReview ? colors.review : colors.read;
    context.lineWidth = Math.max(2, ringRadius * 0.28);
    context.beginPath();
    context.arc(chosenCenter.x, chosenCenter.y, ringRadius, 0, 2 * Math.PI);
    context.stroke();
  } else if (needsReview) {
    const first = centers[0];
    const last = centers[centers.length - 1];
    context.strokeStyle = colors.review;
    context.lineWidth = Math.max(2, ringRadius * 0.22);
    context.setLineDash([ringRadius * 0.5, ringRadius * 0.4]);
    context.beginPath();
    context.moveTo(first.x, first.y);
    context.lineTo(last.x, last.y);
    context.stroke();
    context.setLineDash([]);
  }
}
