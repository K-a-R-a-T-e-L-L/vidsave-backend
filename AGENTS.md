# VidSave backend instructions

- ChatGPT owns architecture decisions; Codex implements the exact approved technical task. Do not add business features without a task.
- This NestJS API is an independent repository directory. The Next.js frontend is the sibling `../vidsave-frontend`; do not edit it without explicit scope.
- The single canonical project state is `PROJECT_STATE.md` here. The shared parent `../.codex/` may contain only one current `отчёт.txt` and `изменения.patch` when a Git base exists. Fully replace the report after each stage; do not accumulate archives, extra reports, logs, or temporary files. Do not put reports in this repository or create nested `.codex/` directories.
- Do not create a second backend. Payload CMS is excluded. Backend uses NestJS, PostgreSQL and TypeORM as specified by the approved task.
- Keep real credentials outside Git and Docker context. `.env.example` contains placeholders only.
- Preserve user files and existing processes. Never stop unrelated processes or containers; record PIDs/ports for task-owned runtimes and clean up only those resources.
- PostgreSQL integration tests may run only against an explicitly named disposable database configured through `VIDSAVE_AUTH_TEST_DB_*`; never connect tests to the workstation database on port 5432. Label and remove only containers/networks created by the current task.
- Backend Git initialized on main at the owner’s request; origin is https://github.com/K-a-R-a-T-e-L-L/vidsave-backend.git. No commit, push, deploy, production or DNS changes without explicit authorization. CI/CD preparation is approved; triggering deployments is not.
- Do not manually edit `dist/`, `node_modules/`, or other generated output. Runtime uses the approved synchronize: true / dropSchema: false strategy. Do not add migrations. Never apply development schema checks to user or production databases.
- Keep a recovery patch only if the data is not present in the working tree or it is a valid Git-based deliverable; do not keep redundant patches.
- Required checks: `npm ci`, `npm test`, `npm run test:e2e`, `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm run build`, and production/full npm audit as appropriate.

- Stage 5 CMS is approved: reuse src/modules/cms, the existing auth guards, strict input schemas, private S3 delivery and the transactional lead outbox. Initial data is insert-only; preserve editorial changes and legacy services.

- Current owner-approved scope supersedes Stage 5 website editing: static page, SEO and media-library administration is removed; only contact settings remain. Keep business CRUD and inline uploads. Public copy and legal documents are source-managed; privacy/consent composition was explicitly authorized. Use server-rendered dynamic public content and automatically near-viewport-loaded 2GIS.
