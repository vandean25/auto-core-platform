// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      "prettier/prettier": ["error", { endOfLine: "auto" }],
      // AUT-65: Ban raw Prisma queries in application code.
      // Raw queries bypass the tenant isolation extension entirely (ADR-0013).
      // Use typed Prisma operations instead. See: docs/internal/05-Runbooks/prisma-raw-query-prohibition.md
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name='$queryRaw']",
          message:
            '[AUT-65] prisma.$queryRaw() is banned in application code. It bypasses tenant isolation (ADR-0013). Use typed Prisma queries instead. See docs/internal/05-Runbooks/prisma-raw-query-prohibition.md',
        },
        {
          selector: "MemberExpression[property.name='$queryRawUnsafe']",
          message:
            '[AUT-65] prisma.$queryRawUnsafe() is banned in application code. It bypasses tenant isolation (ADR-0013). Use typed Prisma queries instead.',
        },
        {
          selector: "MemberExpression[property.name='$executeRaw']",
          message:
            '[AUT-65] prisma.$executeRaw() is banned in application code. It bypasses tenant isolation (ADR-0013). Use typed Prisma queries instead. See docs/internal/05-Runbooks/prisma-raw-query-prohibition.md',
        },
        {
          selector: "MemberExpression[property.name='$executeRawUnsafe']",
          message:
            '[AUT-65] prisma.$executeRawUnsafe() is banned in application code. It bypasses tenant isolation (ADR-0013). Use typed Prisma queries instead.',
        },
        {
          selector:
            "MemberExpression[object.name='systemPrisma'][property.name=/^(customer|vehicle|employee|workshopOrder|invoice|salesOrder|catalogItem|inventoryStock)$/]",
          message:
            '[AUT-135] SystemPrismaService cannot access tenant models. Use PrismaService so tenant isolation applies. See docs/internal/05-Runbooks/system-prisma-allowlist.md',
        },
        {
          selector:
            "MemberExpression[object.property.name='systemPrisma'][property.name=/^(customer|vehicle|employee|workshopOrder|invoice|salesOrder|catalogItem|inventoryStock)$/]",
          message:
            '[AUT-135] SystemPrismaService cannot access tenant models. Use PrismaService so tenant isolation applies. See docs/internal/05-Runbooks/system-prisma-allowlist.md',
        },
      ],
    },
  },
  {
    files: [
      '**/*.spec.ts',
      '**/*.spec.support.ts',
      'test/**/*.ts',
      'prisma/**/*.ts',
      'scripts/**/*.ts',
      '*.ts',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'prettier/prettier': 'off',
      'no-restricted-syntax': 'off',
    },
  },
);
