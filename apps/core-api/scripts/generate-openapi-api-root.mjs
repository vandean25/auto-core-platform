process.env.SKIP_PRISMA_CONNECT = 'true';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ApiRootModule } from '../dist/api-root.module.js';
import { standardSchemaConverter } from '../dist/common/index.js';
import {
  closeGuardedInventoryPatchOpenApiSchemas,
  runOpenApiGeneratorCli,
  writeOpenApiJson,
} from './openapi-document-post-process.mjs';

function stabilizeOpenApiParameterOrder(document) {
  for (const pathItem of Object.values(document.paths ?? {})) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const operation of Object.values(pathItem)) {
      if (!operation || typeof operation !== 'object' || !Array.isArray(operation.parameters)) {
        continue;
      }
      operation.parameters.sort((left, right) => left.name.localeCompare(right.name));
    }
  }
}

/**
 * Boots ApiRootModule (AppModule + feature modules not wired in AppModule) for OpenAPI
 * generation so contract checks include routes registered outside app.module.ts.
 */
async function generateOpenApiSpec() {
  const app = await NestFactory.create(ApiRootModule, {
    logger: ['error', 'warn'],
  });
  app.setGlobalPrefix('api');

  const config = new DocumentBuilder()
    .setTitle('Auto Core Platform API')
    .setDescription(
      'Generated OpenAPI spec for contract checks and client types.',
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
      'BearerAuth',
    )
    // Tenant API keys (ADR-0026). Not a global requirement: only /api/public/v1 operations declare it,
    // and each one names its scope in the x-required-scopes extension. Session-only routes reject keys.
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'acp_live_<keyId>_<secret>',
        description:
          'Tenant API key created in Settings > API keys. Send as `Authorization: Bearer acp_live_<keyId>_<secret>`. Only read endpoints under /api/public/v1 accept it.',
      },
      'PublicApiKey',
    )
    .addSecurityRequirements('BearerAuth')
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    standardSchemaConverter,
  });
  stabilizeOpenApiParameterOrder(document);
  closeGuardedInventoryPatchOpenApiSchemas(document);
  const outputFile = writeOpenApiJson(document);
  await app.close();
  console.log(`OpenAPI spec written to ${outputFile}`);
}

runOpenApiGeneratorCli(generateOpenApiSpec);
