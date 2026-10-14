import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn,
} from "typeorm";
import { ServiceCategory } from "../../service-categories/entities/service-category.entity";
import { MediaAsset } from "../../cms/cms.entities";

export enum ServiceStatus {
  DRAFT = "draft",
  PUBLISHED = "published",
  HIDDEN = "hidden",
  ARCHIVED = "archived",
}

export enum ServicePriceMode {
  FIXED = "fixed",
  FROM = "from",
  ON_REQUEST = "on_request",
}

@Entity({ name: "services" })
@Index("uq_services_slug", ["slug"], { unique: true })
@Index("uq_services_legacy_id", ["legacyId"], { unique: true })
@Index("idx_services_status_order", ["status", "sortOrder"])
@Index("idx_services_category_status_order", [
  "category",
  "status",
  "sortOrder",
])
export class Service {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "integer", nullable: true })
  legacyId!: number | null;

  @Column({ type: "varchar", length: 255 })
  name!: string;

  @Column({ type: "varchar", length: 200 })
  slug!: string;

  @Column({ type: "text" })
  description!: string;

  @Column({ type: "text", nullable: true })
  details!: string | null;

  @ManyToOne(() => ServiceCategory, (category) => category.services, {
    nullable: false,
    onDelete: "RESTRICT",
  })
  @JoinColumn({ name: "category_id" })
  category!: Relation<ServiceCategory>;

  @Column({ type: "numeric", precision: 12, scale: 2, nullable: true })
  priceRub!: string | null;

  @Column({
    type: "enum",
    enum: ServicePriceMode,
    enumName: "services_price_mode_enum",
  })
  priceMode!: ServicePriceMode;

  @Column({ type: "varchar", length: 40, nullable: true })
  unitLabel!: string | null;

  @Column({ type: "integer", default: 0 })
  sortOrder!: number;

  @Column({ type: "varchar", length: 500, nullable: true })
  legacyImagePath!: string | null;

  @Column({ name: "media_id", type: "uuid", nullable: true })
  mediaId!: string | null;

  @ManyToOne(() => MediaAsset, { nullable: true, onDelete: "RESTRICT" })
  @JoinColumn({ name: "media_id" })
  media!: Relation<MediaAsset> | null;

  @Column({ type: "boolean", default: false })
  slugLocked!: boolean;

  @Column({
    type: "enum",
    enum: ServiceStatus,
    enumName: "services_status_enum",
  })
  status!: ServiceStatus;

  @Column({ type: "varchar", length: 255, nullable: true })
  seoTitle!: string | null;

  @Column({ type: "text", nullable: true })
  seoDescription!: string | null;

  @Column({ type: "char", length: 64, nullable: true })
  legacyChecksum!: string | null;

  @Column({ type: "varchar", length: 20, nullable: true })
  legacyPriceQualifier!: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
