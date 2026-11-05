/**
 * @file Starts the app and connects the page's buttons to the parts that do
 * the work:
 *
 * - {@link PhotoPanel}: shows the photo and runs the reader.
 * - {@link ScoreSheet}: the editable scores and totals.
 * - {@link PracticeLogStore}: saved rounds, kept in this browser.
 * - {@link renderPracticeLog}: the table of saved rounds.
 */

import type { CardReadResult } from "../reader/analyze-card.ts";
import {
  createCsv,
  createTabSeparatedText,
  readRoundsFromCsv,
  UnrecognizedCsvError,
} from "./csv.ts";
import type { CsvImport } from "./csv.ts";
import { getTodayAsIsoDate } from "./dates.ts";
import { decodeImageFile, isImageFile, loadImageFromUrl } from "./image-loading.ts";
import type { DecodedImage } from "./image-loading.ts";
import { downloadTextFile, formatCount, getElement, showToast } from "./page-helpers.ts";
import { PhotoPanel } from "./photo-panel.ts";
import { PracticeLogStore, StorageUnavailableError } from "./practice-log-store.ts";
import type { AddManyResult } from "./practice-log-store.ts";
import { getArcherNames, renderPracticeLog } from "./practice-log-view.ts";
import { sortNewestFirst } from "./practice-round.ts";
import { ScoreSheet } from "./score-sheet.ts";
import { ARROW_COUNT, summarizeRound } from "./scoring.ts";

/** The simulated card shown when the page first opens. */
const SAMPLE_CARD_URL = "assets/sample-card.jpg";

const MESSAGES = {
  sampleRead:
    "This is a sample card with one double-marked arrow. Take a photo of one of yours to start.",
  noSample: "Take a photo of a score card to start.",
  notAnImage: "That file isn't an image. Choose a photo of the score card.",
  cannotOpenImage: "This browser couldn't open that image. Try a JPEG or PNG.",
  retakeAdvice:
    "Retake it with the whole card in frame, flat and evenly lit, or enter the scores by hand.",
  enterByHand: "Enter each arrow on the score sheet.",
  needsArcher: "Add the archer's name or shooter number first.",
  noScores: "There are no scores to save yet.",
  cannotSave:
    "This browser wouldn't save the round. Its storage may be full or blocked in private browsing.",
  storageBlocked:
    "This browser isn't letting the page save (private browsing?). Export before you close it.",
  copyBlocked:
    "Copying isn't allowed here. Select this text and copy it, then paste it into your spreadsheet.",
} as const;

const photoPanel = new PhotoPanel();
const scoreSheet = new ScoreSheet();
const practiceLog = new PracticeLogStore();

startApp();

/** Connects every control on the page, then shows the sample card. */
function startApp(): void {
  connectPhotoInputs();
  getElement("enter-by-hand-button", HTMLButtonElement).addEventListener(
    "click",
    enterScoresByHand,
  );
  getElement("save-round-button", HTMLButtonElement).addEventListener("click", saveRound);
  getElement("download-csv-button", HTMLButtonElement).addEventListener("click", downloadCsv);
  getElement("copy-for-spreadsheet-button", HTMLButtonElement).addEventListener(
    "click",
    copyForSpreadsheet,
  );
  onFileChosen("import-csv-input", importCsv);

  // Keep the overlay in step with the sheet and the light or dark theme.
  scoreSheet.onChange(redrawPhoto);
  photoPanel.onOverlayToggle(redrawPhoto);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redrawPhoto);

  if (!practiceLog.canSave()) {
    getElement("practice-log-message", HTMLParagraphElement).textContent = MESSAGES.storageBlocked;
  }
  PracticeLogStore.requestPersistentStorage();
  refreshPracticeLog();

  void showSampleCard();
  registerOfflineSupport();
}

/**
 * Calls `handler` with the file chosen in a file input. Clears the input
 * afterwards, so choosing the same file again still counts as a new choice.
 */
function onFileChosen(inputId: string, handler: (file: File) => unknown): void {
  const input = getElement(inputId, HTMLInputElement);
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    input.value = "";
    if (file) {
      void handler(file);
    }
  });
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

/** Accepts photos from the camera, the file picker, drag and drop, and paste. */
function connectPhotoInputs(): void {
  onFileChosen("take-photo-input", readPhotoFile);
  onFileChosen("upload-photo-input", readPhotoFile);

  const dropZone = photoPanel.dropZone;
  dropZone.addEventListener("dragover", (event) => event.preventDefault());
  dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files[0];
    if (file) {
      void readPhotoFile(file);
    }
  });

  document.addEventListener("paste", (event) => {
    const files = Array.from(event.clipboardData?.files ?? []);
    const image = files.find((file) => file.type.startsWith("image/"));
    if (image) {
      void readPhotoFile(image);
    }
  });
}

