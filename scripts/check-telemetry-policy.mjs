import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import safeInput from './lib/safe-input.cjs';
import { parseHtmlDocument } from './lib/html-document.mjs';
import { loadManifest, validateVendorGovernance } from './check-vendor-governance.mjs';

const { readStableFileNoFollow } = safeInput;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const RUNTIME_FILES = [
  'js/main.js',
  'js/site.js'
];

const SERVICE_WORKER_FILE = 'pwabuilder-sw.js';
// Review worker network, cache, message, and import behavior before updating this pin.
// Matching a reviewed digest is a change gate, not a proof that arbitrary JS is safe.
const REVIEWED_SERVICE_WORKER_SHA256 = '3f119738bdd1e6e48b4b638e264a7c26706b99c3c54f3eb5fd1f265150fccc4c';
const RUNTIME_HTML_FILES = [
  'src/index.html', 'src/work.html', 'src/reading.html', 'src/offline.html', 'src/case-study.html',
  'index.html', 'work.html', 'reading.html', 'offline.html',
  'case-study-agentforge.html', 'case-study-agentic.html', 'case-study-apple-calendar-mcp.html',
  '.well-known/service-doc.html'
];

const MAX_RUNTIME_SOURCE_BYTES = 512 * 1024;
const MAX_RUNTIME_TOKENS = 100000;
const DISALLOWED_RUNTIME_IDENTIFIERS = new Map([
  ['fetch', 'runtime telemetry must not reference fetch'],
  ['sendbeacon', 'runtime telemetry must not reference sendBeacon'],
  ['xmlhttprequest', 'runtime telemetry must not use XMLHttpRequest'],
  ['datalayer', 'runtime telemetry must not use dataLayer adapters'],
  ['gtag', 'runtime telemetry must not use gtag adapters'],
  ['plausible', 'runtime telemetry must not use Plausible adapters'],
  ['image', 'runtime telemetry must not use Image beacon adapters'],
  ['websocket', 'runtime telemetry must not use WebSocket adapters'],
  ['eventsource', 'runtime telemetry must not use EventSource adapters'],
  ['audio', 'runtime telemetry must not use Audio resource adapters'],
  ['import', 'page runtime imports require explicit inventory review'],
  ['importscripts', 'page runtime imports require explicit inventory review'],
  ['worker', 'page worker constructors require explicit inventory review'],
  ['sharedworker', 'page worker constructors require explicit inventory review'],
  ['eval', 'page runtime must not evaluate dynamic source']
]);
const NETWORK_GLOBAL_IDENTIFIERS = new Set(['document', 'globalThis', 'navigator', 'self', 'window']);
const DYNAMIC_GLOBAL_ACCESS_FINDING = 'runtime telemetry must not use dynamic network-capable global property access';

const ALLOWED_EVENTS = new Set([
  'portfolio_action_clicked',
  'reading_filter_changed',
  'reading_view_changed',
  'reading_share_clicked',
  'reading_share_completed'
]);

function readJavaScriptString(source, start, quote) {
  let cursor = start + 1;
  let value = '';
  while (cursor < source.length) {
    const character = source[cursor];
    if (character === quote) {
      return { value, end: cursor + 1 };
    }
    if (character === '\n' || character === '\r') {
      throw new Error('unterminated string literal');
    }
    if (character !== '\\') {
      value += character;
      cursor += 1;
      continue;
    }

    const escaped = source[cursor + 1];
    if (escaped === undefined) throw new Error('unterminated string escape');
    if (escaped === '\n' || escaped === '\r') {
      cursor += escaped === '\r' && source[cursor + 2] === '\n' ? 3 : 2;
      continue;
    }
    if (/[1-7]/.test(escaped) || (escaped === '0' && /\d/.test(source[cursor + 2] || ''))) {
      throw new Error('legacy octal string escapes are not allowed in runtime source');
    }
    const simpleEscapes = {
      n: '\n',
      r: '\r',
      t: '\t',
      b: '\b',
      f: '\f',
      v: '\v',
      0: '\0'
    };
    if (Object.hasOwn(simpleEscapes, escaped)) {
      value += simpleEscapes[escaped];
      cursor += 2;
      continue;
    }
    if (escaped === 'x') {
      const digits = source.slice(cursor + 2, cursor + 4);
      if (!/^[0-9a-f]{2}$/i.test(digits)) throw new Error('invalid hexadecimal string escape');
      value += String.fromCodePoint(Number.parseInt(digits, 16));
      cursor += 4;
      continue;
    }
    if (escaped === 'u') {
      const digits = source.slice(cursor + 2, cursor + 6);
      if (!/^[0-9a-f]{4}$/i.test(digits)) throw new Error('invalid Unicode string escape');
      value += String.fromCodePoint(Number.parseInt(digits, 16));
      cursor += 6;
      continue;
    }
    value += escaped;
    cursor += 2;
  }
  throw new Error('unterminated string literal');
}

