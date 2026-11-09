import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyGateOverride,
  loadGateOverrideVerificationInputs,
  resolveHeadPushedAt,
} from './verify-gate-override.mjs';

const OVERRIDE = 'gate-override';
const HEAD = 'deadbeef00000000000000000000000000000000';
const PR = 42;
const ALLOWED = ['trusted-human'];

function labeled({ login = 'trusted-human', at = '2026-01-02T12:00:00Z', bot = false, viaApp = false } = {}) {
  const actor = { login, type: bot ? 'Bot' : 'User' };
  const event = {
    event: 'labeled',
    created_at: at,
    actor,
    label: { name: OVERRIDE },
  };
  if (viaApp) {
    event.performed_via_github_app = { id: 1, slug: 'some-app' };
  }
  return event;
}

/** Real timeline `committed` shape: no `created_at`, only commit metadata. */
function timelineCommitted(sha = HEAD) {
  return {
    event: 'committed',
    sha,
    author: { date: '1990-01-01T00:00:00Z', name: 'Author', email: 'a@example.com' },
    committer: { date: '1990-01-01T00:00:00Z', name: 'Committer', email: 'c@example.com' },
    message: 'msg',
  };
}

function checkSuitePush(at, headSha = HEAD, prNumber = PR) {
  return {
    head_sha: headSha,
    created_at: at,
    pull_requests: [{ number: prNumber }],
  };
}

function headForcePushed(at, after) {
  return { event: 'head_ref_force_pushed', created_at: at, after };
}

function verifyFixture({
  events = [],
  headPushedAt = '2026-01-02T11:00:00Z',
  headSha = HEAD,
  allowlist = ALLOWED,
  labelsPresent = [OVERRIDE],
}) {
  return verifyGateOverride({ events, headPushedAt, headSha, allowlist, labelsPresent });
}

test('rejectsNonAllowlistedActor', () => {
  const result = verifyFixture({
    events: [labeled({ login: 'random-collaborator', at: '2026-01-02T13:00:00Z' })],
  });
  assert.equal(result.skip, false);
  assert.equal(result.reason, 'not-allowlisted');
});

test('rejectsAppOrBotActor', () => {
  const cases = [
    { title: 'actor type Bot on allowlisted login', labeled: labeled({ login: 'trusted-human', at: '2026-01-02T13:00:00Z', bot: true }) },
    { title: 'performed_via_github_app on allowlisted login', labeled: labeled({ login: 'trusted-human', at: '2026-01-02T13:00:00Z', viaApp: true }) },
  ];
  for (const scenario of cases) {
    const result = verifyFixture({ events: [scenario.labeled] });
    assert.equal(result.skip, false, scenario.title);
    assert.equal(result.reason, 'bot-or-app', scenario.title);
  }
});

test('rejectsStaleLabelBeforeHeadPush', () => {
  const result = verifyFixture({
    events: [labeled({ at: '2026-01-02T11:00:00Z' })],
    headPushedAt: '2026-01-02T12:00:00Z',
  });
  assert.equal(result.skip, false);
  assert.equal(result.reason, 'stale-label');
});

test('acceptsAllowlistedHumanOnCurrentHead', () => {
  const result = verifyFixture({
    events: [labeled({ login: 'trusted-human', at: '2026-01-02T12:00:00Z' })],
    headPushedAt: '2026-01-02T11:00:00Z',
  });
  assert.equal(result.skip, true);
  assert.equal(result.reason, 'valid-override');
  assert.match(result.summary, /trusted-human/);
  assert.match(result.summary, new RegExp(HEAD));
});

