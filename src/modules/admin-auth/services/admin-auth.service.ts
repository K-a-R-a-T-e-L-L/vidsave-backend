import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DataSource, EntityManager, IsNull, QueryFailedError } from "typeorm";
import { AppEnvironment } from "../../../config/env.schema";
import { AdminTokenPair, SafeAdminUser } from "../dto/admin-auth.dto";
import { AdminSession } from "../entities/admin-session.entity";
import {
  AdminRole,
  AdminUser,
  normalizeAdminEmail,
} from "../entities/admin-user.entity";
import { AdminAuthRateLimitService } from "./admin-auth-rate-limit.service";
import {
  AdminPasswordService,
  hashAdminPassword,
  isPasswordWithinPolicy,
} from "./admin-password.service";
import { RateLimitExceededException } from "../../../common/exceptions/rate-limit-exceeded.exception";

interface AccessClaims {
  sub: string;
  sid: string;
  jti: string;
  iat: number;
}

@Injectable()
export class AdminAuthService {
  private readonly accessTtlSeconds: number;
  private readonly refreshTtlSeconds: number;

  constructor(
    private readonly dataSource: DataSource,
    private readonly jwtService: JwtService,
    private readonly rateLimit: AdminAuthRateLimitService,
    private readonly passwordService: AdminPasswordService,
    config: ConfigService<AppEnvironment>,
  ) {
    this.accessTtlSeconds = config.getOrThrow("JWT_ACCESS_EXPIRES_SECONDS", {
      infer: true,
    });
    this.refreshTtlSeconds = config.getOrThrow("JWT_REFRESH_EXPIRES_SECONDS", {
      infer: true,
    });
  }

  async login(
    emailInput: string,
    password: string,
    ipAddress: string,
  ): Promise<AdminTokenPair> {
    const email = normalizeAdminEmail(emailInput);
    const result = await this.rateLimit.runLoginAttempt(
      ipAddress,
      email,
      async (manager) => {
        const user = await manager
          .getRepository(AdminUser)
          .createQueryBuilder("adminUser")
          .addSelect("adminUser.passwordHash")
          .where("adminUser.email = :email", { email })
          .getOne();
        const correctPassword = await this.passwordService.verify(
          password,
          user?.passwordHash,
        );
        if (!user || !user.isActive || !correctPassword)
          return { success: false };

        const pair = await this.createSession(manager, user);
        return { success: true, value: pair };
      },
    );

    if (result.kind === "limited") {
      throw new RateLimitExceededException(result.retryAfterSeconds);
    }
    if (result.kind === "success" && result.value) return result.value;
    throw new UnauthorizedException("Invalid email or password");
  }

