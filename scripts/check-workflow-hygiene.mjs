import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import YAML, { isAlias, isMap, isScalar, isSeq } from 'yaml';

const require = createRequire(import.meta.url);
const { readStableFileNoFollow } = require('./lib/safe-input.cjs');

const WORKFLOW_DIR = '.github/workflows';
const MAX_WORKFLOW_BYTES = 1024 * 1024;
const REMOTE_ACTION_WITH_SHA = /^([^@\s]+)@([0-9a-f]{40})$/i;
const IMMUTABLE_DOCKER_REFERENCE = /^docker:\/\/[^@\s]+@sha256:[0-9a-f]{64}$/i;
const RATCHET_COMMENT = /(?:^|\s)ratchet:([^@\s]+)@([^\s]+)/;
const WORKFLOW_EXPRESSION_PATTERN = /\$\{\{([\s\S]*?)}}/g;
const EVENT_BODY_REFERENCE_PATTERN = new RegExp(
  String.raw`\bgithub\s*` +
  String.raw`(?:\.\s*event\b|\[\s*['"]event['"]\s*\])\s*` +
  String.raw`(?:\.\s*(?:issue|comment|review|pull_request)\b|` +
  String.raw`\[\s*['"](?:issue|comment|review|pull_request)['"]\s*\])\s*` +
  String.raw`(?:\.\s*body\b|\[\s*['"]body['"]\s*\])`
);
const FIXED_OUTPUT_DELIMITER_PATTERN =
  /(?<!<)<<-?[ \t]*(?:'[^'\r\n]+'|"(?![^"\r\n]*[$`])[^"\r\n]+"|[^\s<$`"';&|()]+)/;
const SHELL_CONTROL_PREFIXES = new Set([
  '!', '{', '}', 'if', 'then', 'elif', 'while', 'until', 'do', 'builtin'
]);
const ENV_OPTIONS_WITH_VALUES = new Set([
  '--argv0', '--chdir', '--split-string', '--unset', '-C', '-S', '-u'
]);
const ENV_FLAG_OPTIONS = new Set([
  '--debug', '--ignore-environment', '--null', '--verbose', '-0', '-i', '-v'
]);
const ENV_SCRIPT_OPTIONS = new Set(['--split-string', '-S']);
const SUDO_OPTIONS_WITH_VALUES = new Set([
  '--chdir',
  '--close-from',
  '--group',
  '--host',
  '--other-user',
  '--prompt',
  '--role',
  '--type',
  '--user',
  '-C',
  '-D',
  '-g',
  '-h',
  '-p',
  '-R',
  '-T',
  '-U',
  '-u'
]);
const SUDO_FLAG_OPTIONS = new Set([
  '--askpass',
  '--background',
  '--bell',
  '--edit',
  '--help',
  '--login',
  '--non-interactive',
  '--preserve-env',
  '--remove-timestamp',
  '--reset-timestamp',
  '--set-home',
  '--stdin',
  '--validate',
  '--version',
  '-A',
  '-b',
  '-B',
  '-e',
  '-E',
  '-H',
  '-i',
  '-K',
  '-k',
  '-n',
  '-P',
  '-S',
  '-s',
  '-V',
  '-v'
]);
const EXEC_OPTIONS_WITH_VALUES = new Set(['--argv0', '-a']);
const EXEC_FLAG_OPTIONS = new Set(['--clear-environment', '--login', '-c', '-l']);
const TIMEOUT_OPTIONS_WITH_VALUES = new Set(['--kill-after', '--signal', '-k', '-s']);
const TIMEOUT_FLAG_OPTIONS = new Set(['--foreground', '--preserve-status', '--verbose']);
const STDBUF_OPTIONS_WITH_VALUES = new Set(['--error', '--input', '--output', '-e', '-i', '-o']);
const SETSID_FLAG_OPTIONS = new Set(['--ctty', '--fork', '--wait', '-c', '-f', '-w']);
const XARGS_OPTIONS_WITH_VALUES = new Set([
  '--arg-file',
  '--delimiter',
  '--eof',
  '--max-args',
  '--max-chars',
  '--max-lines',
  '--max-procs',
  '--process-slot-var',
  '--replace',
  '-a',
  '-d',
  '-E',
  '-I',
  '-L',
  '-n',
  '-P',
  '-s'
]);
const XARGS_FLAG_OPTIONS = new Set([
  '--exit',
  '--interactive',
  '--no-run-if-empty',
  '--null',
  '--open-tty',
  '--verbose',
  '-0',
  '-o',
  '-p',
  '-r',
  '-t',
  '-x'
]);
const NPM_OPTIONS_WITH_VALUES = new Set([
  '--auth-type',
  '--before',
  '--cache',
  '--globalconfig',
  '--https-proxy',
  '--loglevel',
  '--node-options',
  '--otp',
  '--prefix',
  '--proxy',
  '--registry',
  '--script-shell',
  '--scope',
  '--tag',
  '--userconfig',
  '--workspace',
  '-C',
  '-w'
]);
const NPM_FLAG_OPTIONS = new Set([
  '--audit',
  '--color',
  '--dry-run',
  '--force',
  '--foreground-scripts',
  '--fund',
  '--global',
  '--ignore-scripts',
  '--include-workspace-root',
  '--json',
  '--legacy-peer-deps',
  '--no-audit',
  '--no-color',
  '--no-fund',
  '--no-ignore-scripts',
  '--no-progress',
  '--no-unicode',
  '--no-workspaces',
  '--offline',
  '--prefer-offline',
  '--prefer-online',
  '--progress',
  '--silent',
  '--strict-peer-deps',
  '--timing',
  '--unicode',
  '--verbose',
  '--workspaces',
  '--yes',
  '-f',
  '-g',
  '-s',
  '-y'
]);
const SHELL_COMMAND_WRAPPERS = new Set(['ash', 'bash', 'dash', 'sh', 'zsh']);
const SHELL_OPTIONS_WITH_VALUES = new Set(['--init-file', '--rcfile', '+O', '+o', '-O', '-o']);
const SHELL_FLAG_OPTIONS = new Set([
  '--debugger',
  '--dump-po-strings',
  '--dump-strings',
  '--help',
  '--login',
  '--noediting',
  '--noprofile',
  '--norc',
  '--posix',
  '--restricted',
  '--verbose',
  '--version'
]);
const SHELL_TERMINAL_OPTIONS = new Set([
  '--dump-po-strings', '--dump-strings', '--help', '--version'
]);
const MAX_SHELL_WRAPPER_DEPTH = 8;

