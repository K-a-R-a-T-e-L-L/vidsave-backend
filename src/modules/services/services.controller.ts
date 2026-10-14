import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from "@nestjs/swagger";
import { RequireAdminRoles } from "../admin-auth/decorators/admin-roles.decorator";
import { AdminRole } from "../admin-auth/entities/admin-user.entity";
import { AdminAuthGuard } from "../admin-auth/guards/admin-auth.guard";
import { AdminRoleGuard } from "../admin-auth/guards/admin-role.guard";
import {
  CreateServiceDto,
  AdminServiceQueryDto,
  AdminServicesListDto,
  ServiceAdminDto,
  ServicePublicDto,
  PublicServicesListDto,
  ServiceQueryDto,
  ServiceSlugDto,
  UpdateServiceDto,
} from "./dto/service.dto";
import { Service } from "./entities/service.entity";
import { ServicesService, toPublicService } from "./services.service";

@ApiTags("catalog services")
@Controller("catalog/services")
export class PublicServicesController {
  constructor(private readonly service: ServicesService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: PublicServicesListDto })
  list(@Query() query: ServiceQueryDto) {
    return this.service.listPublic(query);
  }

  @Get(":slug")
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: ServicePublicDto })
  async get(@Param() params: ServiceSlugDto) {
    const service = await this.service.getPublic(params.slug);
    return toPublicService(service);
  }
}

@ApiTags("admin services")
@ApiBearerAuth()
@UseGuards(AdminAuthGuard, AdminRoleGuard)
@RequireAdminRoles(AdminRole.ADMIN)
@Controller("admin/services")
export class AdminServicesController {
  constructor(private readonly service: ServicesService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: AdminServicesListDto })
  list(@Query() query: AdminServiceQueryDto) {
    return this.service.listAdmin(query);
  }

  @Get(":id")
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: ServiceAdminDto })
  async get(@Param("id") id: string) {
    if (!isUuid(id)) throw new NotFoundException();
    return toAdminService(await this.service.getAdmin(id));
  }

  @Post()
  @Header("Cache-Control", "no-store")
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: ServiceAdminDto })
  async create(@Body() body: CreateServiceDto) {
    return toAdminService(await this.service.create(body));
  }

  @Delete(":id")
  @Header("Cache-Control", "no-store")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id") id: string): Promise<void> {
    if (!isUuid(id)) throw new NotFoundException();
    await this.service.delete(id);
  }

  @Patch(":id")
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: ServiceAdminDto })
  async update(@Param("id") id: string, @Body() body: UpdateServiceDto) {
    if (!isUuid(id)) throw new NotFoundException();
    return toAdminService(await this.service.update(id, body));
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function toAdminService(value: Service) {
  return {
    ...toPublicService(value),
    legacyId: value.legacyId,
    status: value.status,
    slugLocked: value.slugLocked,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}
