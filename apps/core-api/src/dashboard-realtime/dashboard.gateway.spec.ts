import type { Socket } from 'socket.io';
import type { AuthService } from '../auth/auth.service';
import {
  AUTH_CLAIMS_UPDATED_EVENT,
  DASHBOARD_ENTITY_UPDATED_EVENT,
  type AuthClaimsUpdatedPayload,
  type DashboardEntityUpdatedPayload,
} from './dashboard-events.types';
import { DashboardGateway } from './dashboard.gateway';

type MockSocket = {
  id: string;
  handshake: { auth?: Record<string, unknown> };
  join: jest.Mock<Promise<void>, [string]>;
  disconnect: jest.Mock<void, [boolean?]>;
  data: Record<string, unknown>;
};

function createClient(token?: string): MockSocket {
  return {
    id: 'socket-1',
    handshake: token ? { auth: { token } } : { auth: {} },
    join: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
    data: {},
  };
}

describe('DashboardGateway', () => {
  let authService: jest.Mocked<Pick<AuthService, 'authenticateBearerToken'>>;
  let gateway: DashboardGateway;

  beforeEach(() => {
    authService = {
      authenticateBearerToken: jest.fn(),
    };
    gateway = new DashboardGateway(authService as unknown as AuthService);
  });

  it('disconnects immediately when socket auth token is missing', async () => {
    const client = createClient();

    await gateway.handleConnection(client as unknown as Socket);

    expect(authService.authenticateBearerToken).not.toHaveBeenCalled();
    expect(client.join).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('disconnects immediately when socket auth token is invalid', async () => {
    const client = createClient('bad-token');
    authService.authenticateBearerToken.mockRejectedValue(
      new Error('invalid token'),
    );

    await gateway.handleConnection(client as unknown as Socket);

    expect(authService.authenticateBearerToken).toHaveBeenCalledWith(
      'Bearer bad-token',
    );
    expect(client.join).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('authenticates and joins tenant-prefixed room from jwt tenantId', async () => {
    const client = createClient('jwt-token');
    authService.authenticateBearerToken.mockResolvedValue({
      userId: 'user-1',
      email: 'user@example.com',
      tenantId: 'tenant-a',
      role: 'ADMIN',
    });

    await gateway.handleConnection(client as unknown as Socket);

    expect(authService.authenticateBearerToken).toHaveBeenCalledWith(
      'Bearer jwt-token',
    );
    expect(client.join).toHaveBeenCalledWith('tenant_tenant-a');
    expect(client.join).toHaveBeenCalledWith('user_user-1');
    expect(client.data.tenantId).toBe('tenant-a');
    expect(client.data.userId).toBe('user-1');
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('emits realtime updates only to tenant-prefixed room without tenantId in payload', () => {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    gateway.server = { to } as unknown as DashboardGateway['server'];

    const payload: DashboardEntityUpdatedPayload = {
      type: 'CUSTOMER',
      action: 'UPDATED',
      entityId: 'cust-1',
      timestamp: new Date().toISOString(),
    };

    gateway.emitEntityUpdated('tenant-a', payload);

    expect(to).toHaveBeenCalledWith('tenant_tenant-a');
    expect(emit).toHaveBeenCalledWith(DASHBOARD_ENTITY_UPDATED_EVENT, payload);
    const emittedPayload = emit.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(emittedPayload.tenantId).toBeUndefined();
  });

  it('emits claims refresh events only to the affected user room', () => {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    gateway.server = { to } as unknown as DashboardGateway['server'];

    const payload: AuthClaimsUpdatedPayload = {
      reason: 'membership-updated',
      timestamp: new Date().toISOString(),
    };

    gateway.emitClaimsUpdated('user-1', payload);

    expect(to).toHaveBeenCalledWith('user_user-1');
    expect(emit).toHaveBeenCalledWith(AUTH_CLAIMS_UPDATED_EVENT, payload);
  });
});
