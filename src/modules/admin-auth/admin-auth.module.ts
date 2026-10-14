import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AppEnvironment } from "../../config/env.schema";
import { AdminAuthController } from "./admin-auth.controller";
import { AdminsController } from "./admins.controller";
import { AdminAuthRateLimit } from "./entities/admin-auth-rate-limit.entity";
import { AdminSession } from "./entities/admin-session.entity";
import { AdminUser } from "./entities/admin-user.entity";
import { AdminAuthGuard } from "./guards/admin-auth.guard";
import { AdminRoleGuard } from "./guards/admin-role.guard";
import { AdminAuthRateLimitService } from "./services/admin-auth-rate-limit.service";
import { AdminAuthService } from "./services/admin-auth.service";
import { AdminPasswordService } from "./services/admin-password.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([AdminUser, AdminSession, AdminAuthRateLimit]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnvironment>) => ({
        secret: config.getOrThrow("JWT_SECRET", { infer: true }),
        signOptions: { algorithm: "HS256" },
        verifyOptions: { algorithms: ["HS256"] },
      }),
    }),
  ],
  controllers: [AdminAuthController, AdminsController],
  providers: [
    AdminAuthService,
    AdminAuthRateLimitService,
    AdminPasswordService,
    AdminAuthGuard,
    AdminRoleGuard,
  ],
  exports: [
    AdminAuthService,
    AdminAuthRateLimitService,
    AdminAuthGuard,
    AdminRoleGuard,
    JwtModule,
  ],
})
export class AdminAuthModule {}
