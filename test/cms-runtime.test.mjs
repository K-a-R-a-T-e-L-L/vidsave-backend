import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import test from "node:test";
const base = process.env.VIDSAVE_CMS_TEST_URL;
if (base !== "http://127.0.0.1:3141")
  throw new Error(
    "CMS tests require the explicitly isolated Stage 5 API on port 3141",
  );
const slug = "fixture-" + randomUUID();
let token = "",
  refresh = "",
  settings;
async function request(
  path,
  method = "GET",
  body,
  expected = 200,
  auth = true,
) {
  const r = await fetch(base + "/api/" + path, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(auth && token ? { authorization: "Bearer " + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  assert.equal(r.status, expected, `${method} ${path}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}
const doc = (text) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
test("real PostgreSQL/S3: strict CMS publication, private media, consent and transactional leads", async () => {
  const auth = await request(
    "admin/auth/login",
    "POST",
    {
      email: "stage5-admin@example.test",
      password: "Stage5-test-only-password-12345",
    },
    200,
    false,
  );
  token = auth.accessToken;
  refresh = auth.refreshToken;
  assert.ok(token && refresh);
  await request("admin/cms/posts", "GET", undefined, 401, false);
  settings = await request("admin/cms/contacts");
  const original = { ...settings };
  try {
    await request("admin/cms/posts?page=Infinity", "GET", undefined, 400);
    await request("admin/cms/posts?search[x]=bad", "GET", undefined, 400);
    await request(
      "admin/cms/blog-categories",
      "POST",
      {
        title: "Недопустимо",
        slug: slug + "-bad",
        status: "draft",
        role: "ADMIN",
      },
      400,
    );
    const category = await request(
      "admin/cms/blog-categories",
      "POST",
      {
        title: "Тестовая категория",
        slug: slug + "-category",
        status: "published",
      },
      201,
    );
    assert.ok(
      !(
        await request("content/blog-categories", "GET", undefined, 200, false)
      ).items.some((c) => c.id === category.id),
    );
    const bytes = (
      await readFile(
        new URL(
          "../../vidsave-frontend/tests/fixtures/upload-32.png",
          import.meta.url,
        ),
      )
    ).toString("base64");
    const media = await request(
      "admin/cms/media",
      "POST",
      {
        title: "Тестовое изображение",
        alt: "Точный альтернативный текст",
        mime: "image/png",
        bytes,
      },
      201,
    );
    const privateFile = await fetch(
      base + "/api/admin/cms/media/" + media.id + "/file",
      { headers: { authorization: "Bearer " + token } },
    );
    assert.equal(privateFile.status, 200);
    assert.equal(privateFile.headers.get("content-type"), "image/webp");
    assert.equal(privateFile.headers.get("cache-control"), "no-store");
    await request("content/media/" + media.id, "GET", undefined, 404, false);
    await request(
      "admin/cms/media",
      "POST",
      {
        title: "SVG",
        mime: "image/png",
        bytes: Buffer.from('<svg onload="alert(1)"></svg>').toString("base64"),
      },
      400,
    );
    const postPayload = {
      title: "Проверяемая статья",
      slug,
      excerpt: "Описание настоящего тестового материала",
      status: "draft",
      coverId: media.id,
      body: doc("Проверяемый текст"),
      categoryIds: [category.id],
    };
    const post = await request("admin/cms/posts", "POST", postPayload, 201);
    await request("content/posts/" + slug, "GET", undefined, 404, false);
    await request("admin/cms/media/" + media.id, "DELETE", undefined, 409);
    await request(
      "admin/cms/posts/" + post.id,
      "PATCH",
      {
        ...postPayload,
        body: {
          type: "doc",
          content: [{ type: "html", text: "<script>alert(1)</script>" }],
        },
      },
      400,
    );
    await request(
      "admin/cms/posts/" + post.id,
      "PATCH",
      {
        ...postPayload,
        body: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "XSS",
                  marks: [
                    { type: "link", attrs: { href: "javascript:alert(1)" } },
                  ],
                },
              ],
            },
          ],
        },
      },
      400,
    );
    const published = await request("admin/cms/posts/" + post.id, "PATCH", {
      ...postPayload,
      status: "published",
    });
    assert.ok(published.publishedAt);
    const publicPost = await request(
      "content/posts/" + slug,
      "GET",
      undefined,
      200,
      false,
    );
    assert.equal(publicPost.coverAlt, "Точный альтернативный текст");
    assert.equal(
      publicPost.body.content[0].content[0].text,
      "Проверяемый текст",
    );
    assert.equal(
      (await fetch(base + "/api/content/media/" + media.id)).status,
      200,
    );
    await request(
      "admin/cms/blog-categories/" + category.id,
      "DELETE",
      undefined,
      409,
    );
    assert.ok(
      (
        await request("content/blog-categories", "GET", undefined, 200, false)
      ).items.some((c) => c.id === category.id),
    );
    await request(
      "admin/cms/media/" + media.id,
      "PATCH",
      { title: "Закрыто", alt: "Закрыто" },
      404,
    );
    await request("admin/cms/posts/" + post.id, "PATCH", {
      ...postPayload,
      status: "draft",
    });
    await request("content/media/" + media.id, "GET", undefined, 404, false);
    await request(
      "admin/cms/posts/" + post.id,
      "PATCH",
      { ...postPayload, slug: slug + "-changed" },
      409,
    );
    await request("admin/cms/posts/" + post.id, "PATCH", {
      ...postPayload,
      coverId: null,
      categoryIds: [],
      status: "archived",
    });
    await request("admin/cms/blog-categories/" + category.id, "DELETE");
    await request("admin/cms/media/" + media.id, "DELETE");

    const config = await request(
      "content/lead-config",
      "GET",
      undefined,
      200,
      false,
    );
    assert.equal(config.enabled, true);
    const lead = {
      name: "Тестовый клиент",
      phone: "8 (900) 555-" + String(1000 + Math.floor(Math.random() * 9000)),
      message: "Проверка заявки",
      source: "/contacts",
      sourceUrl: "/contacts",
      consent: true,
      policyVersion: config.policyVersion,
      requestKey: randomUUID(),
      website: "",
    };
    await request(
      "content/leads",
      "POST",
      { ...lead, policyVersion: randomUUID() },
      409,
      false,
    );
    await request(
      "admin/cms/contacts",
      "PATCH",
      { ...original, privacyPublished: true },
      400,
    );
    settings = config;
    await request(
      "content/leads",
      "POST",
      { ...lead, consent: false },
      400,
      false,
    );
    await request(
      "content/leads",
      "POST",
      { ...lead, website: "bot" },
      400,
      false,
    );
    await request("content/leads", "POST", lead, 201, false);
    await request("content/leads", "POST", lead, 201, false);
    await request(
      "content/leads",
      "POST",
      { ...lead, message: "Другой текст" },
      409,
      false,
    );
    const list = await request("admin/cms/leads?search=Тестовый%20клиент");
    const saved = list.items.find((l) => l.requestKey === lead.requestKey);
    assert.ok(saved);
    assert.equal(
      saved.phone,
      "+7" + lead.phone.replace(/[^0-9]/g, "").slice(1),
    );
    assert.equal(saved.policyVersion, settings.policyVersion);
    assert.match(saved.consentText, /Срок действия и отзыв/);
    assert.equal(
      list.items.filter((l) => l.requestKey === lead.requestKey).length,
      1,
    );
    await request("admin/cms/leads/" + saved.id, "PATCH", {
      status: "in_progress",
      note: "Проверенная заметка",
    });
    assert.equal(
      (await request("admin/cms/leads/" + saved.id)).note,
      "Проверенная заметка",
    );
    const deadline = Date.now() + 40000;
    let delivered;
    while (Date.now() < deadline) {
      delivered = await request("admin/cms/leads/" + saved.id);
      if (delivered.notificationStatus === "sent") break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    assert.equal(delivered.notificationStatus, "sent");
    const fixture = await (await fetch("http://127.0.0.1:19012/status")).json();
    assert.ok(fixture.attempts >= 2);
    assert.equal(fixture.ids.filter((id) => id === saved.id).length, 1);
    for (let i = 0; i < 4; i++)
      await request(
        "content/leads",
        "POST",
        { ...lead, requestKey: randomUUID() },
        201,
        false,
      );
    await request(
      "content/leads",
      "POST",
      { ...lead, requestKey: randomUUID() },
      429,
      false,
    );
    const refreshed = await request(
      "admin/auth/refresh",
      "POST",
      { refreshToken: refresh },
      200,
      false,
    );
    const old = token;
    token = refreshed.accessToken;
    refresh = refreshed.refreshToken;
    assert.notEqual(token, old);
    await request("admin/auth/me");
  } finally {
    if (settings) await request("admin/cms/contacts", "PATCH", original);
    if (refresh)
      await request(
        "admin/auth/logout",
        "POST",
        { refreshToken: refresh },
        204,
        false,
      );
  }
  await request("admin/auth/me", "GET", undefined, 401);
});

test("published pagination and category counts use real rows and stable non-overlapping pages", async () => {
  const login = await request(
    "admin/auth/login",
    "POST",
    {
      email: "stage5-admin@example.test",
      password: "Stage5-test-only-password-12345",
    },
    200,
    false,
  );
  token = login.accessToken;
  const category = await request(
    "admin/cms/blog-categories",
    "POST",
    {
      title: "Pagination fixture",
      slug: "paging-" + randomUUID(),
      status: "published",
    },
    201,
  );
  const records = [];
  try {
    for (let i = 0; i < 13; i++) {
      const input = {
        title: "Pagination " + i,
        slug: "paging-" + randomUUID(),
        excerpt: "Only disposable test content",
        status: "published",
        body: doc("Pagination fixture"),
        categoryIds: [category.id],
      };
      records.push({
        input,
        record: await request("admin/cms/posts", "POST", input, 201),
      });
    }
    const first = await request(
      "content/posts?category=" + category.slug + "&limit=5&page=1",
      "GET",
      undefined,
      200,
      false,
    );
    const second = await request(
      "content/posts?category=" + category.slug + "&limit=5&page=2",
      "GET",
      undefined,
      200,
      false,
    );
    assert.equal(first.total, 13);
    assert.equal(second.total, 13);
    assert.equal(first.items.length, 5);
    assert.equal(second.items.length, 5);
    assert.ok(
      !second.items.some((item) =>
        first.items.some((other) => other.id === item.id),
      ),
    );
    const html = await (
      await fetch(
        "http://localhost:3140/blog/category/" + category.slug + "?page=2",
      )
    ).text();
    assert.ok(
      html.includes(
        'href="https://vidsave.karatell.ru/blog/category/' +
          category.slug +
          '?page=2"',
      ),
    );
    assert.ok(html.includes('aria-current="page"'));
    assert.ok(!html.includes("?category=" + category.slug));
  } finally {
    for (const { input, record } of records)
      await request("admin/cms/posts/" + record.id, "PATCH", {
        ...input,
        status: "archived",
        categoryIds: [],
      });
    await request("admin/cms/blog-categories/" + category.id, "DELETE");
    await request(
      "admin/auth/logout",
      "POST",
      { refreshToken: login.refreshToken },
      204,
      false,
    );
  }
});

test("USER cannot access any CMS administration resource or mutate content", async () => {
  const session = await request(
    "admin/auth/login",
    "POST",
    {
      email: "stage5-user@example.test",
      password: "Stage5-test-only-user-password-12345",
    },
    200,
    false,
  );
  token = session.accessToken;
  try {
    for (const resource of [
      "posts",
      "projects",
      "blog-categories",
      "pages",
      "settings",
      "media",
      "leads",
      "dashboard",
      "seo",
    ])
      await request("admin/cms/" + resource, "GET", undefined, 403);
    await request(
      "admin/cms/posts",
      "POST",
      { title: "Forbidden", slug: "forbidden", body: doc() },
      403,
    );
  } finally {
    await request(
      "admin/auth/logout",
      "POST",
      { refreshToken: session.refreshToken },
      204,
      false,
    );
  }
});
