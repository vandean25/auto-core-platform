import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyGateOverride } from './verify-gate-override.mjs';

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

function synchronize(at, commitId = HEAD) {
  return { event: 'synchronize', created_at: at, commit_id: commitId };
}

function opened(at, commitId = HEAD) {
  return { event: 'opened', created_at: at, commit_id: commitId };
}

test('rejectsNonAllowlistedActor', () => {
  const events = [
    opened('2026-01-02T10:00:00Z', HEAD),
    labeled({ login: 'random-collaborator', at: '2026-01-02T13:00:00Z' }),
  ];
  const result = verifyGateOverride({
    events,
    headSha: HEAD,
    allowlist: ALLOWED,
    labelsPresent: [OVERRIDE],
  });
  assert.equal(result.skip, false);
});

test('rejectsAppOrBotActor', () => {
  const events = [
    opened('2026-01-02T10:00:00Z', HEAD),
    labeled({ login: 'cursor[bot]', at: '2026-01-02T13:00:00Z', bot: true }),
  ];
  const result = verifyGateOverride({
    events,
    headSha: HEAD,
    allowlist: ALLOWED,
    labelsPresent: [OVERRIDE],
  });
  assert.equal(result.skip, false);
});

test('rejectsStaleLabelBeforeHeadPush', () => {
  const events = [
    labeled({ at: '2026-01-02T11:00:00Z' }),
    synchronize('2026-01-02T12:00:00Z', HEAD),
  ];
  const result = verifyGateOverride({
    events,
    headSha: HEAD,
    allowlist: ALLOWED,
    labelsPresent: [OVERRIDE],
  });
  assert.equal(result.skip, false);
});

test('acceptsAllowlistedHumanOnCurrentHead', () => {
  const events = [
    synchronize('2026-01-02T11:00:00Z', HEAD),
    labeled({ login: 'trusted-human', at: '2026-01-02T12:00:00Z' }),
  ];
  const result = verifyGateOverride({
    events,
    headSha: HEAD,
    allowlist: ALLOWED,
    labelsPresent: [OVERRIDE],
  });
  assert.equal(result.skip, true);
  assert.match(result.summary, /trusted-human/);
  assert.match(result.summary, new RegExp(HEAD.slice(0, 7)));
});

test('newPushInvalidatesPriorOverride', () => {
  const newHead = 'cafebabe00000000000000000000000000000000';
  const events = [
    synchronize('2026-01-02T11:00:00Z', HEAD),
    labeled({ at: '2026-01-02T12:00:00Z' }),
    synchronize('2026-01-02T13:00:00Z', newHead),
  ];
  const result = verifyGateOverride({
    events,
    headSha: newHead,
    allowlist: ALLOWED,
    labelsPresent: [OVERRIDE],
  });
  assert.equal(result.skip, false);
});
