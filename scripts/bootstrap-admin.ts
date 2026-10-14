import "dotenv/config";
import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { isEmail } from "class-validator";
import { DataSource } from "typeorm";
import { AppModule } from "../src/app.module";
import { validateEnvironment } from "../src/config/env.schema";
import { AdminAuthService } from "../src/modules/admin-auth/services/admin-auth.service";
import { normalizeAdminEmail } from "../src/modules/admin-auth/entities/admin-user.entity";
import { isPasswordWithinPolicy } from "../src/modules/admin-auth/services/admin-password.service";

const logger = new Logger("AdminBootstrap");
const BOOTSTRAP_LOCK = "vidsave:bootstrap-first-admin";

type BootstrapPhase = "initialization" | "administrator storage";

class BootstrapDiagnosticError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BootstrapDiagnosticError";
  }
}

function findErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    const value = current as Error & {
      code?: unknown;
      driverError?: { code?: unknown };
      cause?: unknown;
    };
    for (const candidate of [value.code, value.driverError?.code]) {
      if (
        typeof candidate === "string" &&
        /^[A-Z0-9_]{2,32}$/.test(candidate)
      ) {
        return candidate;
      }
    }
    current = value.cause;
  }
  return undefined;
}

function describeUnexpectedError(error: unknown): string {
  const names: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    names.push(current.name || "Error");
    current = current.cause;
  }
  const chain = names.length ? names.join(" caused by ") : "Unknown error";
  const code = findErrorCode(error);
  return code ? `${chain} (code ${code})` : chain;
}

function diagnosticFor(error: unknown, phase: BootstrapPhase): string {
  if (error instanceof BootstrapDiagnosticError) return error.message;
  if (
    error instanceof Error &&
    error.message.startsWith("Invalid environment configuration:")
  ) {
    return error.message;
  }

  const code = findErrorCode(error);
  const connectionCodes = new Set([
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "ENOTFOUND",
    "EHOSTUNREACH",
    "28P01",
    "3D000",
  ]);
  if (code && connectionCodes.has(code)) {
    return `PostgreSQL connection failed (${code}). Check the configured local database and retry.`;
  }
  if (phase === "administrator storage") {
    return code
      ? `Administrator record could not be saved (database error ${code}).`
      : `Administrator storage failed (${describeUnexpectedError(error)}).`;
  }
  return `Backend initialization failed (${describeUnexpectedError(error)}).`;
}

async function main(): Promise<void> {
  let app:
    | Awaited<ReturnType<typeof NestFactory.createApplicationContext>>
    | undefined;
  let phase: BootstrapPhase = "initialization";
  try {
    const emailInput = process.env.BOOTSTRAP_ADMIN_EMAIL;
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
    if (process.env.BOOTSTRAP_ADMIN_CONFIRM !== "CREATE_FIRST_ADMIN") {
      throw new BootstrapDiagnosticError(
        "Missing confirmation: set BOOTSTRAP_ADMIN_CONFIRM=CREATE_FIRST_ADMIN to permit first-admin creation.",
      );
    }
    if (!emailInput || !password) {
      const missing = [
        !emailInput ? "BOOTSTRAP_ADMIN_EMAIL" : undefined,
        !password ? "BOOTSTRAP_ADMIN_PASSWORD" : undefined,
      ].filter(Boolean);
      throw new BootstrapDiagnosticError(
        `Bootstrap credentials are not loaded: ${missing.join(", ")}.`,
      );
    }
    const email = normalizeAdminEmail(emailInput);
    if (!isEmail(email)) {
      throw new BootstrapDiagnosticError(
        "BOOTSTRAP_ADMIN_EMAIL did not pass email validation.",
      );
    }
    if (!isPasswordWithinPolicy(password)) {
      throw new BootstrapDiagnosticError(
        "BOOTSTRAP_ADMIN_PASSWORD must contain at least 14 characters and no more than 72 UTF-8 bytes.",
      );
    }

    validateEnvironment(process.env);
    app = await NestFactory.createApplicationContext(AppModule, {
      logger: ["error", "warn"],
    });
    const dataSource = app.get(DataSource);
    const authService = app.get(AdminAuthService);
    phase = "administrator storage";
    const outcome = await dataSource.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        BOOTSTRAP_LOCK,
      ]);
      return authService.createFirstAdmin(manager, email, password);
    });

    process.stdout.write(
      outcome.created
        ? "First administrator created. Credentials were not displayed.\n"
        : "An administrator already exists. No changes were made.\n",
    );
  } catch (error) {
    logger.error(diagnosticFor(error, phase));
    process.exitCode = 1;
  } finally {
    if (app) {
      try {
        await app.close();
      } catch (error) {
        logger.error(
          `Backend shutdown failed (${describeUnexpectedError(error)}).`,
        );
        process.exitCode = 1;
      }
    }
  }
}

void main();
