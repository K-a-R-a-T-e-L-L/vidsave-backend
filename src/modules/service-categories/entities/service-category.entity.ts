import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn,
} from "typeorm";
import { Service } from "../../services/entities/service.entity";

export enum ServiceCategoryStatus {
  PUBLISHED = "published",
  HIDDEN = "hidden",
}

@Entity({ name: "service_categories" })
@Index("uq_service_categories_slug", ["slug"], { unique: true })
@Index("uq_service_categories_legacy_feed_id", ["legacyFeedId"], {
  unique: true,
})
@Index("idx_service_categories_status_order", ["status", "sortOrder"])
export class ServiceCategory {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 255 })
  name!: string;

  @Column({ type: "varchar", length: 160 })
  slug!: string;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  @Column({ type: "integer", default: 0 })
  sortOrder!: number;

  @Column({ type: "integer", nullable: true })
  legacyFeedId!: number | null;

  @Column({
    type: "enum",
    enum: ServiceCategoryStatus,
    enumName: "service_categories_status_enum",
    default: ServiceCategoryStatus.PUBLISHED,
  })
  status!: ServiceCategoryStatus;

  @Column({ type: "varchar", length: 255, nullable: true })
  seoTitle!: string | null;

  @Column({ type: "text", nullable: true })
  seoDescription!: string | null;

  @OneToMany(() => Service, (service) => service.category)
  services!: Relation<Service[]>;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
