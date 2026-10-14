import { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { Server } from "node:http";
import { join } from "node:path";
import request from "supertest";
import { DataSource } from "typeorm";
import { configureApplication } from "../src/configure-application";
import { AppEnvironment, validateEnvironment } from "../src/config/env.schema";
import { AdminAuthRateLimit } from "../src/modules/admin-auth/entities/admin-auth-rate-limit.entity";
import { AdminSession } from "../src/modules/admin-auth/entities/admin-session.entity";
import {
  AdminRole,
  AdminUser,
} from "../src/modules/admin-auth/entities/admin-user.entity";
import { hashAdminPassword } from "../src/modules/admin-auth/services/admin-password.service";

interface AuthResponse {
  user: { id: string; email: string; role: AdminRole };
  accessToken: string;
  refreshToken: string;
  accessExpiresIn: number;
  refreshExpiresIn: number;
}

const backendRoot = process.cwd();
const enabled = process.env.VIDSAVE_AUTH_TEST_DATABASE === "1";
const authDescribe = enabled ? describe : describe.skip;
const PASSWORD = "admin-password-for-tests-12";
const email = " Owner@Example.COM ";
const CHILD_PIDS: number[] = [];
const CHILD_PORTS: number[] = [];

let app: INestApplication;
let dataSource: DataSource;
let environment: AppEnvironment;

authDescribe("PostgreSQL-backed administrator authentication", () => {
  beforeAll(async () => {
    for (const key of [
      "VIDSAVE_AUTH_TEST_DB_HOST",
      "VIDSAVE_AUTH_TEST_DB_PORT",
      "VIDSAVE_AUTH_TEST_DB_USER",
      "VIDSAVE_AUTH_TEST_DB_PASSWORD",
      "VIDSAVE_AUTH_TEST_DB_NAME",
    ]) {
      if (!process.env[key])
        throw new Error(`Missing isolated test setting: ${key}`);
    }
    Object.assign(process.env, {
      NODE_ENV: "test",
      PORT: "3001",
      API_PREFIX: "api",
      FRONTEND_ORIGIN: "http://localhost:3000",
      DATABASE_HOST: process.env.VIDSAVE_AUTH_TEST_DB_HOST,
      DATABASE_PORT: process.env.VIDSAVE_AUTH_TEST_DB_PORT,
      DATABASE_USER: process.env.VIDSAVE_AUTH_TEST_DB_USER,
      DATABASE_PASSWORD: process.env.VIDSAVE_AUTH_TEST_DB_PASSWORD,
      DATABASE_NAME: process.env.VIDSAVE_AUTH_TEST_DB_NAME,
      DATABASE_SSL: "false",
      TRUST_PROXY_HOPS: "1",
      SWAGGER_ENABLED: "false",
      JWT_SECRET: randomBytes(48).toString("base64url"),
      JWT_ACCESS_EXPIRES: "4m",
      JWT_REFRESH_EXPIRES: "1h",
    });
    await openApplication();
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
    if (CHILD_PIDS.length) {
      process.stdout.write(
        `Task-owned child processes exited: ${CHILD_PIDS.join(", ")}\n`,
      );
    }
    if (CHILD_PORTS.length) {
      process.stdout.write(
        `Backend child ports released: ${CHILD_PORTS.join(", ")}\n`,
      );
    }
  });

  beforeEach(async () => {
    await dataSource.query(
      "TRUNCATE TABLE admin_sessions, admin_auth_rate_limits, admin_users CASCADE",
    );
  });

  it("creates the first administrator through the explicit CLI and is idempotent", async () => {
    const bootstrapEmail = "Bootstrap@Example.com";
    const bootstrapPassword = "first-admin-password-12";
    const [first, concurrent] = await Promise.all([
      runBootstrap(bootstrapEmail, bootstrapPassword),
      runBootstrap(bootstrapEmail, "parallel-bootstrap-password-12"),
    ]);
    expect(first.code).toBe(0);
    expect(first.output).not.toContain(bootstrapPassword);
    expect(concurrent.code).toBe(0);
    expect([first.output, concurrent.output].join(" ")).toContain(
      "First administrator created",
    );
    expect([first.output, concurrent.output].join(" ")).toContain(
      "already exists",
    );

    const user = await dataSource
      .getRepository(AdminUser)
      .createQueryBuilder("adminUser")
      .addSelect("adminUser.passwordHash")
      .where("adminUser.email = :email", { email: "bootstrap@example.com" })
      .getOneOrFail();
    const savedHash = user.passwordHash;
    const repeated = await runBootstrap(bootstrapEmail, "another-password-14");
    expect(repeated.code).toBe(0);
    expect(repeated.output).toContain("already exists");
    expect(await dataSource.getRepository(AdminUser).count()).toBe(1);
    const unchanged = await dataSource.getRepository(AdminUser).findOne({
      where: { id: user.id },
      select: { id: true, passwordHash: true },
    });
    expect(unchanged?.passwordHash).toBe(savedHash);
  }, 60_000);

  it("loads bootstrap settings from dotenv through the real npm command", async () => {
    const bootstrapEmail = "dotenv-bootstrap@example.com";
    const bootstrapPassword = "dotenv-only-admin-password-22";
    const testDirectory = await mkdtemp(join(tmpdir(), "vidsave-bootstrap-"));
    const dotenvPath = join(testDirectory, ".env");
    const dotenvContent = [
      "NODE_ENV=test",
      "PORT=3001",
      "API_PREFIX=api",
      "FRONTEND_ORIGIN=http://localhost:3000",
      `DATABASE_HOST=${process.env.VIDSAVE_AUTH_TEST_DB_HOST}`,
      `DATABASE_PORT=${process.env.VIDSAVE_AUTH_TEST_DB_PORT}`,
      `DATABASE_USER=${process.env.VIDSAVE_AUTH_TEST_DB_USER}`,
      `DATABASE_PASSWORD=${process.env.VIDSAVE_AUTH_TEST_DB_PASSWORD}`,
      `DATABASE_NAME=${process.env.VIDSAVE_AUTH_TEST_DB_NAME}`,
      "DATABASE_SSL=false",
      "TRUST_PROXY_HOPS=1",
      "SWAGGER_ENABLED=false",
      `JWT_SECRET=${randomBytes(48).toString("base64url")}`,
      "JWT_ACCESS_EXPIRES=4m",
      "JWT_REFRESH_EXPIRES=1h",
      `BOOTSTRAP_ADMIN_EMAIL=${bootstrapEmail}`,
      `BOOTSTRAP_ADMIN_PASSWORD=${bootstrapPassword}`,
      "BOOTSTRAP_ADMIN_CONFIRM=CREATE_FIRST_ADMIN",
      "",
    ].join("\n");

    try {
      await writeFile(dotenvPath, dotenvContent, { encoding: "utf8" });
      const first = await runNpmBootstrap(dotenvPath);
      expect(first.code).toBe(0);
      expect(first.output).toContain("First administrator created");
      expect(first.output).not.toContain(bootstrapPassword);

      const user = await dataSource
        .getRepository(AdminUser)
        .createQueryBuilder("adminUser")
        .addSelect("adminUser.passwordHash")
        .where("adminUser.email = :email", { email: bootstrapEmail })
        .getOneOrFail();
      const savedHash = user.passwordHash;
      await login(bootstrapEmail, bootstrapPassword).expect(200);

      const repeated = await runNpmBootstrap(dotenvPath);
      expect(repeated.code).toBe(0);
      expect(repeated.output).toContain("already exists");
      expect(repeated.output).not.toContain(bootstrapPassword);
      expect(await dataSource.getRepository(AdminUser).count()).toBe(1);
      const unchanged = await dataSource.getRepository(AdminUser).findOne({
        where: { id: user.id },
        select: { id: true, passwordHash: true },
      });
      expect(unchanged?.passwordHash).toBe(savedHash);
    } finally {
      await rm(testDirectory, { recursive: true, force: true });
    }
  }, 240_000);

  it("normalizes email and stores only a bcrypt hash", async () => {
    const user = await createAdmin(email);
    expect(user.email).toBe("owner@example.com");
    expect(user.passwordHash).not.toBe(PASSWORD);
    expect(user.passwordHash).toMatch(/^\$2[aby]\$12\$/);
  });

  it("returns a signed four-minute access token and one-hour hashed refresh token", async () => {
    await createAdmin(email);
    const httpResponse = await login(email, PASSWORD).expect(200);
    const response = authResponse(httpResponse);
    expect(httpResponse.headers["cache-control"]).toBe("no-store");
    expect(response).toMatchObject({
      user: { email: "owner@example.com", role: "ADMIN" },
      accessExpiresIn: 240,
      refreshExpiresIn: 3600,
    });
    const jwt = app.get(JwtService);
    const claims = await jwt.verifyAsync<Record<string, unknown>>(
      response.accessToken,
      {
        algorithms: ["HS256"],
      },
    );
    expect(claims.sub).toBe(response.user.id);
    expect(typeof claims.sid).toBe("string");
    expect(typeof claims.jti).toBe("string");
    expect(typeof claims.iat).toBe("number");
    expect(claims.exp).toBe(Number(claims.iat) + 240);
    const sessions = await dataSource.getRepository(AdminSession).find({
      relations: { user: true },
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].refreshTokenHash).toBe(
      createHash("sha256").update(response.refreshToken).digest("hex"),
    );
    expect(sessions[0].refreshTokenHash).not.toBe(response.refreshToken);
    expect(
      Math.round((sessions[0].refreshExpiresAt.getTime() - Date.now()) / 1_000),
    ).toBeGreaterThanOrEqual(3590);
  });

  it("returns the same 401 body for an unknown account and a wrong password", async () => {
    await createAdmin(email);
    const wrongPassword = await login(
      "owner@example.com",
      "wrong-password-value",
    ).expect(401);
    const unknownEmail = await login(
      "missing@example.com",
      "wrong-password-value",
    ).expect(401);
    expect(unknownEmail.body).toEqual(wrongPassword.body);
    expect(unknownEmail.headers["cache-control"]).toBe("no-store");
  });

  it("marks unauthorized admin responses as non-cacheable", async () => {
    const response = await request(app.getHttpServer() as Server)
      .get("/api/admin/auth/me")
      .expect(401);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("rotates both tokens with sliding expiry and rejects replay and the previous access token", async () => {
    await createAdmin(email);
    const initial = authResponse(await login(email, PASSWORD).expect(200));
    const original = await dataSource
      .getRepository(AdminSession)
      .findOneByOrFail({
        refreshTokenHash: createHash("sha256")
          .update(initial.refreshToken)
          .digest("hex"),
      });
    const rotated = await request(app.getHttpServer() as Server)
      .post("/api/admin/auth/refresh")
      .send({ refreshToken: initial.refreshToken })
      .expect(200);
    const rotatedPair = authResponse(rotated);
    expect(rotatedPair.accessToken).not.toBe(initial.accessToken);
    expect(rotatedPair.refreshToken).not.toBe(initial.refreshToken);
    const current = await dataSource
      .getRepository(AdminSession)
      .findOneByOrFail({ id: original.id });
    expect(current.refreshTokenHash).toBe(
      createHash("sha256").update(rotatedPair.refreshToken).digest("hex"),
    );
    expect(current.accessJti).not.toBe(original.accessJti);
    expect(current.refreshExpiresAt.getTime()).toBeGreaterThan(
      original.refreshExpiresAt.getTime(),
    );
    await request(app.getHttpServer() as Server)
      .post("/api/admin/auth/refresh")
      .send({ refreshToken: initial.refreshToken })
      .expect(401);
    await request(app.getHttpServer() as Server)
      .get("/api/admin/auth/me")
      .set("Authorization", `Bearer ${initial.accessToken}`)
      .expect(401);
    await request(app.getHttpServer() as Server)
      .get("/api/admin/auth/me")
      .set("Authorization", `Bearer ${rotatedPair.accessToken}`)
      .expect(200);
  });

  it("allows exactly one concurrent refresh and creates no second session", async () => {
    await createAdmin(email);
    const initial = authResponse(await login(email, PASSWORD).expect(200));
    const attempts = await Promise.all([
      request(app.getHttpServer() as Server)
        .post("/api/admin/auth/refresh")
        .send({ refreshToken: initial.refreshToken }),
      request(app.getHttpServer() as Server)
        .post("/api/admin/auth/refresh")
        .send({ refreshToken: initial.refreshToken }),
    ]);
    expect(attempts.map((result) => result.status).sort()).toEqual([200, 401]);
    expect(await dataSource.getRepository(AdminSession).count()).toBe(1);
  });

  it("rejects forged and database-expired access tokens", async () => {
    await createAdmin(email);
    const pair = authResponse(await login(email, PASSWORD).expect(200));
    const session = await dataSource
      .getRepository(AdminSession)
      .findOneByOrFail({
        refreshTokenHash: createHash("sha256")
          .update(pair.refreshToken)
          .digest("hex"),
      });
    const expired = await app
      .get(JwtService)
      .signAsync(
        { sub: pair.user.id, sid: session.id, jti: session.accessJti },
        { algorithm: "HS256", expiresIn: -1 },
      );
    await request(app.getHttpServer() as Server)
      .get("/api/admin/auth/me")
      .set("Authorization", `Bearer ${expired}`)
      .expect(401);
    const forged = await app.get(JwtService).signAsync(
      {
        sub: pair.user.id,
        sid: "b69e4af3-0871-40d3-9645-237712f52b37",
        jti: "b69e4af3-0871-40d3-9645-237712f52b37",
      },
      {
        secret: "not-the-configured-secret",
        algorithm: "HS256",
        expiresIn: 240,
      },
    );
    await request(app.getHttpServer() as Server)
      .get("/api/admin/auth/me")
      .set("Authorization", `Bearer ${forged}`)
      .expect(401);
    await dataSource
      .getRepository(AdminSession)
      .update(
        { id: session.id },
        { accessExpiresAt: new Date(Date.now() - 1_000) },
      );
    await request(app.getHttpServer() as Server)
      .get("/api/admin/auth/me")
      .set("Authorization", `Bearer ${pair.accessToken}`)
      .expect(401);
  });

  it("rejects an expired refresh token and an inactive administrator", async () => {
    const user = await createAdmin(email);
    const pair = authResponse(await login(email, PASSWORD).expect(200));
    const session = await dataSource
      .getRepository(AdminSession)
      .findOneByOrFail({
        refreshTokenHash: createHash("sha256")
          .update(pair.refreshToken)
          .digest("hex"),
      });
    await dataSource
      .getRepository(AdminSession)
      .update(
        { id: session.id },
        { refreshExpiresAt: new Date(Date.now() - 1_000) },
      );
    await request(app.getHttpServer() as Server)
      .post("/api/admin/auth/refresh")
      .send({ refreshToken: pair.refreshToken })
      .expect(401);
    await dataSource
      .getRepository(AdminSession)
      .update(
        { id: session.id },
        { refreshExpiresAt: new Date(Date.now() + 60_000) },
      );
    await dataSource
      .getRepository(AdminUser)
      .update({ id: user.id }, { isActive: false });
    await request(app.getHttpServer() as Server)
      .post("/api/admin/auth/refresh")
      .send({ refreshToken: pair.refreshToken })
      .expect(401);
    await request(app.getHttpServer() as Server)
      .get("/api/admin/auth/me")
      .set("Authorization", `Bearer ${pair.accessToken}`)
      .expect(401);
  });

  it("revokes access and refresh with an idempotent logout", async () => {
    await createAdmin(email);
    const pair = authResponse(await login(email, PASSWORD).expect(200));
    await request(app.getHttpServer() as Server)
      .post("/api/admin/auth/logout")
      .send({ refreshToken: pair.refreshToken })
      .expect(204);
    await request(app.getHttpServer() as Server)
      .post("/api/admin/auth/logout")
      .send({ refreshToken: pair.refreshToken })
      .expect(204);
    await request(app.getHttpServer() as Server)
      .post("/api/admin/auth/refresh")
      .send({ refreshToken: pair.refreshToken })
      .expect(401);
    await request(app.getHttpServer() as Server)
      .get("/api/admin/auth/me")
      .set("Authorization", `Bearer ${pair.accessToken}`)
      .expect(401);
  });

  it("persists valid sessions across a backend process restart", async () => {
    await createAdmin(email);
    const pair = authResponse(await login(email, PASSWORD).expect(200));
    await app.close();
    const port = await findAvailablePort();
    CHILD_PORTS.push(port);
    const child = spawn(
      process.execPath,
      [
        "-r",
        join(backendRoot, "node_modules", "ts-node", "register", "index.js"),
        "src/main.ts",
      ],
      {
        cwd: backendRoot,
        env: { ...process.env, PORT: String(port) },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    if (child.pid) CHILD_PIDS.push(child.pid);
    let output = "";
    child.stdout
      .setEncoding("utf8")
      .on("data", (chunk: string) => (output += chunk));
    child.stderr
      .setEncoding("utf8")
      .on("data", (chunk: string) => (output += chunk));
    const closed = new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve) =>
      child.once("close", (code, signal) => resolve({ code, signal })),
    );
    let cleanupError: Error | undefined;
    try {
      let ready = false;
      for (let attempt = 0; attempt < 160; attempt++) {
        if (child.exitCode !== null) break;
        try {
          const health = await getJson(
            `http://127.0.0.1:${port}/api/health/ready`,
          );
          if (health.status === 200) {
            ready = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      if (!ready)
        throw new Error(`Backend process did not become ready: ${output}`);
      const current = await getJson(
        `http://127.0.0.1:${port}/api/admin/auth/me`,
        { Authorization: `Bearer ${pair.accessToken}` },
      );
      expect(current.status).toBe(200);
      expect(current.body).toMatchObject({
        email: "owner@example.com",
      });
    } finally {
      if (child.exitCode === null) child.kill("SIGTERM");
      let stopTimer: NodeJS.Timeout | undefined;
      const stopped = await Promise.race([
        closed,
        new Promise<null>((resolve) => {
          stopTimer = setTimeout(() => resolve(null), 10_000);
        }),
      ]);
      if (stopTimer) clearTimeout(stopTimer);
      if (stopped === null) {
        if (child.pid && child.exitCode === null) child.kill("SIGKILL");
        cleanupError = new Error(
          `Backend child PID ${child.pid ?? "unknown"} did not stop`,
        );
      } else if (stopped.code !== 0 && stopped.signal !== "SIGTERM") {
        cleanupError = new Error(
          `Backend child exited unexpectedly (code ${stopped.code})`,
        );
      }
      await openApplication();
    }
    if (cleanupError) throw cleanupError;
  }, 60_000);

  it("restricts admin management to ADMIN and returns safe fields", async () => {
    await createAdmin(email);
    const adminPair = authResponse(await login(email, PASSWORD).expect(200));
    const created = await request(app.getHttpServer() as Server)
      .post("/api/admin/admins")
      .set("Authorization", `Bearer ${adminPair.accessToken}`)
      .send({
        email: "second-admin@example.com",
        password: "second-admin-password-12",
      })
      .expect(201);
    expect(created.body).toMatchObject({
      email: "second-admin@example.com",
      role: "ADMIN",
    });
    expect(created.body).not.toHaveProperty("passwordHash");
    expect(created.body).not.toHaveProperty("refreshToken");
    await request(app.getHttpServer() as Server)
      .post("/api/admin/admins")
      .set("Authorization", `Bearer ${adminPair.accessToken}`)
      .send({
        email: "SECOND-ADMIN@example.com",
        password: "another-admin-password-12",
      })
      .expect(409);
    expect(
      JSON.stringify(
        (
          await request(app.getHttpServer() as Server)
            .get("/api/admin/admins")
            .set("Authorization", `Bearer ${adminPair.accessToken}`)
            .expect(200)
        ).body,
      ),
    ).not.toContain("passwordHash");

    const user = dataSource.getRepository(AdminUser).create({
      email: "regular-user@example.com",
      passwordHash: await hashAdminPassword("regular-user-password-12"),
      role: AdminRole.USER,
      isActive: true,
    });
    await dataSource.getRepository(AdminUser).save(user);
    const listed = await request(app.getHttpServer() as Server)
      .get("/api/admin/admins")
      .set("Authorization", `Bearer ${adminPair.accessToken}`)
      .expect(200);
    expect(listed.body).toHaveLength(2);
    expect(JSON.stringify(listed.body)).not.toContain(
      "regular-user@example.com",
    );
    const userPair = authResponse(
      await login(user.email, "regular-user-password-12").expect(200),
    );
    await request(app.getHttpServer() as Server)
      .get("/api/admin/admins")
      .set("Authorization", `Bearer ${userPair.accessToken}`)
      .expect(403);
  });

  it("rate-limits failures by IP and normalized identity, including concurrent requests", async () => {
    await createAdmin("existing@example.com");
    const sameIp = await Promise.all(
      ["one@example.com", "two@example.com", "three@example.com"].map((value) =>
        login(value, "wrong-password-value").set(
          "X-Forwarded-For",
          "198.51.100.20",
        ),
      ),
    );
    expect(sameIp.map((result) => result.status)).toEqual([401, 401, 401]);
    const ipBlocked = await login(
      "four@example.com",
      "wrong-password-value",
    ).set("X-Forwarded-For", "198.51.100.20");
    expect(ipBlocked.status).toBe(429);
    expect(Number(ipBlocked.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    expect(Number(ipBlocked.headers["retry-after"])).toBeLessThanOrEqual(60);

    await dataSource.getRepository(AdminAuthRateLimit).clear();
    const sameIdentity = await Promise.all(
      ["198.51.100.31", "198.51.100.32", "198.51.100.33"].map((address) =>
        login("same-identity@example.com", "wrong-password-value").set(
          "X-Forwarded-For",
          address,
        ),
      ),
    );
    expect(sameIdentity.map((result) => result.status)).toEqual([
      401, 401, 401,
    ]);
    const identityBlocked = await login(
      "SAME-IDENTITY@example.com",
      "wrong-password-value",
    ).set("X-Forwarded-For", "198.51.100.34");
    expect(identityBlocked.status).toBe(429);
    expect(
      Number(identityBlocked.headers["retry-after"]),
    ).toBeGreaterThanOrEqual(1);
    expect(Number(identityBlocked.headers["retry-after"])).toBeLessThanOrEqual(
      60,
    );

    await dataSource.getRepository(AdminAuthRateLimit).clear();
    const concurrent = await Promise.all(
      Array.from({ length: 8 }, () =>
        login("parallel@example.com", "wrong-password-value"),
      ),
    );
    expect(concurrent.filter((result) => result.status === 401)).toHaveLength(
      3,
    );
    expect(concurrent.filter((result) => result.status === 429)).toHaveLength(
      5,
    );
  }, 60_000);

  it("rejects malformed login data before issuing tokens", async () => {
    await request(app.getHttpServer() as Server)
      .post("/api/admin/auth/login")
      .send({ email: "not-an-email", password: "short" })
      .expect(401);
    expect(environment.NODE_ENV).toBe("test");
  });

  it("does not expose a public registration route", async () => {
    await request(app.getHttpServer() as Server)
      .post("/api/admin/auth/register")
      .send({ email: "public@example.com", password: "public-password-12" })
      .expect(404);
    expect(await dataSource.getRepository(AdminUser).count()).toBe(0);
  });
});

async function openApplication(): Promise<void> {
  const { AppModule } = await import("../src/app.module");
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = moduleRef.createNestApplication({ bodyParser: false });
  const config = app.get(ConfigService<AppEnvironment>);
  environment = validateEnvironment(process.env);
  configureApplication(app, {
    NODE_ENV: config.getOrThrow("NODE_ENV", { infer: true }),
    API_PREFIX: config.getOrThrow("API_PREFIX", { infer: true }),
    FRONTEND_ORIGIN: config.getOrThrow("FRONTEND_ORIGIN", { infer: true }),
    TRUST_PROXY_HOPS: config.getOrThrow("TRUST_PROXY_HOPS", { infer: true }),
    SWAGGER_ENABLED: config.getOrThrow("SWAGGER_ENABLED", { infer: true }),
  });
  await app.init();
  dataSource = app.get(DataSource);
}

function login(emailValue: string, password: string) {
  return request(app.getHttpServer() as Server)
    .post("/api/admin/auth/login")
    .send({ email: emailValue, password });
}

function authResponse(response: { body: unknown }): AuthResponse {
  return response.body as AuthResponse;
}

async function findAvailablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not reserve a temporary backend port");
  }
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

function getJson(
  url: string,
  headers?: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  const parsed = new URL(url);
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      {
        hostname: parsed.hostname,
        port: Number(parsed.port),
        path: parsed.pathname + parsed.search,
        method: "GET",
        headers,
        agent: false,
      },
      (incoming) => {
        let responseText = "";
        incoming.setEncoding("utf8");
        incoming.on("data", (chunk: string) => (responseText += chunk));
        incoming.once("end", () => {
          let body: unknown = responseText;
          try {
            body = JSON.parse(responseText) as unknown;
          } catch {
            // Keep non-JSON error responses as plain text for assertions.
          }
          resolve({ status: incoming.statusCode ?? 0, body });
        });
      },
    );
    outgoing.once("error", reject);
    outgoing.end();
  });
}

async function createAdmin(emailValue: string): Promise<AdminUser> {
  const repository = dataSource.getRepository(AdminUser);
  const user = repository.create({
    email: emailValue.trim().toLowerCase(),
    passwordHash: await hashAdminPassword(PASSWORD),
    role: AdminRole.ADMIN,
    isActive: true,
  });
  return repository.save(user);
}

function runBootstrap(
  emailValue: string,
  password: string,
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "-r",
        join(backendRoot, "node_modules", "ts-node", "register", "index.js"),
        "scripts/bootstrap-admin.ts",
      ],
      {
        cwd: backendRoot,
        env: {
          ...process.env,
          BOOTSTRAP_ADMIN_EMAIL: emailValue,
          BOOTSTRAP_ADMIN_PASSWORD: password,
          BOOTSTRAP_ADMIN_CONFIRM: "CREATE_FIRST_ADMIN",
        },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    if (child.pid) CHILD_PIDS.push(child.pid);
    let output = "";
    const timeout = setTimeout(() => {
      if (child.pid && child.exitCode === null) child.kill();
      reject(new Error("Bootstrap CLI timed out"));
    }, 45_000);
    child.stdout
      .setEncoding("utf8")
      .on("data", (chunk: string) => (output += chunk));
    child.stderr
      .setEncoding("utf8")
      .on("data", (chunk: string) => (output += chunk));
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, output });
    });
  });
}

