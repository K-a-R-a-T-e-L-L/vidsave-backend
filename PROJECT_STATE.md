# VidSave — PROJECT_STATE

## Logical project

- «ВИДЕОХРАНИТЕЛЬ» / VidSave consists of two related repositories.
- Backend: `D:\Desktop\dev\web\orders\vidsave\vidsave-backend`, Git main; origin https://github.com/K-a-R-a-T-e-L-L/vidsave-backend.git. Initial application commit and push to origin/main authorized on 2026-10-14.
- Frontend: `D:\Desktop\dev\web\orders\vidsave\vidsave-frontend`, branch `main`, origin https://github.com/K-a-R-a-T-e-L-L/vidsave-frontend.git. Prepared application changes are included in the authorized release commit; prior local history is retained.
- Canonical report: `D:\Desktop\dev\web\orders\vidsave\.codex\отчёт.txt`. Frontend state is a short pointer only.

## Stack and architecture

- Backend: Node 22, NestJS 12, TypeORM 1.1, PostgreSQL, Zod, Express 5, AWS S3 SDK, Sharp.
- Frontend: Next.js 16.4 App Router, React 19, TypeScript, Mantine 8, Manrope, SCSS, light/dark themes, Tiptap 3 JSON editor.
- Browser → existing Next BFF → NestJS → PostgreSQL. Existing ADMIN guards, HttpOnly sessions, 4m/1h default TTL and refresh rotation are retained. Frontend single-flight remains per Node process; deployment assumes one frontend instance.
- Public SSR reads published catalog/CMS data with no-store and request-scoped React caching. No legacy catalog runtime fallback. Missing backend fails visibly.

## Modules and routes

- Existing `health`, `admin-auth`, `service-categories`, `services`; new `cms` for content, media, contact settings, leads and outbox.
- Public website: `/`, `/services`, `/services/[serviceName]`, `/for-home`, `/for-business`, `/about`, `/contacts`, `/blog`, `/blog/[slug]`, `/blog/category/[slug]`, `/projects`, `/projects/[slug]`, `/privacy`, `/consent`, `/media/[id]`, dynamic sitemap and YML.
- Admin: overview, services/categories, blog/categories, projects, leads, contact settings, administrators. CMS proxy uses a strict kind/ID/method allowlist under `/api/admin/cms`.
- Backend catalog: `/api/catalog/*`; ADMIN catalog/users remain under their existing routes. CMS: `/api/admin/cms/*`; public content/lead-config/intake/media: `/api/content/*`.
- Static page copy, visuals, metadata and legal documents are maintained in source. Old admin pages/SEO/media-library/settings APIs return 404; contact-only API is `/api/admin/cms/contacts`. Business content retains publication controls and permanent published slugs.

## Data and integrations

- Preserve the 23 legacy services, seven categories, prices/units/IDs/slugs and local assets. Snapshot/importer: frontend `src/app/lib/servicesList.ts`; backend `scripts/import-legacy-services.ts`. Reimport retains administrator edits.
- `synchronize: true`, `dropSchema: false`, no migrations. Importer and guarded test seeding do not synchronize schema. No development schema changes were applied to user/production DBs.
- CMS entities: BlogCategory, BlogPost, PortfolioProject, MediaAsset/MediaUse, SitePage, SiteSettings, Lead, NotificationOutbox, CmsRateLimit. Service adds nullable media FK and permanent slug lock.
- Inline image uploads use a private local directory (`MEDIA_LOCAL_DIRECTORY`, default `var/media`) when no S3 bucket is configured; persist this directory across deployments. Optional S3 uses `MEDIA_S3_*`. FirstVDS deployment templates use path-style like the read-only sigmadrun reference, region default; endpoint/access/secret are mandatory when enabling a bucket. Signed PUT/GET/DELETE verified against a local protocol fixture, real FirstVDS pending credentials. Sharp validates/optimizes JPEG/PNG/WebP/AVIF; 8 MiB and pixel limits. Stable media URLs check publication on each request; authenticated draft previews, deletion blocked by references, responsive Next srcset via a custom MediaImage loader. /media variants use quality75/85 and bounded in-memory caching only after a fresh publication check; default Next cache is restricted to static /images assets.
- Policy and separate consent were authored at the owner’s explicit request using existing operator details; source-managed `/privacy` and `/consent` enable real lead intake. Full consent evidence is immutable, versions depend on document content/contact email; normalized phone, persistent limits, idempotent request keys and transactional outbox remain.
- BrandLogo uses owner-provided theme-specific transparent WebP assets (720×240, light35,830 bytes/dark55,720 bytes), shared by header/footer. Owner-supplied ICO/PNG/Apple/manifest icons are installed and PNGs losslessly compressed; 512px WebP shield is the structured logo, 1200×630 JPEG is the social sharing image.
- Admin URLs are assigned automatically on creation (transliterated title + UUID) and remain stable on rename. Lists expose hide/publish and confirmed delete for services, posts, projects and categories; used categories require reassignment. Deletion removes content/media references and service/project junctions. Article images have pixel-width presets, alt text and delete/undo controls; tables have row/column/delete controls.
- PublicPage appends one shared FeedbackSection at the end of every standard public page (including legal documents); home ends with the same component after Contacts. Blog cards share ContentCard, public/admin list prices omit kopecks without changing stored values, menu CTA targets #request. Blog preview includes cover and rich body.
- Three original introductory blog guides are seeded transactionally only when installing contact settings for the first time; deletions survive restart. Actual projects/reviews are never fabricated. Public content is SSR/no-store with parallel independent reads; legal body is excluded from client context, admin-only styles/notifications stay out of public layout.
- Verified 2GIS company widget loads through IntersectionObserver within 700 px of viewport, without clicking. CSS adapts the map to dark/light; permanent route link remains available.
- Optional Telegram credentials enable leased retry/backoff delivery. Missing credentials keep leads stored with disabled notification state. At-least-once delivery can repeat after a provider-success/process-crash window. Notifications contain only the lead ID. Real Telegram delivery requires owner credentials; lead storage works without them.