/** Opens a photo the coach chose and reads the card in it. */
async function readPhotoFile(file: File): Promise<void> {
  if (!isImageFile(file)) {
    photoPanel.setStatus(MESSAGES.notAnImage, { isProblem: true });
    return;
  }
  let image: DecodedImage;
  try {
    image = await decodeImageFile(file);
  } catch {
    photoPanel.setStatus(MESSAGES.cannotOpenImage, { isProblem: true });
    return;
  }

  const reading = await photoPanel.readCard(image);
  // A new card is usually a new archer.
  scoreSheet.clearArcher();
  showReading(reading, { isSample: false });
}

/** Loads and reads the built-in sample card. */
async function showSampleCard(): Promise<void> {
  try {
    const image = await loadImageFromUrl(SAMPLE_CARD_URL);
    const reading = await photoPanel.readCard(image);
    showReading(reading, { isSample: true });
  } catch {
    photoPanel.setStatus(MESSAGES.noSample);
  }
}

/** Puts what the reader found onto the score sheet and explains it. */
function showReading(reading: CardReadResult, { isSample }: { isSample: boolean }): void {
  clearSaveMessage();

  if (!reading.ok) {
    scoreSheet.clear();
    photoPanel.setBadge("error");
    photoPanel.setStatus(`${reading.error} ${MESSAGES.retakeAdvice}`, { isProblem: true });
    redrawPhoto();
    return;
  }

  const shooterDigits = reading.shooter.map((digit) =>
    digit.value === null ? "" : String(digit.value),
  );
  const shooterNumberNeedsReview = reading.shooter.some((digit) => digit.flag !== null);
  scoreSheet.showReading({
    arrowScores: reading.scores.map((arrow) => arrow.value),
    arrowFlags: reading.scores.map((arrow) => arrow.flag),
    shooterNumber: shooterDigits.join(""),
    shooterNumberNeedsReview,
  });

  if (isSample) {
    photoPanel.setBadge("sample");
    photoPanel.setStatus(MESSAGES.sampleRead);
  } else {
    const flaggedArrows = reading.scores.filter((arrow) => arrow.flag !== null).length;
    const spotsToCheck = flaggedArrows + (shooterNumberNeedsReview ? 1 : 0);
    photoPanel.setBadge("read");
    photoPanel.setStatus(describeReadResult(spotsToCheck));
  }
  redrawPhoto();
}

/** Builds the status message after a successful read. */
function describeReadResult(spotsToCheck: number): string {
  if (spotsToCheck === 0) {
    return "Read all 30 arrows. Check the sheet against the card, then save.";
  }
  const spots = spotsToCheck === 1 ? "One spot needs" : `${spotsToCheck} spots need`;
  return `Read all 30 arrows. ${spots} a look before you save.`;
}

/** Clears the sheet so every arrow can be typed in. */
function enterScoresByHand(): void {
  photoPanel.clearReading();
  photoPanel.setBadge("manual");
  photoPanel.setStatus(MESSAGES.enterByHand);
  scoreSheet.clear();
  clearSaveMessage();
  redrawPhoto();
  scoreSheet.focusFirstArrow();
}

/** Redraws the photo and overlay to match the score sheet. */
function redrawPhoto(): void {
  photoPanel.draw(scoreSheet.getArrowScores(), scoreSheet.getArrowFlags());
}

// ---------------------------------------------------------------------------
// Saving and the practice log
// ---------------------------------------------------------------------------

/** Saves the score sheet as a new round in the practice log. */
function saveRound(): void {
  const details = scoreSheet.getRoundDetails();
  const arrowScores = scoreSheet.getArrowScores();
  const blankCount = arrowScores.filter((score) => score === null).length;

  if (!details.archer && !details.shooterNumber) {
    setSaveMessage(MESSAGES.needsArcher, { isProblem: true });
    scoreSheet.focusArcher();
    return;
  }
  if (blankCount === ARROW_COUNT) {
    setSaveMessage(MESSAGES.noScores, { isProblem: true });
    return;
  }

  try {
    practiceLog.add({ ...details, arrowScores, createdAt: Date.now() });
  } catch (error) {
    if (error instanceof StorageUnavailableError) {
      setSaveMessage(MESSAGES.cannotSave, { isProblem: true });
      return;
    }
    throw error;
  }

  refreshPracticeLog();
  const who = details.archer || `#${details.shooterNumber}`;
  showToast(`Saved ${who}: ${summarizeRound(arrowScores).total}`);
  setSaveMessage(
    blankCount === 0
      ? "Saved. Scan the next card when you're ready."
      : `Saved with ${formatCount(blankCount, "blank arrow")} counted as 0.`,
  );
}

