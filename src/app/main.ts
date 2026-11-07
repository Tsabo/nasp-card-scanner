/**
 * @file Starts the app and connects the page's buttons to the parts that do
 * the work:
 *
 * - {@link PhotoPanel}: shows the photo and runs the reader.
 * - {@link ScoreSheet}: the editable scores and totals.
 * - {@link LogStore}: saved scorecards, kept in this browser.
 * - {@link renderLog}: the table of saved scorecards, one format at a time.
 */

import type { CardReadResult } from "../reader/analyze-card.ts";
import {
  createCsv,
  createExportTable,
  createTabSeparatedText,
  readScorecardsFromCsv,
  UnrecognizedCsvError,
} from "./csv.ts";
import type { CsvImport } from "./csv.ts";
import { getTodayAsIsoDate } from "./dates.ts";
import { decodeImageFile, isImageFile, loadImageFromUrl } from "./image-loading.ts";
import type { DecodedImage } from "./image-loading.ts";
import { downloadFile, formatCount, getElement, showToast } from "./page-helpers.ts";
import { PhotoPanel } from "./photo-panel.ts";
import { LogStore, StorageUnavailableError } from "./log-store.ts";
import type { AddManyResult } from "./log-store.ts";
import { ArcherDirectory, readShooterNumber } from "./archer-fields.ts";
import { connectLogTabs, getArcherNames, renderLog } from "./log-table.ts";
import { findSaveProblem, sortNewestFirst } from "./scorecard.ts";
import type { SaveProblem } from "./scorecard.ts";
import {
  FORMAT_LABELS,
  SCORECARD_FORMATS,
  loadRememberedFormat,
  rememberFormat,
} from "./scorecard-format.ts";
import type { ScorecardFormat } from "./scorecard-format.ts";
import { ScoreSheet } from "./score-sheet.ts";
import { summarizeScorecard } from "./scoring.ts";
import { createXlsx } from "./xlsx.ts";

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
  partialShooterNumber:
    "Enter all five digits of the Shooter #, including any leading zeros, like 00123, or clear it.",
  needsSide: "Choose the side this archer shot from.",
  needsFirstAnimal: "Choose the first animal this archer shot.",
  noScores: "There are no scores to save yet.",
  cannotSave:
    "This browser wouldn't save the scorecard. Its storage may be full or blocked in private browsing.",
  storageBlocked:
    "This browser isn't letting the page save (private browsing?). Export before you close it.",
  copyBlocked:
    "Copying isn't allowed here. Select this text and copy it, then paste it into your spreadsheet.",
} as const;

const photoPanel = new PhotoPanel();
const scoreSheet = new ScoreSheet();
const log = new LogStore();

/** The format whose tab is showing in the log. */
let logFormat: ScorecardFormat = loadRememberedFormat();

startApp();

