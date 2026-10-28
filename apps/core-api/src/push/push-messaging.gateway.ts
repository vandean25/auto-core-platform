import { Injectable } from '@nestjs/common';
import {
  getMessaging,
  type BatchResponse,
  type Messaging,
} from 'firebase-admin/messaging';
import { getFirebaseAdminApp } from '../auth/firebase-admin.js';
import { PUSH_TTL_SECONDS } from './push.constants.js';
import type { PushData } from './push-message.js';

export interface PushSendTarget {
  deviceId: string;
  token: string;
}

export type PushSendOutcome =
  | { deviceId: string; ok: true }
  | {
      deviceId: string;
      ok: false;
      /**
       * `unregistered`: the token is dead, revoke the device. `invalid-argument`: the token or the message is bad and
       * FCM does not say which. `transient`: try again later.
       */
      kind: 'unregistered' | 'invalid-argument' | 'transient';
      code: string;
    };

/** The port to the push provider. Unit tests replace it; production uses FCM through firebase-admin. */
export abstract class PushMessagingGateway {
  abstract sendEach(
    targets: PushSendTarget[],
    message: PushData,
  ): Promise<PushSendOutcome[]>;
}

/** FCM error codes that mean this registration token will never work again (ADR-0033 §2). */
const UNREGISTERED_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

/** A code from the provider, or a fixed word: only a short code is ever stored or logged, never a message. */
const SAFE_CODE = /^[a-z][a-z0-9/-]{0,63}$/;

export function classifyFcmError(
  code: string | undefined,
): Extract<PushSendOutcome, { ok: false }>['kind'] {
  if (code === 'messaging/invalid-argument') return 'invalid-argument';
  return code && UNREGISTERED_CODES.has(code) ? 'unregistered' : 'transient';
}

export function toSafeProviderCode(code: string | undefined): string {
  return code && SAFE_CODE.test(code) ? code : 'messaging/unknown';
}

@Injectable()
export class FirebasePushMessagingGateway extends PushMessagingGateway {
  async sendEach(
    targets: PushSendTarget[],
    message: PushData,
  ): Promise<PushSendOutcome[]> {
    if (targets.length === 0) return [];
    const response = await this.messaging().sendEach(
      targets.map(({ token }) => ({
        token,
        // Data-only: the service worker always shows the notification itself (a silent push is revoked on Safari).
        data: message as Record<string, string>,
        webpush: {
          headers: { TTL: String(PUSH_TTL_SECONDS), Urgency: 'normal' },
        },
      })),
    );
    return toOutcomes(targets, response);
  }

  protected messaging(): Messaging {
    return getMessaging(getFirebaseAdminApp());
  }
}

export function toOutcomes(
  targets: PushSendTarget[],
  response: BatchResponse,
): PushSendOutcome[] {
  return targets.map((target, index) => {
    const result = response.responses[index];
    if (result?.success) {
      return { deviceId: target.deviceId, ok: true };
    }
    const code = result?.error?.code;
    return {
      deviceId: target.deviceId,
      ok: false,
      kind: classifyFcmError(code),
      code: toSafeProviderCode(code),
    };
  });
}
