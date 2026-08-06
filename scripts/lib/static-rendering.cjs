const crypto = require('crypto');

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeJsonLd(value) {
  return JSON.stringify(value, null, 8)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function stripTrailingWhitespace(content) {
  return content.replace(/[ \t]+(?=\r|\n|$)/g, '');
}

function hashInlineScript(content) {
  return `sha256-${crypto.createHash('sha256').update(content, 'utf8').digest('base64')}`;
}

module.exports = {
  escapeHtml,
  escapeJsonLd,
  hashInlineScript,
  stripTrailingWhitespace
};
