import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AdminAuthModule } from "../admin-auth/admin-auth.module";
import { Service } from "../services/entities/service.entity";
import { ServiceCategory } from "./entities/service-category.entity";
import {
  AdminServiceCategoriesController,
  PublicServiceCategoriesController,
} from "./service-categories.controller";
import { ServiceCategoriesService } from "./service-categories.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([ServiceCategory, Service]),
    AdminAuthModule,
  ],
  controllers: [
    PublicServiceCategoriesController,
    AdminServiceCategoriesController,
  ],
  providers: [ServiceCategoriesService],
  exports: [ServiceCategoriesService],
})
export class ServiceCategoriesModule {}