test('newPushInvalidatesPriorOverride', async () => {
  const newHead = 'cafebabe00000000000000000000000000000000';
  const issueEvents = [labeled({ at: '2026-01-02T12:00:00Z' })];
  const labels = [{ name: OVERRIDE }];

  const fetchImpl = async (url) => {
    if (url.includes('/events?')) {
      return { ok: true, json: async () => issueEvents };
    }
    if (url.includes('/timeline?')) {
      return { ok: true, json: async () => [] };
    }
    if (url.includes('/check-suites?')) {
      assert.match(url, new RegExp(newHead));
      return {
        ok: true,
        json: async () => ({
          check_suites: [checkSuitePush('2026-01-02T13:00:00Z', newHead)],
        }),
      };
    }
    if (url.endsWith('/labels')) {
      return { ok: true, json: async () => labels };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  const result = await loadGateOverrideVerificationInputs(
    {
      repo: 'org/repo',
      prNumber: PR,
      token: 'test-token',
      headSha: newHead,
      allowlist: ALLOWED,
    },
    { fetchImpl },
  );

  assert.equal(result.skip, false);
  assert.equal(result.reason, 'stale-label');
});

test('acceptsAllowlistedHumanDespiteLaterLabelTriggeredCheckSuite', async () => {
  const issueEvents = [labeled({ at: '2026-01-02T12:00:00Z' })];
  const labels = [{ name: OVERRIDE }];

  const fetchImpl = async (url) => {
    if (url.includes('/events?')) {
      return { ok: true, json: async () => issueEvents };
    }
    if (url.includes('/timeline?')) {
      return { ok: true, json: async () => [timelineCommitted(HEAD)] };
    }
    if (url.includes('/check-suites?')) {
      return {
        ok: true,
        json: async () => ({
          check_suites: [
            checkSuitePush('2026-01-02T11:00:00Z'),
            checkSuitePush('2026-01-02T12:30:00Z'),
          ],
        }),
      };
    }
    if (url.endsWith('/labels')) {
      return { ok: true, json: async () => labels };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  const result = await loadGateOverrideVerificationInputs(
    {
      repo: 'org/repo',
      prNumber: PR,
      token: 'test-token',
      headSha: HEAD,
      allowlist: ALLOWED,
    },
    { fetchImpl },
  );

  assert.equal(result.skip, true);
  assert.equal(result.reason, 'valid-override');
});

test('resolveHeadPushedAt ignores timeline committed metadata without created_at', async () => {
  const fetchImpl = async (url) => {
    if (!url.includes('/check-suites')) {
      throw new Error(`unexpected fetch: ${url}`);
    }
    return {
      ok: true,
      json: async () => ({ check_suites: [checkSuitePush('2026-01-02T11:00:00Z')] }),
    };
  };

  const at = await resolveHeadPushedAt({
    repo: 'org/repo',
    prNumber: PR,
    headSha: HEAD,
    token: 'token',
    timeline: [timelineCommitted(HEAD)],
    fetchImpl,
  });

  assert.equal(at, '2026-01-02T11:00:00Z');
});

test('resolveHeadPushedAt does not use forgeable committer.date when check suites exist', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ check_suites: [checkSuitePush('2026-01-02T14:00:00Z')] }),
  });

  const at = await resolveHeadPushedAt({
    repo: 'org/repo',
    prNumber: PR,
    headSha: HEAD,
    token: 'token',
    timeline: [
      {
        ...timelineCommitted(HEAD),
        committer: { date: '1990-01-01T00:00:00Z', name: 'x', email: 'x@example.com' },
      },
    ],
    fetchImpl,
  });

  assert.equal(at, '2026-01-02T14:00:00Z');
});

test('loadGateOverrideVerificationInputs uses check suites from GitHub APIs', async () => {
  const issueEvents = [
    {
      event: 'labeled',
      created_at: '2026-01-02T12:00:00Z',
      actor: { login: 'trusted-human', type: 'User' },
      label: { name: OVERRIDE },
    },
  ];
  const timeline = [timelineCommitted(HEAD)];
  const labels = [{ name: OVERRIDE }];

  const fetchImpl = async (url) => {
    if (url.includes('/events?')) {
      return { ok: true, json: async () => issueEvents };
    }
    if (url.includes('/timeline?')) {
      return { ok: true, json: async () => timeline };
    }
    if (url.includes('/check-suites?')) {
      return {
        ok: true,
        json: async () => ({ check_suites: [checkSuitePush('2026-01-02T11:00:00Z')] }),
      };
    }
    if (url.endsWith('/labels')) {
      return { ok: true, json: async () => labels };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  const result = await loadGateOverrideVerificationInputs(
    {
      repo: 'org/repo',
      prNumber: PR,
      token: 'test-token',
      headSha: HEAD,
      allowlist: ALLOWED,
    },
    { fetchImpl },
  );

  assert.equal(result.skip, true);
  assert.equal(result.reason, 'valid-override');
});

test('head force-push timeline event binds head SHA', async () => {
  const at = await resolveHeadPushedAt({
    repo: 'org/repo',
    prNumber: PR,
    headSha: HEAD,
    token: 'token',
    timeline: [headForcePushed('2026-01-02T11:00:00Z', HEAD)],
    fetchImpl: async () => ({ ok: true, json: async () => ({ check_suites: [] }) }),
  });
  assert.equal(at, '2026-01-02T11:00:00Z');
});

test('additional guard cases', () => {
  const cases = [
    {
      title: 'empty allowlist',
      input: { allowlist: [], labelsPresent: [OVERRIDE], events: [labeled()] },
      reason: 'empty-allowlist',
    },
    {
      title: 'label absent on PR',
      input: { labelsPresent: [], events: [labeled()] },
      reason: 'label-absent',
    },
    {
      title: 'unlabeled after labeled',
      input: {
        events: [
          labeled({ at: '2026-01-02T12:00:00Z' }),
          { event: 'unlabeled', created_at: '2026-01-02T12:30:00Z', label: { name: OVERRIDE } },
        ],
      },
      reason: 'no-active-label-event',
    },
  ];

  for (const scenario of cases) {
    const result = verifyFixture({
      events: scenario.input.events ?? [],
      allowlist: scenario.input.allowlist ?? ALLOWED,
      labelsPresent: scenario.input.labelsPresent ?? [OVERRIDE],
      headPushedAt: '2026-01-02T10:00:00Z',
    });
    assert.equal(result.skip, false, scenario.title);
    assert.equal(result.reason, scenario.reason, scenario.title);
  }
});
