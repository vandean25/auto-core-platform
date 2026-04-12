import './instrument';
import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { ApiKeyGuard } from './common/guards/api-key.guard';
import { GlobalExceptionFilter } from './common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  // Global Exception Filter
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Global Auth Guard
  const reflector = app.get(Reflector);
  app.useGlobalGuards(new ApiKeyGuard(reflector));

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
