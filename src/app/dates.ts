/**
 * @file Date helpers.
 */

/**
 * Returns today's date in the device's time zone as "YYYY-MM-DD", the
 * format used by date inputs and by the CSV export.
 *
 * (`new Date().toISOString()` would give the date in UTC, which is
 * tomorrow's date during a US evening practice.)
 */
export function getTodayAsIsoDate(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
