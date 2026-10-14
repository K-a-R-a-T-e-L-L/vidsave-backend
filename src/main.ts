import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configureApplication } from "./configure-application";
import { AppEnvironment } from "./config/env.schema";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const config = app.get(ConfigService<AppEnvironment>);
  configureApplication(app, {
    NODE_ENV: config.getOrThrow("NODE_ENV", { infer: true }),
    API_PREFIX: config.getOrThrow("API_PREFIX", { infer: true }),
    FRONTEND_ORIGIN: config.getOrThrow("FRONTEND_ORIGIN", { infer: true }),
    TRUST_PROXY_HOPS: config.getOrThrow("TRUST_PROXY_HOPS", { infer: true }),
    SWAGGER_ENABLED: config.getOrThrow("SWAGGER_ENABLED", { infer: true }),
  });
  app.enableShutdownHooks();
  await app.listen(config.getOrThrow("PORT", { infer: true }), "0.0.0.0");
}

void bootstrap().catch((error: unknown) => {
  const logger = new Logger("Bootstrap");
  logger.error(
    error instanceof Error ? error.message : "Unknown startup failure",
  );
  process.exitCode = 1;
});