function runNpmBootstrap(
  dotenvPath: string,
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const npmCli = process.env.npm_execpath;
    if (!npmCli) {
      reject(new Error("npm_execpath is required for the npm bootstrap test"));
      return;
    }

    const childEnvironment: NodeJS.ProcessEnv = {
      ...process.env,
      DOTENV_CONFIG_PATH: dotenvPath,
    };
    for (const key of [
      "BOOTSTRAP_ADMIN_EMAIL",
      "BOOTSTRAP_ADMIN_PASSWORD",
      "BOOTSTRAP_ADMIN_CONFIRM",
      "DATABASE_HOST",
      "DATABASE_PORT",
      "DATABASE_USER",
      "DATABASE_PASSWORD",
      "DATABASE_NAME",
      "DATABASE_SSL",
      "FRONTEND_ORIGIN",
      "JWT_SECRET",
      "JWT_ACCESS_EXPIRES",
      "JWT_REFRESH_EXPIRES",
      "PORT",
      "API_PREFIX",
      "TRUST_PROXY_HOPS",
      "SWAGGER_ENABLED",
    ]) {
      delete childEnvironment[key];
    }

    const child = spawn(process.execPath, [npmCli, "run", "admin:bootstrap"], {
      cwd: backendRoot,
      env: childEnvironment,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (child.pid) CHILD_PIDS.push(child.pid);
    let output = "";
    const timeout = setTimeout(() => {
      if (child.pid && child.exitCode === null) child.kill();
      reject(new Error("Real npm bootstrap command timed out"));
    }, 210_000);
    child.stdout
      .setEncoding("utf8")
      .on("data", (chunk: string) => (output += chunk));
    child.stderr
      .setEncoding("utf8")
      .on("data", (chunk: string) => (output += chunk));
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, output });
    });
  });
}
