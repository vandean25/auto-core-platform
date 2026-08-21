import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from './common/decorators/public.decorator';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  const controller = new HealthController();

  it('returns a stable healthy status without external dependencies', () => {
    expect(controller.getHealth()).toEqual({ status: 'ok' });
  });

  it('registers a public GET route at health', () => {
    expect(Reflect.getMetadata(PATH_METADATA, controller.getHealth)).toBe('/');
    expect(Reflect.getMetadata(METHOD_METADATA, controller.getHealth)).toBe(
      RequestMethod.GET,
    );
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, controller.getHealth)).toBe(true);
  });
});
