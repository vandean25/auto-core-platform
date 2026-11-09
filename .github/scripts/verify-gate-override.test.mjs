import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyGateOverride,
  loadGateOverrideVerificationInputs,
} from './verify-gate-override.mjs';

const OVERRIDE = 'gate-override';
const HEAD = 'deadbeef00000000000000000000000000000000';
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

/** Timeline `committed` event shape (issue timeline API). */
function headCommitted(at, sha = HEAD) {
  return { event: 'committed', created_at: at, sha };
}

function headForcePushed(at, after) {
  return { event: 'head_ref_force_pushed', created_at: at, after };
}

function verifyFixture({ events = [], timeline = [], headSha = HEAD, allowlist = ALLOWED, labelsPresent = [OVERRIDE] }) {
  return verifyGateOverride({ events, timeline, headSha, allowlist, labelsPresent });
}

test('rejectsNonAllowlistedActor', () => {
  const result = verifyFixture({
    timeline: [headCommitted('2026-01-02T10:00:00Z')],
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
    const result = verifyFixture({
      timeline: [headCommitted('2026-01-02T10:00:00Z')],
      events: [scenario.labeled],
    });
    assert.equal(result.skip, false, scenario.title);
    assert.equal(result.reason, 'bot-or-app', scenario.title);
  }
});

test('rejectsStaleLabelBeforeHeadPush', () => {
  const result = verifyFixture({
    events: [labeled({ at: '2026-01-02T11:00:00Z' })],
    timeline: [headCommitted('2026-01-02T12:00:00Z')],
  });
  assert.equal(result.skip, false);
  assert.equal(result.reason, 'stale-label');
});

test('acceptsAllowlistedHumanOnCurrentHead', () => {
  const result = verifyFixture({
    timeline: [headCommitted('2026-01-02T11:00:00Z')],
    events: [labeled({ login: 'trusted-human', at: '2026-01-02T12:00:00Z' })],
  });
  assert.equal(result.skip, true);
  assert.equal(result.reason, 'valid-override');
  assert.match(result.summary, /trusted-human/);
  assert.match(result.summary, new RegExp(HEAD));
});

test('newPushInvalidatesPriorOverride', () => {
  const newHead = 'cafebabe00000000000000000000000000000000';
  const result = verifyFixture({
    headSha: newHead,
    timeline: [
      headCommitted('2026-01-02T11:00:00Z', HEAD),
      headCommitted('2026-01-02T13:00:00Z', newHead),
    ],
    events: [labeled({ at: '2026-01-02T12:00:00Z' })],
  });
  assert.equal(result.skip, false);
  assert.equal(result.reason, 'stale-label');
});

test('loadGateOverrideVerificationInputs uses timeline committed events from GitHub APIs', async () => {
  const issueEvents = [
  /** @type {const} */ ({
      event: 'labeled',
      created_at: '2026-01-02T12:00:00Z',
      actor: { login: 'trusted-human', type: 'User' },
      label: { name: OVERRIDE },
    }),
  ];
  const timeline = [headCommitted('2026-01-02T11:00:00Z')];
  const labels = [{ name: OVERRIDE }];

  const fetchImpl = async (url) => {
    if (url.includes('/events?')) {
      return { ok: true, json: async () => issueEvents };
    }
    if (url.includes('/timeline?')) {
      return { ok: true, json: async () => timeline };
    }
    if (url.endsWith('/labels')) {
      return { ok: true, json: async () => labels };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  const result = await loadGateOverrideVerificationInputs(
    {
      repo: 'org/repo',
      prNumber: 42,
      token: 'test-token',
      headSha: HEAD,
      allowlist: ALLOWED,
    },
    { fetchImpl },
  );

  assert.equal(result.skip, true);
  assert.equal(result.reason, 'valid-override');
});

test('head force-push timeline event binds head SHA', () => {
  const result = verifyFixture({
    timeline: [headForcePushed('2026-01-02T11:00:00Z', HEAD)],
    events: [labeled({ at: '2026-01-02T12:00:00Z' })],
  });
  assert.equal(result.skip, true);
  assert.equal(result.reason, 'valid-override');
});
