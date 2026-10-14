import {
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Auth, UserRecord } from 'firebase-admin/auth';

export async function resolveFirebaseUser(
  firebaseAuth: Auth,
  email: string,
): Promise<UserRecord> {
  try {
    const existing = await firebaseAuth.getUserByEmail(email);
    assertEmailVerified(existing, email);
    return existing;
  } catch (error) {
    if (error instanceof UnprocessableEntityException) {
      throw error;
    }

    if (getFirebaseErrorCode(error) === 'auth/user-not-found') {
      return firebaseAuth.createUser({ email });
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new BadRequestException(
      `Failed to resolve Firebase user for ${email}: ${message}`,
    );
  }
}

export function getFirebaseErrorCode(error: unknown): string | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  return typeof error.code === 'string' ? error.code : undefined;
}

function assertEmailVerified(user: UserRecord, email: string): void {
  if (!user.emailVerified) {
    throw new UnprocessableEntityException(
      `A Firebase account for ${email} exists but its email is not verified; the user must verify it before being invited.`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
