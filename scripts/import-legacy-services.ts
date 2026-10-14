import "reflect-metadata";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { DataSource, EntityManager, In, IsNull, Not } from "typeorm";
import { TypeOrmModule } from "@nestjs/typeorm";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import { AppEnvironment, validateEnvironment } from "../src/config/env.schema";
import { createDatabaseConfig } from "../src/config/database.config";
import { AdminAuthRateLimit } from "../src/modules/admin-auth/entities/admin-auth-rate-limit.entity";
import { AdminSession } from "../src/modules/admin-auth/entities/admin-session.entity";
import { AdminUser } from "../src/modules/admin-auth/entities/admin-user.entity";
import {
  ServiceCategory,
  ServiceCategoryStatus,
} from "../src/modules/service-categories/entities/service-category.entity";
import {
  Service,
  ServicePriceMode,
  ServiceStatus,
} from "../src/modules/services/entities/service.entity";

import { cmsEntities } from "../src/modules/cms/cms.entities";

interface LegacyService {
  id: number;
  name: string;
  serviceName: string;
  category: string;
  price: number;
  unit: string;
  description: string;
  from: string;
}

interface LegacyCategory {
  legacyFeedId: number;
  name: string;
  slug: string;
}

const LOCK_KEY = "vidsave:legacy-service-catalog-import:v1";
const categories: LegacyCategory[] = [
  {
    legacyFeedId: 1,
    name: "Установка и настройка систем видеонаблюдения",
    slug: "ustanovka-i-nastroika-sistem-videonablyudeniya",
  },
  {
    legacyFeedId: 2,
    name: "Монтаж и обслуживание кондиционеров",
    slug: "montazh-i-obsluzhivanie-kondicionerov",
  },
  {
    legacyFeedId: 3,
    name: "Установка видеорегистраторов",
    slug: "ustanovka-videoregistratorov",
  },
  {
    legacyFeedId: 4,
    name: "Электромонтажные работы",
    slug: "elektromontazhnye-raboty",
  },
  {
    legacyFeedId: 5,
    name: "Установка и настройка роутеров",
    slug: "ustanovka-i-nastroika-routerov",
  },
  {
    legacyFeedId: 6,
    name: "Замена жёсткого диска",
    slug: "zamena-zhestkogo-diska",
  },
  {
    legacyFeedId: 7,
    name: "Подключение POE коммутатора",
    slug: "podklyuchenie-poe-kommutatora",
  },
];
const categoryByName = new Map(
  categories.map((category) => [category.name, category]),
);

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnvironment>) => ({
        ...createDatabaseConfig(config),
        entities: [
          AdminUser,
          AdminSession,
          AdminAuthRateLimit,
          ServiceCategory,
          Service,
          ...cmsEntities,
        ],
        autoLoadEntities: false,
        synchronize: false,
      }),
    }),
  ],
})
class CatalogImportDatabaseModule {}

