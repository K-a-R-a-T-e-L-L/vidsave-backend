// Real PostgreSQL leases and the local provider only; never run against user data.
require("reflect-metadata");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { DataSource, In } = require("typeorm");
const { Service } = require("../dist/modules/services/entities/service.entity");
const {
  ServiceCategory,
} = require("../dist/modules/service-categories/entities/service-category.entity");
const {
  cmsEntities,
  Lead,
  NotificationOutbox,
} = require("../dist/modules/cms/cms.entities");
const { LeadsService } = require("../dist/modules/cms/leads.service");
(async () => {
  assert.equal(process.env.DATABASE_NAME, "vidsave_stage5_test");
  assert.equal(
    process.env.TELEGRAM_API_BASE_URL,
    "http://vidsave-stage5-telegram:8080",
  );
  const db = new DataSource({
    type: "postgres",
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT),
    username: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    entities: [Service, ServiceCategory, ...cmsEntities],
    synchronize: false,
  });
  await db.initialize();
  const leads = [],
    events = [];
  try {
    // Future availability prevents the fixture's regular worker from claiming partially seeded rows.
    for (let i = 0; i < 8; i++) {
      const lead = await db.getRepository(Lead).save({
        requestKey: randomUUID(),
        name: "Изолированная проверка конкуренции",
        phone: "+79005554628",
        source: "fixture",
        sourceUrl: "/contacts",
        policyVersion: randomUUID(),
        consentText: "Только тестовые данные",
        consentAt: new Date(),
      });
      leads.push(lead.id);
      events.push(
        (
          await db.getRepository(NotificationOutbox).save({
            leadId: lead.id,
            availableAt: new Date(Date.now() + 60000),
          })
        ).id,
      );
    }
    await db
      .getRepository(NotificationOutbox)
      .update({ id: In(events) }, { availableAt: new Date() });
    const workers = [new LeadsService(db), new LeadsService(db)];
    for (let i = 0; i < 10; i++)
      await Promise.all(workers.map((worker) => worker.deliver()));
    const rows = await db
      .getRepository(NotificationOutbox)
      .findBy({ id: In(events) });
    assert.equal(rows.length, 8);
    for (const row of rows) {
      assert.equal(row.status, "sent");
      assert.equal(row.attempts, 1);
      assert.equal(row.leaseToken, null);
      assert.equal(row.leaseUntil, null);
    }
    const fixture = await (
      await fetch(process.env.TELEGRAM_API_BASE_URL + "/status")
    ).json();
    for (const id of leads)
      assert.equal(fixture.ids.filter((sent) => sent === id).length, 1);
    console.log(
      "Two concurrent workers delivered all eight PostgreSQL events exactly once in the local provider; leases cleared",
    );
  } finally {
    if (events.length)
      await db.getRepository(NotificationOutbox).delete({ id: In(events) });
    if (leads.length) await db.getRepository(Lead).delete({ id: In(leads) });
    await db.destroy();
    console.log(
      "Concurrency fixture rows removed and database connection closed",
    );
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
