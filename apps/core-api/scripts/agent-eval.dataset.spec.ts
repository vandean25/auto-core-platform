import { join } from 'node:path';
import { hashAgentEvalDataset } from './agent-eval.dataset.js';

describe('agent-eval dataset paths', () => {
  it('uses one results directory for LF and CRLF copies of the fixture', () => {
    const lfDataset = '{"id":"row-1"}\n{"id":"row-2"}\n';
    const crlfDataset = lfDataset.replace(/\n/g, '\r\n');

    const lfResultDirectory = join(
      'results',
      hashAgentEvalDataset(lfDataset),
    );
    const crlfResultDirectory = join(
      'results',
      hashAgentEvalDataset(crlfDataset),
    );

    expect(crlfResultDirectory).toBe(lfResultDirectory);
  });
});
