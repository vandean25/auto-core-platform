import { describe, expect, it } from '@jest/globals';
import {
  cloudTasksErrorCode,
  deterministicExtractionTaskId,
  taskIdFromName,
} from './cloud-tasks.task-identity.js';

describe('taskIdFromName', () => {
  it('returns the last path segment of a Cloud Tasks task name', () => {
    expect(taskIdFromName('projects/p/locations/l/queues/q/tasks/task-1')).toBe(
      'task-1',
    );
  });

  it('returns the input unchanged when it has no path segments', () => {
    expect(taskIdFromName('task-1')).toBe('task-1');
  });
});

describe('deterministicExtractionTaskId', () => {
  it('is stable for the same extraction and attempt count', () => {
    expect(deterministicExtractionTaskId('ext-1', 0)).toBe(
      deterministicExtractionTaskId('ext-1', 0),
    );
  });

  it('changes when the attempt count changes', () => {
    expect(deterministicExtractionTaskId('ext-1', 0)).not.toBe(
      deterministicExtractionTaskId('ext-1', 1),
    );
  });

  it('uses the document-branding prefix and a 40 character digest', () => {
    expect(deterministicExtractionTaskId('ext-1', 2)).toMatch(
      /^document-branding-extraction-[a-f0-9]{40}$/,
    );
  });
});

describe('cloudTasksErrorCode', () => {
  it('reads a numeric gRPC code from an error-like object', () => {
    expect(
      cloudTasksErrorCode(Object.assign(new Error('exists'), { code: 6 })),
    ).toBe(6);
  });

  it.each([undefined, null, 'boom', new Error('no code'), { code: '6' }])(
    'returns null for %p',
    (value) => {
      expect(cloudTasksErrorCode(value)).toBeNull();
    },
  );
});
