import { ConfigService } from "@nestjs/config";
import { TypeOrmModuleOptions } from "@nestjs/typeorm";
import { AppEnvironment } from "./env.schema";

export function createDatabaseConfig(
  config: ConfigService<AppEnvironment>,
): TypeOrmModuleOptions {
  const ssl = config.getOrThrow("DATABASE_SSL", { infer: true });
  return {
    type: "postgres",
    host: config.getOrThrow("DATABASE_HOST", { infer: true }),
    port: config.getOrThrow("DATABASE_PORT", { infer: true }),
    username: config.getOrThrow("DATABASE_USER", { infer: true }),
    password: config.getOrThrow("DATABASE_PASSWORD", { infer: true }),
    database: config.getOrThrow("DATABASE_NAME", { infer: true }),
    ssl: ssl ? { rejectUnauthorized: true } : false,
    autoLoadEntities: true,
    synchronize: true,
    dropSchema: false,
    logging: false,
    retryAttempts: 5,
    retryDelay: 1_000,
    extra: {
      connectionTimeoutMillis: 3_000,
      query_timeout: 3_000,
      statement_timeout: 3_000,
    },
  };
}
