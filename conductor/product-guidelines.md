# Product Guidelines

## TypeScript & Style
- **Type Safety**: Enforced `verbatimModuleSyntax`. **ALWAYS** use `import type` for type-only imports.
- **Tailwind v4**: All styling is defined in `@theme` blocks in `src/index.css`. Utility classes are preferred.
- **shadcn/ui**: Components are in `src/components/ui/`. Use the `cn()` utility for conditional classes.

## Backend Patterns
- **Services**: Business logic stays in services; controllers handle HTTP routing.
- **Prisma**: Use `PrismaService` for all DB operations. Schema uses `snake_case` via `@@map()`.
- **Validation**: Global `ValidationPipe` is enabled in `main.ts`.

## Testing Standards
- **Integration Tests**: Required for each feature module (`apps/core-api/test/*.e2e-spec.ts`).
- **Flow Focus**: Tests must cover end-to-end business flows (e.g., PO -> Receipt -> Bill, Customer -> Sales Order -> Invoice).