- Owner media pack installed: public/images/media-pack, 12 source images optimized to 18 WebP/AVIF files (30,570,794 → 2,832,363 bytes including hero variants). Theme-specific hero backgrounds use mobile960 and desktop source-sized images, section illustrations use responsive Next Image; route mapping in src/app/lib/page-media.ts. Browser verified all eight routes and theme switching.

## Commands and generated paths

- Both: `npm ci`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build`, production/full npm audit.
- Backend: `npm test`, `npm run test:e2e`, `npm run test:cms`, `npm run admin:bootstrap`, `npm run catalog:import -- --dry-run|--apply`.
- Frontend: `npm test`, `npm run test:e2e` (isolated simplified-admin/inline-upload/theme/map browser fixture). Optional `VIDSAVE_PREBUILT_FRONTEND` reuses a disposable production build; `VIDSAVE_PLAYWRIGHT_MODULE` selects a local browser module.
- Generated: backend `dist/`, `dist-bootstrap/`, coverage/tsbuildinfo; frontend `.next/`, `next-env.d.ts`, tsbuildinfo. Never edit manually. No Kubb generator is configured. Stock Next generation maintains declarations; Prettier excludes generated files.

## Confirmed constraints and next work

- Both repositories publish VidSave to origin/main. Frontend origin was corrected to https://github.com/K-a-R-a-T-e-L-L/vidsave-frontend.git on 2026-10-14 at the explicit request of the owner; legacy-origin remains preserved. The mistaken main branch in the unrelated repository was removed after transferring both commits; original master was preserved. Backend deployment automatically follows successful checks on the default branch without DEPLOY_ENABLED, explicitly authorized by the owner. Frontend retains its DEPLOY_ENABLED/default-branch gate. Production configuration and DNS were not changed.
- Runtime checks use disposable PostgreSQL ports, never workstation port 5432. No schema checks or test writes were applied to the user database. synchronize: true / dropSchema: false remains unchanged; migrations are excluded.
- Existing production audits had zero findings; development dependency findings remain tracked in the report. No dependency versions changed in this task.
- Node 22 is the supported runtime. Workstation Node 24 remains untouched; final build and runtime checks use an isolated Node 22 executable. S3 SDK and Sharp are installed/resolvable.
- PostgreSQL client warns about concurrent startup queries; runtime and integration checks pass. A future pg major upgrade requires review.
- Verified: both builds/typecheck, backend 32 unit/protocol tests, real PostgreSQL lead/media/content CRUD, production-browser lead submission and contact editing, bot-visible HTML, live 2GIS, responsive light/dark layouts. Exact current test totals and cleanup are in the canonical report.
- CI/CD: .github/workflows/deploy.yml in both repositories, pinned actions, checks then GHCR latest/SHA then Dokploy secret webhook. Backend publish/deploy follows checks on the default branch without an enable variable; frontend still requires repository DEPLOY_ENABLED=true. Both require the production Dokploy webhook secret. Backend integration uses disposable PostgreSQL5433; frontend browser CI uses xvfb/Chromium. Production runtime templates and DEPLOYMENT.md cover both domains and FirstVDS private S3. Docker Engine is stopped locally, so new container builds remain unverified.
- Next: configure production GitHub secrets, Dokploy runtime/S3/volumes and review GitHub CI results. Default-branch changes and frontend deployment configuration remain separate tasks.

## Codebase Memory

- Updated 2026-10-14 for the final source state; `persistence=false`, no auto_index/auto_watch, no repository graph artifacts.
- Backend project `D-Desktop-dev-web-orders-vidsave-vidsave-backend`: 1387 nodes / 2832 edges; absolute root above, source graph indexed before the initial main commit; source files unchanged by publication.
- Frontend project `D-Desktop-dev-web-orders-vidsave-vidsave-frontend`: 1097 nodes / 2196 edges; absolute root above, source graph indexed before the release commit; source files unchanged by publication.
