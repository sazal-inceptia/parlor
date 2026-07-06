/**
 * Text Utilities — Bengali-aware string helpers.
 *
 * Pure functions with no dependencies on other project modules.
 */

/**
 * Split Bengali text into sentences for streaming TTS.
 *
 * Handles Bengali sentence terminators (।, ॥) as well as
 * standard punctuation (!, ?).
 *
 * @param {string} text
 * @returns {string[]}
 */
function splitSentences(text) {
  if (!text) return [];
  const parts = text.split(/(?<=[।॥!?])\s*/);
  return parts.filter((s) => s.trim().length > 0);
}

/**
 * Escape a string for safe use in a shell command argument.
 *
 * @param {string} text
 * @returns {string}
 */
function escapeShellArg(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, ' ')
    .replace(/\r/g, '');
}

module.exports = { splitSentences, escapeShellArg };
