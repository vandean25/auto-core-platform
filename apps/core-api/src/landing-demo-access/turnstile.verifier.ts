import { Injectable } from '@nestjs/common';
import type { LandingDemoAccessConfig } from './landing-demo-access.config.js';

export type TurnstileVerifyInput = {
  token?: string;
  remoteIp?: string | null;
};

@Injectable()
export class TurnstileVerifier {
  async verify(
    config: Pick<
      LandingDemoAccessConfig,
      'turnstileEnabled' | 'turnstileSecret'
    >,
    input: TurnstileVerifyInput,
  ): Promise<boolean> {
    if (!config.turnstileEnabled) {
      return true;
    }

    const secret = config.turnstileSecret?.trim();
    const token = input.token?.trim();
    if (!secret || !token) {
      return false;
    }

    const body = new URLSearchParams({
      secret,
      response: token,
    });
    if (input.remoteIp) {
      body.set('remoteip', input.remoteIp);
    }

    const response = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      },
    );

    if (!response.ok) {
      return false;
    }

    const payload = (await response.json()) as { success?: boolean };
    return payload.success === true;
  }
}
