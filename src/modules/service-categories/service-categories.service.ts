import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  CreateServiceCategoryDto,
  UpdateServiceCategoryDto,
} from "./dto/service-category.dto";
import {
  ServiceCategory,
  ServiceCategoryStatus,
} from "./entities/service-category.entity";
import { Service } from "../services/entities/service.entity";

@Injectable()
export class ServiceCategoriesService {
  constructor(
    @InjectRepository(ServiceCategory)
    private readonly categories: Repository<ServiceCategory>,
    @InjectRepository(Service)
    private readonly services: Repository<Service>,
  ) {}

  async listPublic(): Promise<ServiceCategory[]> {
    return this.categories.find({
      where: { status: ServiceCategoryStatus.PUBLISHED },
      order: { sortOrder: "ASC", id: "ASC" },
    });
  }

  async listAdmin(): Promise<ServiceCategory[]> {
    return this.categories.find({ order: { sortOrder: "ASC", id: "ASC" } });
  }

  async getAdmin(id: string): Promise<ServiceCategory> {
    const category = await this.categories.findOneBy({ id });
    if (!category) throw new NotFoundException();
    return category;
  }

  async create(input: CreateServiceCategoryDto): Promise<ServiceCategory> {
    const category = this.categories.create({
      name: input.name,
      slug: input.slug,
      description: input.description ?? null,
      sortOrder: input.sortOrder ?? 0,
      status: input.status ?? ServiceCategoryStatus.PUBLISHED,
      seoTitle: input.seoTitle ?? null,
      seoDescription: input.seoDescription ?? null,
      legacyFeedId: null,
    });
    return this.save(category);
  }

  async update(
    id: string,
    input: UpdateServiceCategoryDto,
  ): Promise<ServiceCategory> {
    const category = await this.getAdmin(id);
    if (input.name !== undefined) category.name = input.name;
    if (input.slug !== undefined) category.slug = input.slug;
    if (input.description !== undefined)
      category.description = input.description;
    if (input.sortOrder !== undefined) category.sortOrder = input.sortOrder;
    if (input.status !== undefined) category.status = input.status;
    if (input.seoTitle !== undefined) category.seoTitle = input.seoTitle;
    if (input.seoDescription !== undefined)
      category.seoDescription = input.seoDescription;
    return this.save(category);
  }

  async delete(id: string): Promise<void> {
    const category = await this.getAdmin(id);
    if (await this.services.exists({ where: { category: { id } } })) {
      throw new ConflictException("Category is in use");
    }
    await this.categories.remove(category);
  }

  private async save(category: ServiceCategory): Promise<ServiceCategory> {
    try {
      return await this.categories.save(category);
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ConflictException("Slug already exists");
      throw error;
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; driverError?: { code?: unknown } };
  return value.code === "23505" || value.driverError?.code === "23505";
}
