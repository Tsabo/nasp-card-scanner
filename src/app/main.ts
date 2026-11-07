/**
 * @file Starts the app and connects the page's buttons to the parts that do
 * the work:
 *
 * - {@link ScoreSheet}: the scorecard being worked on, drawn by
 *   {@link ScoreSheetView} and {@link PhotoPanel}.
 * - {@link PhotoPanel}: runs the reader and shows the photo.
 * - {@link LogStore}: saved scorecards, kept in this browser.
 * - {@link renderLog}: the table of saved scorecards, one format at a time.
 */

import {
  createCsv,
  createExportTable,
  createTabSeparatedText,
  readScorecardsFromCsv,
  UnrecognizedCsvError,
} from "./csv.ts";
import type { CsvImport } from "./csv.ts";
import { getTodayAsIsoDate } from "./dates.ts";
import { decodeImageFile, drawScaledCopy, isImageFile, loadImageFromUrl } from "./image-loading.ts";
import type { DecodedImage } from "./image-loading.ts";
import { downloadFile, getElement, showToast } from "./page-helpers.ts";
import { PhotoPanel } from "./photo-panel.ts";
import { LogStore, StorageUnavailableError } from "./log-store.ts";
import type { AddManyResult } from "./log-store.ts";
import { connectLogTabs, renderLog } from "./log-table.ts";
import { sortNewestFirst } from "./scorecard.ts";
import type { NewScorecard } from "./scorecard.ts";
import {
  FORMAT_LABELS,
  SCORECARD_FORMATS,
  loadRememberedFormat,
  rememberFormat,
} from "./scorecard-format.ts";
import type { ScorecardFormat } from "./scorecard-format.ts";
import {
  BLANK_CARD_LAYOUT_URL,
  BLANK_CARD_URL,
  SAMPLE_CARD_URL,
  createBlankReading,
  readBlankCardLayout,
} from "./sample-card.ts";
import { ScoreSheet } from "./score-sheet.ts";
import type { CardPhoto } from "./score-sheet.ts";
import { ScoreSheetView } from "./score-sheet-view.ts";
import { summarizeScorecard } from "./scoring.ts";
import { formatCount } from "./text.ts";
import { createXlsx } from "./xlsx.ts";

const MESSAGES = {
  storageBlocked:
    "This browser isn't letting the page save (private browsing?). Export before you close it.",
  copyBlocked:
    "Copying isn't allowed here. Select this text and copy it, then paste it into your spreadsheet.",
} as const;

/** The format whose tab is showing in the log. */
let logFormat: ScorecardFormat = loadRememberedFormat();

const photoPanel = new PhotoPanel();
const scoreSheet = new ScoreSheet<HTMLCanvasElement>({ format: logFormat });
const log = new LogStore();

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

  new ScoreSheetView(scoreSheet);
  scoreSheet.onFormatChange(rememberFormat);
  // Keep the photo panel in step with the sheet and the light or dark theme.
  scoreSheet.subscribe((state) => photoPanel.render(state));
  redrawPhoto();
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
    scoreSheet.showPhotoProblem("not-an-image");
    return;
  }
  let image: DecodedImage;
  try {
    image = await decodeImageFile(file);
  } catch {
    scoreSheet.showPhotoProblem("cannot-open");
    return;
  }
  await scoreSheet.readPhoto(photoPanel.readCard(image));
}

/** Loads and reads the built-in sample card. */
async function showSampleCard(): Promise<void> {
  await scoreSheet.readSample(
    loadImageFromUrl(SAMPLE_CARD_URL).then((image) => photoPanel.readCard(image)),
  );
}

/** Clears the sheet so every arrow can be typed in, showing the blank sample card. */
function enterScoresByHand(): void {
  void scoreSheet.enterByHand(loadBlankCard());
}

/** The blank sample card, loaded the first time it's needed. */
let blankCard: Promise<CardPhoto<HTMLCanvasElement>> | null = null;

/**
 * Loads the blank sample card and where its bubbles are. Nothing is read from
 * the photo: the bubble positions were stored when the card was drawn. A
 * failed load is tried again next time.
 */
function loadBlankCard(): Promise<CardPhoto<HTMLCanvasElement>> {
  blankCard ??= Promise.all([
    loadImageFromUrl(BLANK_CARD_URL),
    fetch(BLANK_CARD_LAYOUT_URL).then((response) => {
      if (!response.ok) {
        throw new Error(`Couldn't load ${BLANK_CARD_LAYOUT_URL}.`);
      }
      return response.json() as Promise<unknown>;
    }),
  ]).then(([image, data]) => {
    const layout = readBlankCardLayout(data);
    const photo = drawScaledCopy(image);
    return { image: photo, reading: createBlankReading(layout, photo.width / layout.width) };
  });
  blankCard.catch(() => {
    blankCard = null;
  });
  return blankCard;
}

/** Redraws the photo and overlay, for a change of theme or of the overlay checkbox. */
function redrawPhoto(): void {
  photoPanel.render(scoreSheet.getState());
}

// ---------------------------------------------------------------------------
// Saving and the log
// ---------------------------------------------------------------------------

/** Saves the score sheet as a new scorecard in the log. */
function saveScorecard(): void {
  const saved = scoreSheet.save(addToLog);
  if (saved === null) {
    return;
  }
  // Show the tab the new scorecard is on.
  showLogFormat(saved.format);
  const who = saved.archer || `#${saved.shooterNumber}`;
  showToast(`Saved ${who}: ${summarizeScorecard(saved.arrowScores).total}`);
}

/**
 * Adds a scorecard to the log.
 *
 * @returns False when the browser wouldn't save it.
 */
function addToLog(scorecard: NewScorecard): boolean {
  try {
    log.add(scorecard);
    return true;
  } catch (error) {
    if (error instanceof StorageUnavailableError) {
      return false;
    }
    throw error;
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
  scoreSheet.setLog(scorecards);
  const isTabEmpty = getVisibleExportTable().rows.length === 0;
  getElement("download-excel-button", HTMLButtonElement).disabled = scorecards.length === 0;
  getElement("download-csv-button", HTMLButtonElement).disabled = isTabEmpty;
  getElement("copy-for-spreadsheet-button", HTMLButtonElement).disabled = isTabEmpty;
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
