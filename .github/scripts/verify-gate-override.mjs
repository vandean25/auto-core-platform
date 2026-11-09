import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const OVERRIDE_LABEL = 'gate-override';

const GITHUB_HEADERS = (token) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
});

/**
 * Parses repo variable text into lowercase GitHub login names.
 * @param {string | string[] | undefined} raw
 * @returns {string[]}
 */
export function parseAllowlist(raw) {
  if (Array.isArray(raw)) {
    return raw.map((login) => String(login).trim().toLowerCase()).filter(Boolean);
  }
  if (!raw || !String(raw).trim()) {
    return [];
  }
  return String(raw)
    .split(/[\n,]/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * @param {{ type?: string, login?: string } | null | undefined} actor
 * @param {{ performed_via_github_app?: unknown }} event
 */
export function isBotActor(actor, event) {
  if (event.performed_via_github_app) {
    return true;
  }
  if (!actor) {
    return true;
  }
  if (actor.type === 'Bot') {
    return true;
  }
  return false;
}

/**
 * Force-push entries on the issue timeline carry GitHub-controlled `created_at`.
 *
 * @param {Array<{ event?: string, created_at?: string, after?: string }>} timeline
 * @param {string} headSha
 * @returns {string | null}
 */
export function headPushedAtFromForcePushTimeline(timeline, headSha) {
  const matches = timeline.filter(
    (entry) => entry.event === 'head_ref_force_pushed' && entry.after === headSha,
  );
  if (matches.length === 0) {
    return null;
  }
  return matches.reduce((latest, entry) => {
    const at = entry.created_at ?? '';
    if (!at) {
      return latest;
    }
    return !latest || new Date(at) > new Date(latest) ? at : latest;
  }, /** @type {string | null} */ (null));
}

/**
 * Check suites for a commit are created when GitHub receives the push (not commit-author metadata).
 *
 * @param {string} repo
 * @param {number} prNumber
 * @param {string} headSha
 * @param {string} token
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<string | null>}
 */
export async function headPushedAtFromCheckSuites(repo, prNumber, headSha, token, fetchImpl = fetch) {
  const response = await fetchImpl(
    `https://api.github.com/repos/${repo}/commits/${headSha}/check-suites?per_page=100`,
    { headers: GITHUB_HEADERS(token) },
  );
  if (!response.ok) {
    return null;
  }
  const payload = await response.json();
  const suites = (payload.check_suites ?? []).filter(
    (suite) =>
      suite.head_sha === headSha &&
      suite.pull_requests?.some((pr) => pr.number === prNumber),
  );
  if (suites.length === 0) {
    return null;
  }
  return suites.reduce((latest, suite) => {
    const at = suite.created_at ?? '';
    if (!at) {
      return latest;
    }
    return !latest || new Date(at) > new Date(latest) ? at : latest;
  }, /** @type {string | null} */ (null));
}

/**
 * @param {{
 *   repo: string,
 *   prNumber: number,
 *   headSha: string,
 *   token: string,
 *   timeline: Array<Record<string, unknown>>,
 *   fetchImpl?: typeof fetch,
 * }} query
 * @returns {Promise<string | null>}
 */
export async function resolveHeadPushedAt(query) {
  const fetchImpl = query.fetchImpl ?? fetch;
  const [fromForcePush, fromCheckSuites] = await Promise.all([
    Promise.resolve(headPushedAtFromForcePushTimeline(query.timeline, query.headSha)),
    headPushedAtFromCheckSuites(
      query.repo,
      query.prNumber,
      query.headSha,
      query.token,
      fetchImpl,
    ),
  ]);
  const candidates = [fromForcePush, fromCheckSuites].filter(Boolean);
  if (candidates.length === 0) {
    return null;
  }
  return candidates.reduce((latest, at) =>
    new Date(at) > new Date(latest) ? at : latest,
  );
}

/**
 * @param {Array<{ event?: string, created_at?: string, label?: { name?: string } }>} events
 */
function latestGateOverrideLabelAction(events) {
  const relevant = events.filter(
    (entry) =>
      (entry.event === 'labeled' || entry.event === 'unlabeled') &&
      entry.label?.name === OVERRIDE_LABEL,
  );
  if (relevant.length === 0) {
    return null;
  }
  return relevant.reduce((latest, entry) =>
    new Date(entry.created_at ?? 0) > new Date(latest.created_at ?? 0) ? entry : latest,
  );
}

/**
 * @param {{
 *   events: Array<Record<string, unknown>>,
 *   headPushedAt: string | null,
 *   headSha: string,
 *   allowlist: string[] | string,
 *   labelsPresent?: string[],
 * }} options
 * @returns {{ skip: boolean, reason: string, summary?: string, actor?: string, headSha?: string }}
 */
export function verifyGateOverride({ events, headPushedAt, headSha, allowlist, labelsPresent }) {
  const allowed = parseAllowlist(allowlist);
  if (allowed.length === 0) {
    return { skip: false, reason: 'empty-allowlist' };
  }

  if (!labelsPresent?.includes(OVERRIDE_LABEL)) {
    return { skip: false, reason: 'label-absent' };
  }

  const latest = latestGateOverrideLabelAction(events);
  if (!latest || latest.event !== 'labeled') {
    return { skip: false, reason: 'no-active-label-event' };
  }

  const actor = /** @type {{ type?: string, login?: string } | undefined} */ (latest.actor);
  if (isBotActor(actor, latest)) {
    return { skip: false, reason: 'bot-or-app' };
  }

  const login = actor?.login?.toLowerCase() ?? '';
  if (!allowed.includes(login)) {
    return { skip: false, reason: 'not-allowlisted' };
  }

  if (!headPushedAt) {
    return { skip: false, reason: 'unknown-head-push' };
  }

  const labeledAt = latest.created_at ?? '';
  if (new Date(labeledAt) <= new Date(headPushedAt)) {
    return { skip: false, reason: 'stale-label' };
  }

  const actorLogin = actor?.login ?? login;
  const summary = `Fallow audit skipped: \`gate-override\` applied by **@${actorLogin}** for head \`${headSha}\`.`;
  return { skip: true, reason: 'valid-override', summary, actor: actorLogin, headSha };
}

/**
 * @param {string} urlBase includes query string prefix without page
 * @param {string} errorLabel
 * @param {string} token
 * @param {typeof fetch} fetchImpl
 */
async function fetchPaginatedGithub(urlBase, errorLabel, token, fetchImpl) {
  const collected = [];
  let page = 1;
  while (true) {
    const response = await fetchImpl(`${urlBase}&page=${page}`, { headers: GITHUB_HEADERS(token) });
    if (!response.ok) {
      throw new Error(`${errorLabel}: HTTP ${response.status}`);
    }
    const batch = await response.json();
    collected.push(...batch);
    if (batch.length < 100) {
      break;
    }
    page += 1;
  }
  return collected;
}

/**
 * @param {string} repo `owner/name`
 * @param {number} issueNumber
 * @param {string} token
 * @param {typeof fetch} fetchImpl
 */
export async function fetchIssueEvents(repo, issueNumber, token, fetchImpl = fetch) {
  return fetchPaginatedGithub(
    `https://api.github.com/repos/${repo}/issues/${issueNumber}/events?per_page=100`,
    'GitHub issue events failed',
    token,
    fetchImpl,
  );
}

/**
 * @param {string} repo
 * @param {number} issueNumber
 * @param {string} token
 * @param {typeof fetch} fetchImpl
 */
export async function fetchIssueTimeline(repo, issueNumber, token, fetchImpl = fetch) {
  return fetchPaginatedGithub(
    `https://api.github.com/repos/${repo}/issues/${issueNumber}/timeline?per_page=100`,
    'GitHub issue timeline failed',
    token,
    fetchImpl,
  );
}

/**
 * @param {string} repo
 * @param {number} issueNumber
 * @param {string} token
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<string[]>}
 */
export async function fetchLabelNames(repo, issueNumber, token, fetchImpl = fetch) {
  const response = await fetchImpl(`https://api.github.com/repos/${repo}/issues/${issueNumber}/labels`, {
    headers: GITHUB_HEADERS(token),
  });
  if (!response.ok) {
    throw new Error(`GitHub issue labels failed: HTTP ${response.status}`);
  }
  const labels = await response.json();
  return labels.map((label) => label.name);
}

/**
 * @param {{
 *   repo: string,
 *   prNumber: number,
 *   token: string,
 *   headSha: string,
 *   allowlist: string[] | string,
 * }} query
 * @param {{ fetchImpl?: typeof fetch }} deps
 */
export async function loadGateOverrideVerificationInputs(query, deps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const [events, labelsPresent, timeline] = await Promise.all([
    fetchIssueEvents(query.repo, query.prNumber, query.token, fetchImpl),
    fetchLabelNames(query.repo, query.prNumber, query.token, fetchImpl),
    fetchIssueTimeline(query.repo, query.prNumber, query.token, fetchImpl),
  ]);
  const headPushedAt = await resolveHeadPushedAt({
    repo: query.repo,
    prNumber: query.prNumber,
    headSha: query.headSha,
    token: query.token,
    timeline,
    fetchImpl,
  });
  return verifyGateOverride({
    events,
    headPushedAt,
    headSha: query.headSha,
    allowlist: query.allowlist,
    labelsPresent,
  });
}

/**
 * @returns {{
 *   token: string,
 *   repo: string,
 *   prNumber: number,
 *   headSha: string,
 *   allowlist: string,
 *   outputPath?: string,
 *   summaryPath?: string,
 * }}
 */
export function readGateOverrideCliEnv() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const prNumber = Number(process.env.PR_NUMBER);
  const headSha = process.env.HEAD_SHA;

  if (!token || !repo || !prNumber || !headSha) {
    throw new Error('Missing GH_TOKEN, GITHUB_REPOSITORY, PR_NUMBER, or HEAD_SHA');
  }

  return {
    token,
    repo,
    prNumber,
    headSha,
    allowlist: process.env.GATE_OVERRIDE_ACTORS ?? '',
    outputPath: process.env.GITHUB_OUTPUT,
    summaryPath: process.env.GITHUB_STEP_SUMMARY,
  };
}

/**
 * @param {{ skip: boolean, reason: string, summary?: string, actor?: string, headSha?: string }} result
 * @param {{ outputPath?: string, summaryPath?: string }} targets
 */
export function writeGateOverrideCliResult(result, targets) {
  if (!result.skip) {
    console.log(`::notice::Fallow audit will run (gate-override not valid: ${result.reason}).`);
    return;
  }
  if (targets.outputPath) {
    appendFileSync(targets.outputPath, 'skip=true\n');
  }
  if (targets.summaryPath && result.summary) {
    appendFileSync(targets.summaryPath, `${result.summary}\n`);
  }
  console.log(
    `::notice::gate-override accepted for @${result.actor} on ${result.headSha}: Fallow audit skipped.`,
  );
}

export async function runCli(deps = {}) {
  const env = readGateOverrideCliEnv();
  const result = await loadGateOverrideVerificationInputs(
    {
      repo: env.repo,
      prNumber: env.prNumber,
      token: env.token,
      headSha: env.headSha,
      allowlist: env.allowlist,
    },
    deps,
  );
  writeGateOverrideCliResult(result, env);
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  runCli().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
