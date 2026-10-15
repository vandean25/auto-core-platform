import type { INestApplication } from '@nestjs/common';
import cors from 'cors';
import type { NextFunction, Request, Response } from 'express';
import { isLandingDemoAccessRequest } from '../../landing-demo-access/landing-demo-access.constants.js';

export function resolveLandingPageOrigins(
  landingPageOrigins = process.env.LANDING_PAGE_ORIGINS,
): string[] {
  return [
    ...new Set(
      landingPageOrigins
        ?.split(',')
        .map((origin) => origin.trim())
        .filter(Boolean) ?? [],
    ),
  ];
}

export function configureHttpCors(
  app: INestApplication,
  options: {
    dashboardOrigins: string[];
    landingPageOrigins?: string[];
  },
): void {
  const landingOrigins = options.landingPageOrigins ?? [];
  const landingCors =
    landingOrigins.length > 0
      ? cors({
          origin: landingOrigins,
          credentials: false,
          methods: ['POST', 'OPTIONS'],
        })
      : null;

  const dashboardCors = cors({
    origin: options.dashboardOrigins,
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (landingCors && isLandingDemoAccessRequest(req)) {
      return landingCors(req, res, next);
    }
    return dashboardCors(req, res, next);
  });
}
