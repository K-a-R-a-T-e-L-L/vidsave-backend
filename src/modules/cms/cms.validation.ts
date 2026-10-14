import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
import type { RichNode } from "./cms.entities";

export const PUBLIC_ORIGIN = "https://vidsave.karatell.ru";
const text = (max = 10000) => z.string().max(max);
export const uuid = z.string().uuid();
const nullableId = uuid.nullable().optional();
const phoneText = text(40)
  .trim()
  .refine(
    (value) =>
      /^[+0-9() .-]+$/.test(value) &&
      value.replace(/\D/g, "").length >= 10 &&
      value.replace(/\D/g, "").length <= 15,
  );
const safeCharacters = (value: string) =>
  !Array.from(value).some(
    (c) => c.charCodeAt(0) < 32 || c === String.fromCharCode(92),
  );
const safeLink = (value: string) =>
  /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(value) &&
  safeCharacters(value);
export const socialUrl = z
  .string()
  .refine((v) => !v || (/^https:\/\//.test(v) && safeLink(v)));
const status = z.enum(["draft", "published", "archived"]);
const base = {
  title: text(255).trim().min(1),
  slug: z
    .string()
    .max(200)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  excerpt: text(2000).default(""),
  status: status.default("draft"),
  seoTitle: text(255).nullable().optional(),
  seoDescription: text(1000).nullable().optional(),
  coverId: nullableId,
  ogImageId: nullableId,
};
export const categoryInput = z
  .object({
    ...base,
    sortOrder: z.number().int().min(0).max(100000).default(0),
  })
  .strict();
export const postInput = z
  .object({
    ...base,
    body: z.unknown(),
    categoryIds: z.array(uuid).max(30).default([]),
  })
  .strict();
export const projectInput = z
  .object({
    ...base,
    objectType: text(500).default(""),
    task: text().default(""),
    solution: text().default(""),
    result: text().default(""),
    galleryIds: z.array(uuid).max(40).default([]),
    serviceIds: z.array(uuid).max(100).default([]),
  })
  .strict();
const imageChoice = z
  .string()
  .max(500)
  .refine(
    (v) =>
      /^\/images\/[a-zA-Z0-9/_-]+\.(png|jpg|jpeg|webp|avif)$/.test(v) ||
      /^\/media\/[0-9a-f-]{36}$/.test(v),
  );
export const settingsInput = z
  .object({
    companyName: text(255).trim().min(1),
    phone: phoneText,
    additionalPhone: phoneText.or(z.literal("")),
    email: z.string().email(),
    additionalEmail: z.string().email().or(z.literal("")),
    address: text(500),
    legalName: text(255),
    legalAddress: text(500),
    inn: text(30),
    egrip: text(30),
    geography: text(500),
    hours: text(500),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    telegram: socialUrl,
    vk: socialUrl,
    avito: socialUrl,
    heroLight: imageChoice,
    heroDark: imageChoice,
    ctaTitle: text(255),
    ctaText: text(2000),
    seoTitle: text(255),
    seoDescription: text(1000),
    analyticsId: z.string().regex(/^\d{1,12}$|^$/),
    privacyBody: z.unknown(),
    consentText: text(2000),
    privacyPublished: z.boolean(),
  })
  .strict();
export const contactsInput = settingsInput
  .pick({
    phone: true,
    additionalPhone: true,
    email: true,
    additionalEmail: true,
    address: true,
    geography: true,
    hours: true,
    latitude: true,
    longitude: true,
    telegram: true,
    vk: true,
    avito: true,
  })
  .strict();
export const pageInput = z
  .object({
    document: z
      .object({
        title: text(255).trim().min(1),
        description: text(2000),
        ctaTitle: text(255),
        ctaText: text(2000),
        faq: z
          .array(z.object({ question: text(500), answer: text(3000) }).strict())
          .max(30),
        fields: z
          .array(
            z
              .object({
                id: z.string().regex(/^[a-z0-9-]{1,64}$/),
                role: z.literal("control").optional(),
                label: text(500),
                text: text(),
                visible: z.boolean(),
                order: z.number().int().min(0).max(10000),
                imageId: nullableId,
              })
              .strict(),
          )
          .max(200),
      })
      .strict(),
    seoTitle: text(255).nullable().optional(),
    seoDescription: text(1000).nullable().optional(),
    canonical: z
      .string()
      .max(500)
      .refine((v) => {
        try {
          const url = new URL(v || "/", PUBLIC_ORIGIN);
          return (
            url.origin === PUBLIC_ORIGIN &&
            !url.hash &&
            !url.username &&
            !url.password
          );
        } catch {
          return false;
        }
      })
      .nullable()
      .optional(),
    noindex: z.boolean().default(false),
    ogImageId: nullableId,
  })
  .strict();
export const mediaUploadInput = z
  .object({
    title: text(255).trim().min(1),
    alt: text(500).default(""),
    mime: z.enum(["image/jpeg", "image/png", "image/webp", "image/avif"]),
    bytes: z
      .string()
      .max(14000000)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict();
export const mediaInput = z
  .object({ title: text(255).trim().min(1), alt: text(500) })
  .strict();
export const leadInput = z
  .object({
    name: text(100).trim().min(1),
    phone: text(40),
    message: text(2000).default(""),
    source: text(100),
    sourceUrl: text(500).refine(
      (v) => v.startsWith("/") && !v.startsWith("//") && safeCharacters(v),
    ),
    consent: z.literal(true),
    policyVersion: uuid,
    requestKey: uuid,
    website: text(100).default(""),
  })
  .strict();
export const leadUpdate = z
  .object({
    status: z.enum(["new", "in_progress", "completed", "spam"]),
    note: text(10000),
  })
  .strict();

export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException("Invalid input");
  return result.data;
}

export function validateRichText(value: unknown): RichNode {
  let count = 0;
  const allowed = new Set([
    "doc",
    "text",
    "paragraph",
    "heading",
    "bulletList",
    "orderedList",
    "listItem",
    "blockquote",
    "hardBreak",
    "horizontalRule",
    "image",
    "table",
    "tableRow",
    "tableCell",
    "tableHeader",
  ]);
  function visit(node: unknown, depth: number): void {
    if (
      !node ||
      typeof node !== "object" ||
      Array.isArray(node) ||
      depth > 20 ||
      ++count > 5000
    )
      throw new BadRequestException("Invalid content");
    const n = node as RichNode;
    if (
      Object.keys(n).some(
        (k) => !["type", "text", "attrs", "marks", "content"].includes(k),
      ) ||
      !allowed.has(n.type)
    )
      throw new BadRequestException("Invalid content");
    if (
      n.text !== undefined &&
      (typeof n.text !== "string" || n.text.length > 50000 || n.type !== "text")
    )
      throw new BadRequestException("Invalid text");
    if (n.attrs) {
      const keys: Record<string, string[]> = {
        heading: ["level"],
        orderedList: ["start", "type"],
        image: ["src", "alt", "title", "mediaId", "width", "height"],
        tableCell: ["colspan", "rowspan", "colwidth", "align"],
        tableHeader: ["colspan", "rowspan", "colwidth", "align"],
      };
      if (Object.keys(n.attrs).some((k) => !(keys[n.type] ?? []).includes(k)))
        throw new BadRequestException("Invalid attributes");
      if (n.type === "heading" && ![2, 3, 4].includes(Number(n.attrs.level)))
        throw new BadRequestException("Invalid heading");
      if (
        n.type === "image" &&
        (!uuid.safeParse(n.attrs.mediaId).success ||
          n.attrs.src !== `/media/${String(n.attrs.mediaId)}`)
      )
        throw new BadRequestException("Invalid image");
      for (const k of ["alt", "title"])
        if (
          n.attrs[k] != null &&
          (typeof n.attrs[k] !== "string" || String(n.attrs[k]).length > 500)
        )
          throw new BadRequestException("Invalid image label");
      for (const k of ["width", "height"])
        if (
          n.attrs[k] != null &&
          (!Number.isInteger(n.attrs[k]) ||
            Number(n.attrs[k]) < 1 ||
            Number(n.attrs[k]) > 4000)
        )
          throw new BadRequestException("Invalid image size");
      for (const k of ["start", "colspan", "rowspan"])
        if (
          n.attrs[k] != null &&
          (!Number.isInteger(n.attrs[k]) ||
            Number(n.attrs[k]) < 1 ||
            Number(n.attrs[k]) > 1000)
        )
          throw new BadRequestException("Invalid table");
      if (
        n.attrs.colwidth != null &&
        (!Array.isArray(n.attrs.colwidth) ||
          n.attrs.colwidth.some(
            (v) => !Number.isInteger(v) || v < 1 || v > 4000,
          ))
      )
        throw new BadRequestException("Invalid table");
    }
    if (n.type === "image" && !n.attrs)
      throw new BadRequestException("Invalid image");
    if (n.marks) {
      if (!Array.isArray(n.marks))
        throw new BadRequestException("Invalid marks");
      for (const m of n.marks) {
        if (
          !["bold", "italic", "strike", "underline", "code", "link"].includes(
            m.type,
          ) ||
          Object.keys(m).some((k) => !["type", "attrs"].includes(k))
        )
          throw new BadRequestException("Invalid marks");
        if (m.type === "link") {
          if (
            typeof m.attrs?.href !== "string" ||
            !safeLink(m.attrs.href) ||
            Object.keys(m.attrs).some(
              (k) => !["href", "target", "rel", "class"].includes(k),
            )
          )
            throw new BadRequestException("Invalid link");
          if (m.attrs.class != null)
            throw new BadRequestException("Invalid link class");
        } else if (m.attrs && Object.keys(m.attrs).length)
          throw new BadRequestException("Invalid marks");
      }
    }
    if (n.content) {
      if (!Array.isArray(n.content))
        throw new BadRequestException("Invalid content");
      n.content.forEach((child) => visit(child, depth + 1));
    }
  }
  visit(value, 0);
  if ((value as RichNode).type !== "doc")
    throw new BadRequestException("Invalid document");
  return value as RichNode;
}

export function richText(node: RichNode): string {
  return [node.text ?? "", ...(node.content ?? []).map(richText)]
    .join(" ")
    .trim();
}
export function richMedia(node: RichNode): string[] {
  return [
    ...(node.type === "image" ? [String(node.attrs?.mediaId)] : []),
    ...(node.content ?? []).flatMap(richMedia),
  ];
}
export function normalizedPhone(value: string): string {
  let digits = value.replace(/[^0-9]/g, "");
  if (digits.length === 11 && digits[0] === "8") digits = "7" + digits.slice(1);
  if (digits.length < 10 || digits.length > 15)
    throw new BadRequestException("Invalid telephone");
  return "+" + digits;
}
