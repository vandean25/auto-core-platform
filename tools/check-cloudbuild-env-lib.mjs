import ts from 'typescript';

export const DEFAULT_ALLOWLIST = [
  {
    file: 'cloudbuild.staging.yaml',
    key: 'BANK_RECONCILIATION_IBAN_HMAC_SECRET',
    ticket: 'AUT-1060',
  },
  {
    file: 'cloudbuild.staging.yaml',
    key: 'CATALOG_HIT_HMAC_SECRET',
    ticket: 'AUT-1060',
  },
];

const NON_SECRET_FLAG_KEYS = new Set([
  'CLOUD_TASKS_ENABLED',
  'CLOUD_TASKS_LOCATION',
  'CLOUD_TASKS_QUEUE',
  'CUSTOMER_ESTIMATE_SEND_ENABLED',
]);

/**
 * Extracts boot-required env keys from `apps/core-api/src/config/env.ts` AST.
 * @param {string} envTsSource
 * @returns {Array<{ key: string, scope: 'always' | 'production' | 'pdf-worker' | 'when-enabled', enabledBy?: string }>}
 */
export function extractBootRequiredEnvKeys(envTsSource) {
  const sourceFile = ts.createSourceFile('env.ts', envTsSource, ts.ScriptTarget.Latest, true);
  const helpers = collectFunctionDeclarations(sourceFile);
  const superRefineBody = findSuperRefineBody(sourceFile);
  if (!superRefineBody) {
    throw new Error('Could not find envSchema.superRefine callback in env.ts');
  }

  const found = [];
  const seen = new Set();
  const addKey = (key, scope, enabledBy) => {
    if (seen.has(key)) return;
    seen.add(key);
    found.push(enabledBy ? { key, scope, enabledBy } : { key, scope });
  };

  visitBlockStatements(superRefineBody, 'always', undefined, helpers, addKey);
  return found;
}

function collectFunctionDeclarations(sourceFile) {
  const helpers = new Map();
  for (const stmt of sourceFile.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name && stmt.body) {
      helpers.set(stmt.name.text, stmt.body);
    }
  }
  return helpers;
}

