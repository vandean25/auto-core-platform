import { createHash } from 'node:crypto';

export function hashAgentEvalDataset(rawDataset: string): string {
  return createHash('sha256')
    .update(rawDataset.replace(/\r\n/g, '\n'))
    .digest('hex');
}
