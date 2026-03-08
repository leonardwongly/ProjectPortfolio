/**
 * Utility functions for HTML escaping and URL sanitization.
 */

/**
 * Escapes HTML special characters to prevent XSS attacks.
 *
 * @param {*} value - Value to escape
 * @returns {string} Escaped HTML string
 */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Safely returns a sanitized href with fallback for invalid URLs.
 *
 * @param {string} rawValue - Raw URL to sanitize
 * @param {string} fieldPath - Field path for error messages
 * @param {Object} options - Options object
 * @param {string} options.fallback - Fallback value for invalid URLs
 * @param {Function} sanitizeHref - Sanitization function from build.js
 * @returns {string} Sanitized URL or fallback
 */
function safeHref(rawValue, fieldPath, { fallback = '#' } = {}, sanitizeHref) {
  try {
    return sanitizeHref(rawValue, fieldPath);
  } catch (error) {
    console.warn(`[build] ${error.message}. Falling back to "${fallback}".`);
    return fallback;
  }
}

/**
 * Safely returns a sanitized asset path, dropping invalid paths.
 *
 * @param {string} rawValue - Raw asset path
 * @param {string} fieldPath - Field path for error messages
 * @param {Function} sanitizeAssetPath - Sanitization function from build.js
 * @returns {string} Sanitized path or empty string
 */
function safeAssetPath(rawValue, fieldPath, sanitizeAssetPath) {
  try {
    return sanitizeAssetPath(rawValue, fieldPath);
  } catch (error) {
    console.warn(`[build] ${error.message}. Dropping unsafe asset path.`);
    return '';
  }
}

module.exports = {
  escapeHtml,
  safeHref,
  safeAssetPath
};