function readUnicodeIdentifierEscape(source, start) {
  if (source[start] !== '\\' || source[start + 1] !== 'u') return null;
  if (source[start + 2] === '{') {
    const end = source.indexOf('}', start + 3);
    if (end === -1) throw new Error('unterminated Unicode identifier escape');
    const digits = source.slice(start + 3, end);
    if (!/^[0-9a-f]{1,6}$/i.test(digits)) throw new Error('invalid Unicode identifier escape');
    const codePoint = Number.parseInt(digits, 16);
    if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      throw new Error('invalid Unicode identifier escape');
    }
    return { value: String.fromCodePoint(codePoint), end: end + 1 };
  }
  const digits = source.slice(start + 2, start + 6);
  if (!/^[0-9a-f]{4}$/i.test(digits)) throw new Error('invalid Unicode identifier escape');
  return { value: String.fromCodePoint(Number.parseInt(digits, 16)), end: start + 6 };
}

function readJavaScriptIdentifier(source, start) {
  let cursor = start;
  let value = '';
  while (cursor < source.length) {
    if (/[A-Za-z0-9_$]/.test(source[cursor])) {
      value += source[cursor];
      cursor += 1;
      continue;
    }
    const escaped = readUnicodeIdentifierEscape(source, cursor);
    if (!escaped) break;
    value += escaped.value;
    cursor = escaped.end;
  }
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value)) {
    throw new Error('invalid or unsupported escaped identifier');
  }
  return { value, end: cursor };
}

