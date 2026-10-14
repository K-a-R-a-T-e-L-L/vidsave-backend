import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { createDatabaseConfig } from "./config/database.config";
import { validateEnvironment } from "./config/env.schema";
import { HealthModule } from "./modules/health/health.module";
import { AdminAuthModule } from "./modules/admin-auth/admin-auth.module";
import { ServiceCategoriesModule } from "./modules/service-categories/service-categories.module";
import { ServicesModule } from "./modules/services/services.module";
import { CmsModule } from "./modules/cms/cms.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: createDatabaseConfig,
    }),
    HealthModule,
    AdminAuthModule,
    ServiceCategoriesModule,
    ServicesModule,
    CmsModule,
  ],
})
export class AppModule {}