async function main(): Promise<void> {
  const mode = process.argv.slice(2);
  if (mode.length !== 1 || !["--dry-run", "--apply"].includes(mode[0])) {
    throw new Error("Use exactly one mode: --dry-run or --apply");
  }
  const source = readLegacySource();
  const errors = validateSource(source);
  if (errors.length) {
    process.stderr.write(
      `Legacy source validation failed (${errors.length}):\n${errors.map((error) => `- ${error}`).join("\n")}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(
    CatalogImportDatabaseModule,
    {
      logger: ["error", "warn"],
    },
  );
  try {
    const dataSource = app.get(DataSource);
    const sourceCategoryByName = categoryByName;
    await dataSource.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        LOCK_KEY,
      ]);
      const conflicts = await findConflicts(
        manager,
        source,
        sourceCategoryByName,
      );
      if (conflicts.length) {
        throw new Error(
          `Import conflict (${conflicts.length}):\n${conflicts.map((item) => `- ${item}`).join("\n")}`,
        );
      }
      const inserted =
        mode[0] === "--apply"
          ? await applySource(manager, source, sourceCategoryByName)
          : new Set<number>();
      if (mode[0] === "--apply") {
        await verifySource(manager, source, sourceCategoryByName, inserted);
      }
    });
    const imported = await dataSource.getRepository(Service).count({
      where: { legacyId: Not(IsNull()) },
    });
    process.stdout.write(
      `Legacy catalog ${mode[0] === "--apply" ? "apply" : "dry-run"} passed: ${source.length} services, ${categories.length} source YML categories, ${new Set(source.map((item) => item.category)).size} used categories; all source fields and ${source.length} images verified.${imported === undefined ? "" : ` Existing imported records: ${imported}.`}\n`,
    );
  } finally {
    await app.close();
  }
}

function readLegacySource(): LegacyService[] {
  const frontendRoot = process.env.VIDSAVE_FRONTEND_ROOT
    ? resolve(process.env.VIDSAVE_FRONTEND_ROOT)
    : resolve(process.cwd(), "..", "vidsave-frontend");
  const sourcePath = resolve(frontendRoot, "src/app/lib/servicesList.ts");
  if (!existsSync(sourcePath))
    throw new Error(`Legacy source not found: ${sourcePath}`);
  const sourceText = readFileSync(sourcePath, "utf8");
  const compiled = ts.transpileModule(sourceText, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const sourceExports: Record<string, unknown> = {};
  new Function("exports", "require", compiled)(
    sourceExports,
    createRequire(sourcePath),
  );
  const value = sourceExports.servicesList;
  if (!Array.isArray(value))
    throw new Error("Legacy source does not export servicesList");
  return value as LegacyService[];
}

function validateSource(source: LegacyService[]): string[] {
  const errors: string[] = [];
  const frontendRoot = process.env.VIDSAVE_FRONTEND_ROOT
    ? resolve(process.env.VIDSAVE_FRONTEND_ROOT)
    : resolve(process.cwd(), "..", "vidsave-frontend");
  if (source.length !== 23)
    errors.push(`Expected 23 services, found ${source.length}`);
  const ids = source.map((item) => item?.id);
  const slugs = source.map((item) => item?.serviceName);
  if (new Set(ids).size !== ids.length)
    errors.push("Legacy service IDs are not unique");
  if (new Set(slugs).size !== slugs.length)
    errors.push("Legacy service slugs are not unique");
  const categoryIds = new Set<number>();
  for (const item of source) {
    if (!Number.isSafeInteger(item.id) || item.id < 1)
      errors.push(`Invalid legacy ID: ${item.id}`);
    if (typeof item.name !== "string" || !item.name.length)
      errors.push(`Service ${item.id}: missing name`);
    if (typeof item.serviceName !== "string" || !item.serviceName.length)
      errors.push(`Service ${item.id}: missing slug`);
    if (typeof item.description !== "string" || !item.description.length)
      errors.push(`Service ${item.id}: missing description`);
    if (!Number.isSafeInteger(item.price) || item.price < 0)
      errors.push(
        `Service ${item.id}: price is not an exact non-negative integer`,
      );
    if (typeof item.unit !== "string")
      errors.push(`Service ${item.id}: invalid unit`);
    const category = categoryByName.get(item.category);
    if (!category)
      errors.push(
        `Service ${item.id}: unknown YML category ${JSON.stringify(item.category)}`,
      );
    else categoryIds.add(category.legacyFeedId);
    const image = resolve(
      frontendRoot,
      `public/images/services/service${item.id}.png`,
    );
    if (!existsSync(image)) errors.push(`Service ${item.id}: image is missing`);
    if (item.from !== "" && item.from !== "от")
      errors.push(`Service ${item.id}: unsupported original price qualifier`);
  }
  if (categoryIds.size !== categories.length)
    errors.push(
      `Expected all 7 actual YML categories, found ${categoryIds.size}`,
    );
  return errors;
}

async function findConflicts(
  manager: EntityManager,
  source: LegacyService[],
  sourceCategories: Map<string, LegacyCategory>,
): Promise<string[]> {
  const errors: string[] = [];
  const categoryRepo = manager.getRepository(ServiceCategory);
  const serviceRepo = manager.getRepository(Service);
  for (const expected of categories) {
    const category = await categoryRepo.findOne({
      where: { legacyFeedId: expected.legacyFeedId },
    });
    if (!category) {
      const slugConflict = await categoryRepo.exists({
        where: { slug: expected.slug },
      });
      if (slugConflict)
        errors.push(`Category slug is already used: ${expected.slug}`);
    }
  }
  for (const item of source) {
    const service = await serviceRepo.findOne({ where: { legacyId: item.id } });
    if (service && service.legacyChecksum !== checksum(item)) {
      errors.push(
        `Service legacyId=${item.id} has a changed source checksum or is not an importer-owned record`,
      );
      continue;
    }
    if (
      !service &&
      (await serviceRepo.exists({ where: { slug: item.serviceName } }))
    ) {
      errors.push(
        `Service slug is already used by a non-imported record: ${item.serviceName}`,
      );
    }
    if (!sourceCategories.has(item.category))
      errors.push(`Service ${item.id} category mapping is missing`);
  }
  return errors;
}

async function applySource(
  manager: EntityManager,
  source: LegacyService[],
  sourceCategories: Map<string, LegacyCategory>,
): Promise<Set<number>> {
  const categoryRepo = manager.getRepository(ServiceCategory);
  const serviceRepo = manager.getRepository(Service);
  const categoriesByName = new Map<string, ServiceCategory>();
  const inserted = new Set<number>();
  for (const expected of categories) {
    let category = await categoryRepo.findOne({
      where: { legacyFeedId: expected.legacyFeedId },
    });
    if (!category) {
      category = await categoryRepo.save(
        categoryRepo.create({
          name: expected.name,
          slug: expected.slug,
          description: null,
          sortOrder: expected.legacyFeedId - 1,
          legacyFeedId: expected.legacyFeedId,
          status: ServiceCategoryStatus.PUBLISHED,
          seoTitle: null,
          seoDescription: null,
        }),
      );
    }
    categoriesByName.set(expected.name, category);
  }
  for (const item of source) {
    if (await serviceRepo.exists({ where: { legacyId: item.id } })) continue;
    const sourceCategory = sourceCategories.get(item.category);
    const category =
      sourceCategory && categoriesByName.get(sourceCategory.name);
    if (!category)
      throw new Error(`Category was not created for service ${item.id}`);
    await serviceRepo.save(
      serviceRepo.create({
        legacyId: item.id,
        name: item.name,
        slug: item.serviceName,
        description: item.description,
        details: null,
        category,
        priceRub: formatPrice(item.price),
        priceMode:
          item.from === "от" ? ServicePriceMode.FROM : ServicePriceMode.FIXED,
        unitLabel: item.unit,
        sortOrder: item.id - 1,
        legacyImagePath: `/images/services/service${item.id}.png`,
        status: ServiceStatus.PUBLISHED,
        seoTitle: null,
        seoDescription: null,
        legacyChecksum: checksum(item),
        legacyPriceQualifier: item.from,
      }),
    );
    inserted.add(item.id);
  }
  return inserted;
}

async function verifySource(
  manager: EntityManager,
  source: LegacyService[],
  sourceCategories: Map<string, LegacyCategory>,
  newlyInserted: Set<number>,
): Promise<void> {
  const repository = manager.getRepository(Service);
  const imported = await repository.find({
    where: { legacyId: In(source.map((item) => item.id)) },
    relations: { category: true },
  });
  const byId = new Map(imported.map((service) => [service.legacyId, service]));
  const failures: string[] = [];
  for (const item of source) {
    const service = byId.get(item.id);
    const expectedCategory = sourceCategories.get(item.category);
    if (!service) {
      failures.push(`Missing imported service ${item.id}`);
      continue;
    }
    const checks: Array<[string, boolean]> = [
      ["legacy ID", service.legacyId === item.id],
      ["source checksum", service.legacyChecksum === checksum(item)],
    ];
    if (newlyInserted.has(item.id))
      checks.push(
        ["name", service.name === item.name],
        ["slug", service.slug === item.serviceName],
        ["description", service.description === item.description],
        ["price", service.priceRub === formatPrice(item.price)],
        ["unit", service.unitLabel === item.unit],
        ["price qualifier", service.legacyPriceQualifier === item.from],
        [
          "price mode",
          service.priceMode ===
            (item.from === "от"
              ? ServicePriceMode.FROM
              : ServicePriceMode.FIXED),
        ],
        ["published status", service.status === ServiceStatus.PUBLISHED],
        [
          "image path",
          service.legacyImagePath === `/images/services/service${item.id}.png`,
        ],
        [
          "category",
          service.category.legacyFeedId === expectedCategory?.legacyFeedId &&
            service.category.name === item.category,
        ],
      );
    for (const [field, okay] of checks)
      if (!okay)
        failures.push(`Service ${item.id}: ${field} differs from source`);
  }
  if (imported.length !== source.length)
    failures.push(
      `Expected ${source.length} imported rows, found ${imported.length}`,
    );
  const importedCount = await repository.count({
    where: { legacyId: Not(IsNull()) },
  });
  if (importedCount !== 23)
    failures.push(`Expected 23 imported records, found ${importedCount}`);
  if (failures.length)
    throw new Error(
      `Post-import verification failed (${failures.length}):\n${failures.map((item) => `- ${item}`).join("\n")}`,
    );
}

function checksum(item: LegacyService): string {
  const canonical = JSON.stringify([
    item.id,
    item.name,
    item.serviceName,
    item.category,
    item.price,
    item.unit,
    item.description,
    item.from,
  ]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function formatPrice(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Legacy source price cannot be represented exactly");
  }
  return `${String(value)}.00`;
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Legacy catalog import failed"}\n`,
  );
  process.exitCode = 1;
});
