// Explicit disposable database only. Never a production seed or automatic catalog reset.
require("reflect-metadata");
const { DataSource } = require("typeorm");
const { Service } = require("../dist/modules/services/entities/service.entity");
const {
  ServiceCategory,
} = require("../dist/modules/service-categories/entities/service-category.entity");
const {
  AdminUser,
} = require("../dist/modules/admin-auth/entities/admin-user.entity");
const {
  AdminSession,
} = require("../dist/modules/admin-auth/entities/admin-session.entity");
const {
  AdminAuthRateLimit,
} = require("../dist/modules/admin-auth/entities/admin-auth-rate-limit.entity");
const { cmsEntities } = require("../dist/modules/cms/cms.entities");
const fs = require("node:fs");
(async () => {
  if (process.env.DATABASE_NAME !== "vidsave_stage5_test")
    throw new Error("Disposable stage5 test database required");
  const fixture = JSON.parse(fs.readFileSync("/fixture/catalog.json", "utf8"));
  const db = new DataSource({
    type: "postgres",
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT),
    username: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    entities: [
      Service,
      ServiceCategory,
      AdminUser,
      AdminSession,
      AdminAuthRateLimit,
      ...cmsEntities,
    ],
    synchronize: false,
  });
  await db.initialize();
  try {
    const categories = new Map();
    for (const item of fixture.categories) {
      let category = await db
        .getRepository(ServiceCategory)
        .findOneBy({ legacyFeedId: item.legacyFeedId });
      if (!category)
        category = await db.getRepository(ServiceCategory).save({
          name: item.name,
          slug: item.slug,
          legacyFeedId: item.legacyFeedId,
          sortOrder: item.sortOrder,
          status: "published",
        });
      categories.set(item.id, category);
    }
    for (const item of fixture.services) {
      if (await db.getRepository(Service).existsBy({ legacyId: item.legacyId }))
        continue;
      await db.getRepository(Service).save({
        legacyId: item.legacyId,
        name: item.name,
        slug: item.slug,
        description: item.description,
        details: item.details,
        category: categories.get(item.category.id),
        priceRub: item.priceRub,
        priceMode: item.priceMode,
        unitLabel: item.unitLabel,
        sortOrder: item.sortOrder,
        legacyImagePath: item.imagePath,
        status: "published",
        seoTitle: item.seoTitle,
        seoDescription: item.seoDescription,
        mediaId: null,
        slugLocked: true,
      });
    }
    if (
      !(await db
        .getRepository(AdminUser)
        .existsBy({ email: "stage5-user@example.test" }))
    )
      await db.getRepository(AdminUser).save({
        email: "stage5-user@example.test",
        role: "USER",
        isActive: true,
        passwordHash: await require("bcryptjs").hash(
          "Stage5-test-only-user-password-12345",
          12,
        ),
      });
    console.log(
      "Disposable legacy fixture seeded: 23 services, 7 categories; existing records retained",
    );
  } finally {
    await db.destroy();
  }
})().catch((error) => {
  console.error(error.name);
  process.exitCode = 1;
});
