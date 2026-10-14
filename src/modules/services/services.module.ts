import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AdminAuthModule } from "../admin-auth/admin-auth.module";
import { ServiceCategory } from "../service-categories/entities/service-category.entity";
import {
  AdminServicesController,
  PublicServicesController,
} from "./services.controller";
import { Service } from "./entities/service.entity";
import { ServicesService } from "./services.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([Service, ServiceCategory]),
    AdminAuthModule,
  ],
  controllers: [PublicServicesController, AdminServicesController],
  providers: [ServicesService],
})
export class ServicesModule {}
