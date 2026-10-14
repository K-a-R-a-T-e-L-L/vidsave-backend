# VidSave backend

NestJS 12 / TypeORM API for the VidSave corporate website. The frontend is the sibling `../vidsave-frontend`. Canonical state: `PROJECT_STATE.md`; task report: `../.codex/отчёт.txt`.

## Local run

Use Node.js 22.22.3+ in the Node 22 line and npm 10+. Copy `.env.example` to `.env` and enter your local PostgreSQL connection and a random JWT secret of at least 32 characters. Keep existing processes and databases separate from test fixtures.

```powershell
npm ci
npm run build
$env:BOOTSTRAP_ADMIN_CONFIRM = 'CREATE_FIRST_ADMIN'
$env:BOOTSTRAP_ADMIN_EMAIL = 'your-admin@example.com'
$env:BOOTSTRAP_ADMIN_PASSWORD = 'your-private-password-at-least-14-characters'
npm run admin:bootstrap
npm run dev
```

Bootstrap builds fresh output and creates only the first ADMIN. Password policy is at least 14 characters and at most 72 UTF-8 bytes. No public registration is provided. Do not store real bootstrap credentials in scripts, reports or Git.

Runtime schema management remains `synchronize: true`, `dropSchema: false`. No migrations are used. Run development schema checks against an explicitly disposable database. The legacy importer preserves existing administrator edits: `npm run catalog:import -- --dry-run` or `--apply`; it does not synchronize schema.

## Modules and endpoints

- `/api/health/live`, `/api/health/ready`; Swagger `/api/docs` outside production when enabled.
- Existing session login/refresh/logout and ADMIN operations under `/api/admin/auth` and `/api/admin/admins`.
- Existing service/category CRUD under `/api/admin/services` and `/api/admin/service-categories`; published catalog under `/api/catalog`.
- ADMIN CMS under `/api/admin/cms`: `posts`, `blog-categories`, `projects`, `contacts`, `leads`, `dashboard`. Retired pages/settings/SEO/media-list and media-edit endpoints return 404. Media upload, authenticated file preview and protected deletion remain available for inline content forms. Article/project status changes preserve previously published slugs. Images and referenced categories cannot be deleted while in use.
- Anonymous `/api/content`: bootstrap, published content lists/details, `lead-config`, lead intake, and publication-checked media delivery. Draft details and private media return 404.

The browser uses the existing Next BFF and HttpOnly sessions. Rich content is validated Tiptap JSON, not executable HTML. Initial site data is inserted only when missing; startup never overwrites CMS edits.

## Images

Configure the optional `MEDIA_S3_*` variables from `.env.example`. Create a private bucket in your S3-compatible provider. Upload accepts JPEG, PNG, WebP and AVIF up to 8 MiB, checks actual format/dimensions, and optimizes to WebP through Sharp. Credentials and object keys are never public. Stable `/media/<uuid>` frontend URLs proxy bytes after a current publication check; drafts use the authenticated admin preview route. Without MEDIA_S3_BUCKET, private files are stored under MEDIA_LOCAL_DIRECTORY (default var/media). Mount persistent storage in production. Static site images are maintained in source.

## Leads and Telegram

Source-managed policy and separate consent were prepared at the owner’s request using the existing operator details. They enable intake immediately. Contact email changes rotate the document version. Each accepted lead stores its policy version, full consent document, confirmation and timestamp. Leads and the notification outbox commit in one PostgreSQL transaction. Duplicate request keys are idempotent; phone and IP limits are persisted.

Optional `TELEGRAM_BOT_TOKEN` and `TELEGRAM_LEADS_CHAT_ID` enable the leased outbox worker. It retries temporary errors with backoff, honors provider retry delays and limits attempts. Delivery is at least once; a crash after the provider accepts a message can cause a repeated notification. Telegram notifications contain only the lead ID and an instruction to open the admin panel. Missing Telegram credentials do not prevent saving a lead. `TELEGRAM_API_BASE_URL` is intended for the isolated test provider; normal delivery defaults to the official Telegram API.

## Checks and generated output

`npm ci`, `npm test`, `npm run test:e2e`, `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm run build`, `npm audit --omit=dev`, `npm audit`.

PostgreSQL e2e suites require explicit `VIDSAVE_AUTH_TEST_DB_*` / `VIDSAVE_CATALOG_TEST_DB_*` settings, disposable database prefixes and a host port other than 5432. `npm run test:cms` requires the isolated Stage 5 API on `http://127.0.0.1:3141`, its fixture admin and S3/Telegram providers. Never point tests at a user database. The fixture seed is explicitly guarded by `DATABASE_NAME=vidsave_stage5_test` and retains existing legacy records.

After building the fixture, `node test/cms-image-formats.cjs` checks all four supported upload formats against real Sharp/S3. `node test/cms-outbox-concurrency.cjs` checks PostgreSQL leases with two concurrent workers and eight local-provider deliveries. Both scripts enforce the disposable Stage 5 database/provider configuration and close their database connections.

Production image: `docker build -t vidsave-backend .`. It builds without a live database, prunes development dependencies and runs as the `node` user. Generated `dist/`, `dist-bootstrap/`, `coverage/` and tsbuildinfo files must not be edited manually. No Kubb generation is configured in this project.

Deployment setup: [DEPLOYMENT.md](DEPLOYMENT.md). Runtime template: `.env.production.example`. CI/CD is prepared locally; publishing is gated by repository variable `DEPLOY_ENABLED`.
