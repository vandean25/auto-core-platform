<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Native ESM runtime contract

The API is a native Node.js ESM application. It requires Node.js 22 or newer,
uses `type: module` with TypeScript NodeNext resolution, and keeps explicit
`.js` extensions on relative runtime imports. Production starts from the
compiled `dist/main.js` entry point.

Use the repository scripts for supported TypeScript entry points:

- `npm run openapi:generate` builds the API and then runs the compiled
  `scripts/generate-openapi.mjs`, which boots the application so Nest decorator
  metadata is available while the application is inspected.
- Operational scripts such as `check:cloudrun-env`, `db:baseline`, and the
  seed commands use `tsx` and are safe ESM entry points.
- `npm run verify:esm-artifact` checks a previously built `dist/` artifact for a
  native ESM entry point, explicit relative extensions, and CommonJS runtime
  syntax. Run `npm run build` first. CI invokes this after the backend build
  step so the compiler is not run twice.

Bundling/tree-shaking, artificial top-level await, and a public dual
CommonJS/ESM package distribution are intentionally outside this private
application's runtime contract.

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## HTTP-triggered crons (AUT-715)

Core-api scheduled jobs normally run in-process via `@nestjs/schedule` (`SCHEDULER_MODE=in-process`, the default). On Cloud Run with CPU throttling, Infra can switch QA core-api to **HTTP mode** so Cloud Scheduler hits `POST /api/internal/cron/:jobName` on the service `run.app` URL (OIDC, not Firebase session auth).

| Variable | When required | Purpose |
| --- | --- | --- |
| `SCHEDULER_MODE` | Optional (`in-process`, `http`, `off`) | `http` disables in-process crons and enables the internal endpoint; `off` disables both (pdf-worker). |
| `CRON_OIDC_AUDIENCE` | Required when `SCHEDULER_MODE=http` | Must match the core-api Cloud Run URL used as the scheduler target (token `aud`). |
| `CRON_INVOKER_SA_EMAIL` | Required when `SCHEDULER_MODE=http` | Service account email Cloud Scheduler uses; token `email` must match and be verified. |

Pdf-worker deploy sets `SCHEDULER_MODE=off`. Until Infra overrides cloudbuild substitutions, QA core-api stays `SCHEDULER_MODE=in-process` (placeholders for the OIDC vars are wired but not validated in that mode).

Example manual invoke (replace placeholders; never commit real URLs or emails):

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $(gcloud auth print-identity-token --audiences=https://core-api-PLACEHOLDER.run.app)" \
  "https://core-api-PLACEHOLDER.run.app/api/internal/cron/notification-outbox-recovery"
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