/** Connects every control on the page, then shows the sample card. */
function startApp(): void {
  connectPhotoInputs();
  getElement("enter-by-hand-button", HTMLButtonElement).addEventListener(
    "click",
    enterScoresByHand,
  );
  getElement("save-scorecard-button", HTMLButtonElement).addEventListener("click", saveScorecard);
  getElement("download-excel-button", HTMLButtonElement).addEventListener("click", downloadExcel);
  getElement("download-csv-button", HTMLButtonElement).addEventListener("click", downloadCsv);
  getElement("copy-for-spreadsheet-button", HTMLButtonElement).addEventListener(
    "click",
    copyForSpreadsheet,
  );
  onFileChosen("import-csv-input", importCsv);
  connectLogTabs(showLogFormat);

  scoreSheet.setFormat(logFormat);
  scoreSheet.onFormatChange(rememberFormat);
  // Choosing a side or an animal answers the message asking for one, and
  // changing the archer or Shooter # answers the messages about those.
  getElement("side-select", HTMLSelectElement).addEventListener("change", clearSaveMessage);
  getElement("first-animal-select", HTMLSelectElement).addEventListener("change", clearSaveMessage);
  getElement("archer-input", HTMLInputElement).addEventListener("input", clearSaveMessage);
  getElement("shooter-number-input", HTMLInputElement).addEventListener("input", clearSaveMessage);

  // Keep the overlay in step with the sheet and the light or dark theme.
  scoreSheet.onChange(redrawPhoto);
  photoPanel.onOverlayToggle(redrawPhoto);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redrawPhoto);

  if (!log.canSave()) {
    getElement("log-message", HTMLParagraphElement).textContent = MESSAGES.storageBlocked;
  }
  LogStore.requestPersistentStorage();
  refreshLog();

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
  scoreSheet.clearSideAndFirstAnimal();
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

  const { shooterNumber, needsReview: shooterNumberNeedsReview } = readShooterNumber(
    reading.shooter,
  );
  scoreSheet.showReading({
    arrowScores: reading.scores.map((arrow) => arrow.value),
    arrowFlags: reading.scores.map((arrow) => arrow.flag),
    shooterNumber,
    shooterNumberNeedsReview,
  });

  if (isSample) {
    photoPanel.setBadge("sample");
    photoPanel.setStatus(MESSAGES.sampleRead);
  } else {
    photoPanel.setBadge("read");
    photoPanel.setStatus(describeReadResult(scoreSheet.getReviewCount()));
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
  scoreSheet.clearArcher();
  scoreSheet.clear();
  scoreSheet.clearSideAndFirstAnimal();
  clearSaveMessage();
  redrawPhoto();
  scoreSheet.focusFirstArrow();
}

/** Redraws the photo and overlay to match the score sheet. */
function redrawPhoto(): void {
  photoPanel.draw(scoreSheet.getArrowScores(), scoreSheet.getArrowFlags());
}

// ---------------------------------------------------------------------------
// Saving and the log
// ---------------------------------------------------------------------------

/** Saves the score sheet as a new scorecard in the log. */
function saveScorecard(): void {
  const details = scoreSheet.getScorecardDetails();
  const arrowScores = scoreSheet.getArrowScores();
  const blankCount = arrowScores.filter((score) => score === null).length;

  const problem = findSaveProblem({ ...details, arrowScores });
  if (problem !== null) {
    showSaveProblem(problem);
    return;
  }

  try {
    log.add({ ...details, arrowScores, createdAt: Date.now() });
  } catch (error) {
    if (error instanceof StorageUnavailableError) {
      setSaveMessage(MESSAGES.cannotSave, { isProblem: true });
      return;
    }
    throw error;
  }

  // Show the tab the new scorecard is on.
  showLogFormat(details.format);
  const who = details.archer || `#${details.shooterNumber}`;
  showToast(`Saved ${who}: ${summarizeScorecard(arrowScores).total}`);
  setSaveMessage(
    blankCount === 0
      ? "Saved. Scan the next card when you're ready."
      : `Saved with ${formatCount(blankCount, "blank arrow")} counted as 0.`,
  );
}

/** Explains why the score sheet can't be saved, and moves to the field to fix. */
function showSaveProblem(problem: SaveProblem): void {
  switch (problem) {
    case "no-archer":
      setSaveMessage(MESSAGES.needsArcher, { isProblem: true });
      scoreSheet.focusArcher();
      return;
    case "partial-shooter-number":
      setSaveMessage(MESSAGES.partialShooterNumber, { isProblem: true });
      scoreSheet.showShooterNumberProblem();
      return;
    case "no-side":
      setSaveMessage(MESSAGES.needsSide, { isProblem: true });
      scoreSheet.focusSide();
      return;
    case "no-first-animal":
      setSaveMessage(MESSAGES.needsFirstAnimal, { isProblem: true });
      scoreSheet.focusFirstAnimal();
      return;
    case "no-scores":
      setSaveMessage(MESSAGES.noScores, { isProblem: true });
      return;
  }
}

/** Deletes a scorecard from the log. */
function deleteScorecard(scorecardId: string): void {
  try {
    log.remove(scorecardId);
    showToast("Scorecard deleted");
  } catch {
    showToast("Couldn't delete that scorecard. Try again.");
  }
  refreshLog();
}

/** Shows one format's tab in the log. */
function showLogFormat(format: ScorecardFormat): void {
  logFormat = format;
  // Any text shown for copying by hand belongs to the previous tab.
  getElement("copy-fallback", HTMLDivElement).hidden = true;
  refreshLog();
}

