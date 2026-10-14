import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from "@nestjs/swagger";
import { RequireAdminRoles } from "../admin-auth/decorators/admin-roles.decorator";
import { AdminRole } from "../admin-auth/entities/admin-user.entity";
import { AdminAuthGuard } from "../admin-auth/guards/admin-auth.guard";
import { AdminRoleGuard } from "../admin-auth/guards/admin-role.guard";
import {
  CreateServiceCategoryDto,
  ServiceCategoryAdminDto,
  ServiceCategoryAdminListDto,
  ServiceCategoryListDto,
  ServiceCategoryPublicDto,
  ServiceCategoryRouteParamsDto,
  UpdateServiceCategoryDto,
} from "./dto/service-category.dto";
import { ServiceCategory } from "./entities/service-category.entity";
import { ServiceCategoriesService } from "./service-categories.service";

@ApiTags("catalog categories")
@Controller("catalog/categories")
export class PublicServiceCategoriesController {
  constructor(private readonly service: ServiceCategoriesService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: ServiceCategoryListDto })
  async list(): Promise<{ items: ServiceCategoryPublicDto[] }> {
    return { items: (await this.service.listPublic()).map(toPublicCategory) };
  }
}

@ApiTags("admin service categories")
@ApiBearerAuth()
@UseGuards(AdminAuthGuard, AdminRoleGuard)
@RequireAdminRoles(AdminRole.ADMIN)
@Controller("admin/service-categories")
export class AdminServiceCategoriesController {
  constructor(private readonly service: ServiceCategoriesService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: ServiceCategoryAdminListDto })
  async list(): Promise<{ items: ServiceCategoryAdminDto[] }> {
    return { items: (await this.service.listAdmin()).map(toAdminCategory) };
  }

  @Get(":id")
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: ServiceCategoryAdminDto })
  async get(@Param() params: ServiceCategoryRouteParamsDto) {
    return toAdminCategory(await this.service.getAdmin(params.id));
  }

  @Post()
  @Header("Cache-Control", "no-store")
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: ServiceCategoryAdminDto })
  async create(@Body() body: CreateServiceCategoryDto) {
    return toAdminCategory(await this.service.create(body));
  }

  @Patch(":id")
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: ServiceCategoryAdminDto })
  async update(
    @Param() params: ServiceCategoryRouteParamsDto,
    @Body() body: UpdateServiceCategoryDto,
  ) {
    return toAdminCategory(await this.service.update(params.id, body));
  }

  @Delete(":id")
  @Header("Cache-Control", "no-store")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  delete(@Param() params: ServiceCategoryRouteParamsDto): Promise<void> {
    return this.service.delete(params.id);
  }
}

function toPublicCategory(value: ServiceCategory): ServiceCategoryPublicDto {
  return {
    id: value.id,
    legacyFeedId: value.legacyFeedId,
    name: value.name,
    slug: value.slug,
    description: value.description,
    sortOrder: value.sortOrder,
  };
}

function toAdminCategory(value: ServiceCategory): ServiceCategoryAdminDto {
  return {
    ...toPublicCategory(value),
    legacyFeedId: value.legacyFeedId,
    status: value.status,
    seoTitle: value.seoTitle,
    seoDescription: value.seoDescription,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}
