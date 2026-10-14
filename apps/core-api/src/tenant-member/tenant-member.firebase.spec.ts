import {
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Auth, UserRecord } from 'firebase-admin/auth';
import {
  getFirebaseErrorCode,
  resolveFirebaseUser,
} from './tenant-member.firebase.js';

const verifiedUser = {
  uid: 'uid-1',
  email: 'tech@autocore.com',
  emailVerified: true,
} as UserRecord;

function createFirebaseAuth(getUserByEmail: jest.Mock, createUser = jest.fn()) {
  return { getUserByEmail, createUser } as unknown as Auth;
}

describe('resolveFirebaseUser', () => {
  it('returns an existing Firebase account whose email is verified', async () => {
    const createUser = jest.fn();
    const auth = createFirebaseAuth(
      jest.fn().mockResolvedValue(verifiedUser),
      createUser,
    );

    await expect(resolveFirebaseUser(auth, 'tech@autocore.com')).resolves.toBe(
      verifiedUser,
    );
    expect(createUser).not.toHaveBeenCalled();
  });

  it('rejects an existing account whose email is not verified', async () => {
    const createUser = jest.fn();
    const auth = createFirebaseAuth(
      jest.fn().mockResolvedValue({ ...verifiedUser, emailVerified: false }),
      createUser,
    );

    await expect(
      resolveFirebaseUser(auth, 'tech@autocore.com'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(createUser).not.toHaveBeenCalled();
  });

  it('provisions a Firebase account when none exists for the email', async () => {
    const createUser = jest.fn().mockResolvedValue(verifiedUser);
    const auth = createFirebaseAuth(
      jest.fn().mockRejectedValue({ code: 'auth/user-not-found' }),
      createUser,
    );

    await expect(resolveFirebaseUser(auth, 'tech@autocore.com')).resolves.toBe(
      verifiedUser,
    );
    expect(createUser).toHaveBeenCalledWith({ email: 'tech@autocore.com' });
  });

  it('wraps other lookup failures in a BadRequestException that carries the cause', async () => {
    const auth = createFirebaseAuth(
      jest.fn().mockRejectedValue(new Error('network down')),
    );

    await expect(
      resolveFirebaseUser(auth, 'tech@autocore.com'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      resolveFirebaseUser(auth, 'tech@autocore.com'),
    ).rejects.toThrow(
      'Failed to resolve Firebase user for tech@autocore.com: network down',
    );
  });

  it('stringifies non-Error lookup failures in the BadRequestException message', async () => {
    const auth = createFirebaseAuth(jest.fn().mockRejectedValue('boom'));

    await expect(
      resolveFirebaseUser(auth, 'tech@autocore.com'),
    ).rejects.toThrow(
      'Failed to resolve Firebase user for tech@autocore.com: boom',
    );
  });
});

describe('getFirebaseErrorCode', () => {
  it('returns the string code carried by an error-like object', () => {
    expect(getFirebaseErrorCode({ code: 'auth/user-not-found' })).toBe(
      'auth/user-not-found',
    );
  });

  it('returns undefined when the code is not a string or the value is not an object', () => {
    expect(getFirebaseErrorCode({ code: 42 })).toBeUndefined();
    expect(getFirebaseErrorCode(new Error('plain'))).toBeUndefined();
    expect(getFirebaseErrorCode(null)).toBeUndefined();
    expect(getFirebaseErrorCode('auth/user-not-found')).toBeUndefined();
  });
});