/** Deletes a round from the practice log. */
function deleteRound(roundId: string): void {
  try {
    practiceLog.remove(roundId);
    showToast("Round deleted");
  } catch {
    showToast("Couldn't delete that round. Try again.");
  }
  refreshPracticeLog();
}

/** Redraws the log table and the export buttons, and updates name suggestions. */
function refreshPracticeLog(): void {
  const rounds = practiceLog.getAll();
  renderPracticeLog(rounds, deleteRound);
  scoreSheet.setArcherSuggestions(getArcherNames(rounds));
  const isEmpty = rounds.length === 0;
  getElement("download-csv-button", HTMLButtonElement).disabled = isEmpty;
  getElement("copy-for-spreadsheet-button", HTMLButtonElement).disabled = isEmpty;
}

/** Shows a message beside the Save button. */
function setSaveMessage(
  message: string,
  { isProblem = false }: { isProblem?: boolean } = {},
): void {
  const element = getElement("save-message", HTMLSpanElement);
  element.textContent = message;
  element.classList.toggle("is-problem", isProblem);
}

function clearSaveMessage(): void {
  setSaveMessage("");
}

// ---------------------------------------------------------------------------
// Export and import
// ---------------------------------------------------------------------------

/** Downloads the whole log as a CSV file. */
function downloadCsv(): void {
  const rounds = sortNewestFirst(practiceLog.getAll());
  downloadTextFile(
    `nasp-practice-${getTodayAsIsoDate()}.csv`,
    createCsv(rounds),
    "text/csv;charset=utf-8",
  );
  showToast("CSV downloaded");
}

/** Copies the whole log as tab-separated text, ready to paste into a spreadsheet. */
async function copyForSpreadsheet(): Promise<void> {
  const rounds = sortNewestFirst(practiceLog.getAll());
  const text = createTabSeparatedText(rounds);
  try {
    await navigator.clipboard.writeText(text);
    showToast(`Copied ${formatCount(rounds.length, "round")}. Paste into Excel or Google Sheets.`);
  } catch {
    // Some browsers block the clipboard. Show the text so it can be copied by hand.
    getElement("copy-fallback", HTMLDivElement).hidden = false;
    getElement("copy-fallback-message", HTMLSpanElement).textContent = MESSAGES.copyBlocked;
    const textArea = getElement("copy-fallback-text", HTMLTextAreaElement);
    textArea.value = text;
    textArea.focus();
    textArea.select();
  }
}

/**
 * Adds the rounds from a CSV file (exported from this page, perhaps on
 * another device) to the log.
 */
async function importCsv(file: File): Promise<void> {
  let imported: CsvImport;
  try {
    imported = readRoundsFromCsv(await file.text());
  } catch (error) {
    showToast(error instanceof UnrecognizedCsvError ? error.message : "Couldn't read that file.");
    return;
  }

  let result: AddManyResult;
  try {
    result = practiceLog.addMany(imported.rounds);
  } catch {
    showToast("This browser wouldn't save the imported rounds.");
    return;
  }
  refreshPracticeLog();

  const parts = [`Imported ${formatCount(result.addedCount, "round")}`];
  if (result.duplicateCount > 0) {
    parts.push(`${result.duplicateCount} already in the log`);
  }
  if (imported.unreadableRowCount > 0) {
    parts.push(`${formatCount(imported.unreadableRowCount, "unreadable row")} skipped`);
  }
  showToast(`${parts.join(", ")}.`);
}

// ---------------------------------------------------------------------------
// Offline support
// ---------------------------------------------------------------------------

/**
 * Registers the service worker that lets the app open without a signal.
 * Browsers only allow this on HTTPS sites and on this computer (localhost).
 */
function registerOfflineSupport(): void {
  const isAllowedHere =
    location.protocol === "https:" ||
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1";
  if ("serviceWorker" in navigator && isAllowedHere) {
    navigator.serviceWorker.register("sw.js").catch((error: unknown) => {
      console.warn("Offline support is unavailable:", error);
    });
  }
}
