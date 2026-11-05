/**
 * @file Small helpers for working with the page.
 */

/**
 * Finds an element by id and checks its type, so a renamed or missing
 * element fails loudly at startup instead of quietly later.
 *
 * Usage: `const input = getElement("archer-input", HTMLInputElement);`
 *
 * @param expectedType The element's class, such as HTMLInputElement.
 */
export function getElement<T extends HTMLElement>(
  id: string,
  expectedType: { new (): T; prototype: T },
): T {
  const element = document.getElementById(id);
  if (!(element instanceof expectedType)) {
    throw new Error(`Expected #${id} to be a ${expectedType.name}, found ${String(element)}.`);
  }
  return element;
}

/** Options for {@link createElement}. */
interface CreateElementOptions {
  className?: string;
  text?: string | number;
}

/** Creates an element with optional CSS classes and text. */
export function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  options: CreateElementOptions = {},
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  if (options.className) {
    element.className = options.className;
  }
  if (options.text !== undefined) {
    element.textContent = String(options.text);
  }
  return element;
}

/** How long a toast message stays on screen. */
const TOAST_DURATION_MILLISECONDS = 2600;

let toastTimer: ReturnType<typeof setTimeout> | undefined;

/** Shows a short message at the bottom of the screen for a few seconds. */
export function showToast(message: string): void {
  const toast = getElement("toast", HTMLDivElement);
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, TOAST_DURATION_MILLISECONDS);
}

/**
 * Saves text as a file in the browser's downloads.
 *
 * @param mimeType Such as "text/csv;charset=utf-8".
 */
export function downloadTextFile(fileName: string, contents: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: mimeType }));
  const link = createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before releasing the file.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Reads a colour (or any other custom property) defined in the stylesheet,
 * so canvas drawings match the current light or dark theme.
 *
 * @param propertyName Such as "--color-accent".
 */
export function readCssVariable(propertyName: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(propertyName).trim();
}

/**
 * Formats a count with the right singular or plural word, such as
 * "1 scorecard" or "3 scorecards".
 *
 * @param plural Defaults to the singular plus "s".
 */
export function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
