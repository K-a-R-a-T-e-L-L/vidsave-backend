import { PartialType } from "@nestjs/swagger";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MinLength,
  Matches,
  MaxLength,
  Min,
} from "class-validator";
import { ServiceCategoryStatus } from "../entities/service-category.entity";

export class CreateServiceCategoryDto {
  @ApiProperty({ maxLength: 255 })
  @IsString()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @ApiProperty({ maxLength: 160, pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" })
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(160)
  slug!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ enum: ServiceCategoryStatus })
  @IsOptional()
  @IsEnum(ServiceCategoryStatus)
  status?: ServiceCategoryStatus;

  @ApiPropertyOptional({ maxLength: 255, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  seoTitle?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  seoDescription?: string | null;
}

export class UpdateServiceCategoryDto extends PartialType(
  CreateServiceCategoryDto,
) {}

export class ServiceCategoryPublicDto {
  @ApiProperty({ format: "uuid" })
  id!: string;
  @ApiProperty({ nullable: true, minimum: 1 })
  legacyFeedId!: number | null;
  @ApiProperty()
  name!: string;
  @ApiProperty()
  slug!: string;
  @ApiProperty({ nullable: true })
  description!: string | null;
  @ApiProperty()
  sortOrder!: number;
}

export class ServiceCategoryAdminDto extends ServiceCategoryPublicDto {
  declare legacyFeedId: number | null;
  @ApiProperty({ enum: ServiceCategoryStatus })
  status!: ServiceCategoryStatus;
  @ApiProperty({ nullable: true })
  seoTitle!: string | null;
  @ApiProperty({ nullable: true })
  seoDescription!: string | null;
  @ApiProperty()
  createdAt!: Date;
  @ApiProperty()
  updatedAt!: Date;
}

export class ServiceCategoryListDto {
  @ApiProperty({ type: ServiceCategoryPublicDto, isArray: true })
  items!: ServiceCategoryPublicDto[];
}

export class ServiceCategoryAdminListDto {
  @ApiProperty({ type: ServiceCategoryAdminDto, isArray: true })
  items!: ServiceCategoryAdminDto[];
}

export class ServiceCategoryRouteParamsDto {
  @ApiProperty({ format: "uuid" })
  @IsString()
  @Matches(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  )
  id!: string;
}
