import './instrument';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common';

function validateStartupEnv(): void {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  const raw = process.env.SECRET_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'SECRET_ENCRYPTION_KEY is required and must be a base64-encoded 32-byte key.',
    );
  }

  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(
      'SECRET_ENCRYPTION_KEY must be a base64-encoded 32-byte key.',
    );
  }
}

async function bootstrap() {
  validateStartupEnv();
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.useGlobalFilters(new GlobalExceptionFilter());

  // CORS Configuration
  const frontendUrl = process.env.FRONTEND_URL;
  if (frontendUrl) {
    app.enableCors({
      origin: frontendUrl,
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
      credentials: true,
    });
  }

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`Application is running on: http://0.0.0.0:${port}`);
}
void bootstrap();
