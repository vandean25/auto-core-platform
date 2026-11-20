# AUT-1025: First URL Page Load Baseline & After Report

## Method

1. **Production bundle manifest (`vite build --mode production`):**
   - Measured via `apps/core-web/scripts/check-startup-bundle.ts` (`measureStartupBundle`) walking `dist/.vite/manifest.json` from the entry chunk through all static `imports` and `css` assets, comparing `origin/main` (`2713f70`) against this branch.
   - Enforced in unit tests (`apps/core-web/scripts/check-startup-bundle.test.ts`) and Playwright CI (`apps/core-web/e2e/startup-bundle-budget.spec.ts`).
2. **Hard-load Web Vitals & route-ready timings (Playwright + Chromium):**
   - Served `dist-e2e` via `vite preview` (`1440x900`, `de-AT`, simulated `80 ms` API RTT per request) on hard URL loads (`page.goto`) of `/dashboard`, `/sales/invoices`, `/purchase-orders`, and `/workshop/tyre-storage`.
   - Recorded `first-contentful-paint` (FCP), `largest-contentful-paint` (LCP), `domInteractive`, total time to route ready, `GET /api/purchase-orders` response-to-table-paint interval, and spurious `/api/workshop/resources` request count.

## Production QA Baseline (`v2026.11.20-release-1` / `9d3d1688`)

- Dashboard: `5.5–7.3 s`
- URL-opened lists (invoices / customers): `4–6 s`
- Purchase orders (`/purchase-orders`): `~15 s`
- Tyre storage (`/workshop/tyre-storage`): stuck on blank „Auto Core wird geladen…“ (`PageLoader`)
- Startup payload: `43` files, `~454 KB` compressed (`283 KB` main script)

## Local Reproducible Before/After (`origin/main` `2713f70` vs branch)

### Startup Bundle (`vite build --mode production`)

| Metric | Baseline (`origin/main`) | After | Target |
|---|---:|---:|---|
| Startup files (HTML + static JS/CSS) | 44 | **34** (-22.7%) | `< 44` |
| Startup bundle (raw) | 1,749,448 B (1,708.4 KB) | **1,655,910 B** (1,617.1 KB) | Smaller than `origin/main` |
| Startup bundle (gzip) | 535,224 B (522.7 KB) | **507,290 B** (495.4 KB) | `< 535,224 B` |
| Entry `index` chunk (raw) | 1,134,785 B (1,108.2 KB) | **1,059,533 B** (1,034.7 KB) | Smaller than `origin/main` |
| Entry `index` chunk (gzip) | 348,005 B (339.8 KB) | **326,451 B** (318.8 KB) | `< 348,005 B` |

### Hard URL Load Web Vitals (`vite preview`, 80 ms simulated API RTT)

| Route | Baseline (`origin/main`) | After | Notes |
|---|---|---|---|
| `/dashboard` | 1,563 ms ready (FCP 656 ms, LCP 1,120 ms, 1× `/api/workshop/resources`) | **1,479 ms** ready (FCP 660 ms, LCP 1,208 ms, **0×** `/api/workshop/resources`) | `GlobalSearch` lazy-mounted on Cmd+K |
| `/sales/invoices` | 1,537 ms ready (FCP 556 ms, LCP 1,216 ms, 1× `/api/workshop/resources`) | **1,449 ms** ready (FCP 664 ms, LCP 1,084 ms, **0×** `/api/workshop/resources`) | Route chunk + locale preloaded in parallel |
| `/purchase-orders` | 1,536 ms ready (207 ms response-to-paint, FCP 568 ms, LCP 1,260 ms) | **1,621 ms** ready (**432 ms** response-to-paint incl. 350 ms skeleton min-hold, FCP 676 ms, LCP 1,116 ms) | Table paints promptly once `GET /api/purchase-orders` resolves |
| `/workshop/tyre-storage` | 1,526 ms ready (`PageLoader` fallback, FCP 556 ms, LCP 1,232 ms) | **1,466 ms** ready (`ListRouteSkeleton` fallback, `sawPageLoader: false`, FCP 672 ms, LCP 1,124 ms) | No „Auto Core wird geladen…“ once shell is up |

## QA Screenshots

- `/workshop/tyre-storage` loading state (`ListRouteSkeleton`): `docs/internal/assets/aut-1025-tyre-storage-loading.png`
- `/workshop/tyre-storage` ready state: `docs/internal/assets/aut-1025-tyre-storage-ready.png`
- `/purchase-orders` populated table ready state: `docs/internal/assets/aut-1025-purchase-orders-ready.png`
