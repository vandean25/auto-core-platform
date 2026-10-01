process.env.SKIP_PRISMA_CONNECT = 'true';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../dist/app.module.js';
import { standardSchemaConverter } from '../dist/common/index.js';

/**
 * Boots the compiled Nest app in-process and writes the current OpenAPI document
 * to `apps/core-api/openapi/openapi.json` for CI contract checks.
 */
async function generateOpenApiSpec() {
  const app = await NestFactory.create(AppModule, {
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
    .addSecurityRequirements('BearerAuth')
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    standardSchemaConverter,
  });
  const outputDir = join(process.cwd(), 'openapi');
  const outputFile = join(outputDir, 'openapi.json');
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(outputFile, JSON.stringify(document, null, 2) + '\n', 'utf8');

  await app.close();
  console.log(`OpenAPI spec written to ${outputFile}`);
}

generateOpenApiSpec().catch((error) => {
  console.error('Failed to generate OpenAPI spec:');
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