function listWorkflowFiles({ cwd = process.cwd() } = {}) {
  return fs.readdirSync(path.join(cwd, WORKFLOW_DIR))
    .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
    .map((file) => `${WORKFLOW_DIR}/${file}`)
    .sort();
}

function parseWorkflowYaml(filePath, content, findings) {
  const document = YAML.parseDocument(content, {
    prettyErrors: false,
    strict: true
  });

  if (document.errors.length > 0) {
    findings.push(...document.errors.map((error) => `${filePath}: invalid YAML: ${error.message}`));
    return null;
  }

  return document;
}

function resolveNode(node, document) {
  let resolved = node;
  const aliases = new Set();

  while (isAlias(resolved)) {
    if (aliases.has(resolved)) return null;
    aliases.add(resolved);
    resolved = resolved.resolve(document);
  }

  return resolved;
}

function scalarValue(node, document) {
  const resolved = resolveNode(node, document);
  return isScalar(resolved) ? resolved.value : undefined;
}

function findMapPair(mapNode, key, document) {
  const resolvedMap = resolveNode(mapNode, document);
  if (!isMap(resolvedMap)) return null;

  return resolvedMap.items.find((pair) => scalarValue(pair.key, document) === key) || null;
}

function lineNumberAtOffset(content, offset) {
  if (!Number.isInteger(offset) || offset < 0) return null;

  let lineNumber = 1;
  for (let index = 0; index < offset; index += 1) {
    if (content.charCodeAt(index) === 10) lineNumber += 1;
  }
  return lineNumber;
}

function nodeLineDetails(content, ...nodes) {
  const node = nodes.find((candidate) => Number.isInteger(candidate?.range?.[0]));
  const lineNumber = lineNumberAtOffset(content, node?.range?.[0]);
  if (!lineNumber) return { lineNumber: null, sourceLine: '' };

  return {
    lineNumber,
    sourceLine: content.split(/\r?\n/)[lineNumber - 1]?.trim() || ''
  };
}

function addLineFinding(findings, filePath, content, nodes, message, includeSource = false) {
  const { lineNumber, sourceLine } = nodeLineDetails(content, ...nodes);
  const location = lineNumber ? `${filePath}:${lineNumber}` : filePath;
  const source = includeSource && sourceLine ? `: ${sourceLine}` : '';
  findings.push(`${location}: ${message}${source}`);
}

function eventNode(node, eventName, document) {
  const resolved = resolveNode(node, document);

  if (isScalar(resolved)) {
    return resolved.value === eventName ? resolved : null;
  }

  if (isSeq(resolved)) {
    for (const item of resolved.items) {
      const match = eventNode(item, eventName, document);
      if (match) return match;
    }
    return null;
  }

  if (isMap(resolved)) {
    const pair = findMapPair(resolved, eventName, document);
    return pair?.key || null;
  }

  return null;
}

function validateUsesPair(filePath, content, pair, document, findings) {
  const referenceNode = resolveNode(pair.value, document);
  const rawReference = scalarValue(pair.value, document);
  const diagnosticNodes = [pair.key, pair.value, referenceNode];

  if (typeof rawReference !== 'string') {
    addLineFinding(
      findings,
      filePath,
      content,
      diagnosticNodes,
      'action reference must be a string',
      true
    );
    return;
  }

  if (rawReference.startsWith('./')) return;

  if (rawReference.startsWith('docker://')) {
    if (!IMMUTABLE_DOCKER_REFERENCE.test(rawReference)) {
      addLineFinding(
        findings,
        filePath,
        content,
        diagnosticNodes,
        'Docker action reference is not pinned to a sha256 digest',
        true
      );
    }
    return;
  }

  const remoteMatch = rawReference.match(REMOTE_ACTION_WITH_SHA);
  if (!remoteMatch) {
    addLineFinding(
      findings,
      filePath,
      content,
      diagnosticNodes,
      'action reference is not pinned to a full SHA',
      true
    );
    return;
  }

  const comment = pair.value?.comment || referenceNode?.comment || '';
  const commentMatch = comment.match(RATCHET_COMMENT);
  if (!commentMatch) {
    addLineFinding(
      findings,
      filePath,
      content,
      diagnosticNodes,
      'pinned action is missing a ratchet comment',
      true
    );
    return;
  }

  const [, actionPath] = remoteMatch;
  const [, ratchetPath, ratchetVersion] = commentMatch;
  const ratchetMatchesAction = actionPath === ratchetPath || actionPath.startsWith(`${ratchetPath}/`);
  if (!ratchetMatchesAction) {
    addLineFinding(
      findings,
      filePath,
      content,
      diagnosticNodes,
      'ratchet comment path does not match action path',
      true
    );
  }
  if (!/^v?\d+(?:\.\d+){0,2}$/.test(ratchetVersion)) {
    addLineFinding(
      findings,
      filePath,
      content,
      diagnosticNodes,
      'ratchet comment must name a version tag, not a branch or SHA',
      true
    );
  }
}