  async refresh(refreshToken: string): Promise<AdminTokenPair> {
    const oldHash = this.hashRefreshToken(refreshToken);
    const result = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(AdminSession);
      const session = await repository.findOne({
        where: { refreshTokenHash: oldHash },
        relations: { user: true },
      });
      const now = new Date();
      if (
        !session ||
        session.revokedAt ||
        session.refreshExpiresAt <= now ||
        !session.user.isActive
      ) {
        return null;
      }

      const pair = await this.createRotatedPair(session);
      const refreshExpiresAt = new Date(
        now.getTime() + this.refreshTtlSeconds * 1_000,
      );
      const update: unknown = await manager.query(
        `UPDATE admin_sessions
         SET "refreshTokenHash" = $1,
             "accessJti" = $2,
             "accessExpiresAt" = $3,
             "refreshExpiresAt" = $4,
             "updatedAt" = NOW()
         WHERE id = $5
           AND "refreshTokenHash" = $6
           AND "revokedAt" IS NULL
           AND "refreshExpiresAt" > $7
           AND EXISTS (
             SELECT 1 FROM admin_users
             WHERE admin_users.id = admin_sessions.user_id
               AND admin_users."isActive" = TRUE
           )
         RETURNING id`,
        [
          pair.refreshTokenHash,
          pair.accessJti,
          pair.accessExpiresAt,
          refreshExpiresAt,
          session.id,
          oldHash,
          now,
        ],
      );
      const updatedRows =
        Array.isArray(update) && Array.isArray(update[0]) ? update[0] : [];
      if (updatedRows.length !== 1) return null;

      return {
        user: this.toSafeUser(session.user),
        accessToken: pair.accessToken,
        refreshToken: pair.refreshToken,
        accessExpiresIn: this.accessTtlSeconds,
        refreshExpiresIn: this.refreshTtlSeconds,
      } satisfies AdminTokenPair;
    });

    if (!result) throw new UnauthorizedException("Invalid refresh token");
    return result;
  }

  async logout(refreshToken: string): Promise<void> {
    const hash = this.hashRefreshToken(refreshToken);
    await this.dataSource
      .getRepository(AdminSession)
      .update(
        { refreshTokenHash: hash, revokedAt: IsNull() },
        { revokedAt: new Date() },
      );
  }

  async getCurrentUser(userId: string): Promise<SafeAdminUser> {
    const user = await this.dataSource.getRepository(AdminUser).findOne({
      where: { id: userId, isActive: true },
    });
    if (!user) throw new UnauthorizedException();
    return this.toSafeUser(user);
  }

  async listAdmins(): Promise<SafeAdminUser[]> {
    const users = await this.dataSource.getRepository(AdminUser).find({
      where: { role: AdminRole.ADMIN },
      order: { email: "ASC" },
    });
    return users.map((user) => this.toSafeUser(user));
  }

  async createAdmin(
    emailInput: string,
    password: string,
  ): Promise<SafeAdminUser> {
    if (!isPasswordWithinPolicy(password)) {
      throw new BadRequestException("Password does not meet the requirements");
    }
    const repository = this.dataSource.getRepository(AdminUser);
    const user = repository.create({
      email: normalizeAdminEmail(emailInput),
      passwordHash: await hashAdminPassword(password),
      role: AdminRole.ADMIN,
      isActive: true,
    });
    try {
      return this.toSafeUser(await repository.save(user));
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error as QueryFailedError & { driverError?: { code?: string } })
          .driverError?.code === "23505"
      ) {
        throw new ConflictException("Administrator email already exists");
      }
      throw error;
    }
  }

  async createFirstAdmin(
    manager: EntityManager,
    emailInput: string,
    password: string,
  ): Promise<{ created: boolean; user?: SafeAdminUser }> {
    const repository = manager.getRepository(AdminUser);
    const existingCount = await repository.count();
    if (existingCount > 0) return { created: false };

    const user = repository.create({
      email: normalizeAdminEmail(emailInput),
      passwordHash: await hashAdminPassword(password),
      role: AdminRole.ADMIN,
      isActive: true,
    });
    return {
      created: true,
      user: this.toSafeUser(await repository.save(user)),
    };
  }

  private async createSession(
    manager: EntityManager,
    user: AdminUser,
  ): Promise<AdminTokenPair> {
    const now = new Date();
    const issuedAt = Math.floor(now.getTime() / 1_000);
    const rawRefreshToken = randomBytes(48).toString("base64url");
    const session = manager.getRepository(AdminSession).create({
      user,
      refreshTokenHash: this.hashRefreshToken(rawRefreshToken),
      accessJti: randomUUID(),
      accessExpiresAt: new Date((issuedAt + this.accessTtlSeconds) * 1_000),
      refreshExpiresAt: new Date(
        now.getTime() + this.refreshTtlSeconds * 1_000,
      ),
      revokedAt: null,
    });
    const saved = await manager.getRepository(AdminSession).save(session);
    const accessToken = await this.jwtService.signAsync(
      {
        sub: user.id,
        sid: saved.id,
        jti: saved.accessJti,
        iat: issuedAt,
      } satisfies AccessClaims,
      { algorithm: "HS256", expiresIn: this.accessTtlSeconds },
    );
    return {
      user: this.toSafeUser(user),
      accessToken,
      refreshToken: rawRefreshToken,
      accessExpiresIn: this.accessTtlSeconds,
      refreshExpiresIn: this.refreshTtlSeconds,
    };
  }

  private async createRotatedPair(session: AdminSession): Promise<{
    accessToken: string;
    refreshToken: string;
    refreshTokenHash: string;
    accessJti: string;
    accessExpiresAt: Date;
  }> {
    const refreshToken = randomBytes(48).toString("base64url");
    const accessJti = randomUUID();
    const issuedAt = Math.floor(Date.now() / 1_000);
    const accessToken = await this.jwtService.signAsync(
      {
        sub: session.user.id,
        sid: session.id,
        jti: accessJti,
        iat: issuedAt,
      } satisfies AccessClaims,
      { algorithm: "HS256", expiresIn: this.accessTtlSeconds },
    );
    return {
      accessToken,
      refreshToken,
      refreshTokenHash: this.hashRefreshToken(refreshToken),
      accessJti,
      accessExpiresAt: new Date((issuedAt + this.accessTtlSeconds) * 1_000),
    };
  }

  private hashRefreshToken(refreshToken: string): string {
    return createHash("sha256").update(refreshToken).digest("hex");
  }

  private toSafeUser(user: AdminUser): SafeAdminUser {
    return { id: user.id, email: user.email, role: user.role };
  }
}
