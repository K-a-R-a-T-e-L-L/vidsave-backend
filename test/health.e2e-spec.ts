import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Post,
} from "@nestjs/common";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { IsNotEmpty, IsString } from "class-validator";
import { DataSource } from "typeorm";
import { Server } from "node:http";
import request from "supertest";
import { configureApplication } from "../src/configure-application";
import { validateEnvironment } from "../src/config/env.schema";
import { HealthController } from "../src/modules/health/health.controller";
import { HealthService } from "../src/modules/health/health.service";

class TestPayload {
  @IsString()
  @IsNotEmpty()
  name!: string;
}

@Controller("testing")
class TestOnlyController {
  @Get("failure")
  fail(): never {
    throw new Error("driver leaked password=never-log-this");
  }

  @Get("http-failure")
  httpFailure(): never {
    throw new HttpException("Public failure", HttpStatus.CONFLICT);
  }

  @Post("body")
  acceptBody(@Body() body: unknown): unknown {
    return body;
  }

  @Post("dto")
  acceptDto(@Body() body: TestPayload): TestPayload {
    return body;
  }
}

const baseEnv = {
  NODE_ENV: "test",
  PORT: "3001",
  API_PREFIX: "api",
  FRONTEND_ORIGIN: "http://localhost:3000",
  DATABASE_HOST: "127.0.0.1",
  DATABASE_PORT: "5432",
  DATABASE_USER: "vidsave_test",
  DATABASE_PASSWORD: "test-only-password",
  DATABASE_NAME: "vidsave_test",
  DATABASE_SSL: "false",
  TRUST_PROXY_HOPS: "0",
  SWAGGER_ENABLED: "true",
  JWT_SECRET: "a-test-secret-that-is-definitely-longer-than-32-characters",
};

async function createTestApplication(
  query: jest.Mock<(sql: string) => Promise<unknown>>,
  overrides: Record<string, string> = {},
): Promise<INestApplication> {
  const config = validateEnvironment({ ...baseEnv, ...overrides });
  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController, TestOnlyController],
    providers: [HealthService, { provide: DataSource, useValue: { query } }],
  }).compile();
  const app = moduleRef.createNestApplication({ bodyParser: false });
  configureApplication(app, config);
  await app.init();
  return app;
}

