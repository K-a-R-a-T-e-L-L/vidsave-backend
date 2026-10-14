import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac } from "node:crypto";
import { DataSource, EntityManager } from "typeorm";
import { AppEnvironment } from "../../../config/env.schema";
import { AdminAuthRateLimit } from "../entities/admin-auth-rate-limit.entity";

const WINDOW_MS = 60_000;
const MAX_FAILURES = 3;

export type LoginAttemptResult<T> =
  | { kind: "success"; value: T }
  | { kind: "failure" }
  | { kind: "limited"; retryAfterSeconds: number };

@Injectable()
export class AdminAuthRateLimitService {
  private readonly secret: string;

  constructor(
    private readonly dataSource: DataSource,
    config: ConfigService<AppEnvironment>,
  ) {
    this.secret = config.getOrThrow("JWT_SECRET", { infer: true });
  }

  async runLoginAttempt<T>(
    ipAddress: string,
    normalizedEmail: string,
    verify: (
      manager: EntityManager,
    ) => Promise<{ success: true; value: T } | { success: false }>,
  ): Promise<LoginAttemptResult<T>> {
    const hashes = [
      this.bucketHash("ip", ipAddress),
      this.bucketHash("email", normalizedEmail),
    ].sort();
    const now = new Date();

    return this.dataSource.transaction(async (manager) => {
      for (const hash of hashes) {
        await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          hash,
        ]);
      }

      const repository = manager.getRepository(AdminAuthRateLimit);
      const rows = await Promise.all(
        hashes.map((bucketHash) =>
          repository.findOne({ where: { bucketHash } }),
        ),
      );
      const retryAt = rows.reduce<Date | null>((latest, row) => {
        if (row?.blockedUntil && row.blockedUntil > now) {
          return !latest || row.blockedUntil > latest
            ? row.blockedUntil
            : latest;
        }
        return latest;
      }, null);

      if (retryAt) {
        return {
          kind: "limited",
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((retryAt.getTime() - now.getTime()) / 1_000),
          ),
        } as const;
      }

      const activeRows = rows.map((row, index) => {
        const current = row ?? repository.create({ bucketHash: hashes[index] });
        if (
          now.getTime() - (current.windowStartedAt?.getTime() ?? 0) >=
          WINDOW_MS
        ) {
          current.attemptCount = 0;
          current.windowStartedAt = now;
          current.blockedUntil = null;
        }
        return current;
      });

      if (activeRows.some((row) => row.attemptCount >= MAX_FAILURES)) {
        const retryAfterSeconds = Math.ceil(WINDOW_MS / 1_000);
        for (const row of activeRows) {
          row.blockedUntil = new Date(now.getTime() + WINDOW_MS);
          row.windowStartedAt ??= now;
        }
        await repository.save(activeRows);
        return { kind: "limited", retryAfterSeconds } as const;
      }

      const verification = await verify(manager);
      if (verification.success) {
        for (const row of activeRows) {
          row.attemptCount = 0;
          row.windowStartedAt = now;
          row.blockedUntil = null;
        }
        await repository.save(activeRows);
        return { kind: "success", value: verification.value } as const;
      }

      for (const row of activeRows) {
        row.attemptCount += 1;
        row.windowStartedAt ??= now;
        if (row.attemptCount >= MAX_FAILURES) {
          row.blockedUntil = new Date(now.getTime() + WINDOW_MS);
        }
      }
      await repository.save(activeRows);
      return { kind: "failure" } as const;
    });
  }

  private bucketHash(kind: "ip" | "email", value: string): string {
    return createHmac("sha256", this.secret)
      .update(`${kind}:${value}`)
      .digest("hex");
  }
}
