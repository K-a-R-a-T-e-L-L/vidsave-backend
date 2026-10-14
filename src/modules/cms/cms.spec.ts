import { describe, it, expect, jest, afterEach } from "@jest/globals";
import { BadRequestException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  normalizedPhone,
  validateRichText,
  parseInput,
  pageInput,
  postInput,
  leadInput,
} from "./cms.validation";
import { LeadsService } from "./leads.service";
import { DataSource } from "typeorm";
import { Lead, NotificationOutbox } from "./cms.entities";
const document = (text = "Материал") => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
describe("CMS boundary validation", () => {
  it("normalizes Russian telephone prefixes without adding a digit", () => {
    expect(normalizedPhone("8 (900) 555-01-23")).toBe("+79005550123");
    expect(normalizedPhone("+7 (900) 555-01-23")).toBe("+79005550123");
    expect(() => normalizedPhone("123")).toThrow(BadRequestException);
  });
  it("accepts real Tiptap 3 image/table attributes", () => {
    const id = randomUUID();
    const image = {
      type: "image",
      attrs: {
        src: "/media/" + id,
        mediaId: id,
        alt: "Описание",
        title: null,
        width: null,
        height: null,
      },
    };
    const cell = {
      type: "tableCell",
      attrs: { colspan: 1, rowspan: 1, colwidth: null, align: null },
      content: [{ type: "paragraph" }],
    };
    const table = {
      type: "table",
      content: [{ type: "tableRow", content: [cell] }],
    };
    expect(
      validateRichText({ type: "doc", content: [image, table] }).type,
    ).toBe("doc");
  });
  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>",
    "/\\attacker.invalid",
    String.fromCharCode(0) + "https://example.test",
  ])("rejects unsafe rich links: %s", (href) => {
    expect(() =>
      validateRichText({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "link",
                marks: [{ type: "link", attrs: { href } }],
              },
            ],
          },
        ],
      }),
    ).toThrow(BadRequestException);
  });
  it("rejects arbitrary HTML, unknown attributes, and excessive nesting", () => {
    expect(() =>
      validateRichText({ type: "doc", content: [{ type: "html" }] }),
    ).toThrow();
    expect(() =>
      validateRichText({ type: "doc", attrs: { onload: "bad" } }),
    ).toThrow();
    let nested: unknown = { type: "paragraph" };
    for (let i = 0; i < 25; i++)
      nested = { type: "blockquote", content: [nested] };
    expect(() =>
      validateRichText({ type: "doc", content: [nested] }),
    ).toThrow();
  });
  it("rejects whitespace-only headings", () => {
    expect(() =>
      parseInput(postInput, {
        title: "   ",
        slug: "blank-title",
        body: document(),
      }),
    ).toThrow(BadRequestException);
  });
  it("rejects privileged mass assignment and external canonical URLs", () => {
    expect(() =>
      parseInput(postInput, {
        title: "Title",
        slug: "test",
        body: document(),
        role: "ADMIN",
      }),
    ).toThrow();
    const page = {
      document: {
        title: "Page",
        description: "",
        ctaTitle: "",
        ctaText: "",
        fields: [],
        faq: [],
      },
      noindex: false,
      canonical: "https://attacker.invalid/",
    };
    expect(() => parseInput(pageInput, page)).toThrow();
    expect(
      parseInput(pageInput, { ...page, canonical: "/about" }).canonical,
    ).toBe("/about");
  });
  it("requires affirmative consent and a same-site source path", () => {
    const input = {
      name: "Клиент",
      phone: "89005550123",
      message: "",
      source: "/contacts",
      sourceUrl: "/contacts",
      consent: true,
      policyVersion: randomUUID(),
      requestKey: randomUUID(),
    };
    expect(() => parseInput(leadInput, { ...input, consent: false })).toThrow();
    expect(() =>
      parseInput(leadInput, { ...input, sourceUrl: "/\\evil.test" }),
    ).toThrow();
  });
});
describe("outbox delivery and leases", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });
  it("uses the real TypeORM PostgreSQL UPDATE tuple and marks only its lease as delivered", async () => {
    const event = { id: randomUUID(), leadId: randomUUID(), attempts: 1 };
    const update = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue({ affected: 1 });
    const query = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValueOnce([[], 0])
      .mockResolvedValueOnce([[event], 1]);
    const lead = {
      id: event.leadId,
      name: "Fixture",
      phone: "+79005550123",
      message: "Fixture",
      sourceUrl: "/contacts",
      source: "/contacts",
      status: "new",
      createdAt: new Date("2026-10-14T12:00:00Z"),
    };
    const db = {
      query,
      getRepository: (entity: unknown) =>
        entity === Lead
          ? {
              findOneBy: jest
                .fn<(...args: unknown[]) => Promise<unknown>>()
                .mockResolvedValue(lead),
            }
          : entity === NotificationOutbox
            ? { update }
            : {},
    } as unknown as DataSource;
    const service = new LeadsService(db);
    jest.replaceProperty(process, "env", {
      ...process.env,
      FRONTEND_ORIGIN: "https://site.example.test",
    });
    jest.spyOn(service, "configured").mockReturnValue(true);
    const send = jest
      .spyOn(global, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    await service.deliver();
    const message = JSON.parse(String(send.mock.calls[0][1]?.body)) as {
      text: string;
      parse_mode: string;
      reply_markup: { inline_keyboard: { url: string }[][] };
    };
    expect(message.text).toContain(lead.phone);
    expect(message.text).toContain(lead.message);
    expect(message.parse_mode).toBe("HTML");
    expect(message.reply_markup.inline_keyboard[0][0].url).toBe(
      `https://site.example.test/admin/leads/${lead.id}`,
    );
    expect(query.mock.calls[1][0]).toContain("FOR UPDATE SKIP LOCKED");
    expect(update.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        id: event.id,
        status: "processing",
        leaseToken: expect.any(String) as unknown,
      }),
    );
    expect(update.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        status: "sent",
        leaseUntil: null,
        lastHttpStatus: 200,
      }),
    );
  });
});
