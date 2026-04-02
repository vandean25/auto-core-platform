import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('debug-sentry', () => {
    it('should throw not found when debug route is disabled', () => {
      process.env.ENABLE_SENTRY_DEBUG_ROUTE = 'false';

      expect(() => appController.getSentryError()).toThrow(NotFoundException);
    });

    it('should throw the Sentry verification error when debug route is enabled', () => {
      process.env.ENABLE_SENTRY_DEBUG_ROUTE = 'true';

      expect(() => appController.getSentryError()).toThrow(
        'My first Sentry error!',
      );
    });
  });
});
