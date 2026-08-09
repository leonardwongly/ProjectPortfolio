import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  MAX_WORKFLOW_BYTES,
  collectWorkflowHygieneFindings
} from '../../scripts/check-workflow-hygiene.mjs';

const ACTION_SHA = 'a'.repeat(40);
const IMAGE_DIGEST = 'b'.repeat(64);

function workflowWithStep(step) {
  const indentedStep = step
    .split('\n')
    .map((line) => `        ${line}`)
    .join('\n');

  return `name: Adversarial fixture
on: push
permissions: {}
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - name: Exercise policy
${indentedStep}
`;
}

function collectFixtureFindings(t, content) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-hygiene-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const workflowDirectory = path.join(root, '.github', 'workflows');
  fs.mkdirSync(workflowDirectory, { recursive: true });
  fs.writeFileSync(path.join(workflowDirectory, 'adversarial.yml'), content);

  return collectWorkflowHygieneFindings({ cwd: root });
}

function assertFinding(findings, expectedMessage) {
  assert.equal(
    findings.length,
    1,
    `Expected exactly one finding containing ${JSON.stringify(expectedMessage)}:\n${findings.join('\n')}`
  );
  const [finding] = findings;
  assert.ok(finding.includes(expectedMessage), `Unexpected finding:\n${finding}`);
  assert.match(finding, /^\.github\/workflows\/adversarial\.yml:\d+:/);
}

