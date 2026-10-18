import { z } from 'zod';
import { MCP_MAX_PAGE_SIZE } from './mcp.constants.js';

export const mcpOutputIdString = z.string().min(1);
export const mcpOutputNonEmptyString = z.string().min(1);
export const mcpOutputCount = z.number().int().min(0);
export const mcpOutputPageSize = z.number().int().min(1).max(MCP_MAX_PAGE_SIZE);
export const mcpOutputDecimalString = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, 'must be a decimal string');
export const mcpOutputNullableDecimalString = mcpOutputDecimalString.nullable();
export const mcpOutputIsoDateTime = z.iso.datetime();
export const mcpOutputNullableIsoDateTime = mcpOutputIsoDateTime.nullable();
export const mcpOutputIsoDateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

export const mcpOutputTotalCursorMeta = z.object({
  total: mcpOutputCount,
  page_size: mcpOutputPageSize,
  next_cursor: mcpOutputNonEmptyString.nullable(),
});

type Shape = Record<string, z.ZodType>;

function optionalShape<S extends Shape>(shape: S) {
  return Object.fromEntries(
    Object.entries(shape).map(([key, schema]) => [key, schema.optional()]),
  ) as { [K in keyof S]: z.ZodOptional<S[K]> };
}

const truncatedMarkerShape = {
  __truncated__: z.literal(true),
  originalBytes: mcpOutputCount,
  preview: z.string(),
};

/** Same contract as the core MCP output registry (AUT-427). */
export function mcpOutputResultOf<S extends Shape>(success: S) {
  const requiredKeys = Object.keys(success).filter(
    (key) => !success[key].safeParse(undefined).success,
  );
  const shape = {
    ...optionalShape(success),
    ...optionalShape(truncatedMarkerShape),
  };
  return z.object(shape).superRefine((value, ctx) => {
    const fields = value as Record<string, unknown>;
    if (fields.__truncated__ === true) {
      return;
    }
    for (const key of requiredKeys) {
      if (fields[key] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} is required`,
        });
      }
    }
  });
}
