import { privacyDocuments } from "./privacy-documents";
import { initialArticles } from "./blog.defaults";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import {
  DataSource,
  EntityManager,
  In,
  Repository,
  FindOptionsRelations,
} from "typeorm";
import { randomUUID } from "node:crypto";
import {
  BlogCategory,
  BlogPost,
  ContentRecord,
  PortfolioProject,
  MediaAsset,
  MediaUse,
  SiteSettings,
  SitePage,
  Lead,
  NotificationOutbox,
} from "./cms.entities";
import {
  categoryInput,
  postInput,
  projectInput,
  settingsInput,
  contactsInput,
  pageInput,
  mediaUploadInput,
  mediaInput,
  leadUpdate,
  parseInput,
  validateRichText,
  richText,
  richMedia,
  uuid,
} from "./cms.validation";
import { MediaStorage } from "./media-storage.service";
import { Service, ServiceStatus } from "../services/entities/service.entity";
import { toPublicService } from "../services/services.service";
import { defaultSettings, defaultPages } from "./cms.defaults";

export type ContentKind = "posts" | "blog-categories" | "projects";
const kinds = {
  posts: BlogPost,
  "blog-categories": BlogCategory,
  projects: PortfolioProject,
};
type FullContent = ContentRecord &
  Partial<BlogPost & BlogCategory & PortfolioProject>;