test('workflow hygiene rejects each adversarial policy bypass', async (t) => {
  const cases = [
    {
      name: 'quoted uses keys cannot bypass immutable action enforcement',
      content: workflowWithStep("'uses': actions/checkout@v4"),
      expected: 'action reference is not pinned to a full SHA'
    },
    {
      name: 'reusable workflow jobs cannot bypass immutable reference enforcement',
      content: `name: Adversarial fixture
on: push
permissions: {}
jobs:
  delegated:
    'uses': example/repository/.github/workflows/build.yml@main
`,
      expected: 'action reference is not pinned to a full SHA'
    },
    {
      name: 'quoted run keys cannot bypass npm lifecycle-script enforcement',
      content: workflowWithStep("'run': npm ci"),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'folded whitespace cannot split npm ci across YAML source lines',
      content: workflowWithStep(`run: >-
  npm
  ci`),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: '--ignore-scripts=false does not satisfy lifecycle-script enforcement',
      content: workflowWithStep('run: npm ci --ignore-scripts=false'),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'a separate false value disables ignore-scripts after the ci command',
      content: workflowWithStep('run: npm ci --ignore-scripts false'),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'a separate false value cannot hide ci behind a global option',
      content: workflowWithStep('run: npm --ignore-scripts false ci'),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'a safe npm invocation cannot bless a later unsafe invocation',
      content: workflowWithStep('run: npm ci --ignore-scripts && npm ci'),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'npm global boolean options cannot hide the ci command',
      content: workflowWithStep('run: npm --silent ci'),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'npm global options with separate values cannot hide the ci command',
      content: workflowWithStep('run: npm --prefix . ci'),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'ignore-scripts after the option terminator is not configuration',
      content: workflowWithStep('run: npm ci -- --ignore-scripts'),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'dynamic npm global arguments fail closed before a ci command',
      content: workflowWithStep('run: npm "$NPM_GLOBAL_OPTIONS" ci --ignore-scripts'),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'bash -c literal scripts cannot hide an unsafe npm ci',
      content: workflowWithStep("run: bash -c 'npm ci'"),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'sh -c literal scripts cannot hide an unsafe npm ci',
      content: workflowWithStep("run: sh -c 'npm ci'"),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'dash -c literal scripts cannot hide an unsafe npm ci',
      content: workflowWithStep("run: dash -c 'npm ci'"),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'zsh -c literal scripts cannot hide an unsafe npm ci',
      content: workflowWithStep("run: zsh -c 'npm ci'"),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'eval literal scripts cannot hide an unsafe npm ci',
      content: workflowWithStep("run: eval 'npm ci'"),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'dynamic shell scripts fail closed',
      content: workflowWithStep('run: bash -c "$INSTALL_COMMAND"'),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'dynamic shell wrapper options fail closed',
      content: workflowWithStep('run: bash "$SHELL_OPTIONS" "npm ci --ignore-scripts"'),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'dynamic eval scripts fail closed',
      content: workflowWithStep('run: eval "$INSTALL_COMMAND"'),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'absolute env paths cannot hide an unsafe npm ci',
      content: workflowWithStep('run: /usr/bin/env npm ci'),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'env options with separate values cannot masquerade as executables',
      content: workflowWithStep('run: env -u NPM_CONFIG_IGNORE_SCRIPTS npm ci'),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'command portability options cannot hide an unsafe npm ci',
      content: workflowWithStep('run: command -p npm ci'),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'command option terminators cannot hide an unsafe npm ci',
      content: workflowWithStep('run: command -- npm ci'),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'sudo options with separate values cannot masquerade as executables',
      content: workflowWithStep('run: sudo -u root npm ci'),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'prefix programs cannot hide unsafe literal shell wrappers',
      content: workflowWithStep("run: /usr/bin/env -u UNUSED bash -c 'npm ci'"),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'BusyBox sh cannot hide an unsafe literal script',
      content: workflowWithStep("run: /bin/busybox sh -c 'npm ci'"),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'dollar-expanded executable names fail closed',
      content: workflowWithStep(`run: '"$PACKAGE_MANAGER" ci'`),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'backtick-expanded executable names fail closed',
      content: workflowWithStep("run: '`printf npm` ci'"),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'nice options cannot hide an unsafe npm ci',
      content: workflowWithStep('run: nice -n 5 npm ci'),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'timeout options and duration cannot hide an unsafe npm ci',
      content: workflowWithStep('run: timeout --signal TERM 30 npm ci'),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'stdbuf options cannot hide an unsafe npm ci',
      content: workflowWithStep('run: stdbuf -oL npm ci'),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'setsid options cannot hide an unsafe npm ci',
      content: workflowWithStep('run: setsid --wait npm ci'),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'BusyBox env cannot hide an unsafe npm ci',
      content: workflowWithStep('run: /bin/busybox env -u UNUSED npm ci'),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'leading redirections cannot masquerade as executables',
      content: workflowWithStep('run: ">install.log npm ci"'),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'file-descriptor redirections cannot split npm from ci',
      content: workflowWithStep('run: "npm 2>/dev/null ci"'),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'brace groups cannot masquerade as executables',
      content: workflowWithStep("run: '{ npm ci; }'"),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'dynamic file descriptors cannot masquerade as executables',
      content: workflowWithStep('run: "{log}>install.log npm ci"'),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'comment text cannot open a fake heredoc that hides later commands',
      content: workflowWithStep(`run: |
  # <<NEVER_CLOSES
  npm ci`),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'arithmetic left shifts cannot open fake heredocs',
      content: workflowWithStep(`run: |
  value=$((1 << 2))
  npm ci`),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'double-quoted command substitutions cannot hide an unsafe npm ci',
      content: workflowWithStep(`run: 'echo "$(npm ci)"'`),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'legacy backtick substitutions cannot hide an unsafe npm ci',
      content: workflowWithStep("run: 'echo `npm ci`'"),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'process substitutions cannot hide an unsafe npm ci',
      content: workflowWithStep("run: 'cat < <(npm ci)'"),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'env split-string options cannot hide an unsafe npm ci',
      content: workflowWithStep("run: env -S 'npm ci'"),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'env split-string equals syntax cannot hide an unsafe npm ci',
      content: workflowWithStep("run: env --split-string='npm ci'"),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'xargs options cannot hide an unsafe npm ci',
      content: workflowWithStep('run: xargs -n 2 npm ci'),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'heredoc input to a shell is executable code',
      content: workflowWithStep(`run: |
  bash <<'INSTALL_SCRIPT'
  npm ci
  INSTALL_SCRIPT`),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'here-string input to a shell is executable code',
      content: workflowWithStep("run: bash <<< 'npm ci'"),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'piped input to a shell fails closed',
      content: workflowWithStep(`run: "printf 'npm ci\\n' | bash"`),
      expected: 'npm ci must use --ignore-scripts'
    },
    {
      name: 'quoted pull_request_target event keys are rejected after YAML parsing',
      content: `name: Adversarial fixture
'on':
  'pull_request_target': {}
permissions: {}
jobs: {}
`,
      expected: 'pull_request_target is not allowed'
    },
    {
      name: 'mutable Docker action tags are rejected',
      content: workflowWithStep('uses: docker://alpine:3.21'),
      expected: 'Docker action reference is not pinned to a sha256 digest'
    },
    {
      name: 'dot-notation event-body interpolation is rejected in shell commands',
      content: workflowWithStep("run: echo '${{ github.event.issue.body }}'"),
      expected: 'do not interpolate PR/comment body content directly into shell commands'
    },
    {
      name: 'bracket-notation event-body interpolation is rejected in shell commands',
      content: workflowWithStep(`run: echo "\${{ github['event']['comment']['body'] }}"`),
      expected: 'do not interpolate PR/comment body content directly into shell commands'
    },
    {
      name: 'spaced fixed output delimiters are rejected',
      content: workflowWithStep(`run: |
  {
    echo "payload<< 'EOF'"
    cat payload.txt
    echo 'EOF'
  } >> "\${GITHUB_OUTPUT}"`),
      expected: 'do not use fixed delimiters for multiline GITHUB_OUTPUT values'
    },
    {
      name: 'ratchet comments must match an action path at a segment boundary',
      content: workflowWithStep(
        `uses: actions/checkout@${ACTION_SHA} # ratchet:actions/check@v7`
      ),
      expected: 'ratchet comment path does not match action path'
    }
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, (t) => {
      assertFinding(collectFixtureFindings(t, fixture.content), fixture.expected);
    });
  }
});

