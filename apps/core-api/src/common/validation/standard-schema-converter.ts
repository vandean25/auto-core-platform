import type { StandardSchemaConverter } from '@nestjs/swagger';

/**
 * Standard Schema converter for NestJS 12 Swagger integration.
 * Supports Zod 4 and any spec-compliant Standard Schema object.
 */
export const standardSchemaConverter: StandardSchemaConverter = (
  schema: unknown,
  options: { schemaType: 'input' | 'output' },
) => {
  if (schema && typeof schema === 'object' && '~standard' in schema) {
    const std = (
      schema as {
        '~standard'?: {
          jsonSchema?: { input?: () => unknown; output?: () => unknown };
        };
      }
    )['~standard'];
    if (std?.jsonSchema) {
      const generated =
        options.schemaType === 'input' &&
        typeof std.jsonSchema.input === 'function'
          ? std.jsonSchema.input()
          : typeof std.jsonSchema.output === 'function'
            ? std.jsonSchema.output()
            : undefined;
      if (generated) {
        return { schema: generated };
      }
    }
    const candidate = schema as unknown as { toJSONSchema?: () => unknown };
    if (typeof candidate.toJSONSchema === 'function') {
      return { schema: candidate.toJSONSchema() };
    }
  }
  return undefined;
};
