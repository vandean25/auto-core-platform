import './instrument';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import {
  createGlobalValidationPipe,
  GlobalExceptionFilter,
  HttpLoggingInterceptor,
  LogLevelService,
} from './common';
import { validateEnv } from './config/env';
import { configureHttpSecurity } from './common/http/http-security';

async function bootstrap() {
  const env = validateEnv();
  const app = await NestFactory.create(AppModule, {
    logger: LogLevelService.getInitialNestLogLevels(),
  });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(createGlobalValidationPipe());
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new HttpLoggingInterceptor());
  configureHttpSecurity(app, env);

  const port = env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`Application is running on: http://0.0.0.0:${port}`);
}
void bootstrap();
