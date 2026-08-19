import './instrument';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import {
  GlobalExceptionFilter,
  HttpLoggingInterceptor,
  LogLevelService,
} from './common';
import { validateEnv } from './config/env';

async function bootstrap() {
  const env = validateEnv();
  const app = await NestFactory.create(AppModule, {
    logger: LogLevelService.getInitialNestLogLevels(),
  });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new HttpLoggingInterceptor());

  if (env.FRONTEND_URL) {
    app.enableCors({
      origin: env.FRONTEND_URL,
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
      credentials: true,
    });
  }

  const port = env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`Application is running on: http://0.0.0.0:${port}`);
}
void bootstrap();
