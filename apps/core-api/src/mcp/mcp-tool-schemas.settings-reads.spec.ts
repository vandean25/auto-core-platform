import { encodeMcpCursor } from './mcp-output.util.js';
import {
  getLegalEntityInputSchema,
  getTenantSettingsInputSchema,
  listSitesInputSchema,
  mcpToolInputSchemas,
} from './mcp-tool-schemas.js';

const TENANT_B = '00000000-0000-4000-8000-00000000000b';
const LEGAL_ENTITY = '00000000-0000-4000-8000-0000000000e1';

describe('settings read input schemas (AUT-457)', () => {
  it('takes no tenant or site argument for get_tenant_settings', () => {
    expect(getTenantSettingsInputSchema.parse({})).toEqual({});
    expect(getTenantSettingsInputSchema.parse({ tenant_id: TENANT_B })).toEqual(
      {},
    );
  });

  it('caps list_sites pageSize at 25', () => {
    expect(listSitesInputSchema.safeParse({ pageSize: 25 }).success).toBe(true);
    expect(listSitesInputSchema.safeParse({ pageSize: 1 }).success).toBe(true);
    expect(listSitesInputSchema.safeParse({ pageSize: 26 }).success).toBe(
      false,
    );
    expect(listSitesInputSchema.safeParse({ pageSize: 0 }).success).toBe(false);
  });

  it('accepts a cursor from meta.next_cursor and rejects values that are not offsets', () => {
    expect(
      listSitesInputSchema.safeParse({ cursor: encodeMcpCursor(10) }).success,
    ).toBe(true);
    expect(
      listSitesInputSchema.safeParse({ cursor: 'not a cursor!' }).success,
    ).toBe(false);
    expect(
      listSitesInputSchema.safeParse({ cursor: 'bm90LWFuLW9mZnNldA' }).success,
    ).toBe(false);
  });

  it('requires legal_entity_id to be a UUID and allows it to be omitted', () => {
    expect(getLegalEntityInputSchema.safeParse({}).success).toBe(true);
    expect(
      getLegalEntityInputSchema.safeParse({ legal_entity_id: LEGAL_ENTITY })
        .success,
    ).toBe(true);
    expect(
      getLegalEntityInputSchema.safeParse({ legal_entity_id: 'not-a-uuid' })
        .success,
    ).toBe(false);
  });

  it('registers each settings read with its own input schema', () => {
    expect(mcpToolInputSchemas.get_tenant_settings).toBe(
      getTenantSettingsInputSchema,
    );
    expect(mcpToolInputSchemas.list_sites).toBe(listSitesInputSchema);
    expect(mcpToolInputSchemas.get_legal_entity).toBe(
      getLegalEntityInputSchema,
    );
  });
});