function slashStartsRegex(tokens) {
  const previous = tokens.at(-1);
  if (!previous) return true;
  if (previous.type === 'identifier') {
    return /^(?:await|case|delete|in|instanceof|new|of|return|throw|typeof|void|yield)$/.test(previous.value);
  }
  return /^(?:\(|\[|\{|,|;|:|=|!|\?|\+|-|\*|%|&|\||\^|~|<|>)$/.test(previous.value);
}

function skipRegexLiteral(source, start) {
  let cursor = start + 1;
  let inCharacterClass = false;
  while (cursor < source.length) {
    const character = source[cursor];
    if (character === '\n' || character === '\r') throw new Error('unterminated regular expression literal');
    if (character === '\\') {
      cursor += 2;
      continue;
    }
    if (character === '[') inCharacterClass = true;
    if (character === ']') inCharacterClass = false;
    if (character === '/' && !inCharacterClass) {
      cursor += 1;
      while (cursor < source.length && /[A-Za-z]/.test(source[cursor])) cursor += 1;
      return cursor;
    }
    cursor += 1;
  }
  throw new Error('unterminated regular expression literal');
}

function skipQuotedJavaScriptSource(source, start, quote) {
  let cursor = start + 1;
  while (cursor < source.length) {
    if (source[cursor] === '\\') {
      cursor += source[cursor + 1] === '\r' && source[cursor + 2] === '\n' ? 3 : 2;
      continue;
    }
    if (source[cursor] === quote) return cursor + 1;
    if (source[cursor] === '\n' || source[cursor] === '\r') {
      throw new Error('unterminated string literal in template interpolation');
    }
    cursor += 1;
  }
  throw new Error('unterminated string literal in template interpolation');
}

function scanTemplateExpression(source, start) {
  let cursor = start;
  let depth = 1;
  while (cursor < source.length) {
    if (source[cursor] === '/' && source[cursor + 1] === '/') {
      const end = source.indexOf('\n', cursor + 2);
      cursor = end === -1 ? source.length : end + 1;
      continue;
    }
    if (source[cursor] === '/' && source[cursor + 1] === '*') {
      const end = source.indexOf('*/', cursor + 2);
      if (end === -1) throw new Error('unterminated block comment in template interpolation');
      cursor = end + 2;
      continue;
    }
    if (source[cursor] === '"' || source[cursor] === "'") {
      cursor = skipQuotedJavaScriptSource(source, cursor, source[cursor]);
      continue;
    }
    if (source[cursor] === '`') {
      cursor = readJavaScriptTemplate(source, cursor).end;
      continue;
    }
    if (source[cursor] === '{') depth += 1;
    if (source[cursor] === '}') {
      depth -= 1;
      if (depth === 0) return cursor + 1;
    }
    cursor += 1;
  }
  throw new Error('unterminated template interpolation');
}

function readJavaScriptTemplate(source, start) {
  let cursor = start + 1;
  let value = '';
  const expressions = [];
  while (cursor < source.length) {
    if (source[cursor] === '\\') {
      if (source[cursor + 1] === undefined) throw new Error('unterminated template escape');
      value += source.slice(cursor, cursor + 2);
      cursor += 2;
      continue;
    }
    if (source[cursor] === '`') return { end: cursor + 1, expressions, value };
    if (source[cursor] === '$' && source[cursor + 1] === '{') {
      const expressionEnd = scanTemplateExpression(source, cursor + 2);
      const expression = source.slice(cursor + 2, expressionEnd - 1);
      expressions.push(expression);
      value += `\${${expression}}`;
      cursor = expressionEnd;
      continue;
    }
    value += source[cursor];
    cursor += 1;
  }
  throw new Error('unterminated template literal');
}

function tokenizeJavaScript(source) {
  const tokens = [];
  let cursor = 0;
  let previousTokenEnd = 0;
  while (cursor < source.length) {
    const character = source[cursor];
    if (/\s/.test(character)) {
      cursor += 1;
      continue;
    }
    if (character === '/' && source[cursor + 1] === '/') {
      const end = source.indexOf('\n', cursor + 2);
      cursor = end === -1 ? source.length : end + 1;
      continue;
    }
    if (character === '/' && source[cursor + 1] === '*') {
      const end = source.indexOf('*/', cursor + 2);
      if (end === -1) throw new Error('unterminated block comment');
      cursor = end + 2;
      continue;
    }
    if (character === '/' && slashStartsRegex(tokens)) {
      cursor = skipRegexLiteral(source, cursor);
      continue;
    }
    const lineBreakBefore = /[\r\n\u2028\u2029]/.test(source.slice(previousTokenEnd, cursor));
    if (character === '`') {
      const parsed = readJavaScriptTemplate(source, cursor);
      tokens.push({ type: 'template', value: parsed.value, expressions: parsed.expressions, lineBreakBefore });
      parsed.expressions.forEach((expression) => {
        tokens.push(...tokenizeJavaScript(expression));
      });
      cursor = parsed.end;
    } else if (character === '"' || character === "'") {
      const parsed = readJavaScriptString(source, cursor, character);
      tokens.push({ type: 'string', value: parsed.value, lineBreakBefore });
      cursor = parsed.end;
    } else if (/[A-Za-z_$]/.test(character) || (character === '\\' && source[cursor + 1] === 'u')) {
      const parsed = readJavaScriptIdentifier(source, cursor);
      tokens.push({ type: 'identifier', value: parsed.value, lineBreakBefore });
      cursor = parsed.end;
    } else {
      tokens.push({ type: 'punctuation', value: character, lineBreakBefore });
      cursor += 1;
    }

    previousTokenEnd = cursor;
    if (tokens.length > MAX_RUNTIME_TOKENS) {
      throw new Error(`runtime source exceeds ${MAX_RUNTIME_TOKENS} token limit`);
    }
  }
  return tokens;
}

function findMatchingToken(tokens, start, open, close) {
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    if (tokens[index].value === open) depth += 1;
    if (tokens[index].value === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function inspectRuntimeAllowedSet(tokens) {
  const findings = [];
  let foundStaticSet = false;
  for (let index = 0; index < tokens.length - 5; index += 1) {
    if (
      tokens[index].value !== 'TELEMETRY_ALLOWED_EVENTS' ||
      tokens[index + 1].value !== '=' ||
      tokens[index + 2].value !== 'new' ||
      tokens[index + 3].value !== 'Set' ||
      tokens[index + 4].value !== '(' ||
      tokens[index + 5].value !== '['
    ) {
      continue;
    }

    const end = findMatchingToken(tokens, index + 5, '[', ']');
    if (end === -1) {
      findings.push('TELEMETRY_ALLOWED_EVENTS has an unterminated initializer');
      continue;
    }
    foundStaticSet = true;
    for (let itemIndex = index + 6; itemIndex < end; itemIndex += 1) {
      const token = tokens[itemIndex];
      if (token.value === ',') continue;
      if (token.type !== 'string') {
        findings.push('TELEMETRY_ALLOWED_EVENTS must contain only static string literals');
        continue;
      }
      if (!ALLOWED_EVENTS.has(token.value)) {
        findings.push(`unapproved telemetry event "${token.value}" in runtime allowlist`);
      }
    }
  }
  return { findings, foundStaticSet };
}

function stripOuterParentheses(tokens) {
  let stripped = tokens;
  while (
    stripped[0]?.value === '(' &&
    findMatchingToken(stripped, 0, '(', ')') === stripped.length - 1
  ) {
    stripped = stripped.slice(1, -1);
  }
  return stripped;
}

function splitTopLevelLogicalOr(tokens) {
  const terms = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value === '(') depth += 1;
    if (tokens[index].value === ')') depth -= 1;
    if (depth === 0 && tokens[index].value === '|' && tokens[index + 1]?.value === '|') {
      terms.push(tokens.slice(start, index));
      start = index + 2;
      index += 1;
    }
  }
  terms.push(tokens.slice(start));
  return terms;
}

function conditionRejectsUnknownEvent(conditionTokens, parameter) {
  const terms = splitTopLevelLogicalOr(stripOuterParentheses(conditionTokens));
  return terms.some((rawTerm) => {
    const term = stripOuterParentheses(rawTerm);
    return term.length === 7 &&
      term[0].value === '!' &&
      term[1].value === 'TELEMETRY_ALLOWED_EVENTS' &&
      term[2].value === '.' &&
      term[3].value === 'has' &&
      term[4].value === '(' &&
      term[5].value === parameter &&
      term[6].value === ')';
  });
}

function hasGuardedTrackEventDefinition(tokens, foundStaticSet) {
  if (!foundStaticSet) return false;
  if (hasTrackEventAssignment(tokens)) return false;
  const definitions = tokens.filter((token, index) => token.value === 'function' && tokens[index + 1]?.value === 'trackEvent');
  if (definitions.length !== 1) return false;
  let outerDepth = 0;
  for (let index = 0; index < tokens.length - 4; index += 1) {
    if (tokens[index].value === '{') outerDepth += 1;
    if (tokens[index].value === '}') outerDepth -= 1;
    if (tokens[index].value !== 'function' || tokens[index + 1].value !== 'trackEvent' || tokens[index + 2].value !== '(') {
      continue;
    }
    if (outerDepth !== 0) return false;
    const parametersEnd = findMatchingToken(tokens, index + 2, '(', ')');
    if (parametersEnd === -1 || tokens[parametersEnd + 1]?.value !== '{') return false;
    const parameter = tokens.slice(index + 3, parametersEnd).find((token) => token.type === 'identifier')?.value;
    const bodyEnd = findMatchingToken(tokens, parametersEnd + 1, '{', '}');
    if (!parameter || bodyEnd === -1) return false;
    // Only the first statement in the function body can establish protection.
    // Nested/dead branches and guards after emission are not control-flow proofs.
    const bodyIndex = parametersEnd + 2;
    if (tokens[bodyIndex]?.value !== 'if' || tokens[bodyIndex + 1]?.value !== '(') return false;
    const conditionEnd = findMatchingToken(tokens, bodyIndex + 1, '(', ')');
    if (conditionEnd === -1 || conditionEnd >= bodyEnd) return false;
    if (!conditionRejectsUnknownEvent(tokens.slice(bodyIndex + 2, conditionEnd), parameter)) return false;
    const consequentStart = conditionEnd + 1;
    if (tokens[consequentStart]?.value === 'return' &&
        (tokens[consequentStart + 1]?.value === ';' || tokens[consequentStart + 1]?.value === '}')) return true;
    if (tokens[consequentStart]?.value !== '{') return false;
    const consequentEnd = findMatchingToken(tokens, consequentStart, '{', '}');
    return consequentEnd !== -1 && tokens[consequentStart + 1]?.value === 'return' &&
      (consequentStart + 2 === consequentEnd ||
       (tokens[consequentStart + 2]?.value === ';' && consequentStart + 3 === consequentEnd));
  }
  return false;
}

function hasTrackEventAssignment(tokens) {
  return tokens.some((token, index) => token.type === 'identifier' && token.value === 'trackEvent' &&
    tokens[index + 1]?.value === '=' && !['=', '>'].includes(tokens[index + 2]?.value));
}

function readStaticPropertyName(tokens, openBracketIndex) {
  let cursor = openBracketIndex + 1;
  let propertyName = '';
  let expectsString = true;
  let interpolated = false;
  while (cursor < tokens.length && tokens[cursor].value !== ']') {
    const token = tokens[cursor];
    if (expectsString && (token.type === 'string' || token.type === 'template')) {
      propertyName += token.value;
      if (token.type === 'template' && token.expressions?.length > 0) interpolated = true;
      expectsString = false;
    } else if (!expectsString && token.value === '+') {
      expectsString = true;
    } else {
      return { propertyName: '', end: cursor, dynamic: true };
    }
    cursor += 1;
  }
  if (!propertyName || expectsString || tokens[cursor]?.value !== ']' || interpolated) {
    return { propertyName: '', end: cursor, dynamic: true };
  }
  return { propertyName, end: cursor, dynamic: false };
}

function inspectAllowedSetMutation(tokens) {
  const findings = [];
  const aliases = new Set(['TELEMETRY_ALLOWED_EVENTS']);
  let changed = true;
  while (changed) {
    changed = false;
    for (let index = 0; index < tokens.length - 2; index += 1) {
      if (
        tokens[index].type === 'identifier' &&
        tokens[index + 1].value === '=' &&
        aliases.has(tokens[index + 2].value) &&
        !aliases.has(tokens[index].value)
      ) {
        aliases.add(tokens[index].value);
        changed = true;
      }
    }
  }

  for (let index = 0; index < tokens.length; index += 1) {
    if (!aliases.has(tokens[index].value)) continue;
    if (
      tokens[index].value === 'TELEMETRY_ALLOWED_EVENTS' &&
      tokens[index + 1]?.value === '=' &&
      !(tokens[index + 2]?.value === 'new' && tokens[index + 3]?.value === 'Set')
    ) {
      findings.push('TELEMETRY_ALLOWED_EVENTS must not be reassigned');
    }
    let propertyName = '';
    if (tokens[index + 1]?.value === '.') {
      propertyName = tokens[index + 2]?.value || '';
    } else if (tokens[index + 1]?.value === '[') {
      propertyName = readStaticPropertyName(tokens, index + 1).propertyName;
    }
    if (/^(?:add|clear|delete)$/i.test(propertyName)) {
      findings.push('TELEMETRY_ALLOWED_EVENTS must not be mutated at runtime');
    }
  }
  return findings;
}

const RESOURCE_ELEMENTS = new Set([
  'img', 'image', 'script', 'link', 'iframe', 'frame', 'object', 'embed',
  'audio', 'video', 'source', 'track', 'input'
]);
const RESOURCE_ATTRIBUTES = new Set(['src', 'srcset', 'href', 'poster', 'data', 'background', 'ping']);
const DOM_RESOURCE_FINDING = 'runtime telemetry must not create DOM resource beacons or assign resource URLs';
const RESOURCE_METHODS = new Set([
  'createElement', 'createElementNS', 'setAttribute', 'setAttributeNS',
  'insertAdjacentHTML', 'write', 'writeln', 'setProperty', 'insertRule', 'replaceSync'
]);

function inspectDomResourceSinks(tokens) {
  const methods = new Map([...RESOURCE_METHODS].map((name) => [name, name]));
  const namedMethod = (token) => methods.get(token?.value);
  // Direct assignments, .bind wrappers, and ordinary alias chains. This is a
  // deliberately bounded policy scanner, not an interpreter for arbitrary JS.
  let changed = true;
  while (changed) {
    changed = false;
    for (let index = 0; index < tokens.length; index += 1) {
      if (tokens[index].type !== 'identifier') continue;
      let method;
      if (tokens[index + 1]?.value === '=' && tokens[index + 2]?.value !== '=') {
        for (let cursor = index + 2; cursor < Math.min(tokens.length, index + 18); cursor += 1) {
          if ([';', '(', '{', '=', '>'].includes(tokens[cursor].value)) break;
          let candidate = namedMethod(tokens[cursor]);
          let referenceEnd = cursor;
          if (tokens[cursor].value === '[') {
            const property = readStaticPropertyName(tokens, cursor);
            candidate = methods.get(property.propertyName);
            referenceEnd = property.end;
          }
          const next = tokens[referenceEnd + 1]?.value;
          const memberStart = referenceEnd + (next === '?' && tokens[referenceEnd + 2]?.value === '.' ? 2 : 1);
          const asiBoundary = tokens[referenceEnd + 1]?.lineBreakBefore &&
            tokens[referenceEnd + 1]?.type === 'identifier';
          if (candidate && (next === undefined || [';', ',', '}', ']'].includes(next) || asiBoundary ||
              (tokens[memberStart]?.value === '.' && tokens[memberStart + 1]?.value === 'bind'))) {
            method = candidate;
            break;
          }
        }
      } else if (tokens[index - 1]?.value === ':' && namedMethod(tokens[index - 2]) &&
                 [',', '}'].includes(tokens[index + 1]?.value)) {
        method = namedMethod(tokens[index - 2]);
      }
      if (method && !methods.has(tokens[index].value)) {
        methods.set(tokens[index].value, method);
        changed = true;
      }
    }
  }
  for (let index = 0; index < tokens.length; index += 1) {
    let method = namedMethod(tokens[index]);
    let callStart = index + 1;
    if (tokens[index].value === '[') {
      const property = readStaticPropertyName(tokens, index);
      method = methods.get(property.propertyName);
      callStart = property.end + 1;
    } else if (tokens[index + 1]?.value === ']') callStart += 1;
    if (tokens[callStart]?.value === '?' && tokens[callStart + 1]?.value === '.') {
      callStart += tokens[callStart + 2]?.value === '(' ? 2 : 1;
    }
    if (method && tokens[callStart]?.value === '.' &&
        ['call', 'apply'].includes(tokens[callStart + 1]?.value)) {
      // Indirect invocation wrappers require review; do not guess their argument flow.
      return [DOM_RESOURCE_FINDING];
    }
    if (method && tokens[callStart]?.value === '(') {
      if (/^(?:createElement|createElementNS|setAttribute|setAttributeNS)$/.test(method)) {
        const argsEnd = findMatchingToken(tokens, callStart, '(', ')');
        if (argsEnd === -1) return [DOM_RESOURCE_FINDING];
        let argument = callStart + 1;
        if (method.endsWith('NS')) {
          const comma = tokens.slice(argument, argsEnd).findIndex((token) => token.value === ',');
          if (comma === -1) return [DOM_RESOURCE_FINDING];
          argument += comma + 1;
        }
        const value = tokens[argument];
        // Dynamic or composed tag/attribute names require explicit review.
        if (!value || !['string', 'template'].includes(value.type) || value.expressions?.length ||
            ![',', ')'].includes(tokens[argument + 1]?.value)) return [DOM_RESOURCE_FINDING];
        const name = value.value.toLowerCase();
        if (method.startsWith('createElement') ? RESOURCE_ELEMENTS.has(name) : RESOURCE_ATTRIBUTES.has(name)) {
          return [DOM_RESOURCE_FINDING];
        }
      } else {
        return [DOM_RESOURCE_FINDING];
      }
    }
    let property;
    let end = index + 2;
    if (tokens[index + 1]?.value === '.') property = tokens[end]?.value;
    if (tokens[index + 1]?.value === '[') {
      const parsed = readStaticPropertyName(tokens, index + 1);
      property = parsed.propertyName;
      end = parsed.end;
    }
    if ((RESOURCE_ATTRIBUTES.has(property?.toLowerCase()) || /^(?:innerHTML|outerHTML|srcdoc)$/.test(property || '')) &&
        ((tokens[end + 1]?.value === '=' && tokens[end + 2]?.value !== '=') ||
         (tokens[end + 1]?.value === '+' && tokens[end + 2]?.value === '='))) return [DOM_RESOURCE_FINDING];
  }
  return [];
}

function inspectRuntimeSource(source) {
  if (typeof source !== 'string') throw new TypeError('runtime source must be a string');
  if (Buffer.byteLength(source, 'utf8') > MAX_RUNTIME_SOURCE_BYTES) {
    throw new Error(`runtime source exceeds ${MAX_RUNTIME_SOURCE_BYTES} byte limit`);
  }

  const tokens = tokenizeJavaScript(source);
  const findings = inspectDomResourceSinks(tokens);
  const detectedAdapters = new Set();
  tokens.forEach((token, index) => {
    let identifier = token.type === 'identifier' ? token.value.toLowerCase() : null;
    if (
      (token.type === 'string' || (token.type === 'template' && token.expressions?.length === 0)) &&
      tokens[index - 1]?.value === '[' &&
      tokens[index + 1]?.value === ']'
    ) {
      identifier = token.value.toLowerCase();
    }
    if (token.type === 'identifier' && token.value === 'Function') {
      detectedAdapters.add('page runtime must not evaluate dynamic source');
    }
    const reason = identifier ? DISALLOWED_RUNTIME_IDENTIFIERS.get(identifier) : null;
    if (reason) detectedAdapters.add(reason);
  });
  const networkGlobalAliases = new Set(NETWORK_GLOBAL_IDENTIFIERS);
  let globalAliasesChanged = true;
  while (globalAliasesChanged) {
    globalAliasesChanged = false;
    for (let index = 0; index < tokens.length - 2; index += 1) {
      if (
        tokens[index].type === 'identifier' && tokens[index + 1].value === '=' &&
        networkGlobalAliases.has(tokens[index + 2].value) && !networkGlobalAliases.has(tokens[index].value)
      ) {
        networkGlobalAliases.add(tokens[index].value);
        globalAliasesChanged = true;
      }
    }
  }
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value !== '[') continue;
    const property = readStaticPropertyName(tokens, index);
    const reason = DISALLOWED_RUNTIME_IDENTIFIERS.get(property.propertyName.toLowerCase());
    if (reason) detectedAdapters.add(reason);
    const globalObject = tokens[index - 1]?.value;
    if (networkGlobalAliases.has(globalObject) && property.dynamic) {
      detectedAdapters.add(DYNAMIC_GLOBAL_ACCESS_FINDING);
    }
  }
  for (let index = 0; index < tokens.length - 6; index += 1) {
    if (
      tokens[index].value !== 'Reflect' || tokens[index + 1].value !== '.' ||
      tokens[index + 2].value !== 'get' || tokens[index + 3].value !== '(' ||
      !networkGlobalAliases.has(tokens[index + 4].value) || tokens[index + 5].value !== ','
    ) {
      continue;
    }
    const propertyToken = tokens[index + 6];
    if (propertyToken?.type === 'string' || (propertyToken?.type === 'template' && propertyToken.expressions?.length === 0)) {
      const reason = DISALLOWED_RUNTIME_IDENTIFIERS.get(propertyToken.value.toLowerCase());
      if (reason) detectedAdapters.add(reason);
    } else {
      detectedAdapters.add(DYNAMIC_GLOBAL_ACCESS_FINDING);
    }
  }
  findings.push(...detectedAdapters);

  const allowedSet = inspectRuntimeAllowedSet(tokens);
  findings.push(...allowedSet.findings);
  const mutationFindings = inspectAllowedSetMutation(tokens);
  findings.push(...mutationFindings);
  if (hasTrackEventAssignment(tokens)) findings.push('trackEvent must not be reassigned at runtime');
  const dynamicCallsAreGuarded =
    hasGuardedTrackEventDefinition(tokens, allowedSet.foundStaticSet) &&
    allowedSet.findings.length === 0 &&
    mutationFindings.length === 0;

  const telemetryCallees = new Set(['trackEvent']);
  let aliasesChanged = true;
  while (aliasesChanged) {
    aliasesChanged = false;
    for (let index = 0; index < tokens.length - 2; index += 1) {
      if (tokens[index].type !== 'identifier' || tokens[index + 1].value !== '=') continue;
      let cursor = index + 2;
      let aliasesTelemetry = false;
      while (cursor < tokens.length && tokens[cursor].value !== ';' && cursor < index + 16) {
        if (telemetryCallees.has(tokens[cursor].value)) aliasesTelemetry = true;
        cursor += 1;
      }
      if (aliasesTelemetry && !telemetryCallees.has(tokens[index].value)) {
        telemetryCallees.add(tokens[index].value);
        aliasesChanged = true;
      }
    }
  }

  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (!telemetryCallees.has(tokens[index].value)) continue;
    let callStart = index + 1;
    if (tokens[callStart]?.value === '?' && tokens[callStart + 1]?.value === '.') callStart += 2;
    if (tokens[callStart]?.value !== '(') continue;
    if (tokens[index - 1]?.value === 'function') continue;
    const eventToken = tokens[callStart + 1];
    if (eventToken?.type === 'string' && [',', ')'].includes(tokens[callStart + 2]?.value)) {
      if (!ALLOWED_EVENTS.has(eventToken.value)) {
        findings.push(`unapproved telemetry event "${eventToken.value}" in trackEvent call`);
      }
    } else if (!dynamicCallsAreGuarded) {
      findings.push('dynamic telemetry event name is not protected by the static runtime allowlist');
    }
  }

  return [...new Set(findings)];
}

