import type { Socket } from 'socket.io';
import type { AuthService } from '../auth/auth.service';
import {
  DASHBOARD_ENTITY_UPDATED_EVENT,
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
    expect(client.data.tenantId).toBe('tenant-a');
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
});
