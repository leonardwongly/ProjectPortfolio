import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import safeInput from './lib/safe-input.cjs';

const { readStableFileNoFollow } = safeInput;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const RUNTIME_FILES = [
  'js/main.js',
  'js/site.js'
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
  ['eventsource', 'runtime telemetry must not use EventSource adapters']
]);
const NETWORK_GLOBAL_IDENTIFIERS = new Set(['globalThis', 'navigator', 'self', 'window']);
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
    if (character === '`') {
      const parsed = readJavaScriptTemplate(source, cursor);
      tokens.push({ type: 'template', value: parsed.value, expressions: parsed.expressions });
      parsed.expressions.forEach((expression) => {
        tokens.push(...tokenizeJavaScript(expression));
      });
      cursor = parsed.end;
    } else if (character === '"' || character === "'") {
      const parsed = readJavaScriptString(source, cursor, character);
      tokens.push({ type: 'string', value: parsed.value });
      cursor = parsed.end;
    } else if (/[A-Za-z_$]/.test(character) || (character === '\\' && source[cursor + 1] === 'u')) {
      const parsed = readJavaScriptIdentifier(source, cursor);
      tokens.push({ type: 'identifier', value: parsed.value });
      cursor = parsed.end;
    } else {
      tokens.push({ type: 'punctuation', value: character });
      cursor += 1;
    }

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
  for (let index = 0; index < tokens.length - 4; index += 1) {
    if (tokens[index].value !== 'function' || tokens[index + 1].value !== 'trackEvent' || tokens[index + 2].value !== '(') {
      continue;
    }
    const parametersEnd = findMatchingToken(tokens, index + 2, '(', ')');
    if (parametersEnd === -1 || tokens[parametersEnd + 1]?.value !== '{') return false;
    const parameter = tokens.slice(index + 3, parametersEnd).find((token) => token.type === 'identifier')?.value;
    const bodyEnd = findMatchingToken(tokens, parametersEnd + 1, '{', '}');
    if (!parameter || bodyEnd === -1) return false;
    for (let bodyIndex = parametersEnd + 2; bodyIndex < bodyEnd; bodyIndex += 1) {
      if (tokens[bodyIndex].value !== 'if' || tokens[bodyIndex + 1]?.value !== '(') continue;
      const conditionEnd = findMatchingToken(tokens, bodyIndex + 1, '(', ')');
      if (conditionEnd === -1 || conditionEnd >= bodyEnd) continue;
      if (!conditionRejectsUnknownEvent(tokens.slice(bodyIndex + 2, conditionEnd), parameter)) continue;
      const consequentStart = conditionEnd + 1;
      if (tokens[consequentStart]?.value === 'return') return true;
      if (tokens[consequentStart]?.value === '{') {
        const consequentEnd = findMatchingToken(tokens, consequentStart, '{', '}');
        if (
          consequentEnd !== -1 &&
          tokens[consequentStart + 1]?.value === 'return' &&
          (tokens[consequentStart + 2]?.value === ';' || consequentStart + 2 === consequentEnd)
        ) {
          return true;
        }
      }
    }
  }
  return false;
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

function inspectRuntimeSource(source) {
  if (typeof source !== 'string') throw new TypeError('runtime source must be a string');
  if (Buffer.byteLength(source, 'utf8') > MAX_RUNTIME_SOURCE_BYTES) {
    throw new Error(`runtime source exceeds ${MAX_RUNTIME_SOURCE_BYTES} byte limit`);
  }

  const tokens = tokenizeJavaScript(source);
  const findings = [];
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
    if (!telemetryCallees.has(tokens[index].value) || tokens[index + 1].value !== '(') continue;
    if (tokens[index - 1]?.value === 'function') continue;
    const eventToken = tokens[index + 2];
    if (eventToken?.type === 'string') {
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

function collectTelemetryPolicyFindings({
  rootDir = projectRoot,
  runtimeFiles = RUNTIME_FILES,
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

  return findings;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const findings = collectTelemetryPolicyFindings();
  if (findings.length > 0) {
    console.error(`Telemetry policy failed with ${findings.length} finding(s):`);
    findings.forEach((finding) => console.error(`- ${finding}`));
    process.exitCode = 1;
  } else {
    console.log('Telemetry policy OK: no external runtime analytics adapters are enabled.');
  }
}

export {
  ALLOWED_EVENTS,
  collectTelemetryPolicyFindings,
  inspectRuntimeSource,
  readStableRuntimeSource,
  tokenizeJavaScript
};
