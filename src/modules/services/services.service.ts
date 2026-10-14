import { MediaAsset } from "../cms/cms.entities";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  ServiceCategory,
  ServiceCategoryStatus,
} from "../service-categories/entities/service-category.entity";
import {
  AdminServiceQueryDto,
  CreateServiceDto,
  ServiceQueryDto,
  UpdateServiceDto,
} from "./dto/service.dto";
import {
  Service,
  ServicePriceMode,
  ServiceStatus,
} from "./entities/service.entity";

@Injectable()
export class ServicesService {
  constructor(
    @InjectRepository(Service) private readonly services: Repository<Service>,
    @InjectRepository(ServiceCategory)
    private readonly categories: Repository<ServiceCategory>,
  ) {}

  async listPublic(query: ServiceQueryDto) {
    const qb = this.services
      .createQueryBuilder("service")
      .innerJoinAndSelect("service.category", "category")
      .leftJoinAndSelect("service.media", "media")
      .where("service.status = :published", {
        published: ServiceStatus.PUBLISHED,
      })
      .andWhere("category.status = :categoryPublished", {
        categoryPublished: "published",
      });
    if (query.category)
      qb.andWhere("category.slug = :categorySlug", {
        categorySlug: query.category,
      });
    if (query.search)
      qb.andWhere("service.name ILIKE :search", {
        search: `%${query.search}%`,
      });
    const [services, total] = await qb
      .orderBy("service.sortOrder", "ASC")
      .addOrderBy("service.legacyId", "ASC", "NULLS LAST")
      .addOrderBy("service.id", "ASC")
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return {
      items: services.map(toPublicService),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async getPublic(slug: string): Promise<Service> {
    const service = await this.services.findOne({
      where: {
        slug,
        status: ServiceStatus.PUBLISHED,
        category: { status: ServiceCategoryStatus.PUBLISHED },
      },
      relations: { category: true, media: true },
    });
    if (!service) throw new NotFoundException();
    return service;
  }

  async listAdmin(query: AdminServiceQueryDto) {
    const qb = this.services
      .createQueryBuilder("service")
      .innerJoinAndSelect("service.category", "category");
    if (query.status)
      qb.andWhere("service.status = :status", { status: query.status });
    if (query.category)
      qb.andWhere("category.slug = :categorySlug", {
        categorySlug: query.category,
      });
    const [services, total] = await qb
      .orderBy("service.sortOrder", "ASC")
      .addOrderBy("service.legacyId", "ASC", "NULLS LAST")
      .addOrderBy("service.id", "ASC")
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return {
      items: services.map(toAdminService),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async getAdmin(id: string): Promise<Service> {
    const service = await this.services.findOne({
      where: { id },
      relations: { category: true, media: true },
    });
    if (!service) throw new NotFoundException();
    return service;
  }

  async create(input: CreateServiceDto): Promise<Service> {
    const category = await this.categories.findOneBy({ id: input.categoryId });
    if (!category) throw new NotFoundException("Category not found");
    validatePrice(input.priceMode, input.priceRub);
    if (
      input.mediaId &&
      !(await this.services.manager
        .getRepository(MediaAsset)
        .existsBy({ id: input.mediaId }))
    )
      throw new BadRequestException("Invalid media");
    const service = this.services.create({
      legacyId: null,
      name: input.name,
      slug: input.slug,
      description: input.description,
      details: input.details ?? null,
      category,
      priceRub: input.priceRub ?? null,
      priceMode: input.priceMode,
      unitLabel: input.unitLabel ?? null,
      sortOrder: input.sortOrder ?? 0,
      legacyImagePath: input.legacyImagePath ?? null,
      mediaId: input.mediaId ?? null,
      slugLocked: input.status === ServiceStatus.PUBLISHED,
      status: input.status ?? ServiceStatus.DRAFT,
      seoTitle: input.seoTitle ?? null,
      seoDescription: input.seoDescription ?? null,
      legacyChecksum: null,
      legacyPriceQualifier: null,
    });
    return this.save(service);
  }

  async update(id: string, input: UpdateServiceDto): Promise<Service> {
    const service = await this.getAdmin(id);
    if (
      input.slug !== undefined &&
      input.slug !== service.slug &&
      (service.legacyId !== null ||
        service.slugLocked ||
        service.status !== ServiceStatus.DRAFT)
    ) {
      throw new ConflictException(
        "Imported service slug cannot be changed before redirects are implemented",
      );
    }
    if (input.categoryId !== undefined) {
      const category = await this.categories.findOneBy({
        id: input.categoryId,
      });
      if (!category) throw new NotFoundException("Category not found");
      service.category = category;
    }
    const priceMode = input.priceMode ?? service.priceMode;
    const priceRub =
      input.priceRub !== undefined ? input.priceRub : service.priceRub;
    validatePrice(priceMode, priceRub);
    if (input.mediaId !== undefined) {
      if (
        input.mediaId &&
        !(await this.services.manager
          .getRepository(MediaAsset)
          .existsBy({ id: input.mediaId }))
      )
        throw new BadRequestException("Invalid media");
      service.mediaId = input.mediaId;
    }
    if (input.status === ServiceStatus.PUBLISHED) service.slugLocked = true;
    if (input.name !== undefined) service.name = input.name;
    if (input.slug !== undefined) service.slug = input.slug;
    if (input.description !== undefined)
      service.description = input.description;
    if (input.details !== undefined) service.details = input.details;
    if (input.priceRub !== undefined) service.priceRub = input.priceRub;
    if (input.priceMode !== undefined) service.priceMode = input.priceMode;
    if (input.unitLabel !== undefined) service.unitLabel = input.unitLabel;
    if (input.sortOrder !== undefined) service.sortOrder = input.sortOrder;
    if (input.legacyImagePath !== undefined)
      service.legacyImagePath = input.legacyImagePath;
    if (input.status !== undefined) service.status = input.status;
    if (input.seoTitle !== undefined) service.seoTitle = input.seoTitle;
    if (input.seoDescription !== undefined)
      service.seoDescription = input.seoDescription;
    return this.save(service);
  }

  async delete(id: string): Promise<void> {
    const service = await this.getAdmin(id);
    await this.services.remove(service);
  }

  private async save(service: Service): Promise<Service> {
    try {
      return await this.services.save(service);
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ConflictException("Slug already exists");
      if (isForeignKeyViolation(error))
        throw new BadRequestException("Invalid category");
      throw error;
    }
  }
}

export function toPublicService(value: Service) {
  return {
    id: value.id,
    legacyId: value.legacyId,
    name: value.name,
    slug: value.slug,
    description: value.description,
    details: value.details,
    category: {
      id: value.category.id,
      name: value.category.name,
      slug: value.category.slug,
    },
    priceRub: value.priceRub,
    priceMode: value.priceMode,
    unitLabel: value.unitLabel,
    sortOrder: value.sortOrder,
    imagePath: value.mediaId
      ? `/media/${value.mediaId}`
      : value.legacyImagePath,
    imageAlt: value.media?.alt || value.name,
    mediaId: value.mediaId ?? null,
    seoTitle: value.seoTitle,
    seoDescription: value.seoDescription,
  };
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

function validatePrice(
  mode: ServicePriceMode,
  amount: string | null | undefined,
): void {
  if (mode === ServicePriceMode.ON_REQUEST) {
    if (amount !== undefined && amount !== null)
      throw new BadRequestException(
        "On-request services cannot have a numeric price",
      );
    return;
  }
  if (
    amount === undefined ||
    amount === null ||
    !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(amount)
  ) {
    throw new BadRequestException("A non-negative decimal price is required");
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; driverError?: { code?: unknown } };
  return value.code === "23505" || value.driverError?.code === "23505";
}

function isForeignKeyViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; driverError?: { code?: unknown } };
  return value.code === "23503" || value.driverError?.code === "23503";
}
