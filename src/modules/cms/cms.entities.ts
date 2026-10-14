import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import type { Relation } from "typeorm";
import { Service } from "../services/entities/service.entity";

export type PublicationStatus = "draft" | "published" | "archived";
export type RichNode = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: RichNode[];
};
export type PageField = {
  role?: "control";
  id: string;
  label: string;
  text: string;
  visible: boolean;
  order: number;
  imageId?: string | null;
};
export type PageDocument = {
  title: string;
  description: string;
  fields: PageField[];
  faq: { question: string; answer: string }[];
  ctaTitle: string;
  ctaText: string;
};

export abstract class ContentRecord {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ type: "varchar", length: 255 }) title!: string;
  @Column({ type: "varchar", length: 200, unique: true }) slug!: string;
  @Column({ type: "text", default: "" }) excerpt!: string;
  @Column({ type: "varchar", length: 20, default: "draft" })
  status!: PublicationStatus;
  @Column({ type: "varchar", length: 255, nullable: true }) seoTitle!:
    string | null;
  @Column({ type: "text", nullable: true }) seoDescription!: string | null;
  @Column({ type: "uuid", nullable: true }) coverId!: string | null;
  @Column({ type: "uuid", nullable: true }) ogImageId!: string | null;
  @Column({ type: "timestamptz", nullable: true }) publishedAt!: Date | null;
  @CreateDateColumn({ type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ type: "timestamptz" }) updatedAt!: Date;
}

@Entity("cms_blog_categories")
export class BlogCategory extends ContentRecord {
  @Column({ type: "integer", default: 0 }) sortOrder!: number;
}

@Entity("cms_blog_posts")
export class BlogPost extends ContentRecord {
  @Column({ type: "jsonb", default: () => '\'{"type":"doc","content":[]}\'' })
  body!: RichNode;
  @ManyToMany(() => BlogCategory)
  @JoinTable({ name: "cms_post_categories" })
  categories!: Relation<BlogCategory[]>;
}

@Entity("cms_portfolio_projects")
export class PortfolioProject extends ContentRecord {
  @Column({ type: "text", default: "" }) objectType!: string;
  @Column({ type: "text", default: "" }) task!: string;
  @Column({ type: "text", default: "" }) solution!: string;
  @Column({ type: "text", default: "" }) result!: string;
  @Column({ type: "jsonb", default: () => "'[]'" }) galleryIds!: string[];
  @ManyToMany(() => Service)
  @JoinTable({ name: "cms_project_services" })
  services!: Relation<Service[]>;
}

@Entity("cms_media")
export class MediaAsset {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ type: "varchar", length: 255 }) title!: string;
  @Column({ type: "varchar", length: 500, default: "" }) alt!: string;
  @Column({ type: "varchar", length: 100, unique: true }) objectKey!: string;
  @Column({ type: "varchar", length: 50, default: "image/webp" }) mime!: string;
  @Column({ type: "integer" }) size!: number;
  @Column({ type: "integer" }) width!: number;
  @Column({ type: "integer" }) height!: number;
  @CreateDateColumn({ type: "timestamptz" }) createdAt!: Date;
}

@Entity("cms_media_uses")
@Index(["ownerType", "ownerId", "mediaId", "slot"], { unique: true })
export class MediaUse {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ type: "varchar", length: 30 }) ownerType!: string;
  @Column({ type: "varchar", length: 100 }) ownerId!: string;
  @Column({ type: "varchar", length: 100 }) slot!: string;
  @Column({ type: "uuid" }) mediaId!: string;
  @ManyToOne(() => MediaAsset, { onDelete: "RESTRICT", nullable: false })
  @JoinColumn({ name: "mediaId" })
  media!: Relation<MediaAsset>;
}

@Entity("cms_site_settings")
export class SiteSettings {
  @PrimaryColumn({ type: "varchar", length: 20 }) id!: string;
  @Column({ type: "jsonb" }) data!: Record<string, unknown>;
  @Column({ type: "uuid" }) policyVersion!: string;
  @UpdateDateColumn({ type: "timestamptz" }) updatedAt!: Date;
}

@Entity("cms_site_pages")
export class SitePage {
  @PrimaryColumn({ type: "varchar", length: 30 }) id!: string;
  @Column({ type: "jsonb" }) document!: PageDocument;
  @Column({ type: "varchar", length: 255, nullable: true }) seoTitle!:
    string | null;
  @Column({ type: "text", nullable: true }) seoDescription!: string | null;
  @Column({ type: "varchar", length: 500, nullable: true }) canonical!:
    string | null;
  @Column({ type: "boolean", default: false }) noindex!: boolean;
  @Column({ type: "uuid", nullable: true }) ogImageId!: string | null;
  @UpdateDateColumn({ type: "timestamptz" }) updatedAt!: Date;
}

@Entity("cms_leads")
export class Lead {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ type: "uuid", unique: true }) requestKey!: string;
  @Column({ type: "varchar", length: 100 }) name!: string;
  @Column({ type: "varchar", length: 20 }) phone!: string;
  @Column({ type: "text", default: "" }) message!: string;
  @Column({ type: "varchar", length: 100 }) source!: string;
  @Column({ type: "varchar", length: 500 }) sourceUrl!: string;
  @Column({ type: "varchar", length: 20, default: "new" }) status!:
    "new" | "in_progress" | "completed" | "spam";
  @Column({ type: "text", default: "" }) note!: string;
  @Column({ type: "uuid" }) policyVersion!: string;
  @Column({ type: "text" }) consentText!: string;
  @Column({ type: "timestamptz" }) consentAt!: Date;
  @CreateDateColumn({ type: "timestamptz" }) createdAt!: Date;
}

@Entity("cms_notification_outbox")
@Index(["status", "availableAt"])
export class NotificationOutbox {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ type: "uuid", unique: true }) leadId!: string;
  @ManyToOne(() => Lead, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "leadId" })
  lead!: Relation<Lead>;
  @Column({ type: "varchar", length: 20, default: "pending" }) status!:
    "pending" | "processing" | "sent" | "failed" | "disabled";
  @Column({ type: "integer", default: 0 }) attempts!: number;
  @Column({ type: "timestamptz", default: () => "CURRENT_TIMESTAMP" })
  availableAt!: Date;
  @Column({ type: "uuid", nullable: true }) leaseToken!: string | null;
  @Column({ type: "timestamptz", nullable: true }) leaseUntil!: Date | null;
  @Column({ type: "integer", nullable: true }) lastHttpStatus!: number | null;
  @CreateDateColumn({ type: "timestamptz" }) createdAt!: Date;
}

@Entity("cms_rate_limits")
export class CmsRateLimit {
  @PrimaryColumn({ type: "char", length: 64 }) key!: string;
  @Column({ type: "timestamptz" }) windowStart!: Date;
  @Column({ type: "integer" }) count!: number;
}

export const cmsEntities = [
  BlogCategory,
  BlogPost,
  PortfolioProject,
  MediaAsset,
  MediaUse,
  SiteSettings,
  SitePage,
  Lead,
  NotificationOutbox,
  CmsRateLimit,
];