test('immutable references and explicit safe controls remain accepted', (t) => {
  const content = `name: Legitimate fixture
on:
  workflow_dispatch:
    inputs:
      uses:
        description: A harmless input named like a step key
defaults:
  run:
    shell: bash
permissions: {}
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: ./local-action
      - uses: docker://alpine@sha256:${IMAGE_DIGEST}
      - uses: github/codeql-action/init@${ACTION_SHA} # ratchet:github/codeql-action@v4
      - run: npm ci --ignore-scripts
      - run: npm ci --ignore-scripts=true
      - run: npm --silent ci --ignore-scripts
      - run: npm --prefix . ci --ignore-scripts
      - run: npm --ignore-scripts --silent ci
      - run: /usr/bin/env npm ci --ignore-scripts
      - run: env -u UNUSED npm ci --ignore-scripts
      - run: command -p npm ci --ignore-scripts
      - run: command -- npm ci --ignore-scripts
      - run: sudo -u root npm ci --ignore-scripts
      - run: nice -n 5 npm ci --ignore-scripts
      - run: timeout --signal TERM 30 npm ci --ignore-scripts
      - run: stdbuf -oL npm ci --ignore-scripts
      - run: setsid --wait npm ci --ignore-scripts
      - run: /bin/busybox env -u UNUSED npm ci --ignore-scripts
      - run: "{log}>install.log npm ci --ignore-scripts"
      - run: env -S 'npm ci --ignore-scripts'
      - run: env --split-string='npm ci --ignore-scripts'
      - run: xargs -n 2 npm ci --ignore-scripts
      - run: npm run ci
      - run: |
          delimiter="OUTPUT_$(uuidgen)"
          echo "payload<<\${delimiter}" >> "\${GITHUB_OUTPUT}"
  delegated:
    uses: example/repository/.github/workflows/build.yml@${ACTION_SHA} # ratchet:example/repository@v1
`;

  assert.deepEqual(collectFixtureFindings(t, content), []);
});

test('shell data and arithmetic do not invent npm ci executions', async (t) => {
  const cases = [
    {
      name: 'arithmetic command substitutions are not dynamic executables',
      content: workflowWithStep(`run: |
  if (( $(wc -c < response.md) > 60000 )); then
    printf 'oversized\\n'
  fi`)
    },
    {
      name: 'heredoc bodies remain data even when they mention npm ci',
      content: workflowWithStep(`run: |
  cat <<'POLICY_TEXT'
  npm ci is policy prose, not an executed command
  POLICY_TEXT`)
    },
    {
      name: 'single-quoted command substitutions remain literal data',
      content: workflowWithStep(`run: "echo '$(npm ci)'"`)
    },
    {
      name: 'arithmetic left shifts remain ordinary expressions',
      content: workflowWithStep(`run: |
  value=$((1 << 2))
  printf '%s\\n' "$value"`)
    }
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, (t) => {
      assert.deepEqual(collectFixtureFindings(t, fixture.content), []);
    });
  }
});

