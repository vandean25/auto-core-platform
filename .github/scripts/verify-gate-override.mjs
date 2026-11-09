import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const OVERRIDE_LABEL = 'gate-override';

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
 * @param {Array<{ event?: string, created_at?: string, commit_id?: string }>} events
 * @param {string} headSha
 * @returns {string | null} ISO timestamp when headSha was last introduced on the PR
 */
export function headPushedAt(events, headSha) {
  const pushEvents = events.filter(
    (entry) =>
      (entry.event === 'synchronize' ||
        entry.event === 'opened' ||
        entry.event === 'ready_for_review') &&
      entry.commit_id === headSha,
  );
  if (pushEvents.length === 0) {
    return null;
  }
  return pushEvents.reduce((latest, entry) => {
    const at = entry.created_at ?? '';
    return !latest || new Date(at) > new Date(latest) ? at : latest;
  }, /** @type {string | null} */ (null));
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
 *   headSha: string,
 *   allowlist: string[] | string,
 *   labelsPresent?: string[],
 * }} options
 * @returns {{ skip: boolean, reason: string, summary?: string, actor?: string, headSha?: string }}
 */
export function verifyGateOverride({ events, headSha, allowlist, labelsPresent }) {
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

  const pushedAt = headPushedAt(events, headSha);
  if (!pushedAt) {
    return { skip: false, reason: 'unknown-head-push' };
  }

  const labeledAt = latest.created_at ?? '';
  if (new Date(labeledAt) <= new Date(pushedAt)) {
    return { skip: false, reason: 'stale-label' };
  }

  const actorLogin = actor?.login ?? login;
  const summary = `Fallow audit skipped: \`gate-override\` applied by **@${actorLogin}** for head \`${headSha}\`.`;
  return { skip: true, reason: 'valid-override', summary, actor: actorLogin, headSha };
}

/**
 * @param {string} repo `owner/name`
 * @param {number} issueNumber
 * @param {string} token
 */
async function fetchIssueEvents(repo, issueNumber, token) {
  const events = [];
  let page = 1;
  while (true) {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/issues/${issueNumber}/events?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );
    if (!response.ok) {
      throw new Error(`GitHub issue events failed: HTTP ${response.status}`);
    }
    const batch = await response.json();
    events.push(...batch);
    if (batch.length < 100) {
      break;
    }
    page += 1;
  }
  return events;
}

/**
 * @param {string} repo
 * @param {number} issueNumber
 * @param {string} token
 * @returns {Promise<string[]>}
 */
async function fetchLabelNames(repo, issueNumber, token) {
  const response = await fetch(`https://api.github.com/repos/${repo}/issues/${issueNumber}/labels`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub issue labels failed: HTTP ${response.status}`);
  }
  const labels = await response.json();
  return labels.map((label) => label.name);
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

async function runCli() {
  const env = readGateOverrideCliEnv();
  const [events, labelsPresent] = await Promise.all([
    fetchIssueEvents(env.repo, env.prNumber, env.token),
    fetchLabelNames(env.repo, env.prNumber, env.token),
  ]);
  writeGateOverrideCliResult(
    verifyGateOverride({
      events,
      headSha: env.headSha,
      allowlist: env.allowlist,
      labelsPresent,
    }),
    env,
  );
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  runCli().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
