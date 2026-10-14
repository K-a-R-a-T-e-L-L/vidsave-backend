import { INestApplication } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { Server } from "node:http";
import { join } from "node:path";
import request from "supertest";
import { DataSource } from "typeorm";
import { configureApplication } from "../src/configure-application";
import { validateEnvironment } from "../src/config/env.schema";
import {
  AdminRole,
  AdminUser,
} from "../src/modules/admin-auth/entities/admin-user.entity";
import { hashAdminPassword } from "../src/modules/admin-auth/services/admin-password.service";
import { ServiceCategory } from "../src/modules/service-categories/entities/service-category.entity";
import { Service } from "../src/modules/services/entities/service.entity";

const enabled = process.env.VIDSAVE_CATALOG_TEST_DATABASE === "1";
const catalogDescribe = enabled ? describe : describe.skip;
const password = "catalog-test-admin-password-12";
const userPassword = "catalog-test-user-password-12";
const IMPORTER_PIDS = new Set<number>();
const IMPORTER_STARTED_PIDS: number[] = [];
let app: INestApplication;
let dataSource: DataSource;
let adminToken: string;
let userToken: string;
let catalogPort: string;

catalogDescribe("PostgreSQL-backed service catalog", () => {
  beforeAll(async () => {
    for (const key of [
      "VIDSAVE_CATALOG_TEST_DB_HOST",
      "VIDSAVE_CATALOG_TEST_DB_PORT",
      "VIDSAVE_CATALOG_TEST_DB_USER",
      "VIDSAVE_CATALOG_TEST_DB_PASSWORD",
      "VIDSAVE_CATALOG_TEST_DB_NAME",
    ]) {
      if (!process.env[key])
        throw new Error(`Missing isolated catalog DB setting: ${key}`);
    }
    catalogPort = process.env.VIDSAVE_CATALOG_TEST_DB_PORT as string;
    if (catalogPort === "5432")
      throw new Error("Catalog integration tests must not use port 5432");
    if (
      !process.env.VIDSAVE_CATALOG_TEST_DB_NAME?.startsWith(
        "vidsave_catalog_test",
      )
    ) {
      throw new Error(
        "Catalog tests require a database named vidsave_catalog_test*",
      );
    }
    Object.assign(process.env, {
      NODE_ENV: "test",
      PORT: "3001",
      API_PREFIX: "api",
      FRONTEND_ORIGIN: "http://localhost:3000",
      DATABASE_HOST: process.env.VIDSAVE_CATALOG_TEST_DB_HOST,
      DATABASE_PORT: catalogPort,
      DATABASE_USER: process.env.VIDSAVE_CATALOG_TEST_DB_USER,
      DATABASE_PASSWORD: process.env.VIDSAVE_CATALOG_TEST_DB_PASSWORD,
      DATABASE_NAME: process.env.VIDSAVE_CATALOG_TEST_DB_NAME,
      DATABASE_SSL: "false",
      TRUST_PROXY_HOPS: "0",
      SWAGGER_ENABLED: "true",
      JWT_SECRET: randomBytes(48).toString("base64url"),
      JWT_ACCESS_EXPIRES: "4m",
      JWT_REFRESH_EXPIRES: "1h",
    });
    const config = validateEnvironment(process.env);
    const { AppModule } = await import("../src/app.module");
    const { NestFactory } = await import("@nestjs/core");
    app = await NestFactory.create(AppModule, { logger: ["error", "warn"] });
    configureApplication(app, config);
    await app.init();
    dataSource = app.get(DataSource);
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
    if (IMPORTER_STARTED_PIDS.length) {
      process.stdout.write(
        `Catalog importer child PIDs started and exited: ${IMPORTER_STARTED_PIDS.join(", ")}\n`,
      );
    }
    if (IMPORTER_PIDS.size) {
      process.stdout.write(
        `Catalog importer child processes still tracked: ${[...IMPORTER_PIDS].join(", ")}\n`,
      );
    }
    if (catalogPort)
      process.stdout.write(
        `Catalog test PostgreSQL host port used: ${catalogPort}; database app connections closed.\n`,
      );
  });

  beforeEach(async () => {
    await dataSource.query(
      "TRUNCATE TABLE services, service_categories, admin_sessions, admin_auth_rate_limits, admin_users CASCADE",
    );
    const users = dataSource.getRepository(AdminUser);
    await users.save(
      users.create({
        email: "catalog-admin@example.test",
        passwordHash: await hashAdminPassword(password),
        role: AdminRole.ADMIN,
        isActive: true,
      }),
    );
    await users.save(
      users.create({
        email: "catalog-user@example.test",
        passwordHash: await hashAdminPassword(userPassword),
        role: AdminRole.USER,
        isActive: true,
      }),
    );
    adminToken = (await login("catalog-admin@example.test", password))
      .accessToken;
    userToken = (await login("catalog-user@example.test", userPassword))
      .accessToken;
  });

  it("enforces anonymous and role ACL, CRUD, publication filters, no-store, and protected fields", async () => {
    const server = app.getHttpServer() as Server;
    await request(server)
      .post("/api/admin/service-categories")
      .send({ name: "Category", slug: "category" })
      .expect(401);
    await request(server)
      .post("/api/admin/service-categories")
      .set(bearer(userToken))
      .send({ name: "Category", slug: "category" })
      .expect(403);
    const categoryResponse = await request(server)
      .post("/api/admin/service-categories")
      .set(bearer(adminToken))
      .send({
        name: "Test category",
        slug: "test-category",
        status: "published",
      })
      .expect(201);
    const category = categoryResponse.body as { id: string };
    expect(categoryResponse.headers["cache-control"]).toBe("no-store");
    await request(server)
      .post("/api/admin/service-categories")
      .set(bearer(adminToken))
      .send({ name: "Duplicate slug", slug: "test-category" })
      .expect(409);
    await request(server)
      .patch(`/api/admin/service-categories/${category.id}`)
      .set(bearer(adminToken))
      .send({ seoTitle: "Test category SEO", sortOrder: 4 })
      .expect(200);
    expect(
      (await request(server).get("/api/catalog/categories").expect(200)).body
        .items,
    ).toHaveLength(1);
    expect(
      (await request(server).get("/api/catalog/categories").expect(200)).body
        .items[0],
    ).toMatchObject({ name: "Test category", legacyFeedId: null });
    const hiddenCategory = await request(server)
      .post("/api/admin/service-categories")
      .set(bearer(adminToken))
      .send({
        name: "Hidden category",
        slug: "hidden-category",
        status: "hidden",
      })
      .expect(201);
    expect(
      (await request(server).get("/api/catalog/categories").expect(200)).body
        .items,
    ).toHaveLength(1);
    await request(server)
      .delete(`/api/admin/service-categories/${hiddenCategory.body.id}`)
      .set(bearer(adminToken))
      .expect(204);
    const body = {
      name: "Test service",
      slug: "test-service",
      description: "Exact test description",
      categoryId: category.id,
      priceRub: "1250.50",
      priceMode: "fixed",
      unitLabel: "шт",
      status: "published",
      legacyChecksum: "must-be-rejected",
    };
    await request(server)
      .post("/api/admin/services")
      .set(bearer(adminToken))
      .send(body)
      .expect(400);
    const allowedBody = {
      name: body.name,
      slug: body.slug,
      description: body.description,
      categoryId: body.categoryId,
      priceRub: body.priceRub,
      priceMode: body.priceMode,
      unitLabel: body.unitLabel,
      status: body.status,
    };
    const created = await request(server)
      .post("/api/admin/services")
      .set(bearer(adminToken))
      .send(allowedBody)
      .expect(201);
    expect(created.body.priceRub).toBe("1250.50");
    expect(created.body.legacyId).toBeNull();
    expect(created.body.legacyChecksum).toBeUndefined();
    await request(server)
      .post("/api/admin/services")
      .set(bearer(adminToken))
      .send(allowedBody)
      .expect(409);
    const publicList = await request(server)
      .get("/api/catalog/services")
      .expect(200);
    expect(publicList.headers["cache-control"]).toBe("no-store");
    expect(publicList.body).toMatchObject({
      total: 1,
      items: [{ slug: "test-service", legacyId: null, priceRub: "1250.50" }],
    });
    await request(server)
      .get("/api/catalog/services?page=1&limit=10")
      .expect(200);
    await request(server).get("/api/catalog/services?page=0").expect(400);
    await request(server).get("/api/catalog/services/test-service").expect(200);
    await request(server)
      .patch(`/api/admin/services/${created.body.id}`)
      .set(bearer(adminToken))
      .send({ slug: "renamed-service" })
      .expect(409);
    await request(server)
      .delete(`/api/admin/service-categories/${category.id}`)
      .set(bearer(adminToken))
      .expect(409);
    await request(server)
      .patch(`/api/admin/services/${created.body.id}`)
      .set(bearer(adminToken))
      .send({ status: "hidden" })
      .expect(200);
    await request(server).get("/api/catalog/services/test-service").expect(404);
    expect(
      (await request(server).get("/api/catalog/services").expect(200)).body
        .total,
    ).toBe(0);
    await request(server)
      .get("/api/admin/services")
      .set(bearer(userToken))
      .expect(403);
    await request(server)
      .get("/api/admin/services")
      .set(bearer(adminToken))
      .expect(200);
    const hiddenOnly = await request(server)
      .get("/api/admin/services?status=hidden")
      .set(bearer(adminToken))
      .expect(200);
    expect(hiddenOnly.body.total).toBe(1);
    const openApi = await request(server).get("/api/docs-json").expect(200);
    expect(openApi.body.paths).toHaveProperty("/api/catalog/categories");
    expect(openApi.body.paths).toHaveProperty("/api/catalog/services");
    expect(openApi.body.paths).toHaveProperty("/api/admin/service-categories");
    expect(openApi.body.paths).toHaveProperty("/api/admin/services");
  });

  it("imports all frontend services transactionally, preserves administrator price edits, and serializes concurrent runs", async () => {
    const first = runImporter("--dry-run");
    expect(first.status).toBe(0);
    expect(first.stdout).toContain("23 services");
    expect(await dataSource.getRepository(Service).count()).toBe(0);
    expect(await dataSource.getRepository(ServiceCategory).count()).toBe(0);
    expect(runImporter("--apply").status).toBe(0);
    const imported = await dataSource
      .getRepository(Service)
      .find({ relations: { category: true }, order: { legacyId: "ASC" } });
    const categories = await dataSource
      .getRepository(ServiceCategory)
      .find({ order: { legacyFeedId: "ASC" } });
    expect(imported).toHaveLength(23);
    expect(categories).toHaveLength(7);
    expect(imported[0]).toMatchObject({
      legacyId: 1,
      slug: "ustanovka-ahd-kamer",
      name: "Установка AHD камер",
      priceRub: "2000.00",
      unitLabel: "шт",
      status: "published",
      legacyPriceQualifier: "от",
      legacyImagePath: "/images/services/service1.png",
    });
    const service = imported.find((item) => item.legacyId === 1);
    if (!service) throw new Error("Expected imported service #1");
    await request(app.getHttpServer() as Server)
      .patch(`/api/admin/services/${service.id}`)
      .set(bearer(adminToken))
      .send({ slug: "changed-imported-slug" })
      .expect(409);
    await request(app.getHttpServer() as Server)
      .patch(`/api/admin/services/${service.id}`)
      .set(bearer(adminToken))
      .send({ priceRub: "2345.67" })
      .expect(200);
    const updatedAt = (
      await dataSource
        .getRepository(Service)
        .findOneByOrFail({ id: service.id })
    ).updatedAt;
    const repeated = await Promise.all([
      runImporterAsync("--apply"),
      runImporterAsync("--apply"),
    ]);
    expect(repeated.map((result) => result.code)).toEqual([0, 0]);
    const after = await dataSource
      .getRepository(Service)
      .findOneByOrFail({ id: service.id });
    expect(after.priceRub).toBe("2345.67");
    expect(after.updatedAt.getTime()).toBe(updatedAt.getTime());
    expect(await dataSource.getRepository(Service).count()).toBe(23);
    expect(await dataSource.getRepository(ServiceCategory).count()).toBe(7);
  }, 120_000);

  function runImporter(mode: "--dry-run" | "--apply") {
    const result = spawnSync(
      process.execPath,
      [
        join(process.cwd(), "node_modules/ts-node/dist/bin.js"),
        "--project",
        "tsconfig.json",
        "scripts/import-legacy-services.ts",
        mode,
      ],
      {
        cwd: process.cwd(),
        env: process.env,
        encoding: "utf8",
        timeout: 60_000,
        windowsHide: true,
      },
    );
    if (result.pid) IMPORTER_STARTED_PIDS.push(result.pid);
    if (result.error) throw result.error;
    return result;
  }

  function runImporterAsync(
    mode: "--dry-run" | "--apply",
  ): Promise<{ code: number | null; output: string }> {
    return new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(
        process.execPath,
        [
          join(process.cwd(), "node_modules/ts-node/dist/bin.js"),
          "--project",
          "tsconfig.json",
          "scripts/import-legacy-services.ts",
          mode,
        ],
        { cwd: process.cwd(), env: process.env, windowsHide: true },
      );
      if (child.pid) {
        IMPORTER_PIDS.add(child.pid);
        IMPORTER_STARTED_PIDS.push(child.pid);
      }
      let output = "";
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
        output += chunk;
      });
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
        output += chunk;
      });
      const timeout = setTimeout(() => child.kill(), 60_000);
      child.on("error", rejectPromise);
      child.on("close", (code) => {
        clearTimeout(timeout);
        if (child.pid) IMPORTER_PIDS.delete(child.pid);
        resolvePromise({ code, output });
      });
    });
  }
});

async function login(
  email: string,
  inputPassword: string,
): Promise<{ accessToken: string }> {
  const response = await request(app.getHttpServer() as Server)
    .post("/api/admin/auth/login")
    .send({ email, password: inputPassword })
    .expect(200);
  return response.body as { accessToken: string };
}

function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