/** Returns the export table for the tab that's showing, newest first. */
function getVisibleExportTable(): ReturnType<typeof createExportTable> {
  return createExportTable(logFormat, sortNewestFirst(log.getAll()));
}

/** Redraws the log table and the export buttons, and updates name suggestions. */
function refreshLog(): void {
  const scorecards = log.getAll();
  renderLog(scorecards, logFormat, deleteScorecard);
  scoreSheet.setArcherSuggestions(getArcherNames(scorecards));
  scoreSheet.setArcherDirectory(new ArcherDirectory(scorecards));
  const isTabEmpty = getVisibleExportTable().rows.length === 0;
  getElement("download-excel-button", HTMLButtonElement).disabled = scorecards.length === 0;
  getElement("download-csv-button", HTMLButtonElement).disabled = isTabEmpty;
  getElement("copy-for-spreadsheet-button", HTMLButtonElement).disabled = isTabEmpty;
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

/** Downloads the whole log as an Excel workbook, with a sheet for each format. */
function downloadExcel(): void {
  const scorecards = sortNewestFirst(log.getAll());
  const workbook = createXlsx(
    SCORECARD_FORMATS.map((format) => ({
      name: FORMAT_LABELS[format],
      ...createExportTable(format, scorecards),
    })),
  );
  downloadFile(
    `nasp-log-${getTodayAsIsoDate()}.xlsx`,
    workbook,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  showToast("Excel file downloaded");
}

/** Downloads the tab that's showing as a CSV file. */
function downloadCsv(): void {
  const scorecards = sortNewestFirst(log.getAll());
  downloadFile(
    `nasp-${logFormat}-${getTodayAsIsoDate()}.csv`,
    createCsv(logFormat, scorecards),
    "text/csv;charset=utf-8",
  );
  showToast("CSV downloaded");
}

/** Copies the tab that's showing as tab-separated text, ready to paste into a spreadsheet. */
async function copyForSpreadsheet(): Promise<void> {
  const scorecards = sortNewestFirst(log.getAll());
  const text = createTabSeparatedText(logFormat, scorecards);
  const copiedCount = getVisibleExportTable().rows.length;
  try {
    await navigator.clipboard.writeText(text);
    showToast(
      `Copied ${formatCount(copiedCount, "scorecard")}. Paste into Excel or Google Sheets.`,
    );
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
 * Adds the scorecards from a CSV file (exported from this page, perhaps on
 * another device) to the log.
 */
async function importCsv(file: File): Promise<void> {
  let imported: CsvImport;
  try {
    imported = readScorecardsFromCsv(await file.text());
  } catch (error) {
    showToast(error instanceof UnrecognizedCsvError ? error.message : "Couldn't read that file.");
    return;
  }

  let result: AddManyResult;
  try {
    result = log.addMany(imported.scorecards);
  } catch {
    showToast("This browser wouldn't save the imported scorecards.");
    return;
  }
  refreshLog();

  const parts = [`Imported ${describeImportedScorecards(result)}`];
  if (result.duplicateCount > 0) {
    parts.push(`${result.duplicateCount} already in the log`);
  }
  if (imported.unreadableRowCount > 0) {
    parts.push(`${formatCount(imported.unreadableRowCount, "unreadable row")} skipped`);
  }
  showToast(`${parts.join(", ")}.`);
}

/** Words the import count by format, such as "2 Bullseye and 3 3D scorecards". */
function describeImportedScorecards({ addedCount, addedCountByFormat }: AddManyResult): string {
  const { bullseye, "3d": threeD } = addedCountByFormat;
  if (bullseye > 0 && threeD > 0) {
    return `${bullseye} ${FORMAT_LABELS.bullseye} and ${formatCount(threeD, `${FORMAT_LABELS["3d"]} scorecard`)}`;
  }
  if (addedCount === 0) {
    return "0 scorecards";
  }
  const label = FORMAT_LABELS[bullseye > 0 ? "bullseye" : "3d"];
  return formatCount(addedCount, `${label} scorecard`);
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