describe("backend HTTP foundation", () => {
  let app: INestApplication;
  let query: jest.Mock<(sql: string) => Promise<unknown>>;

  beforeEach(async () => {
    query = jest
      .fn<(sql: string) => Promise<unknown>>()
      .mockResolvedValue([{ "?column?": 1 }]);
    app = await createTestApplication(query);
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns 200 for liveness without requiring a database query", async () => {
    await request(app.getHttpServer() as Server)
      .get("/api/health/live")
      .expect(200, { status: "ok" });
    expect(query).not.toHaveBeenCalled();
  });

  it("returns 200 readiness when SELECT 1 succeeds", async () => {
    await request(app.getHttpServer() as Server)
      .get("/api/health/ready")
      .expect(200, { status: "ready", database: "connected" });
    expect(query).toHaveBeenCalledWith("SELECT 1");
  });

  it("returns a safe 503 readiness response when the database query fails", async () => {
    query.mockRejectedValueOnce(
      new Error("postgres host and password details"),
    );
    await request(app.getHttpServer() as Server)
      .get("/api/health/ready")
      .expect(503, { status: "unavailable", database: "disconnected" });
  });
  it("returns 503 within the readiness deadline when the database query stalls", async () => {
    query.mockImplementationOnce(() => new Promise<unknown>(() => undefined));
    const started = Date.now();
    await request(app.getHttpServer() as Server)
      .get("/api/health/ready")
      .expect(503, { status: "unavailable", database: "disconnected" });
    expect(Date.now() - started).toBeLessThan(2_500);
  });

  it("uses a consistent 404 response for unknown routes", async () => {
    await request(app.getHttpServer() as Server)
      .get("/api/not-a-route")
      .expect(404)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          statusCode: 404,
          error: "Not Found",
          path: "/api/not-a-route",
        });
        expect(body.message).toEqual(expect.any(String));
      });
  });

  it("rejects invalid environment values without echoing secrets", () => {
    expect(() => validateEnvironment({ ...baseEnv, PORT: "70000" })).toThrow(
      /PORT/,
    );
    expect(() =>
      validateEnvironment({
        ...baseEnv,
        NODE_ENV: "production",
        DATABASE_PASSWORD: "",
      }),
    ).toThrow(/DATABASE_PASSWORD/);
  });

  it("serves Swagger UI in development when enabled", async () => {
    const response = await request(app.getHttpServer() as Server)
      .get("/api/docs")
      .expect(200);
    expect(response.text).toContain("Swagger UI");
  });

  it("documents the configured title, version, and implemented health routes", async () => {
    const response = await request(app.getHttpServer() as Server)
      .get("/api/docs-json")
      .expect(200);
    expect(response.body.info).toMatchObject({
      title: "VidSave API",
      version: "1.0.0",
    });
    expect(response.body.paths).toHaveProperty("/api/health/live");
    expect(response.body.paths).toHaveProperty("/api/health/ready");
  });
  it("does not mount Swagger in production even when enabled", async () => {
    const productionApp = await createTestApplication(query, {
      NODE_ENV: "production",
      SWAGGER_ENABLED: "true",
    });
    try {
      await request(productionApp.getHttpServer() as Server)
        .get("/api/docs")
        .expect(404);
    } finally {
      await productionApp.close();
    }
  });

  it("allows CORS only for the configured frontend origin", async () => {
    await request(app.getHttpServer() as Server)
      .get("/api/health/live")
      .set("Origin", "http://localhost:3000")
      .expect("Access-Control-Allow-Origin", "http://localhost:3000")
      .expect(200);
  });

  it("does not grant CORS access to another origin", async () => {
    const response = await request(app.getHttpServer() as Server)
      .get("/api/health/live")
      .set("Origin", "https://attacker.example")
      .expect(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
  it("answers an allowed CORS preflight without credentials", async () => {
    const response = await request(app.getHttpServer() as Server)
      .options("/api/health/live")
      .set("Origin", "http://localhost:3000")
      .set("Access-Control-Request-Method", "GET")
      .expect(204);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "http://localhost:3000",
    );
    expect(
      response.headers["access-control-allow-credentials"],
    ).toBeUndefined();
    expect(response.headers["access-control-allow-methods"]).toContain("GET");
  });

  it("limits Swagger CSP exceptions to the docs route", async () => {
    const docs = await request(app.getHttpServer() as Server)
      .get("/api/docs")
      .expect(200);
    const health = await request(app.getHttpServer() as Server)
      .get("/api/health/live")
      .expect(200);
    const healthScriptPolicy = health.headers["content-security-policy"]
      .split(";")
      .find((directive: string) => directive.trim().startsWith("script-src"));
    expect(docs.headers["content-security-policy"]).toContain(
      "'unsafe-inline'",
    );
    expect(healthScriptPolicy).not.toContain("'unsafe-inline'");
  });

  it("preserves the status and safe message of HTTP exceptions", async () => {
    await request(app.getHttpServer() as Server)
      .get("/api/testing/http-failure")
      .expect(409)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          statusCode: 409,
          error: "Conflict",
          message: "Public failure",
        });
      });
  });
  it("hides unexpected exception details from the HTTP response", async () => {
    const response = await request(app.getHttpServer() as Server)
      .get("/api/testing/failure")
      .expect(500);
    expect(JSON.stringify(response.body)).not.toContain("never-log-this");
    expect(response.body.message).toBe("Internal server error");
  });

  it("rejects request bodies larger than 64 KiB", async () => {
    await request(app.getHttpServer() as Server)
      .post("/api/testing/body")
      .set("Content-Type", "application/json")
      .send({ data: "x".repeat(65 * 1024) })
      .expect(413);
  });

  it("rejects unknown DTO fields through the global validation pipe", async () => {
    await request(app.getHttpServer() as Server)
      .post("/api/testing/dto")
      .send({ name: "valid", unexpected: true })
      .expect(400);
  });

  it("applies Helmet security headers", async () => {
    const response = await request(app.getHttpServer() as Server)
      .get("/api/health/live")
      .expect(200);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBeDefined();
  });
});
