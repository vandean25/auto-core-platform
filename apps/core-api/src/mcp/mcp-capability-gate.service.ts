import { ForbiddenException, Injectable } from '@nestjs/common';
import type { CountryCapabilities } from '../common/country-pack/country-pack.registry.js';
import { EffectiveCapabilitiesService } from '../common/country-pack/effective-capabilities.guard.js';

/** MCP tools that only exist while an effective country capability is on (AUT-686 REST parity). */
export const MCP_TOOL_CAPABILITY: Readonly<
  Record<string, keyof CountryCapabilities>
> = {
  list_pickerl_due: 'pickerl57a',
  get_nova_preview: 'nova',
};

const CAPABILITY_UNAVAILABLE_MESSAGE =
  'This feature is unavailable for the active legal entity.';

/**
 * Applies the REST `CapabilityGuard` rule to MCP tools: the same effective
 * capability check, the same `CAPABILITY_UNAVAILABLE` code, and the same
 * fail-closed result for an unconfigured (`null`) capability.
 */
@Injectable()
export class McpCapabilityGateService {
  constructor(private readonly capabilities: EffectiveCapabilitiesService) {}

  async assertAvailable(capability: keyof CountryCapabilities): Promise<void> {
    if ((await this.capabilities.resolve())?.[capability] === true) return;
    // MCP tool errors carry only the message text, so it leads with the code.
    throw new ForbiddenException({
      code: 'CAPABILITY_UNAVAILABLE',
      message: `CAPABILITY_UNAVAILABLE: ${CAPABILITY_UNAVAILABLE_MESSAGE}`,
    });
  }

  /** Names of the gated tools whose capability is off right now. */
  async hiddenToolNames(): Promise<ReadonlySet<string>> {
    const capabilities = await this.capabilities.resolve();
    return new Set(
      Object.entries(MCP_TOOL_CAPABILITY)
        .filter(([, capability]) => capabilities?.[capability] !== true)
        .map(([tool]) => tool),
    );
  }
}
