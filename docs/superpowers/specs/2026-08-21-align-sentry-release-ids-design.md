# Align Sentry Release IDs Design

## Goal

Ensure tagged production frontend bundles, Cloud Run API events, and uploaded
Sentry source maps all use the git tag as the canonical release ID.

## Recommended approach

Use Cloud Build as the sole production source-map upload owner. The existing
tag-triggered `build-frontend` step already injects Sentry credentials and sets
both `SENTRY_RELEASE` and `VITE_APP_VERSION` to `${TAG_NAME}`. The
`deploy-cloud-run` and PDF worker deployment steps already set API
`SENTRY_RELEASE` to the same tag.

Delete `.github/workflows/core-web-sentry-sourcemaps.yml` so pushes to `main`
cannot create competing SHA-named production releases. This also ensures PRs
do not upload source maps. Update the GSM guide to describe Cloud Build as the
source-map path and remove the GitHub-only repository secret requirements.
Add concise comments in `cloudbuild.yaml` and `apps/core-web/vite.config.ts`
stating that production release IDs come from git tags. Keep Vite's hidden
sourcemap setting unchanged.

## Alternatives considered

1. Keep GitHub Actions for staging with a staging environment and release
   prefix. This preserves a second build path but requires separate staging
   Sentry configuration and more documentation.
2. Move production uploads to tag-triggered GitHub Actions and disable the
   Vite upload in Cloud Build. This changes the existing production owner and
   would require carefully reproducing Cloud Build's production build inputs.
3. Remove GitHub Actions and retain Cloud Build (recommended). This is the
   smallest change and makes the already-correct tagged production path
   authoritative.

## Components and data flow

- Git tag `v*` triggers Cloud Build.
- Cloud Build's frontend build exports `SENTRY_RELEASE=${TAG_NAME}` and
  `VITE_APP_VERSION=${TAG_NAME}`.
- The Vite Sentry plugin uploads hidden source maps under that tag release.
- Cloud Run receives `SENTRY_RELEASE=${TAG_NAME}` for the API and PDF worker.
- Browser Sentry reads `VITE_APP_VERSION` as its release.

No frontend runtime behavior or Sentry release parsing changes are needed.

## Verification

- Run `npm --prefix apps/core-web test -- src/sentry`.
- Confirm `SENTRY_RELEASE` references in `cloudbuild.yaml` all use
  `${TAG_NAME}` and that the deleted GitHub workflow has no remaining path.
- Confirm `build.sourcemap: 'hidden'` remains present.
- Review the GSM guide for the Cloud Build/GSM path and absence of stale
  GitHub workflow instructions.
