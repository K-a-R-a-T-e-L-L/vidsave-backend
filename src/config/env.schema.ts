import { z } from "zod";

const booleanFromEnvironment = z.preprocess((value: unknown) => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return value;
}, z.boolean());

const originSchema = z
  .string()
  .url()
  .superRefine((value, context) => {
    try {
      const url = new URL(value);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.pathname !== "/" ||
        url.search.length > 0 ||
        url.hash.length > 0 ||
        url.username.length > 0 ||
        url.password.length > 0
      ) {
        context.addIssue({
          code: "custom",
          message: "must be an HTTP(S) origin without a path",
        });
      }
    } catch {
      context.addIssue({
        code: "custom",
        message: "must be a valid HTTP(S) origin",
      });
    }
  });

function ttlToSeconds(value: string): number {
  const amount = Number(value.slice(0, -1));
  const unit = value.slice(-1);
  const multiplier = { s: 1, m: 60, h: 3_600, d: 86_400 }[
    unit as "s" | "m" | "h" | "d"
  ];
  return amount * multiplier;
}

const ttlSchema = z
  .string()
  .regex(
    /^[1-9]\d*[smhd]$/,
    "must be a positive integer followed by s, m, h, or d",
  )
  .refine((value) => Number.isSafeInteger(ttlToSeconds(value)), {
    message: "must be within the supported range",
  });

export const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
    API_PREFIX: z
      .string()
      .regex(/^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/, "must be a safe URL segment")
      .default("api"),
    FRONTEND_ORIGIN: originSchema,
    DATABASE_HOST: z.string().trim().min(1),
    DATABASE_PORT: z.coerce.number().int().min(1).max(65_535),
    DATABASE_USER: z.string().trim().min(1),
    DATABASE_PASSWORD: z.string(),
    DATABASE_NAME: z.string().trim().min(1),
    DATABASE_SSL: booleanFromEnvironment.default(false),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
    SWAGGER_ENABLED: booleanFromEnvironment.default(false),
    JWT_SECRET: z.string().min(32),
    JWT_ACCESS_EXPIRES: ttlSchema.default("4m"),
    JWT_REFRESH_EXPIRES: ttlSchema.default("1h"),
    MEDIA_S3_ENDPOINT: originSchema.optional(),
    MEDIA_LOCAL_DIRECTORY: z.string().trim().min(1).optional(),
    MEDIA_S3_REGION: z.string().default("us-east-1"),
    MEDIA_S3_BUCKET: z.string().optional(),
    MEDIA_S3_ACCESS_KEY_ID: z.string().optional(),
    MEDIA_S3_SECRET_ACCESS_KEY: z.string().optional(),
    MEDIA_S3_FORCE_PATH_STYLE: booleanFromEnvironment.default(false),
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TELEGRAM_LEADS_CHAT_ID: z.string().optional(),
    TELEGRAM_API_BASE_URL: originSchema.optional(),
    TELEGRAM_PROXY_URL: z
      .string()
      .trim()
      .refine((value) => {
        if (!value) return true;
        try {
          const url = new URL(value);
          return (
            ["http:", "https:"].includes(url.protocol) &&
            url.pathname === "/" &&
            !url.search &&
            !url.hash
          );
        } catch {
          return false;
        }
      }, "must be an HTTP(S) proxy URL without path, query or fragment")
      .optional(),
  })
  .superRefine((config, context) => {
    if (config.MEDIA_S3_BUCKET) {
      for (const key of [
        "MEDIA_S3_ENDPOINT",
        "MEDIA_S3_ACCESS_KEY_ID",
        "MEDIA_S3_SECRET_ACCESS_KEY",
      ] as const) {
        if (!config[key]?.trim())
          context.addIssue({
            code: "custom",
            path: [key],
            message: "is required when MEDIA_S3_BUCKET is set",
          });
      }
    }
    if (
      config.NODE_ENV === "production" &&
      config.DATABASE_PASSWORD.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["DATABASE_PASSWORD"],
        message: "must not be empty in production",
      });
    }
  })
  .superRefine((config, context) => {
    if (
      ttlToSeconds(config.JWT_REFRESH_EXPIRES) <=
      ttlToSeconds(config.JWT_ACCESS_EXPIRES)
    ) {
      context.addIssue({
        code: "custom",
        path: ["JWT_REFRESH_EXPIRES"],
        message: "must be longer than JWT_ACCESS_EXPIRES",
      });
    }
  })
  .transform((config) => ({
    ...config,
    JWT_ACCESS_EXPIRES_SECONDS: ttlToSeconds(config.JWT_ACCESS_EXPIRES),
    JWT_REFRESH_EXPIRES_SECONDS: ttlToSeconds(config.JWT_REFRESH_EXPIRES),
  }));

export type AppEnvironment = z.infer<typeof environmentSchema>;

export function validateEnvironment(
  input: Record<string, unknown>,
): AppEnvironment {
  const result = environmentSchema.safeParse(input);
  if (result.success) return result.data;

  const issues = result.error.issues
    .map(
      (issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`,
    )
    .join("; ");
  throw new Error(`Invalid environment configuration: ${issues}`);
}