function findHeredocDeclarations(line, shellState) {
  const declarations = [];

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (shellState.quote) {
      if (character === shellState.quote) shellState.quote = null;
      else if (character === '\\' && shellState.quote === '"') index += 1;
      continue;
    }
    if (character === "'" || character === '"') {
      shellState.quote = character;
      continue;
    }
    if (character === '\\') {
      index += 1;
      continue;
    }

    const startsWord = index === 0 || /[\s;&|()]/.test(line[index - 1]);
    if (character === '#' && startsWord) break;

    if (line.startsWith('$((', index)) {
      shellState.arithmeticDepth += 1;
      index += 2;
      continue;
    }
    if (line.startsWith('((', index)) {
      shellState.arithmeticDepth += 1;
      index += 1;
      continue;
    }
    if (shellState.arithmeticDepth > 0) {
      if (line.startsWith('))', index)) {
        shellState.arithmeticDepth -= 1;
        index += 1;
      }
      continue;
    }
    if (line.startsWith('[[', index)) {
      shellState.conditionalDepth += 1;
      index += 1;
      continue;
    }
    if (shellState.conditionalDepth > 0) {
      if (line.startsWith(']]', index)) {
        shellState.conditionalDepth -= 1;
        index += 1;
      }
      continue;
    }
    if (character !== '<' || line[index + 1] !== '<' || line[index + 2] === '<') continue;

    let cursor = index + 2;
    const stripTabs = line[cursor] === '-';
    if (stripTabs) cursor += 1;
    while (line[cursor] === ' ' || line[cursor] === '\t') cursor += 1;

    let delimiter = '';
    let delimiterQuote = null;
    let quoted = false;
    for (; cursor < line.length; cursor += 1) {
      const delimiterCharacter = line[cursor];
      if (delimiterQuote) {
        if (delimiterCharacter === delimiterQuote) delimiterQuote = null;
        else if (delimiterCharacter === '\\' && delimiterQuote === '"' && cursor + 1 < line.length) {
          cursor += 1;
          delimiter += line[cursor];
        } else delimiter += delimiterCharacter;
        continue;
      }
      if (delimiterCharacter === "'" || delimiterCharacter === '"') {
        quoted = true;
        delimiterQuote = delimiterCharacter;
        continue;
      }
      if (delimiterCharacter === '\\' && cursor + 1 < line.length) {
        quoted = true;
        cursor += 1;
        delimiter += line[cursor];
        continue;
      }
      if (/\s/.test(delimiterCharacter) || ';&|()<>'.includes(delimiterCharacter)) break;
      delimiter += delimiterCharacter;
    }
    if (delimiter) declarations.push({ bodyLines: [], delimiter, quoted, stripTabs });
    index = Math.max(index, cursor - 1);
  }

  return declarations;
}

function stripHeredocBodies(script) {
  const lines = script.split('\n');
  const executableLines = [];
  const expandableBodies = [];
  const pendingHeredocs = [];
  const shellState = { arithmeticDepth: 0, conditionalDepth: 0, quote: null };

  for (const rawLine of lines) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (pendingHeredocs.length > 0) {
      const pending = pendingHeredocs[0];
      const candidate = pending.stripTabs ? line.replace(/^\t+/, '') : line;
      if (candidate === pending.delimiter) {
        if (!pending.quoted) expandableBodies.push(pending.bodyLines.join('\n'));
        pendingHeredocs.shift();
      } else {
        pending.bodyLines.push(rawLine);
      }
      continue;
    }

    executableLines.push(rawLine);
    pendingHeredocs.push(...findHeredocDeclarations(line, shellState));
  }

  if (pendingHeredocs.length > 0) {
    return { executableScript: script, expandableBodies: [] };
  }
  return { executableScript: executableLines.join('\n'), expandableBodies };
}

const SHELL_REDIRECTION_OPERATORS = ['<<<', '<<-', '<<', '<&', '<>', '>>', '>&', '>|', '<', '>'];