@Injectable()
export class CmsService implements OnModuleInit {
  constructor(
    private readonly db: DataSource,
    private readonly storage: MediaStorage,
  ) {}
  async onModuleInit() {
    await this.db.transaction(async (manager) => {
      const initialized = await manager
        .getRepository(SiteSettings)
        .createQueryBuilder()
        .insert()
        .values({
          id: "main",
          data: defaultSettings,
          policyVersion: randomUUID(),
        })
        .orIgnore()
        .returning("id")
        .execute();
      for (const page of defaultPages)
        await manager
          .getRepository(SitePage)
          .createQueryBuilder()
          .insert()
          .values(page)
          .orIgnore()
          .execute();
      // Seed only a new installation. Deleted articles must stay deleted after a restart.
      if (initialized.raw.length)
        for (const article of initialArticles)
          await manager
            .getRepository(BlogPost)
            .createQueryBuilder()
            .insert()
            .values({
              ...article,
              status: "published",
              publishedAt: new Date(),
            })
            .orIgnore()
            .execute();
    });
  }
  repo(kind: ContentKind, manager = this.db.manager): Repository<FullContent> {
    const entity = kinds[kind];
    if (!entity) throw new NotFoundException();
    return manager.getRepository(entity) as Repository<ContentRecord>;
  }
  private relations(kind: ContentKind): FindOptionsRelations<FullContent> {
    return kind === "posts"
      ? { categories: true }
      : kind === "projects"
        ? { services: { category: true, media: true } }
        : {};
  }
  async content(
    kind: ContentKind,
    id: string,
    manager = this.db.manager,
  ): Promise<FullContent> {
    const value = await this.repo(kind, manager).findOne({
      where: { id },
      relations: this.relations(kind),
    });
    if (!value) throw new NotFoundException();
    return value as FullContent;
  }
  async list(
    kind: ContentKind,
    query: Record<string, string>,
    publicOnly = false,
  ) {
    const page = Math.max(1, Math.min(10000, Number(query.page) || 1));
    const limit = Math.max(1, Math.min(50, Number(query.limit) || 12));
    const qb = this.repo(kind).createQueryBuilder("record");
    if (kind === "posts")
      qb.select(
        [
          "id",
          "title",
          "slug",
          "excerpt",
          "status",
          "seoTitle",
          "seoDescription",
          "coverId",
          "ogImageId",
          "publishedAt",
          "createdAt",
          "updatedAt",
        ].map((field) => "record." + field),
      );
    if (publicOnly)
      qb.andWhere("record.status = :status", { status: "published" });
    else if (query.status)
      qb.andWhere("record.status = :status", { status: query.status });
    if (query.search)
      qb.andWhere("record.title ILIKE :search", {
        search: `%${query.search.slice(0, 200)}%`,
      });
    if (kind === "posts" && query.category)
      qb.innerJoin(
        "record.categories",
        "category",
        "category.slug = :slug AND category.status = :published",
        { slug: query.category, published: "published" },
      );
    if (kind === "posts")
      qb.leftJoinAndSelect("record.categories", "linkedCategory");
    if (kind === "projects")
      qb.leftJoinAndSelect("record.services", "linkedService")
        .leftJoinAndSelect("linkedService.category", "linkedServiceCategory")
        .leftJoinAndSelect("linkedService.media", "linkedServiceMedia");
    if (kind === "blog-categories" && publicOnly) {
      const populated = await this.db
        .getRepository(BlogPost)
        .createQueryBuilder("post")
        .innerJoin("post.categories", "category")
        .where("post.status = :published AND category.status = :published", {
          published: "published",
        })
        .select("category.id", "id")
        .distinct(true)
        .getRawMany<{ id: string }>();
      if (populated.length)
        qb.andWhere("record.id IN (:...populated)", {
          populated: populated.map((row) => row.id),
        });
      else qb.andWhere("1 = 0");
    }
    const [items, total] = await qb
      .orderBy(
        kind === "blog-categories" ? "record.sortOrder" : "record.createdAt",
        kind === "blog-categories" ? "ASC" : "DESC",
      )
      .addOrderBy("record.id", "ASC")
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    const serialized = items.map((item) => {
      const row = this.serialize(kind, item, publicOnly);
      delete row.body;
      return row;
    });
    return {
      items: publicOnly ? await this.publicMedia(serialized) : serialized,
      total,
      page,
      limit,
    };
  }
  serialize(kind: ContentKind, record: FullContent, publicOnly = false) {
    const result = { ...record } as FullContent & {
      categoryIds?: string[];
      serviceIds?: string[];
      coverUrl?: string | null;
      ogImageUrl?: string | null;
    };
    result.coverUrl = record.coverId ? `/media/${record.coverId}` : null;
    result.ogImageUrl = record.ogImageId ? `/media/${record.ogImageId}` : null;
    if (kind === "posts") {
      result.categories = (record.categories ?? []).filter(
        (c) => !publicOnly || c.status === "published",
      );
      result.categoryIds = result.categories.map((c) => c.id);
    }
    if (kind === "projects") {
      result.serviceIds = (record.services ?? []).map((s) => s.id);
      if (publicOnly)
        return {
          ...result,
          services: (record.services ?? [])
            .filter(
              (s) =>
                s.status === ServiceStatus.PUBLISHED &&
                s.category.status === "published",
            )
            .map(toPublicService),
        };
    }
    return result;
  }
  async publicMedia<
    T extends Pick<ContentRecord, "coverId" | "title"> & {
      galleryIds?: string[];
      body?: BlogPost["body"];
    },
  >(rows: T[]) {
    const ids = rows
      .flatMap((row) => [
        row.coverId,
        ...(row.galleryIds ?? []),
        ...(row.body ? richMedia(row.body) : []),
      ])
      .filter((id): id is string => !!id);
    const assets = ids.length
      ? await this.db.getRepository(MediaAsset).findBy({ id: In(ids) })
      : [];
    const byId = new Map(assets.map((a) => [a.id, a]));
    const body = (node: BlogPost["body"]): BlogPost["body"] => ({
      ...node,
      ...(node.type === "image"
        ? {
            attrs: {
              ...node.attrs,
              alt:
                node.attrs?.alt ||
                byId.get(String(node.attrs?.mediaId))?.alt ||
                "",
            },
          }
        : {}),
      ...(node.content ? { content: node.content.map(body) } : {}),
    });
    return rows.map((row) => ({
      ...row,
      coverAlt: byId.get(row.coverId ?? "")?.alt || row.title,
      gallery: (row.galleryIds ?? []).map((id) => ({
        id,
        alt: byId.get(id)?.alt || row.title,
      })),
      ...(row.body ? { body: body(row.body) } : {}),
    }));
  }
  async publicDetail(kind: ContentKind, slug: string) {
    const row = await this.repo(kind).findOneBy({ slug, status: "published" });
    if (!row) throw new NotFoundException();
    if (
      kind === "blog-categories" &&
      !(await this.list("posts", { category: slug, limit: "1" }, true)).total
    )
      throw new NotFoundException();
    return (
      await this.publicMedia([
        this.serialize(kind, await this.content(kind, row.id), true),
      ])
    )[0];
  }
  async saveContent(kind: ContentKind, body: unknown, id?: string) {
    const parsed =
      kind === "posts"
        ? parseInput(postInput, body)
        : kind === "projects"
          ? parseInput(projectInput, body)
          : parseInput(categoryInput, body);
    if ("body" in parsed) parsed.body = validateRichText(parsed.body);
    if (
      parsed.status === "published" &&
      kind !== "blog-categories" &&
      (!parsed.excerpt.trim() ||
        ("body" in parsed &&
          !richText(parsed.body as BlogPost["body"]).trim()) ||
        ("task" in parsed &&
          (!parsed.task.trim() ||
            !parsed.solution.trim() ||
            !parsed.result.trim())))
    )
      throw new BadRequestException("Complete content before publication");
    try {
      return await this.db.transaction(async (manager) => {
        const repo = this.repo(kind, manager);
        const record = id
          ? await this.content(kind, id, manager)
          : (repo.create({ publishedAt: null }) as FullContent);
        if (id && record.publishedAt && parsed.slug !== record.slug)
          throw new ConflictException("Published URL cannot change");
        const { ...values } = parsed;
        Object.assign(record, values);
        if (parsed.status === "published" && !record.publishedAt)
          record.publishedAt = new Date();
        if ("categoryIds" in parsed) {
          const categories = await manager
            .getRepository(BlogCategory)
            .findBy({ id: In(parsed.categoryIds) });
          if (categories.length !== new Set(parsed.categoryIds).size)
            throw new BadRequestException("Invalid categories");
          record.categories = categories;
        }
        if ("serviceIds" in parsed) {
          const services = await manager.getRepository(Service).find({
            where: { id: In(parsed.serviceIds) },
            relations: { category: true, media: true },
          });
          if (services.length !== new Set(parsed.serviceIds).size)
            throw new BadRequestException("Invalid services");
          record.services = services;
        }
        const saved = (await repo.save(record)) as FullContent;
        const refs = [
          parsed.coverId,
          parsed.ogImageId,
          ...("body" in parsed
            ? richMedia(parsed.body as BlogPost["body"])
            : []),
          ...("galleryIds" in parsed ? parsed.galleryIds : []),
        ].filter((v): v is string => !!v);
        await this.trackMedia(manager, kind, saved.id, refs);
        return this.serialize(kind, saved);
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505")
        throw new ConflictException("URL already exists");
      throw error;
    }
  }
  async deleteContent(kind: "posts" | "projects", id: string) {
    await this.db.transaction(async (manager) => {
      const record = await this.content(kind, id, manager);
      await manager
        .getRepository(MediaUse)
        .delete({ ownerType: kind, ownerId: id });
      await this.repo(kind, manager).remove(record);
    });
    return { deleted: true };
  }

  async deleteCategory(id: string) {
    const category = await this.content("blog-categories", id);
    await this.db.transaction(async (manager) => {
      await manager
        .getRepository(BlogCategory)
        .findOne({ where: { id }, lock: { mode: "pessimistic_write" } });
      const used = await manager
        .getRepository(BlogPost)
        .createQueryBuilder("post")
        .innerJoin("post.categories", "category", "category.id = :id", { id })
        .getCount();
      if (used) throw new ConflictException("Category is used");
      await manager
        .getRepository(MediaUse)
        .delete({ ownerType: "blog-categories", ownerId: id });
      await manager
        .getRepository(BlogCategory)
        .remove(category as BlogCategory);
    });
  }
  async trackMedia(
    manager: EntityManager,
    ownerType: string,
    ownerId: string,
    ids: string[],
  ) {
    await manager.getRepository(MediaUse).delete({ ownerType, ownerId });
    for (const id of new Set(ids)) {
      if (
        !uuid.safeParse(id).success ||
        !(await manager.getRepository(MediaAsset).existsBy({ id }))
      )
        throw new BadRequestException("Invalid media");
      await manager
        .getRepository(MediaUse)
        .save({ ownerType, ownerId, mediaId: id, slot: id });
    }
  }
  async settings(): Promise<
    Record<string, unknown> & {
      policyVersion: string;
      telegramConfigured: boolean;
    }
  > {
    const data = await this.db
      .getRepository(SiteSettings)
      .findOneBy({ id: "main" });
    if (!data) throw new NotFoundException();
    return {
      ...data.data,
      policyVersion: data.policyVersion,
      telegramConfigured: !!(
        process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_LEADS_CHAT_ID
      ),
    };
  }
  async contacts() {
    const data = await this.settings();
    return parseInput(
      contactsInput,
      Object.fromEntries(
        Object.keys(contactsInput.shape).map((key) => [key, data[key]]),
      ),
    );
  }
  async saveContacts(body: unknown) {
    const input = parseInput(contactsInput, body);
    await this.db.transaction(async (manager) => {
      const row = await manager.getRepository(SiteSettings).findOne({
        where: { id: "main" },
        lock: { mode: "pessimistic_write" },
      });
      if (!row) throw new NotFoundException();
      row.data = { ...row.data, ...input };
      await manager.getRepository(SiteSettings).save(row);
    });
    return this.contacts();
  }
  async saveSettings(body: unknown) {
    const input = parseInput(settingsInput, body);
    input.privacyBody = validateRichText(input.privacyBody);
    if (
      input.privacyPublished &&
      (!richText(input.privacyBody as BlogPost["body"]).trim() ||
        !input.consentText.trim())
    )
      throw new BadRequestException("Publish an approved policy and consent");
    return this.db.transaction(async (manager) => {
      const row = await manager.getRepository(SiteSettings).findOne({
        where: { id: "main" },
        lock: { mode: "pessimistic_write" },
      });
      if (!row) throw new NotFoundException();
      if (
        JSON.stringify(row.data.privacyBody) !==
          JSON.stringify(input.privacyBody) ||
        row.data.consentText !== input.consentText ||
        row.data.privacyPublished !== input.privacyPublished
      )
        row.policyVersion = randomUUID();
      row.data = input;
      await manager.getRepository(SiteSettings).save(row);
      const refs = [input.heroLight, input.heroDark]
        .filter((v) => v.startsWith("/media/"))
        .map((v) => v.slice(7));
      await this.trackMedia(manager, "settings", "main", refs);
      await this.trackMedia(
        manager,
        "policy",
        "main",
        richMedia(input.privacyBody as BlogPost["body"]),
      );
      return { ...row.data, policyVersion: row.policyVersion };
    });
  }
  async pages() {
    return this.db.getRepository(SitePage).find({ order: { id: "ASC" } });
  }
  async savePage(id: string, body: unknown) {
    const input = parseInput(pageInput, body);
    const page = await this.db.getRepository(SitePage).findOneBy({ id });
    if (!page) throw new NotFoundException();
    if (
      new Set(input.document.fields.map((f) => f.id)).size !==
      input.document.fields.length
    )
      throw new BadRequestException("Duplicate section");
    return this.db.transaction(async (manager) => {
      Object.assign(page, input);
      await manager.getRepository(SitePage).save(page);
      await this.trackMedia(
        manager,
        "pages",
        id,
        [
          input.ogImageId,
          ...input.document.fields
            .filter((f) => f.visible)
            .map((f) => f.imageId),
        ].filter((v): v is string => !!v),
      );
      return page;
    });
  }
  async bootstrap() {
    const saved = await this.settings();
    const contacts = await this.contacts();
    return {
      media: {},
      pages: [],
      settings: {
        ...defaultSettings,
        ...contacts,
        ...privacyDocuments(saved),
      },
    };
  }
  async mediaList(query: Record<string, string>) {
    const search = (query.search ?? "").slice(0, 200);
    const page = Math.max(1, Math.min(10000, Number(query.page) || 1));
    const qb = this.db.getRepository(MediaAsset).createQueryBuilder("media");
    if (search)
      qb.where("media.title ILIKE :search", { search: `%${search}%` });
    const usage =
      '(EXISTS (SELECT 1 FROM cms_media_uses u WHERE u."mediaId" = media.id) OR EXISTS (SELECT 1 FROM services s WHERE s.media_id = media.id))';
    if (query.status === "used") qb.andWhere(usage);
    if (query.status === "unused") qb.andWhere("NOT " + usage);
    const [items, total] = await qb
      .orderBy("media.createdAt", "DESC")
      .skip((page - 1) * 24)
      .take(24)
      .getManyAndCount();
    return {
      items: items.map((m) => ({
        ...m,
        objectKey: undefined,
        url: `/media/${m.id}`,
        previewUrl: `/api/admin/cms/media/${m.id}/file`,
      })),
      total,
      page,
      limit: 24,
    };
  }
  async upload(body: unknown) {
    const input = parseInput(mediaUploadInput, body);
    const optimized = await this.storage.optimize(input.bytes, input.mime);
    const key = await this.storage.put(optimized.bytes);
    try {
      const saved = await this.db.getRepository(MediaAsset).save({
        title: input.title,
        alt: input.alt,
        objectKey: key,
        mime: "image/webp",
        size: optimized.bytes.length,
        width: optimized.width,
        height: optimized.height,
      });
      return {
        ...saved,
        objectKey: undefined,
        url: `/media/${saved.id}`,
        previewUrl: `/api/admin/cms/media/${saved.id}/file`,
      };
    } catch (error) {
      await this.storage.remove(key).catch(() => undefined);
      throw error;
    }
  }
  async updateMedia(id: string, body: unknown) {
    const input = parseInput(mediaInput, body);
    const row = await this.db.getRepository(MediaAsset).findOneBy({ id });
    if (!row) throw new NotFoundException();
    Object.assign(row, input);
    await this.db.getRepository(MediaAsset).save(row);
    return { ...row, objectKey: undefined };
  }
  async deleteMedia(id: string) {
    return this.db.transaction(async (manager) => {
      const asset = await manager
        .getRepository(MediaAsset)
        .findOne({ where: { id }, lock: { mode: "pessimistic_write" } });
      if (!asset) throw new NotFoundException();
      const uses = await manager
        .getRepository(MediaUse)
        .countBy({ mediaId: id });
      const services = await manager
        .getRepository(Service)
        .countBy({ mediaId: id });
      if (uses || services) throw new ConflictException("Image is used");
      await this.storage.remove(asset.objectKey);
      await manager.getRepository(MediaAsset).remove(asset);
      return { deleted: true };
    });
  }
  async mediaFile(id: string, publicOnly: boolean) {
    const media = await this.db.getRepository(MediaAsset).findOneBy({ id });
    if (!media) throw new NotFoundException();
    if (publicOnly) {
      let visible = !!(await this.db
        .getRepository(Service)
        .createQueryBuilder("service")
        .innerJoin("service.category", "category")
        .where(
          "service.mediaId = :id AND service.status = :serviceStatus AND category.status = :categoryStatus",
          { id, serviceStatus: "published", categoryStatus: "published" },
        )
        .getCount());
      const uses = await this.db
        .getRepository(MediaUse)
        .findBy({ mediaId: id });
      for (const use of uses) {
        if (
          use.ownerType === "policy" &&
          (await this.settings()).privacyPublished
        )
          visible = true;
        else if (
          use.ownerType in kinds &&
          (await this.repo(use.ownerType as ContentKind).existsBy({
            id: use.ownerId,
            status: "published",
          }))
        )
          visible = true;
      }
      if (!visible) throw new NotFoundException();
    }
    return this.storage.get(media.objectKey);
  }
  async leads(query: Record<string, string>) {
    const qb = this.db.getRepository(Lead).createQueryBuilder("lead");
    if (query.status)
      qb.where("lead.status = :status", { status: query.status });
    if (query.search)
      qb.andWhere("(lead.name ILIKE :search OR lead.phone ILIKE :search)", {
        search: `%${query.search.slice(0, 100)}%`,
      });
    const page = Math.max(1, Number(query.page) || 1);
    const [items, total] = await qb
      .orderBy("lead.createdAt", "DESC")
      .skip((page - 1) * 30)
      .take(30)
      .getManyAndCount();
    const notifications = items.length
      ? await this.db
          .getRepository(NotificationOutbox)
          .findBy({ leadId: In(items.map((l) => l.id)) })
      : [];
    return {
      items: items.map((l) => ({
        ...l,
        notificationStatus:
          notifications.find((n) => n.leadId === l.id)?.status ?? "disabled",
      })),
      total,
      page,
      limit: 30,
    };
  }
  async getLead(id: string) {
    const row = await this.db.getRepository(Lead).findOneBy({ id });
    if (!row) throw new NotFoundException();
    const event = await this.db
      .getRepository(NotificationOutbox)
      .findOneBy({ leadId: id });
    return { ...row, notificationStatus: event?.status ?? "disabled" };
  }
  async updateLead(id: string, body: unknown) {
    const input = parseInput(leadUpdate, body);
    const row = await this.db.getRepository(Lead).findOneBy({ id });
    if (!row) throw new NotFoundException();
    Object.assign(row, input);
    return this.db.getRepository(Lead).save(row);
  }
  async dashboard() {
    const [services, categories, posts, drafts, projects, leads, recent] =
      await Promise.all([
        this.db.getRepository(Service).count(),
        this.db.query<{ count: number }[]>(
          "SELECT count(*)::int AS count FROM service_categories",
        ),
        this.repo("posts").countBy({ status: "published" }),
        this.repo("posts").countBy({ status: "draft" }),
        this.repo("projects").countBy({ status: "published" }),
        this.db.getRepository(Lead).countBy({ status: "new" }),
        this.leads({ page: "1" }),
      ]);
    return {
      services,
      categories: Number(categories[0].count),
      posts,
      drafts,
      projects,
      leads,
      recent: recent.items.slice(0, 5),
    };
  }
  async seo() {
    const pages = await this.pages();
    const content = (
      await Promise.all(
        (Object.keys(kinds) as ContentKind[]).map(async (kind) =>
          (await this.repo(kind).find()).map((item) => ({ kind, ...item })),
        ),
      )
    ).flat();
    const services = (
      await this.db.getRepository(Service).find({
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          seoTitle: true,
          seoDescription: true,
          description: true,
        },
      })
    ).map((service) => ({ kind: "services", ...service }));
    return { pages, content: [...content, ...services] };
  }
}
