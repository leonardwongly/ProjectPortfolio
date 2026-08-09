const DEFAULT_MAX_HTML_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_ATTRIBUTES = 10000;
const RAW_TEXT_TAGS = new Set([
  'iframe',
  'noembed',
  'noframes',
  'script',
  'style',
  'textarea',
  'title',
  'xmp'
]);
const NAMED_URL_ENTITIES = new Map([
  ['amp', '&'],
  ['apos', "'"],
  ['bsol', '\\'],
  ['colon', ':'],
  ['gt', '>'],
  ['lt', '<'],
  ['quot', '"'],
  ['sol', '/']
]);

function decodeHtmlAttributeEntities(rawValue) {
  if (typeof rawValue !== 'string') throw new TypeError('HTML attribute value must be a string');
  let decoded = '';
  let cursor = 0;
  while (cursor < rawValue.length) {
    const ampersand = rawValue.indexOf('&', cursor);
    if (ampersand === -1) return decoded + rawValue.slice(cursor);
    decoded += rawValue.slice(cursor, ampersand);
    const entitySource = rawValue.slice(ampersand);
    const numeric = /^&(?:#x([0-9a-f]+)|#(\d+));?/i.exec(entitySource);
    const named = /^&([a-z][a-z\d]+);/i.exec(entitySource);
    if (numeric) {
      const codePoint = Number.parseInt(numeric[1] ?? numeric[2], numeric[1] ? 16 : 10);
      if (
        !Number.isInteger(codePoint) ||
        codePoint <= 0 ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) {
        throw new Error('HTML attribute contains an invalid numeric character reference');
      }
      decoded += String.fromCodePoint(codePoint);
      cursor = ampersand + numeric[0].length;
      continue;
    }
    if (named) {
      const replacement = NAMED_URL_ENTITIES.get(named[1].toLowerCase());
      if (replacement === undefined) {
        throw new Error('HTML attribute contains an unsupported named character reference');
      }
      decoded += replacement;
      cursor = ampersand + named[0].length;
      continue;
    }
    if (/^&(?:#|[a-z])/i.test(entitySource)) {
      throw new Error('HTML attribute contains a malformed character reference');
    }
    decoded += '&';
    cursor = ampersand + 1;
  }
  return decoded;
}

function findRawTextClosingTag(lowerSource, tagName, start) {
  let candidate = lowerSource.indexOf(`</${tagName}`, start);
  while (candidate !== -1) {
    const delimiter = lowerSource[candidate + tagName.length + 2];
    if (delimiter === undefined || /[\s/>]/.test(delimiter)) return candidate;
    candidate = lowerSource.indexOf(`</${tagName}`, candidate + tagName.length + 2);
  }
  return -1;
}

function foldAsciiCase(source) {
  return source.replace(/[A-Z]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) + 0x20));
}

function scanHtmlAttributes(source, {
  attributeNames,
  maxAttributes = DEFAULT_MAX_ATTRIBUTES,
  maxBytes = DEFAULT_MAX_HTML_BYTES
} = {}) {
  if (typeof source !== 'string') throw new TypeError('HTML source must be a string');
  if (!Number.isSafeInteger(maxAttributes) || maxAttributes < 1) {
    throw new TypeError('HTML attribute limit must be a positive integer');
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError('HTML byte limit must be a positive integer');
  }
  if (Buffer.byteLength(source, 'utf8') > maxBytes) {
    throw new Error(`HTML source exceeds ${maxBytes} byte parse limit`);
  }

  const wanted = attributeNames === undefined
    ? null
    : new Set(Array.from(attributeNames, (name) => String(name).toLowerCase()));
  const attributes = [];
  const findings = [];
  const lowerSource = foldAsciiCase(source);
  let cursor = 0;
  let parsedAttributeCount = 0;

  while (cursor < source.length) {
    const tagStart = source.indexOf('<', cursor);
    if (tagStart === -1) break;
    cursor = tagStart + 1;

    if (source.startsWith('!--', cursor)) {
      const commentEnd = source.indexOf('-->', cursor + 3);
      if (commentEnd === -1) {
        findings.push('HTML contains an unterminated comment');
        break;
      }
      cursor = commentEnd + 3;
      continue;
    }

    let closingTag = false;
    if (source[cursor] === '/') {
      closingTag = true;
      cursor += 1;
    }
    while (/\s/.test(source[cursor] || '')) cursor += 1;
    if (source[cursor] === '!' || source[cursor] === '?' || !/[A-Za-z]/.test(source[cursor] || '')) {
      const declarationEnd = source.indexOf('>', cursor);
      cursor = declarationEnd === -1 ? source.length : declarationEnd + 1;
      continue;
    }

    const tagNameStart = cursor;
    while (cursor < source.length && !/[\s/>]/.test(source[cursor])) cursor += 1;
    const tagName = source.slice(tagNameStart, cursor).toLowerCase();
    if (closingTag) {
      const closingEnd = source.indexOf('>', cursor);
      cursor = closingEnd === -1 ? source.length : closingEnd + 1;
      continue;
    }

    while (cursor < source.length) {
      while (/\s/.test(source[cursor] || '') || source[cursor] === '/') {
        cursor += 1;
      }
      if (source[cursor] === '>') {
        cursor += 1;
        break;
      }
      if (cursor >= source.length || source[cursor] === '<') {
        findings.push(`<${tagName}> has an unterminated tag`);
        break;
      }

      const nameStart = cursor;
      while (cursor < source.length && !/[\s=/>]/.test(source[cursor])) cursor += 1;
      const name = source.slice(nameStart, cursor).toLowerCase();
      if (!name) {
        findings.push(`<${tagName}> contains a malformed attribute`);
        cursor += 1;
        continue;
      }
      parsedAttributeCount += 1;
      if (parsedAttributeCount > maxAttributes) {
        throw new Error(`HTML attributes exceed ${maxAttributes} entry limit`);
      }

      while (/\s/.test(source[cursor] || '')) cursor += 1;
      let value = '';
      if (source[cursor] === '=') {
        cursor += 1;
        while (/\s/.test(source[cursor] || '')) cursor += 1;
        const quote = source[cursor] === '"' || source[cursor] === "'" ? source[cursor] : null;
        if (quote) {
          const valueStart = cursor + 1;
          const valueEnd = source.indexOf(quote, valueStart);
          if (valueEnd === -1) {
            findings.push(`${name} has an unterminated quoted value`);
            cursor = source.length;
            break;
          }
          value = source.slice(valueStart, valueEnd);
          cursor = valueEnd + 1;
        } else {
          const valueStart = cursor;
          while (cursor < source.length && !/[\s>]/.test(source[cursor])) cursor += 1;
          value = source.slice(valueStart, cursor);
        }
      }

      if (!wanted || wanted.has(name)) attributes.push({ name, tagName, value });
    }

    if (tagName === 'plaintext') {
      cursor = source.length;
    } else if (RAW_TEXT_TAGS.has(tagName)) {
      const closingStart = findRawTextClosingTag(lowerSource, tagName, cursor);
      cursor = closingStart === -1 ? source.length : closingStart;
    }
  }

  return { attributes, findings };
}

export {
  DEFAULT_MAX_ATTRIBUTES,
  DEFAULT_MAX_HTML_BYTES,
  decodeHtmlAttributeEntities,
  scanHtmlAttributes
};
