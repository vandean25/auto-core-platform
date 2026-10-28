import { Reflector } from '@nestjs/core';
import { MECHANIC_ACCESSIBLE_KEY } from '../common/decorators/mechanic-accessible.decorator.js';
import {
  LegalEntityController,
  MeSiteController,
  SiteController,
} from './site.controller.js';

/** AUT-780: only the two self-scoped session-site handlers are open to mechanic-mode (TECH) sessions. */
describe('site controllers: mechanic-mode access (AUT-780)', () => {
  const reflector = new Reflector();

  function handlerNames(controller: { prototype: object }): string[] {
    return Object.getOwnPropertyNames(controller.prototype).filter(
      (name) =>
        name !== 'constructor' &&
        typeof (controller.prototype as Record<string, unknown>)[name] ===
          'function',
    );
  }

  function isMechanicAccessible(
    controller: { prototype: object },
    name: string,
  ): boolean {
    const handler = (controller.prototype as Record<string, () => unknown>)[
      name
    ];
    return reflector.get<boolean>(MECHANIC_ACCESSIBLE_KEY, handler) === true;
  }

  it('marks listMySites and setActiveSite as mechanic accessible', () => {
    expect(isMechanicAccessible(MeSiteController, 'listMySites')).toBe(true);
    expect(isMechanicAccessible(MeSiteController, 'setActiveSite')).toBe(true);
  });

  it('does not mark the MeSiteController class, so any new handler stays closed by default', () => {
    expect(reflector.get(MECHANIC_ACCESSIBLE_KEY, MeSiteController)).toBe(
      undefined,
    );
    expect(handlerNames(MeSiteController).sort()).toEqual([
      'listMySites',
      'setActiveSite',
    ]);
  });

  it('leaves site and legal-entity administration closed to mechanic sessions', () => {
    for (const controller of [SiteController, LegalEntityController]) {
      expect(reflector.get(MECHANIC_ACCESSIBLE_KEY, controller)).toBe(
        undefined,
      );
      for (const name of handlerNames(controller)) {
        expect(isMechanicAccessible(controller, name)).toBe(false);
      }
    }
  });
});