function closingShellParenthesis(script, openingIndex) {
  let depth = 1;
  let quote = null;

  for (let index = openingIndex + 1; index < script.length; index += 1) {
    const character = script[index];
    if (quote) {
      if (character === quote) quote = null;
      else if (character === '\\') index += 1;
      else if (quote === '"' && character === '$' && script[index + 1] === '(') {
        depth += 1;
        index += 1;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (character === '(') depth += 1;
    else if (character === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function closingBacktick(script, openingIndex) {
  for (let index = openingIndex + 1; index < script.length; index += 1) {
    if (script[index] === '\\') index += 1;
    else if (script[index] === '`') return index;
  }
  return -1;
}

function extractShellSubstitutions(script) {
  const fragments = [];
  let quote = null;

  for (let index = 0; index < script.length; index += 1) {
    const character = script[index];
    if (quote === "'") {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (character === "'") {
      quote = character;
      continue;
    }
    if (character === '"') {
      quote = quote === '"' ? null : '"';
      continue;
    }
    if (character === '`') {
      const closingIndex = closingBacktick(script, index);
      const fragmentEnd = closingIndex >= 0 ? closingIndex : script.length;
      fragments.push(script.slice(index + 1, fragmentEnd));
      index = fragmentEnd;
      continue;
    }

    const isArithmeticExpansion = character === '$' && script.startsWith('$((', index);
    const isCommandSubstitution = character === '$' && script[index + 1] === '(';
    const isProcessSubstitution = quote !== '"' &&
      (character === '<' || character === '>') &&
      script[index + 1] === '(';
    if (isArithmeticExpansion) {
      index += 2;
      continue;
    }
    if (!isCommandSubstitution && !isProcessSubstitution) continue;

    const openingIndex = index + 1;
    const closingIndex = closingShellParenthesis(script, openingIndex);
    const fragmentEnd = closingIndex >= 0 ? closingIndex : script.length;
    fragments.push(script.slice(openingIndex + 1, fragmentEnd));
    index = fragmentEnd;
  }

  return fragments;
}

function shellWordEnd(script, startIndex) {
  let index = startIndex;
  let quote = null;
  let commandSubstitutionDepth = 0;

  for (; index < script.length; index += 1) {
    const character = script[index];
    if (quote) {
      if (character === quote) quote = null;
      else if (character === '\\' && quote === '"') index += 1;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (character === '$' && script[index + 1] === '(') {
      commandSubstitutionDepth += 1;
      index += 1;
      continue;
    }
    if (character === ')' && commandSubstitutionDepth > 0) {
      commandSubstitutionDepth -= 1;
      continue;
    }
    if (commandSubstitutionDepth === 0 && (/\s/.test(character) || ';&|'.includes(character))) break;
  }

  return index;
}

function tokenizeShellCommands(script) {
  const commands = [];
  let tokens = [];
  let token = '';
  let tokenStarted = false;
  let quote = null;
  let inputRedirection = false;
  let pipedInput = false;

  const flushToken = () => {
    if (!tokenStarted) return;
    tokens.push(token);
    token = '';
    tokenStarted = false;
  };
  const flushCommand = (nextPipedInput = false) => {
    flushToken();
    if (tokens.length > 0) {
      commands.push({ inputRedirection, pipedInput, tokens });
      tokens = [];
      inputRedirection = false;
      pipedInput = nextPipedInput;
    } else if (nextPipedInput) {
      pipedInput = true;
    }
  };

  for (let index = 0; index < script.length; index += 1) {
    const character = script[index];

    if (quote) {
      if (character === quote) {
        quote = null;
      } else if (character === '\\' && quote === '"' && index + 1 < script.length) {
        if (script[index + 1] === '\n') {
          index += 1;
        } else {
          token += script[index + 1];
          index += 1;
        }
      } else {
        token += character;
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      tokenStarted = true;
      continue;
    }

    if (character === '\\' && index + 1 < script.length) {
      if (script[index + 1] === '\n') {
        index += 1;
      } else {
        tokenStarted = true;
        token += script[index + 1];
        index += 1;
      }
      continue;
    }

    if (character === '#' && !tokenStarted) {
      while (index + 1 < script.length && script[index + 1] !== '\n') index += 1;
      flushCommand();
      continue;
    }

    if (character === '<' || character === '>') {
      if (/^(?:[0-9]+|\{[A-Za-z_][A-Za-z0-9_]*})$/.test(token)) {
        token = '';
        tokenStarted = false;
      } else {
        flushToken();
      }

      const operator = SHELL_REDIRECTION_OPERATORS.find((candidate) =>
        script.startsWith(candidate, index)
      );
      if (operator?.startsWith('<')) inputRedirection = true;
      index += (operator?.length || 1) - 1;
      let targetIndex = index + 1;
      while (script[targetIndex] === ' ' || script[targetIndex] === '\t') targetIndex += 1;
      if (targetIndex < script.length && script[targetIndex] !== '\n' && script[targetIndex] !== '\r') {
        index = shellWordEnd(script, targetIndex) - 1;
      }
      continue;
    }

    if (/\s/.test(character)) {
      flushToken();
      if (character === '\n' || character === '\r') flushCommand();
      continue;
    }

    if (';&|()'.includes(character)) {
      const nextCharacter = script[index + 1];
      const pipeToNextCommand = character === '|' && nextCharacter !== '|';
      flushCommand(pipeToNextCommand);
      if (
        ((character === '&' || character === '|') && nextCharacter === character) ||
        (character === '|' && nextCharacter === '&')
      ) {
        index += 1;
      }
      continue;
    }

    tokenStarted = true;
    token += character;
  }

  flushCommand();
  return commands;
}

function isDynamicShellToken(token) {
  return /[$`]/.test(token);
}

function shellExecutableName(token) {
  return path.posix.basename(token || '');
}

function isShellAssignment(token) {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}

function consumePrefixArguments(tokens, startIndex, {
  optionsWithValues,
  flagOptions,
  shortOptionsWithAttachedValues = new Set(),
  scriptValueOptions = new Set(),
  allowAssignments = false
}) {
  let index = startIndex;
  const embeddedScripts = [];

  while (index < tokens.length) {
    const token = tokens[index];
    if (isDynamicShellToken(token)) return { ambiguous: true, embeddedScripts, index };
    if (allowAssignments && isShellAssignment(token)) {
      index += 1;
      continue;
    }
    if (token === '--') return { ambiguous: false, embeddedScripts, index: index + 1 };
    if (!token.startsWith('-') || token === '-') return { ambiguous: false, embeddedScripts, index };

    const equalsIndex = token.indexOf('=');
    const optionName = equalsIndex >= 0 ? token.slice(0, equalsIndex) : token;
    if (optionsWithValues.has(optionName)) {
      const value = equalsIndex >= 0 ? token.slice(equalsIndex + 1) : tokens[index + 1];
      if (!value || isDynamicShellToken(value)) {
        return {
          ambiguous: true,
          dynamicScript: scriptValueOptions.has(optionName),
          embeddedScripts,
          index
        };
      }
      if (scriptValueOptions.has(optionName)) {
        const remainingArguments = tokens.slice(equalsIndex >= 0 ? index + 1 : index + 2);
        embeddedScripts.push([value, ...remainingArguments].join(' '));
        return { ambiguous: false, embeddedScripts, index: tokens.length };
      }
      index += equalsIndex >= 0 ? 1 : 2;
      continue;
    }
    const attachedValueOption = [...shortOptionsWithAttachedValues]
      .find((option) => token.startsWith(option) && token.length > option.length);
    if (attachedValueOption) {
      const value = token.slice(attachedValueOption.length);
      if (isDynamicShellToken(value)) {
        return {
          ambiguous: true,
          dynamicScript: scriptValueOptions.has(attachedValueOption),
          embeddedScripts,
          index
        };
      }
      if (scriptValueOptions.has(attachedValueOption)) {
        embeddedScripts.push([value, ...tokens.slice(index + 1)].join(' '));
        return { ambiguous: false, embeddedScripts, index: tokens.length };
      }
      index += 1;
      continue;
    }
    if (flagOptions.has(token)) {
      index += 1;
      continue;
    }
    return { ambiguous: true, embeddedScripts, index };
  }

  return { ambiguous: false, embeddedScripts, index };
}

function consumeCommandPrefix(tokens, startIndex) {
  let index = startIndex;
  while (tokens[index] === '-p') index += 1;
  if (tokens[index] === '--') index += 1;
  if (tokens[index]?.startsWith('-')) return { ambiguous: true, index };
  return { ambiguous: false, index };
}

function consumeTimePrefix(tokens, startIndex) {
  let index = startIndex;
  while (tokens[index] === '-p' || tokens[index] === '--portability') index += 1;
  if (tokens[index] === '--') index += 1;
  if (tokens[index]?.startsWith('-')) return { ambiguous: true, index };
  return { ambiguous: false, index };
}

function consumeNicePrefix(tokens, startIndex) {
  let index = startIndex;
  while (index < tokens.length) {
    const token = tokens[index];
    if (isDynamicShellToken(token)) return { ambiguous: true, index };
    if (token === '--') return { ambiguous: false, index: index + 1 };
    if (/^-[0-9]+$/.test(token)) {
      index += 1;
      continue;
    }
    if (token === '-n' || token === '--adjustment') {
      const value = tokens[index + 1];
      if (!value || isDynamicShellToken(value)) return { ambiguous: true, index };
      index += 2;
      continue;
    }
    if (/^(?:-n|--adjustment=).+/.test(token)) {
      index += 1;
      continue;
    }
    if (token.startsWith('-')) return { ambiguous: true, index };
    return { ambiguous: false, index };
  }
  return { ambiguous: false, index };
}

function consumeTimeoutPrefix(tokens, startIndex) {
  const prefix = consumePrefixArguments(tokens, startIndex, {
    optionsWithValues: TIMEOUT_OPTIONS_WITH_VALUES,
    flagOptions: TIMEOUT_FLAG_OPTIONS,
    shortOptionsWithAttachedValues: new Set(['-k', '-s'])
  });
  if (prefix.ambiguous || prefix.index >= tokens.length) return prefix;
  if (isDynamicShellToken(tokens[prefix.index])) return { ambiguous: true, index: prefix.index };
  return { ambiguous: false, index: prefix.index + 1 };
}

function commandExecutable(tokens) {
  let index = 0;
  const embeddedScripts = [];
  while (index < tokens.length && isShellAssignment(tokens[index])) index += 1;

  while (index < tokens.length) {
    const token = tokens[index];
    if (isDynamicShellToken(token)) return { ambiguous: true, embeddedScripts, index };

    const executableName = shellExecutableName(token);
    if (SHELL_CONTROL_PREFIXES.has(token)) {
      index += 1;
      continue;
    }

    let prefix;
    if (executableName === 'env') {
      prefix = consumePrefixArguments(tokens, index + 1, {
        optionsWithValues: ENV_OPTIONS_WITH_VALUES,
        flagOptions: ENV_FLAG_OPTIONS,
        shortOptionsWithAttachedValues: new Set(['-C', '-S', '-u']),
        scriptValueOptions: ENV_SCRIPT_OPTIONS,
        allowAssignments: true
      });
    } else if (executableName === 'sudo') {
      prefix = consumePrefixArguments(tokens, index + 1, {
        optionsWithValues: SUDO_OPTIONS_WITH_VALUES,
        flagOptions: SUDO_FLAG_OPTIONS,
        shortOptionsWithAttachedValues: new Set(['-C', '-D', '-g', '-h', '-p', '-R', '-T', '-U', '-u']),
        allowAssignments: true
      });
    } else if (executableName === 'command') {
      prefix = consumeCommandPrefix(tokens, index + 1);
    } else if (executableName === 'time') {
      prefix = consumeTimePrefix(tokens, index + 1);
    } else if (executableName === 'exec') {
      prefix = consumePrefixArguments(tokens, index + 1, {
        optionsWithValues: EXEC_OPTIONS_WITH_VALUES,
        flagOptions: EXEC_FLAG_OPTIONS,
        shortOptionsWithAttachedValues: new Set(['-a'])
      });
    } else if (executableName === 'nohup') {
      prefix = consumePrefixArguments(tokens, index + 1, {
        optionsWithValues: new Set(),
        flagOptions: new Set()
      });
    } else if (executableName === 'nice') {
      prefix = consumeNicePrefix(tokens, index + 1);
    } else if (executableName === 'timeout') {
      prefix = consumeTimeoutPrefix(tokens, index + 1);
    } else if (executableName === 'stdbuf') {
      prefix = consumePrefixArguments(tokens, index + 1, {
        optionsWithValues: STDBUF_OPTIONS_WITH_VALUES,
        flagOptions: new Set(),
        shortOptionsWithAttachedValues: new Set(['-e', '-i', '-o'])
      });
    } else if (executableName === 'setsid') {
      prefix = consumePrefixArguments(tokens, index + 1, {
        optionsWithValues: new Set(),
        flagOptions: SETSID_FLAG_OPTIONS
      });
    } else if (executableName === 'xargs') {
      prefix = consumePrefixArguments(tokens, index + 1, {
        optionsWithValues: XARGS_OPTIONS_WITH_VALUES,
        flagOptions: XARGS_FLAG_OPTIONS,
        shortOptionsWithAttachedValues: new Set(['-a', '-d', '-E', '-I', '-L', '-n', '-P', '-s'])
      });
    } else {
      break;
    }

    if (prefix.embeddedScripts) embeddedScripts.push(...prefix.embeddedScripts);
    if (prefix.ambiguous) return { ...prefix, embeddedScripts };
    index = prefix.index;
  }

  if (isDynamicShellToken(tokens[index] || '')) return { ambiguous: true, embeddedScripts, index };
  return { ambiguous: false, embeddedScripts, index };
}

function parseNpmOption(tokens, index) {
  const token = tokens[index];
  const equalsIndex = token.indexOf('=');
  const optionName = equalsIndex >= 0 ? token.slice(0, equalsIndex) : token;
  const isKnownOption = NPM_OPTIONS_WITH_VALUES.has(optionName) || NPM_FLAG_OPTIONS.has(optionName);

  if (equalsIndex >= 0) {
    return {
      ambiguous: !isKnownOption || isDynamicShellToken(token),
      nextIndex: index + 1,
      option: token
    };
  }

  if (NPM_OPTIONS_WITH_VALUES.has(token)) {
    const value = tokens[index + 1];
    return {
      ambiguous: value === undefined || isDynamicShellToken(value),
      nextIndex: Math.min(index + 2, tokens.length),
      option: token
    };
  }

  if (NPM_FLAG_OPTIONS.has(token)) {
    const booleanValue = tokens[index + 1];
    const hasSeparateBooleanValue = /^(?:true|false)$/i.test(booleanValue || '');
    return {
      ambiguous: false,
      nextIndex: index + (hasSeparateBooleanValue ? 2 : 1),
      option: hasSeparateBooleanValue ? `${token}=${booleanValue.toLowerCase()}` : token
    };
  }

  return {
    ambiguous: true,
    nextIndex: index + 1,
    option: token
  };
}

function findNpmCiInvocation(tokens, executableIndex) {
  const globalOptions = [];
  let ambiguous = false;
  let index = executableIndex + 1;

  while (index < tokens.length) {
    const token = tokens[index];
    if (token === 'ci') {
      return { ambiguous, commandIndex: index, globalOptions };
    }
    if (token === '--') {
      return tokens[index + 1] === 'ci'
        ? { ambiguous, commandIndex: index + 1, globalOptions }
        : null;
    }
    if (!token.startsWith('-') && !isDynamicShellToken(token)) return null;

    const parsedOption = parseNpmOption(tokens, index);
    globalOptions.push(parsedOption.option);
    ambiguous ||= parsedOption.ambiguous;

    if (parsedOption.ambiguous && !NPM_OPTIONS_WITH_VALUES.has(token)) {
      const possibleCommandIndex = tokens.indexOf('ci', index + 1);
      return possibleCommandIndex >= 0
        ? { ambiguous: true, commandIndex: possibleCommandIndex, globalOptions }
        : null;
    }
    index = parsedOption.nextIndex;
  }

  return null;
}

function collectNpmConfigurationOptions(tokens, startIndex, initialOptions) {
  const options = [...initialOptions];
  let ambiguous = false;
  let index = startIndex;

  while (index < tokens.length) {
    const token = tokens[index];
    if (token === '--') break;

    if (isDynamicShellToken(token)) {
      ambiguous = true;
      index += 1;
      continue;
    }
    if (!token.startsWith('-')) {
      index += 1;
      continue;
    }

    const parsedOption = parseNpmOption(tokens, index);
    options.push(parsedOption.option);
    ambiguous ||= parsedOption.ambiguous;
    index = parsedOption.nextIndex;
  }

  return { ambiguous, options };
}

function findShellWrapperScript(tokens, startIndex) {
  let index = startIndex;
  let forceStdin = false;

  while (index < tokens.length) {
    const token = tokens[index];
    if (isDynamicShellToken(token)) return { ambiguous: true, receivesStdin: false, script: null };
    if (token === '--') {
      return {
        ambiguous: false,
        receivesStdin: forceStdin || tokens[index + 1] === undefined,
        script: null
      };
    }

    if (/^-[^-]*c/.test(token)) {
      const script = tokens[index + 1];
      return {
        ambiguous: script === undefined || isDynamicShellToken(script),
        receivesStdin: false,
        script: script || null
      };
    }

    const equalsIndex = token.indexOf('=');
    const optionName = equalsIndex >= 0 ? token.slice(0, equalsIndex) : token;
    if (SHELL_OPTIONS_WITH_VALUES.has(optionName)) {
      const value = equalsIndex >= 0 ? token.slice(equalsIndex + 1) : tokens[index + 1];
      if (value === undefined || isDynamicShellToken(value)) {
        return { ambiguous: true, receivesStdin: false, script: null };
      }
      index += equalsIndex >= 0 ? 1 : 2;
      continue;
    }

    if (SHELL_TERMINAL_OPTIONS.has(token)) {
      return { ambiguous: false, receivesStdin: false, script: null };
    }
    if (SHELL_FLAG_OPTIONS.has(token) || /^-[abefhklmnptuvxBCEHPT]+$/.test(token)) {
      if (/^-[^-]*s/.test(token)) forceStdin = true;
      index += 1;
      continue;
    }
    if (token.startsWith('-') || token.startsWith('+')) {
      return { ambiguous: true, receivesStdin: false, script: null };
    }

    return { ambiguous: false, receivesStdin: forceStdin, script: null };
  }

  return { ambiguous: false, receivesStdin: true, script: null };
}

function hasUnsafeShellWrapper(tokens, executableIndex, depth, commandContext) {
  const executableName = shellExecutableName(tokens[executableIndex]);

  if (executableName === 'eval') {
    const firstArgumentIndex = tokens[executableIndex + 1] === '--'
      ? executableIndex + 2
      : executableIndex + 1;
    const scriptArguments = tokens.slice(firstArgumentIndex);
    if (scriptArguments.length === 0) return false;
    if (scriptArguments.some(isDynamicShellToken) || depth >= MAX_SHELL_WRAPPER_DEPTH) {
      return true;
    }
    return hasUnsafeNpmCi(scriptArguments.join(' '), depth + 1);
  }

  if (!SHELL_COMMAND_WRAPPERS.has(executableName)) return false;

  const wrapper = findShellWrapperScript(tokens, executableIndex + 1);
  if (wrapper.ambiguous) return true;
  if (!wrapper.script) {
    return wrapper.receivesStdin &&
      (commandContext.inputRedirection || commandContext.pipedInput);
  }
  if (depth >= MAX_SHELL_WRAPPER_DEPTH) return true;
  return hasUnsafeNpmCi(wrapper.script, depth + 1);
}

function commandHasCiShape(tokens, startIndex = 0) {
  return tokens.slice(startIndex).includes('ci');
}

function hasUnsafeBusyBoxCommand(tokens, executableIndex, depth, commandContext) {
  let appletIndex = executableIndex + 1;
  if (tokens[appletIndex] === '--') appletIndex += 1;
  const applet = tokens[appletIndex] || '';
  if (!applet) return false;
  if (isDynamicShellToken(applet) || depth >= MAX_SHELL_WRAPPER_DEPTH) {
    return commandHasCiShape(tokens, appletIndex + 1);
  }
  return hasUnsafeNpmCiTokens(tokens.slice(appletIndex), depth + 1, commandContext);
}

function hasUnsafeNpmCiTokens(tokens, depth, commandContext = {}) {
  const resolvedExecutable = commandExecutable(tokens);
  if (resolvedExecutable.dynamicScript) return true;
  for (const embeddedScript of resolvedExecutable.embeddedScripts || []) {
    if (depth >= MAX_SHELL_WRAPPER_DEPTH || hasUnsafeNpmCi(embeddedScript, depth + 1)) return true;
  }
  if (resolvedExecutable.ambiguous) {
    return commandHasCiShape(tokens, resolvedExecutable.index + 1);
  }

  const executableIndex = resolvedExecutable.index;
  const executableName = shellExecutableName(tokens[executableIndex]);
  if (executableName !== 'npm') {
    if (executableName === 'busybox') {
      return hasUnsafeBusyBoxCommand(tokens, executableIndex, depth, commandContext);
    }
    return hasUnsafeShellWrapper(tokens, executableIndex, depth, commandContext);
  }

  const invocation = findNpmCiInvocation(tokens, executableIndex);
  if (!invocation) return false;

  const configuration = collectNpmConfigurationOptions(
    tokens,
    invocation.commandIndex + 1,
    invocation.globalOptions
  );
  const disablesProtection = configuration.options.some((argument) =>
    /^(?:--ignore-scripts=(?:false|0)|--no-ignore-scripts(?:=true)?)$/i.test(argument)
  );
  const enablesProtection = configuration.options.some((argument) =>
    /^(?:--ignore-scripts(?:=true)?|--no-ignore-scripts=false)$/i.test(argument)
  );

  return invocation.ambiguous || configuration.ambiguous || disablesProtection || !enablesProtection;
}

function hasUnsafeNpmCi(command, depth = 0) {
  const { executableScript, expandableBodies } = stripHeredocBodies(command);
  const nestedFragments = extractShellSubstitutions(executableScript);
  for (const body of expandableBodies) {
    nestedFragments.push(...extractShellSubstitutions(body));
  }
  if (nestedFragments.length > 0) {
    if (depth >= MAX_SHELL_WRAPPER_DEPTH) return true;
    if (nestedFragments.some((fragment) => hasUnsafeNpmCi(fragment, depth + 1))) return true;
  }

  return tokenizeShellCommands(executableScript).some((commandContext) =>
    hasUnsafeNpmCiTokens(commandContext.tokens, depth, commandContext)
  );
}

function hasEventBodyInterpolation(command) {
  WORKFLOW_EXPRESSION_PATTERN.lastIndex = 0;
  for (const match of command.matchAll(WORKFLOW_EXPRESSION_PATTERN)) {
    if (EVENT_BODY_REFERENCE_PATTERN.test(match[1])) return true;
  }
  return false;
}

function validateRunPair(filePath, content, pair, document, findings) {
  const runNode = resolveNode(pair.value, document);
  const command = scalarValue(pair.value, document);
  const diagnosticNodes = [pair.key, pair.value, runNode];

  // `defaults.run` is a mapping of shell defaults, not a step command.
  if (!isScalar(runNode)) return;

  if (typeof command !== 'string') {
    addLineFinding(findings, filePath, content, diagnosticNodes, 'run command must be a string');
    return;
  }

  if (hasUnsafeNpmCi(command)) {
    addLineFinding(findings, filePath, content, diagnosticNodes, 'npm ci must use --ignore-scripts');
  }
  if (hasEventBodyInterpolation(command)) {
    addLineFinding(
      findings,
      filePath,
      content,
      diagnosticNodes,
      'do not interpolate PR/comment body content directly into shell commands'
    );
  }
  if (command.includes('GITHUB_OUTPUT') && FIXED_OUTPUT_DELIMITER_PATTERN.test(command)) {
    addLineFinding(
      findings,
      filePath,
      content,
      diagnosticNodes,
      'do not use fixed delimiters for multiline GITHUB_OUTPUT values'
    );
  }
}

function validateJobs(filePath, content, root, document, findings) {
  const jobs = resolveNode(findMapPair(root, 'jobs', document)?.value, document);
  if (!isMap(jobs)) return;

  jobs.items.forEach((jobPair) => {
    const job = resolveNode(jobPair.value, document);
    if (!isMap(job)) return;

    const reusableWorkflowPair = findMapPair(job, 'uses', document);
    if (reusableWorkflowPair) {
      validateUsesPair(filePath, content, reusableWorkflowPair, document, findings);
    }

    const steps = resolveNode(findMapPair(job, 'steps', document)?.value, document);
    if (!isSeq(steps)) return;

    steps.items.forEach((stepNode) => {
      const step = resolveNode(stepNode, document);
      if (!isMap(step)) return;

      const usesPair = findMapPair(step, 'uses', document);
      const runPair = findMapPair(step, 'run', document);
      if (usesPair) validateUsesPair(filePath, content, usesPair, document, findings);
      if (runPair) validateRunPair(filePath, content, runPair, document, findings);
    });
  });
}

function collectWorkflowHygieneFindings({ cwd = process.cwd() } = {}) {
  const findings = [];
  const workflowFiles = listWorkflowFiles({ cwd });

  workflowFiles.forEach((filePath) => {
    const absolutePath = path.join(cwd, filePath);
    const content = readStableFileNoFollow(absolutePath, {
      rootDir: cwd,
      label: filePath,
      maxBytes: MAX_WORKFLOW_BYTES,
      fatalUtf8: true
    });
    const document = parseWorkflowYaml(filePath, content, findings);
    if (!document) return;

    const root = resolveNode(document.contents, document);
    const eventConfigPair = findMapPair(root, 'on', document);
    const forbiddenEventNode = eventNode(eventConfigPair?.value, 'pull_request_target', document);
    if (forbiddenEventNode) {
      addLineFinding(
        findings,
        filePath,
        content,
        [forbiddenEventNode, eventConfigPair?.key],
        'pull_request_target is not allowed without an explicit review exception'
      );
    }

    if (!findMapPair(root, 'permissions', document)) {
      findings.push(`${filePath}: missing top-level permissions block`);
    }

    validateJobs(filePath, content, root, document, findings);
  });

  return findings.sort();
}

function formatFindings(findings) {
  return [
    'Workflow hygiene check failed:',
    ...findings.map((finding) => `- ${finding}`)
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const findings = collectWorkflowHygieneFindings();
    if (findings.length > 0) {
      console.error(formatFindings(findings));
      process.exit(1);
    }
    console.log('Workflow hygiene check passed.');
  } catch (error) {
    console.error(error?.message || 'Workflow hygiene check failed.');
    process.exit(1);
  }
}

export {
  MAX_WORKFLOW_BYTES,
  collectWorkflowHygieneFindings,
  formatFindings,
  listWorkflowFiles
};
