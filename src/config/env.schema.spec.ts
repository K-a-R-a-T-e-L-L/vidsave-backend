import { validateEnvironment } from "./env.schema";

const valid = {
  NODE_ENV: "test",
  PORT: "3001",
  API_PREFIX: "api",
  FRONTEND_ORIGIN: "https://vidsave.karatell.ru",
  DATABASE_HOST: "localhost",
  DATABASE_PORT: "5432",
  DATABASE_USER: "test",
  DATABASE_PASSWORD: "",
  DATABASE_NAME: "test",
  DATABASE_SSL: "false",
  TRUST_PROXY_HOPS: "0",
  SWAGGER_ENABLED: "true",
  JWT_SECRET: "a-test-secret-that-is-definitely-longer-than-32-characters",
};

describe("environment validation", () => {
  it("validates proxy configuration without exposing credentials", () => {
    for (const value of [
      "",
      "http://user:pass@proxy.example:8888",
      "https://proxy.example:443",
    ])
      expect(
        validateEnvironment({ ...valid, TELEGRAM_PROXY_URL: value })
          .TELEGRAM_PROXY_URL,
      ).toBe(value);
    for (const value of [
      "socks5://proxy.example",
      "http://user:secret@proxy.example/path",
      "invalid",
    ])
      expect(() =>
        validateEnvironment({ ...valid, TELEGRAM_PROXY_URL: value }),
      ).toThrow("TELEGRAM_PROXY_URL: must be an HTTP(S) proxy URL");
  });
  it("coerces numeric and boolean environment values", () => {
    const config = validateEnvironment(valid);
    expect(config.PORT).toBe(3001);
    expect(config.DATABASE_SSL).toBe(false);
    expect(config.SWAGGER_ENABLED).toBe(true);
  });

  it.each([
    "https://example.test/path",
    "ftp://example.test",
    "https://u:p@example.test",
  ])("rejects a non-origin frontend URL: %s", (origin) => {
    expect(() =>
      validateEnvironment({ ...valid, FRONTEND_ORIGIN: origin }),
    ).toThrow(/FRONTEND_ORIGIN/);
  });

  it("rejects invalid ports and unsafe API prefixes", () => {
    expect(() =>
      validateEnvironment({ ...valid, DATABASE_PORT: "5432.5" }),
    ).toThrow(/DATABASE_PORT/);
    expect(() =>
      validateEnvironment({ ...valid, API_PREFIX: "../api" }),
    ).toThrow(/API_PREFIX/);
  });

  it("uses secure authentication defaults and parses the configured TTLs", () => {
    const config = validateEnvironment(valid);
    expect(config.JWT_ACCESS_EXPIRES).toBe("4m");
    expect(config.JWT_ACCESS_EXPIRES_SECONDS).toBe(240);
    expect(config.JWT_REFRESH_EXPIRES).toBe("1h");
    expect(config.JWT_REFRESH_EXPIRES_SECONDS).toBe(3600);
  });

  it.each(["0m", "-1h", "3", "1w", "1.5h", "01m", "2 M"])(
    "rejects an invalid JWT TTL: %s",
    (ttl) => {
      expect(() =>
        validateEnvironment({ ...valid, JWT_ACCESS_EXPIRES: ttl }),
      ).toThrow(/JWT_ACCESS_EXPIRES/);
    },
  );

  it("requires a strong JWT secret and refresh TTL longer than access TTL", () => {
    expect(() =>
      validateEnvironment({ ...valid, JWT_SECRET: "too-short" }),
    ).toThrow(/JWT_SECRET/);
    expect(() =>
      validateEnvironment({
        ...valid,
        JWT_ACCESS_EXPIRES: "2h",
        JWT_REFRESH_EXPIRES: "1h",
      }),
    ).toThrow(/JWT_REFRESH_EXPIRES/);
  });
});

describe("S3 deployment configuration", () => {
  it("requires a complete explicit S3 endpoint and credentials when enabling a bucket", () => {
    const s3 = {
      MEDIA_S3_BUCKET: "private-media",
      MEDIA_S3_ENDPOINT: "https://s3.example.test",
      MEDIA_S3_REGION: "default",
      MEDIA_S3_FORCE_PATH_STYLE: "true",
      MEDIA_S3_ACCESS_KEY_ID: "fixture",
      MEDIA_S3_SECRET_ACCESS_KEY: "fixture-secret",
    };
    expect(
      validateEnvironment({ ...valid, ...s3 }).MEDIA_S3_FORCE_PATH_STYLE,
    ).toBe(true);
    for (const key of [
      "MEDIA_S3_ENDPOINT",
      "MEDIA_S3_ACCESS_KEY_ID",
      "MEDIA_S3_SECRET_ACCESS_KEY",
    ])
      expect(() =>
        validateEnvironment({ ...valid, ...s3, [key]: undefined }),
      ).toThrow(key);
    expect(() => validateEnvironment(valid)).not.toThrow();
  });
});
