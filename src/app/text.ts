/**
 * @file Helpers for wording messages. No page code, so they can be used by
 * modules that run in Node tests.
 */

/**
 * Formats a count with the right singular or plural word, such as
 * "1 scorecard" or "3 scorecards".
 *
 * @param plural Defaults to the singular plus "s".
 */
export function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
