import { PartialType } from "@nestjs/swagger";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  IsEnum,
  IsInt,
  MinLength,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Matches,
  MaxLength,
  Min,
} from "class-validator";
import { ServicePriceMode, ServiceStatus } from "../entities/service.entity";

const SERVICE_SLUG = /^[a-z0-9](?:[a-z0-9._()-]*[a-z0-9)])?$/;
const DECIMAL_AMOUNT = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;

export class CreateServiceDto {
  @ApiProperty({ maxLength: 255 })
  @IsString()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @MaxLength(255)
  name!: string;

  @ApiProperty({ maxLength: 200, pattern: SERVICE_SLUG.source })
  @IsString()
  @Matches(SERVICE_SLUG)
  @MaxLength(200)
  slug!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  description!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  details?: string | null;

  @ApiProperty({ format: "uuid" })
  @IsUUID()
  categoryId!: string;

  @ApiPropertyOptional({ type: String, example: "1250.00", nullable: true })
  @IsOptional()
  @IsString()
  @Matches(DECIMAL_AMOUNT)
  priceRub?: string | null;

  @ApiProperty({ enum: ServicePriceMode })
  @IsEnum(ServicePriceMode)
  priceMode!: ServicePriceMode;

  @ApiPropertyOptional({ maxLength: 40, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  unitLabel?: string | null;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ maxLength: 500, nullable: true })
  @IsOptional()
  @IsString()
  @Matches(/^\/images\/services\/[A-Za-z0-9._-]+$/)
  @MaxLength(500)
  legacyImagePath?: string | null;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  @IsOptional()
  @IsUUID()
  mediaId?: string | null;

  @ApiPropertyOptional({ enum: ServiceStatus })
  @IsOptional()
  @IsEnum(ServiceStatus)
  status?: ServiceStatus;

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

export class UpdateServiceDto extends PartialType(CreateServiceDto) {}

export class ServiceQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}

export class AdminServiceQueryDto extends ServiceQueryDto {
  @ApiPropertyOptional({ enum: ServiceStatus })
  @IsOptional()
  @IsEnum(ServiceStatus)
  status?: ServiceStatus;
}

export class ServicePublicDto {
  @ApiProperty({ format: "uuid" })
  id!: string;
  @ApiProperty({ nullable: true })
  legacyId!: number | null;
  @ApiProperty()
  name!: string;
  @ApiProperty()
  slug!: string;
  @ApiProperty()
  description!: string;
  @ApiProperty({ nullable: true })
  details!: string | null;
  @ApiProperty({
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      name: { type: "string" },
      slug: { type: "string" },
    },
  })
  category!: {
    id: string;
    name: string;
    slug: string;
  };
  @ApiProperty({ type: String, nullable: true, example: "1250.00" })
  priceRub!: string | null;
  @ApiProperty({ enum: ServicePriceMode })
  priceMode!: ServicePriceMode;
  @ApiProperty({ nullable: true })
  unitLabel!: string | null;
  @ApiProperty()
  sortOrder!: number;
  @ApiProperty({ nullable: true })
  imagePath!: string | null;
  @ApiProperty({ nullable: true })
  seoTitle!: string | null;
  @ApiProperty({ nullable: true })
  seoDescription!: string | null;
}

export class ServiceAdminDto extends ServicePublicDto {
  declare legacyId: number | null;
  @ApiProperty({ enum: ServiceStatus })
  status!: ServiceStatus;
  @ApiProperty()
  createdAt!: Date;
  @ApiProperty()
  updatedAt!: Date;
}

export class PublicServicesListDto {
  @ApiProperty({ type: ServicePublicDto, isArray: true })
  items!: ServicePublicDto[];
  @ApiProperty()
  total!: number;
  @ApiProperty({ minimum: 1 })
  page!: number;
  @ApiProperty({ minimum: 1, maximum: 100 })
  limit!: number;
}

export class AdminServicesListDto extends PublicServicesListDto {
  @ApiProperty({ type: ServiceAdminDto, isArray: true })
  declare items: ServiceAdminDto[];
}

export class ServiceIdDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  id!: string;
}

export class ServiceSlugDto {
  @ApiProperty()
  @IsString()
  @Matches(SERVICE_SLUG)
  slug!: string;
}
