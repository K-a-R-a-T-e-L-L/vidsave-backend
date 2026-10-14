import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Request } from "express";
import { isUUID } from "class-validator";
import { DataSource } from "typeorm";
import { AdminSession } from "../entities/admin-session.entity";
import { AuthenticatedAdmin } from "../decorators/current-admin.decorator";

interface VerifiedAccessClaims {
  sub: string;
  sid: string;
  jti: string;
  iat: number;
  exp: number;
}

type AuthenticatedRequest = Request & { adminUser?: AuthenticatedAdmin };

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);
    if (!match) throw new UnauthorizedException();

    let claims: unknown;
    try {
      claims = await this.jwtService.verifyAsync<Record<string, unknown>>(
        match[1],
        {
          algorithms: ["HS256"],
        },
      );
    } catch {
      throw new UnauthorizedException();
    }

    if (!this.hasValidClaims(claims)) throw new UnauthorizedException();
    const session = await this.dataSource.getRepository(AdminSession).findOne({
      where: { id: claims.sid },
      relations: { user: true },
    });
    const now = new Date();
    if (
      !session ||
      session.user.id !== claims.sub ||
      session.accessJti !== claims.jti ||
      session.revokedAt ||
      session.accessExpiresAt <= now ||
      Math.floor(session.accessExpiresAt.getTime() / 1_000) !== claims.exp ||
      !session.user.isActive
    ) {
      throw new UnauthorizedException();
    }

    request.adminUser = {
      id: session.user.id,
      email: session.user.email,
      role: session.user.role,
    };
    return true;
  }

  private hasValidClaims(value: unknown): value is VerifiedAccessClaims {
    if (!value || typeof value !== "object") return false;
    const claims = value as Partial<VerifiedAccessClaims>;
    return (
      typeof claims.sub === "string" &&
      isUUID(claims.sub) &&
      typeof claims.sid === "string" &&
      isUUID(claims.sid) &&
      typeof claims.jti === "string" &&
      isUUID(claims.jti) &&
      Number.isInteger(claims.iat) &&
      Number.isInteger(claims.exp)
    );
  }
}
