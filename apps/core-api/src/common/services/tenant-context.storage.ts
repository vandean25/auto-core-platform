import { AsyncLocalStorage } from 'node:async_hooks';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';

type TenantRequestContext = {
  user?: AuthenticatedUser;
};

const tenantContextStorage = new AsyncLocalStorage<TenantRequestContext>();

export class TenantContextStorage {
  static run<T>(callback: () => T): T {
    return tenantContextStorage.run({}, callback);
  }

  static setUser(user: AuthenticatedUser) {
    const store = tenantContextStorage.getStore();
    if (store) {
      store.user = user;
    }
  }

  static getUser(): AuthenticatedUser | undefined {
    return tenantContextStorage.getStore()?.user;
  }
}
