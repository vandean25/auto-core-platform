import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../src/app.module';

async function generateOpenApiSpec() {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');

  const config = new DocumentBuilder()
    .setTitle('Auto Core Platform API')
    .setDescription('Generated OpenAPI spec for contract checks and client types.')
    .setVersion('1.0.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  const outputDir = join(process.cwd(), 'openapi');
  const outputFile = join(outputDir, 'openapi.json');
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(outputFile, JSON.stringify(document, null, 2) + '\n', 'utf8');

  await app.close();
  console.log(`OpenAPI spec written to ${outputFile}`);
}

void generateOpenApiSpec();
