import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import YAML from 'yaml';

const WORKFLOW_DIR = '.github/workflows';
const REMOTE_ACTION_WITH_SHA = /^['"]?([^@\s'"]+)@([0-9a-f]{40})['"]?$/i;
const RATchet_COMMENT = /#\s*ratchet:([^@\s]+)@([^\s]+)/;
const BODY_INTERPOLATION_PATTERN = /\$\{\{\s*github\.event\.(?:issue|comment|review|pull_request)\.body\s*}}/;

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

  return document.toJSON();
}

function validateUsesLine(filePath, line, lineNumber, findings) {
  const match = line.match(/\buses:\s*(\S+)/);
  if (!match) return;

  const rawReference = match[1].replace(/^['"]|['"]$/g, '');
  if (rawReference.startsWith('./') || rawReference.startsWith('docker://')) {
    return;
  }

  const remoteMatch = rawReference.match(REMOTE_ACTION_WITH_SHA);
  if (!remoteMatch) {
    findings.push(`${filePath}:${lineNumber}: action reference is not pinned to a full SHA: ${line.trim()}`);
    return;
  }

  const commentMatch = line.match(RATchet_COMMENT);
  if (!commentMatch) {
    findings.push(`${filePath}:${lineNumber}: pinned action is missing a ratchet comment: ${line.trim()}`);
    return;
  }

  const [, actionPath] = remoteMatch;
  const [, ratchetPath, ratchetVersion] = commentMatch;
  if (!actionPath.startsWith(ratchetPath)) {
    findings.push(`${filePath}:${lineNumber}: ratchet comment path does not match action path: ${line.trim()}`);
  }
  if (!/^v?\d+(?:\.\d+){0,2}$/.test(ratchetVersion)) {
    findings.push(`${filePath}:${lineNumber}: ratchet comment must name a version tag, not a branch or SHA: ${line.trim()}`);
  }
}

function validateRunBlocks(filePath, lines, findings) {
  let activeRunBlock = null;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const runMatch = line.match(/^(\s*)run:\s*(.*)$/);

    if (runMatch) {
      activeRunBlock = {
        indent: runMatch[1].length,
        startLine: lineNumber
      };

      const inlineCommand = runMatch[2];
      if (/\bnpm ci\b/.test(inlineCommand) && !inlineCommand.includes('--ignore-scripts')) {
        findings.push(`${filePath}:${lineNumber}: npm ci must use --ignore-scripts`);
      }
      if (BODY_INTERPOLATION_PATTERN.test(inlineCommand)) {
        findings.push(`${filePath}:${lineNumber}: do not interpolate PR/comment body content directly into shell commands`);
      }
      return;
    }

    if (!activeRunBlock) return;

    const indent = line.match(/^(\s*)/)[1].length;
    if (line.trim() && indent <= activeRunBlock.indent) {
      activeRunBlock = null;
      return;
    }

    if (/\bnpm ci\b/.test(line) && !line.includes('--ignore-scripts')) {
      findings.push(`${filePath}:${lineNumber}: npm ci must use --ignore-scripts`);
    }
    if (BODY_INTERPOLATION_PATTERN.test(line)) {
      findings.push(`${filePath}:${lineNumber}: do not interpolate PR/comment body content directly into shell commands`);
    }
    if (/<<EOF\b/.test(line) && /\bGITHUB_OUTPUT\b/.test(lines.slice(index, Math.min(index + 6, lines.length)).join('\n'))) {
      findings.push(`${filePath}:${lineNumber}: do not use fixed EOF delimiters for multiline GITHUB_OUTPUT values`);
    }
  });
}

function collectWorkflowHygieneFindings({ cwd = process.cwd() } = {}) {
  const findings = [];
  const workflowFiles = listWorkflowFiles({ cwd });

  workflowFiles.forEach((filePath) => {
    const absolutePath = path.join(cwd, filePath);
    const content = fs.readFileSync(absolutePath, 'utf8');
    const lines = content.split('\n');
    const workflow = parseWorkflowYaml(filePath, content, findings);

    if (content.includes('pull_request_target:')) {
      findings.push(`${filePath}: pull_request_target is not allowed without an explicit review exception`);
    }

    if (workflow && !Object.hasOwn(workflow, 'permissions')) {
      findings.push(`${filePath}: missing top-level permissions block`);
    }

    lines.forEach((line, index) => {
      validateUsesLine(filePath, line, index + 1, findings);
    });

    validateRunBlocks(filePath, lines, findings);
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
  collectWorkflowHygieneFindings,
  formatFindings,
  listWorkflowFiles
};
