import { readFileSync } from 'node:fs';
import { buildProposalPreview } from './workshop-command.proposal.js';
import type { WorkshopIntent } from './workshop-command.types.js';

type Json = Record<string, any>;

const FIXTURE_DIR = new URL(
  '../../../../docs/internal/02-Feature-Specs/Platform/command-first-workshop/fixtures/',
  import.meta.url,
);

function fixture(name: string): Json {
  return JSON.parse(readFileSync(new URL(name, FIXTURE_DIR), 'utf8')) as Json;
}

describe('workshop command proposal preview', () => {
  it('matches the canonical propose_expect body without persisted ids', () => {
    const document = fixture('canonical-huber-golf.json');
    const intent = {
      ...document.expect.body,
    } as WorkshopIntent;

    expect(buildProposalPreview(intent)).toEqual(document.propose_expect.body);
  });

  it('omits the loaner booking when no loaner was requested', () => {
    const intent = {
      contract_version: 'workshop-command/v1',
      status: 'ready',
      command_id: '51500000-0000-4000-8000-0000000000cd',
      site_id: '51500000-0000-4000-8000-000000000010',
      timezone: 'Europe/Vienna',
      customer_id: '51500000-0000-4000-8000-000000000021',
      vehicle_id: '51500000-0000-4000-8000-000000000031',
      schedule: {
        local_date: '2026-10-16',
        local_start: '08:00',
        local_end: '09:00',
        start_at: '2026-10-16T06:00:00.000Z',
        end_at: '2026-10-16T07:00:00.000Z',
        duration_minutes: 60,
        duration_source: 'preset_sum',
      },
      bay_id: '51500000-0000-4000-8000-000000000041',
      mechanic_id: null,
      loaner: {
        requested: false,
        loaner_vehicle_id: null,
        planned_from: null,
        planned_to: null,
      },
      position_plan: { version: 1, lines: [] },
      purpose: 'CUSTOMER_REPAIR',
      order_status: 'SCHEDULED',
      reported_issue: 'Kleines Service',
    } as WorkshopIntent;

    expect(buildProposalPreview(intent).would_change).toEqual([
      {
        entity: 'WorkshopOrder',
        op: 'create',
        provisional: true,
        id: null,
        status: 'SCHEDULED',
        site_id: '51500000-0000-4000-8000-000000000010',
      },
    ]);
  });
});
