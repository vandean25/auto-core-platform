import { z } from 'zod';
import { CloudTasksService } from '../common/services/cloud-tasks.service.js';
import { MechanicMediaStorage } from '../mechanic/mechanic-media.storage.js';
import { NotificationCloudTasksService } from '../notifications/notification-cloud-tasks.service.js';
import { NotificationOutboxWorkerService } from '../notifications/notification-outbox-worker.service.js';
import { SideEffectGuard } from '../dry-run/side-effect-guard.js';
import type { SideEffectType } from '../dry-run/dry-run.types.js';
import { PendingActionExecutorService } from '../pending-action-executor/pending-action-executor.service.js';
import type { McpWriteToolName } from './mcp.constants.js';
import { MCP_REGISTERED_TOOL_INPUT_SCHEMAS } from './mcp-server.factory.js';
import type { McpWriteExecution } from './mcp-write-pipeline.service.js';
import { mapExecutorHooks } from './mcp-write-execution-hooks.js';
import { ACTION_TYPE_BY_WRITE_TOOL } from './mcp-write-dry-run.contract.fixture.spec.support.js';

const BLOCKED_OUTBOUND_EFFECTS: SideEffectType[] = [
  'GCS_WRITE',
  'EMAIL',
  'QUEUE_ENQUEUE',
];

export function parseRegisteredInput(toolName: McpWriteToolName, raw: unknown) {
  const schema = MCP_REGISTERED_TOOL_INPUT_SCHEMAS[toolName];
  if (schema instanceof z.ZodType) {
    return schema.parse(raw);
  }
  return z.object(schema).strict().parse(raw);
}

export function buildWriteExecution(
  toolName: McpWriteToolName,
  executors: PendingActionExecutorService,
): McpWriteExecution {
  const executor = executors.resolve(ACTION_TYPE_BY_WRITE_TOOL[toolName]);
  const policyActionType =
    toolName === 'propose_estimate_send'
      ? 'estimate.send_customer_message'
      : executor.actionType;
  return {
    toolName,
    policyActionType,
    buildPolicyContext: (input) => executor.buildPolicyContext(input),
    buildExecutionContext: executor.buildExecutionContext
      ? (input) => executor.buildExecutionContext!(input)
      : undefined,
    preview: executor.preview
      ? (input, executionContext) =>
          executor.preview!(input, executionContext)
      : undefined,
    ...mapExecutorHooks(executor),
    execute: (input, executionContext) =>
      executor.execute(input, executionContext),
    executeOutsideTransaction: executor.executeOutsideTransaction ?? false,
    refreshReplayResult: executor.refreshReplayResult
      ? (result) => executor.refreshReplayResult!(result)
      : undefined,
    buildResultSummary: (result) => executor.buildResultSummary(result),
    buildLogMetadata: executor.buildLogMetadata
      ? (result) => executor.buildLogMetadata!(result)
      : undefined,
  };
}

export type OutboundSideEffectSpies = {
  assertNoOutboundSideEffects: () => void;
  restore: () => void;
};

export function installOutboundSideEffectSpies(): OutboundSideEffectSpies {
  const blockedCalls: SideEffectType[] = [];
  const assertAllowed = SideEffectGuard.assertAllowed.bind(SideEffectGuard);
  const assertAllowedSpy = jest
    .spyOn(SideEffectGuard, 'assertAllowed')
    .mockImplementation((effect: SideEffectType) => {
      if (BLOCKED_OUTBOUND_EFFECTS.includes(effect)) {
        blockedCalls.push(effect);
      }
      return assertAllowed(effect);
    });

  const cloudTasksSpy = jest
    .spyOn(CloudTasksService.prototype, 'enqueuePdfGeneration')
    .mockResolvedValue('task-1');
  const gcsSpy = jest
    .spyOn(MechanicMediaStorage.prototype, 'generateUploadPolicy')
    .mockRejectedValue(new Error('GCS signing must not run during dry_run tests'));
  const emailSpy = jest
    .spyOn(NotificationOutboxWorkerService.prototype, 'deliver')
    .mockRejectedValue(new Error('Email deliver must not run during dry_run tests'));
  const notificationQueueSpy = jest
    .spyOn(NotificationCloudTasksService.prototype, 'enqueueWakeUp')
    .mockResolvedValue(undefined);

  return {
    assertNoOutboundSideEffects: () => {
      expect(blockedCalls).toEqual([]);
      expect(cloudTasksSpy).not.toHaveBeenCalled();
      expect(gcsSpy).not.toHaveBeenCalled();
      expect(emailSpy).not.toHaveBeenCalled();
      expect(notificationQueueSpy).not.toHaveBeenCalled();
    },
    restore: () => {
      assertAllowedSpy.mockRestore();
      cloudTasksSpy.mockRestore();
      gcsSpy.mockRestore();
      emailSpy.mockRestore();
      notificationQueueSpy.mockRestore();
    },
  };
}
