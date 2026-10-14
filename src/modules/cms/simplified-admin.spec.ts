import { jest } from "@jest/globals";
import { mkdtemp, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { CmsAdminController } from "./cms.controller";
import { CmsService } from "./cms.service";
import { MediaStorage } from "./media-storage.service";
import { contactsInput, parseInput } from "./cms.validation";
import { defaultSettings } from "./cms.defaults";
import { privacyDocuments } from "./privacy-documents";
import { richText } from "./cms.validation";

describe("simplified administration", () => {
  it("publishes separate source-managed documents with a stable version and current contact", () => {
    const original = privacyDocuments(defaultSettings);
    expect(original.policyVersion).toBe(
      privacyDocuments(defaultSettings).policyVersion,
    );
    expect(richText(original.privacyBody)).toContain(defaultSettings.inn);
    expect(richText(original.consentBody)).toContain(defaultSettings.email);
    const changed = privacyDocuments({
      ...defaultSettings,
      email: "new@example.test",
    });
    expect(changed.policyVersion).not.toBe(original.policyVersion);
    expect(richText(changed.consentBody)).toContain("new@example.test");
  });
  it("rejects retired page/settings/SEO/media-library endpoints", () => {
    const controller = new CmsAdminController({} as CmsService);
    for (const kind of ["pages", "settings", "seo", "media"]) {
      expect(() => controller.list(kind, {})).toThrow();
    }
    expect(() => controller.settings("settings", defaultSettings)).toThrow();
    expect(() => controller.update("pages", "home", {})).toThrow();
  });
  it("accepts only contact fields and rejects site/SEO/legal mass assignment", () => {
    const contacts = Object.fromEntries(
      Object.keys(contactsInput.shape).map((key) => [
        key,
        defaultSettings[key as keyof typeof defaultSettings],
      ]),
    );
    expect(parseInput(contactsInput, contacts).phone).toBe(
      defaultSettings.phone,
    );
    for (const key of [
      "heroLight",
      "seoTitle",
      "companyName",
      "privacyPublished",
      "ctaText",
    ])
      expect(() =>
        parseInput(contactsInput, { ...contacts, [key]: "unauthorized" }),
      ).toThrow();
  });
  it("dispatches contact updates without exposing complete settings", async () => {
    const saveContacts = jest
      .fn<(body: unknown) => Promise<unknown>>()
      .mockResolvedValue({ phone: defaultSettings.phone });
    const controller = new CmsAdminController({
      saveContacts,
    } as unknown as CmsService);
    await expect(
      controller.settings("contacts", { phone: defaultSettings.phone }),
    ).resolves.toEqual({ phone: defaultSettings.phone });
    expect(saveContacts).toHaveBeenCalledTimes(1);
  });
  it("optimizes, writes, reads and removes local images without S3; rejects traversal", async () => {
    const bucket = process.env.MEDIA_S3_BUCKET,
      directory = process.env.MEDIA_LOCAL_DIRECTORY;
    const folder = await mkdtemp(join(tmpdir(), "vidsave-simplify-storage-"));
    delete process.env.MEDIA_S3_BUCKET;
    process.env.MEDIA_LOCAL_DIRECTORY = folder;
    const storage = new MediaStorage();
    let key: string | undefined;
    try {
      const image = await sharp({
        create: { width: 4, height: 3, channels: 3, background: "#246" },
      })
        .png()
        .toBuffer();
      const optimized = await storage.optimize(
        image.toString("base64"),
        "image/png",
      );
      key = await storage.put(optimized.bytes);
      expect(key).toMatch(/^local\/[0-9a-f-]{36}\.webp$/);
      expect((await sharp(await storage.get(key)).metadata()).format).toBe(
        "webp",
      );
      await expect(storage.get("local/../../secret.webp")).rejects.toThrow();
      await expect(storage.remove("local/../../secret.webp")).rejects.toThrow();
      await storage.remove(key);
      await expect(storage.get(key)).rejects.toThrow();
      key = undefined;
    } finally {
      if (key) await storage.remove(key);
      await rmdir(folder);
      if (bucket === undefined) delete process.env.MEDIA_S3_BUCKET;
      else process.env.MEDIA_S3_BUCKET = bucket;
      if (directory === undefined) delete process.env.MEDIA_LOCAL_DIRECTORY;
      else process.env.MEDIA_LOCAL_DIRECTORY = directory;
    }
  });
});