test('nested executable shell fragments preserve lifecycle-script controls', async (t) => {
  const cases = [
    {
      name: 'command substitution preserves ignore-scripts',
      content: workflowWithStep(`run: 'echo "$(npm ci --ignore-scripts)"'`)
    },
    {
      name: 'backtick substitution preserves ignore-scripts',
      content: workflowWithStep("run: 'echo `npm ci --ignore-scripts`'")
    },
    {
      name: 'process substitution preserves ignore-scripts',
      content: workflowWithStep("run: 'cat < <(npm ci --ignore-scripts)'")
    }
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, (t) => {
      assert.deepEqual(collectFixtureFindings(t, fixture.content), []);
    });
  }
});

test('literal shell wrappers preserve safe commands', async (t) => {
  const cases = [
    {
      name: 'bash -c preserves an explicit lifecycle-script control',
      content: workflowWithStep("run: bash -c 'npm ci --ignore-scripts'")
    },
    {
      name: 'combined bash flags preserve an explicit lifecycle-script control',
      content: workflowWithStep("run: /bin/bash -lc 'npm ci --ignore-scripts'")
    },
    {
      name: 'eval preserves an explicit lifecycle-script control',
      content: workflowWithStep("run: eval 'npm ci --ignore-scripts'")
    },
    {
      name: 'literal wrappers that do not invoke npm remain accepted',
      content: workflowWithStep("run: sh -c 'printf safe'")
    },
    {
      name: 'prefix programs preserve a safe literal wrapper script',
      content: workflowWithStep(
        "run: /usr/bin/env -u UNUSED bash -c 'npm ci --ignore-scripts'"
      )
    },
    {
      name: 'BusyBox sh preserves a safe literal wrapper script',
      content: workflowWithStep("run: /bin/busybox sh -c 'npm ci --ignore-scripts'")
    }
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, (t) => {
      assert.deepEqual(collectFixtureFindings(t, fixture.content), []);
    });
  }
});

test('workflow hygiene rejects unsafe workflow input files', { timeout: 5_000 }, async (t) => {
  const cases = [
    {
      name: 'symbolic links are never followed',
      setup(workflowDirectory) {
        fs.writeFileSync(path.join(workflowDirectory, 'target.txt'), workflowWithStep('run: printf safe'));
        fs.symlinkSync('target.txt', path.join(workflowDirectory, 'adversarial.yml'));
      },
      expected: /refusing to follow a symbolic link/
    },
    {
      name: 'non-regular workflow paths are rejected without opening them',
      setup(workflowDirectory) {
        fs.mkdirSync(path.join(workflowDirectory, 'adversarial.yml'));
      },
      expected: /expected a regular file/
    },
    {
      name: 'workflow byte limits are enforced before parsing',
      setup(workflowDirectory) {
        const file = path.join(workflowDirectory, 'adversarial.yml');
        fs.writeFileSync(file, 'name: oversized\n');
        fs.truncateSync(file, MAX_WORKFLOW_BYTES + 1);
      },
      expected: new RegExp(`exceeds the ${MAX_WORKFLOW_BYTES}-byte limit`)
    },
    {
      name: 'workflow files must have exactly one hard link',
      setup(workflowDirectory) {
        const source = path.join(workflowDirectory, 'source.txt');
        fs.writeFileSync(source, workflowWithStep('run: printf safe'));
        fs.linkSync(source, path.join(workflowDirectory, 'adversarial.yml'));
      },
      expected: /exactly one hard link/
    },
    {
      name: 'malformed UTF-8 is rejected instead of replacement-decoded',
      setup(workflowDirectory) {
        fs.writeFileSync(path.join(workflowDirectory, 'adversarial.yml'), Buffer.from([0xc3, 0x28]));
      },
      expected: /file is not valid UTF-8/
    }
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, (t) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-hygiene-input-'));
      t.after(() => fs.rmSync(root, { recursive: true, force: true }));
      const workflowDirectory = path.join(root, '.github', 'workflows');
      fs.mkdirSync(workflowDirectory, { recursive: true });
      fixture.setup(workflowDirectory);

      assert.throws(
        () => collectWorkflowHygieneFindings({ cwd: root }),
        fixture.expected
      );
    });
  }
});