function findSuperRefineBody(sourceFile) {
  let body = null;
  const visit = (node) => {
    if (body) return;
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'superRefine' &&
      node.arguments.length > 0
    ) {
      const cb = node.arguments[0];
      if ((ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) && ts.isBlock(cb.body)) {
        body = cb.body;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return body;
}

function visitBlockStatements(block, scope, enabledBy, helpers, addKey) {
  for (const stmt of block.statements) {
    if (ts.isIfStatement(stmt)) {
      handleIfStatement(stmt, scope, enabledBy, helpers, addKey);
      continue;
    }
    extractCallsFromNode(stmt, scope, enabledBy, helpers, addKey);
  }
}

function handleIfStatement(stmt, scope, enabledBy, helpers, addKey) {
  const condText = stmt.expression.getText().replace(/\s+/g, '');
  if (condText === "env.NODE_ENV==='test'") {
    return;
  }

  let nextScope = scope;
  let nextEnabledBy = enabledBy;
  if (condText === "env.NODE_ENV==='production'") {
    nextScope = 'production';
  } else if (condText.startsWith('arePdfWorkersEnabled(')) {
    nextScope = 'pdf-worker';
  } else {
    const flagMatch = /^env\.([A-Z0-9_]+)$/.exec(condText);
    if (flagMatch) {
      nextScope = 'when-enabled';
      nextEnabledBy = flagMatch[1];
    }
  }

  if (ts.isBlock(stmt.thenStatement)) {
    visitBlockStatements(stmt.thenStatement, nextScope, nextEnabledBy, helpers, addKey);
  } else {
    extractCallsFromNode(stmt.thenStatement, nextScope, nextEnabledBy, helpers, addKey);
  }
}

function extractCallsFromNode(node, scope, enabledBy, helpers, addKey) {
  const visit = (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      const fnName = n.expression.text;
      if (fnName === 'addRequiredIssue' && n.arguments.length >= 2) {
        const keyArg = n.arguments[1];
        if (ts.isStringLiteral(keyArg)) {
          addKey(keyArg.text, scope, enabledBy);
        }
        return;
      }
      const helperBody = helpers.get(fnName);
      if (helperBody) {
        visitBlockStatements(helperBody, scope, enabledBy, helpers, addKey);
        return;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
}

function parseSubstitutionValue(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    const quote = trimmed[0];
    const endIdx = trimmed.indexOf(quote, 1);
    return endIdx >= 1 ? trimmed.slice(1, endIdx) : trimmed.slice(1);
  }
  return trimmed.replace(/\s+#.*$/, '').trim();
}

function parseCloudBuildSubstitutions(cloudBuildSource) {
  const substitutions = new Map();
  let inSubstitutions = false;

  for (const line of cloudBuildSource.split(/\r?\n/)) {
    if (!inSubstitutions) {
      if (/^substitutions:\s*(?:#.*)?$/.test(line)) {
        inSubstitutions = true;
      }
      continue;
    }
    if (/^\s*(?:#.*)?$/.test(line)) {
      continue;
    }
    if (/^\S/.test(line)) {
      break;
    }
    const match = /^\s+([A-Za-z0-9_]+)\s*:\s*(.*)$/.exec(line);
    if (match) {
      substitutions.set(match[1], parseSubstitutionValue(match[2]));
    }
  }

  return substitutions;
}

function resolveSubstitutions(value, substitutions) {
  return value.replace(/\$\{([A-Za-z0-9_]+)\}/g, (full, name) =>
    substitutions.has(name) ? substitutions.get(name) : full,
  );
}

function parseDeployStepArgs(body, substitutions) {
  const keys = new Set();
  const flags = new Map();
  const setArgPattern = /--set-(env-vars|secrets)\s+(?:"([^"]+)"|'([^']+)')/g;

  for (const argMatch of body.matchAll(setArgPattern)) {
    const kind = argMatch[1];
    const rawList = argMatch[2] ?? argMatch[3] ?? '';
    for (const entry of rawList.split(',')) {
      const eqIdx = entry.indexOf('=');
      if (eqIdx <= 0) continue;
      const key = entry.slice(0, eqIdx).trim();
      keys.add(key);
      if (kind === 'env-vars' && NON_SECRET_FLAG_KEYS.has(key)) {
        const rawValue = entry.slice(eqIdx + 1).trim();
        flags.set(key, resolveSubstitutions(rawValue, substitutions));
      }
    }
  }

  return { keys, flags };
}

/**
 * Parses Cloud Run deploy steps from a Cloud Build YAML file.
 * Extracts only key names from --set-secrets and --set-env-vars (never secret values).
 * @param {string} cloudBuildSource
 * @returns {Array<{ stepId: string, role: 'core-api' | 'pdf-worker', keys: Set<string>, flags: Map<string, string> }>}
 */
export function parseCloudBuildDeploySteps(cloudBuildSource) {
  const substitutions = parseCloudBuildSubstitutions(cloudBuildSource);
  const stepPattern = /^  - id: ([^\r\n]+)\r?$/gm;
  const matches = [...cloudBuildSource.matchAll(stepPattern)];
  const steps = [];

  for (let i = 0; i < matches.length; i += 1) {
    const stepId = matches[i][1].trim();
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : cloudBuildSource.length;
    const body = cloudBuildSource.slice(start, end);
    if (!body.includes('gcloud run deploy')) {
      continue;
    }

    const { keys, flags } = parseDeployStepArgs(body, substitutions);
    steps.push({
      stepId,
      role: stepId.includes('pdf-worker') ? 'pdf-worker' : 'core-api',
      keys,
      flags,
    });
  }

  return steps;
}

function isPdfWorkerKeyRequired(step, hasPdfWorkerStep) {
  if (step.role === 'pdf-worker') return true;
  const enabled = step.flags.get('CLOUD_TASKS_ENABLED');
  if (enabled === 'false') return false;
  if (enabled === 'true') return true;
  return Boolean(
    step.flags.get('CLOUD_TASKS_LOCATION') ||
    step.flags.get('CLOUD_TASKS_QUEUE') ||
    hasPdfWorkerStep,
  );
}

function isKeyRequiredForStep(req, ctx) {
  if (req.scope === 'always') return true;
  if (req.scope === 'production') return ctx.isProduction;
  if (req.scope === 'when-enabled') {
    return ctx.step.flags.get(req.enabledBy) === 'true';
  }
  if (req.scope === 'pdf-worker') {
    return isPdfWorkerKeyRequired(ctx.step, ctx.hasPdfWorkerStep);
  }
  return false;
}

function checkStepKeys(step, target, requiredKeys, hasPdfWorkerStep, allowlist, state) {
  const ctx = { isProduction: target.isProduction, step, hasPdfWorkerStep };
  for (const req of requiredKeys) {
    if (!isKeyRequiredForStep(req, ctx) || step.keys.has(req.key)) {
      continue;
    }
    const allowIdx = allowlist.findIndex(
      (entry) => entry.file === target.file && entry.key === req.key,
    );
    if (allowIdx >= 0) {
      state.usedAllowlist.add(allowIdx);
      state.warnings.push(
        `Allowlisted missing env key ${req.key} in ${target.file} (${step.stepId}) — tracked by ${allowlist[allowIdx].ticket}`,
      );
    } else {
      state.errors.push(`Missing required env key ${req.key} in ${target.file} (${step.stepId})`);
    }
  }
}

/**
 * Checks that all boot-required env keys from env.ts are mounted in the target Cloud Build files.
 */
export function checkCloudBuildEnv({ envTsSource, targets, allowlist = DEFAULT_ALLOWLIST }) {
  const requiredKeys = extractBootRequiredEnvKeys(envTsSource);
  const state = { errors: [], warnings: [], usedAllowlist: new Set() };

  for (const target of targets) {
    const steps = parseCloudBuildDeploySteps(target.content);
    if (steps.length === 0) {
      state.errors.push(`No Cloud Run deploy steps found in ${target.file}`);
      continue;
    }
    const hasPdfWorkerStep = steps.some((s) => s.role === 'pdf-worker');
    for (const step of steps) {
      checkStepKeys(step, target, requiredKeys, hasPdfWorkerStep, allowlist, state);
    }
  }

  allowlist.forEach((entry, i) => {
    if (!state.usedAllowlist.has(i)) {
      state.errors.push(
        `Allowlisted env key ${entry.key} in ${entry.file} (${entry.ticket}) is no longer missing — remove this allowlist entry`,
      );
    }
  });

  return { ok: state.errors.length === 0, errors: state.errors, warnings: state.warnings };
}
