import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AdminAuthModule } from "../admin-auth/admin-auth.module";
import { cmsEntities } from "./cms.entities";
import { CmsService } from "./cms.service";
import { MediaStorage } from "./media-storage.service";
import { LeadsService } from "./leads.service";
import { CmsAdminController, CmsPublicController } from "./cms.controller";

@Module({
  imports: [TypeOrmModule.forFeature(cmsEntities), AdminAuthModule],
  providers: [CmsService, MediaStorage, LeadsService],
  controllers: [CmsAdminController, CmsPublicController],
})
export class CmsModule {}