function readStableRuntimeSource(rootDir, file, { openSync = fs.openSync } = {}) {
  const resolvedRoot = path.resolve(rootDir);
  const absolutePath = path.resolve(resolvedRoot, file);
  return readStableFileNoFollow(absolutePath, {
    label: 'runtime source',
    rootDir: resolvedRoot,
    maxBytes: MAX_RUNTIME_SOURCE_BYTES,
    minBytes: 0,
    openSync
  }).toString('utf8');
}

function inspectRuntimeInventory(rootDir, runtimeFiles, { openSync = fs.openSync, today } = {}) {
  const findings = [];
  const classified = new Set(runtimeFiles);
  let visited = 0;
  const visit = (relativePath) => {
    const absolutePath = path.resolve(rootDir, relativePath);
    const stats = fs.lstatSync(absolutePath);
    if (stats.isSymbolicLink()) throw new Error(`${relativePath}: runtime inventory must not follow symbolic links`);
    if (stats.isDirectory()) {
      for (const name of fs.readdirSync(absolutePath)) {
        if (++visited > 20000) throw new Error('runtime inventory exceeds entry limit');
        visit(`${relativePath}/${name}`);
      }
    } else if (!stats.isFile()) {
      throw new Error(`${relativePath}: runtime inventory requires regular files`);
    } else if (/\.(?:js|mjs|cjs)$/i.test(relativePath) &&
               !classified.has(relativePath) && !relativePath.startsWith('js/vendor/')) {
      findings.push(`${relativePath}: executable source is not classified in the telemetry runtime inventory`);
    }
  };
  try { visit('js'); } catch (error) { findings.push(error.message); }
  // Root workers and scripts cannot silently bypass the js/ inventory.
  for (const name of fs.readdirSync(rootDir)) {
    if (/\.html$/i.test(name) && !RUNTIME_HTML_FILES.includes(name)) {
      findings.push(`${name}: HTML page is not classified in the telemetry runtime inventory`);
    }
    if (/\.(?:js|mjs|cjs)$/i.test(name) && name !== SERVICE_WORKER_FILE && name !== 'playwright.config.mjs') {
      findings.push(`${name}: executable source is not classified in the telemetry runtime inventory`);
    }
  }
  for (const file of RUNTIME_HTML_FILES) {
    try {
      const html = readStableFileNoFollow(path.resolve(rootDir, file), {
        rootDir: path.resolve(rootDir), label: file, maxBytes: 2 * 1024 * 1024, fatalUtf8: true, openSync
      });
      const document = parseHtmlDocument(html);
      // Inline executable additions require classification, rather than automatic
      // acceptance merely because the build assigns them a CSP hash.
      for (const { attributes, body } of document.scripts) {
        if (attributes.has('src')) {
          if (body.trim()) findings.push(`${file}: external script tags must not contain inline source`);
          const source = attributes.get('src').replace(/^\//, '');
          if (!classified.has(source)) findings.push(`${file}: script ${JSON.stringify(source)} is not a scanned page runtime`);
        } else if (attributes.get('type') === 'application/ld+json') {
          if (!file.startsWith('src/')) JSON.parse(body);
        } else {
          findings.push(`${file}: inline executable script is not classified in the page runtime inventory`);
        }
      }
    } catch (error) { findings.push(`${file}: runtime HTML inventory failed: ${error.message}`); }
  }
  try {
    const worker = readStableFileNoFollow(path.resolve(rootDir, SERVICE_WORKER_FILE), {
      rootDir: path.resolve(rootDir), label: SERVICE_WORKER_FILE, maxBytes: MAX_RUNTIME_SOURCE_BYTES, openSync
    });
    if (crypto.createHash('sha256').update(worker).digest('hex') !== REVIEWED_SERVICE_WORKER_SHA256) {
      findings.push(`${SERVICE_WORKER_FILE}: source changed since security review; review network/cache/message/import behavior before updating its SHA-256`);
    }
  } catch (error) { findings.push(`${SERVICE_WORKER_FILE}: reviewed worker validation failed: ${error.message}`); }
  try {
    const manifest = loadManifest(path.resolve(rootDir, 'docs/security/vendor-dependencies.json'), { rootDir });
    validateVendorGovernance(manifest, { rootDir, today });
  } catch (error) { findings.push(`js/vendor: vendor integrity validation failed: ${error.message}`); }
  return findings;
}

function collectTelemetryPolicyFindings({
  rootDir = projectRoot,
  runtimeFiles = RUNTIME_FILES,
  enforceRuntimeInventory = path.resolve(rootDir) === projectRoot,
  today,
  openSync = fs.openSync
} = {}) {
  const findings = [];

  runtimeFiles.forEach((file) => {
    try {
      inspectRuntimeSource(readStableRuntimeSource(rootDir, file, { openSync })).forEach((finding) => {
        findings.push(`${file}: ${finding}`);
      });
    } catch (error) {
      findings.push(`${file}: runtime source parsing failed: ${error?.message || 'invalid source'}`);
    }
  });

  if (enforceRuntimeInventory) findings.push(...inspectRuntimeInventory(rootDir, runtimeFiles, { openSync, today }));
  return findings;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const findings = collectTelemetryPolicyFindings();
  if (findings.length > 0) {
    console.error(`Telemetry policy failed with ${findings.length} finding(s):`);
    findings.forEach((finding) => console.error(`- ${finding}`));
    process.exitCode = 1;
  } else {
    console.log('Telemetry policy OK: bounded page-source checks, runtime inventory, reviewed worker, and vendor integrity passed.');
  }
}

export {
  ALLOWED_EVENTS,
  collectTelemetryPolicyFindings,
  inspectRuntimeSource,
  readStableRuntimeSource,
  tokenizeJavaScript
};
