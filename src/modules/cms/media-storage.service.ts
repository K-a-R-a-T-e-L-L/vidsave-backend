import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";

@Injectable()
export class MediaStorage {
  private localPath(key: string) {
    if (!/^local\/[0-9a-f-]{36}\.webp$/.test(key))
      throw new BadRequestException("Invalid local image key");
    return join(
      resolve(process.env.MEDIA_LOCAL_DIRECTORY || "var/media"),
      key.slice(6),
    );
  }
  private client(): S3Client {
    const env = process.env;
    if (
      !env.MEDIA_S3_ENDPOINT ||
      !env.MEDIA_S3_BUCKET ||
      !env.MEDIA_S3_ACCESS_KEY_ID ||
      !env.MEDIA_S3_SECRET_ACCESS_KEY
    )
      throw new ServiceUnavailableException("Media storage is not configured");
    return new S3Client({
      endpoint: env.MEDIA_S3_ENDPOINT,
      region: env.MEDIA_S3_REGION || "us-east-1",
      forcePathStyle:
        env.MEDIA_S3_FORCE_PATH_STYLE?.trim().toLowerCase() === "true",
      credentials: {
        accessKeyId: env.MEDIA_S3_ACCESS_KEY_ID,
        secretAccessKey: env.MEDIA_S3_SECRET_ACCESS_KEY,
      },
      maxAttempts: 2,
    });
  }
  async optimize(base64: string, mime: string) {
    const input = Buffer.from(base64, "base64");
    if (input.length > 8 * 1024 * 1024 || input.length < 8)
      throw new BadRequestException("Invalid image size");
    try {
      const image = sharp(input, {
        limitInputPixels: 25_000_000,
        failOn: "warning",
        animated: false,
      });
      const metadata = await image.metadata();
      const expected: Record<string, string> = {
        "image/jpeg": "jpeg",
        "image/png": "png",
        "image/webp": "webp",
        "image/avif": "heif",
      };
      if (
        metadata.format !== expected[mime] ||
        !metadata.width ||
        !metadata.height ||
        (metadata.pages ?? 1) !== 1
      )
        throw new Error();
      const optimized = await image
        .rotate()
        .resize({
          width: 2400,
          height: 2400,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true });
      return {
        bytes: optimized.data,
        width: optimized.info.width,
        height: optimized.info.height,
      };
    } catch {
      throw new BadRequestException("Unsupported image");
    }
  }
  async put(bytes: Buffer): Promise<string> {
    if (!process.env.MEDIA_S3_BUCKET) {
      const key = `local/${randomUUID()}.webp`;
      try {
        await mkdir(resolve(process.env.MEDIA_LOCAL_DIRECTORY || "var/media"), {
          recursive: true,
        });
        await writeFile(this.localPath(key), bytes, {
          flag: "wx",
          mode: 0o600,
        });
        return key;
      } catch {
        throw new ServiceUnavailableException("Image storage unavailable");
      }
    }
    const key = `images/${randomUUID()}.webp`;
    const client = this.client();
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: process.env.MEDIA_S3_BUCKET,
          Key: key,
          Body: bytes,
          ContentType: "image/webp",
        }),
        { abortSignal: AbortSignal.timeout(10000) },
      );
      return key;
    } catch {
      throw new ServiceUnavailableException("Media storage unavailable");
    } finally {
      client.destroy();
    }
  }
  async get(key: string): Promise<Uint8Array> {
    if (key.startsWith("local/")) {
      const file = this.localPath(key);
      try {
        return await readFile(file);
      } catch {
        throw new ServiceUnavailableException("Image storage unavailable");
      }
    }
    const client = this.client();
    try {
      const data = await client.send(
        new GetObjectCommand({ Bucket: process.env.MEDIA_S3_BUCKET, Key: key }),
        { abortSignal: AbortSignal.timeout(10000) },
      );
      if (!data.Body) throw new Error();
      return await data.Body.transformToByteArray();
    } catch {
      throw new ServiceUnavailableException("Media storage unavailable");
    } finally {
      client.destroy();
    }
  }
  async remove(key: string) {
    if (key.startsWith("local/")) {
      const file = this.localPath(key);
      try {
        await unlink(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          throw new ServiceUnavailableException("Image storage unavailable");
      }
      return;
    }
    const client = this.client();
    try {
      await client.send(
        new DeleteObjectCommand({
          Bucket: process.env.MEDIA_S3_BUCKET,
          Key: key,
        }),
        { abortSignal: AbortSignal.timeout(10000) },
      );
    } catch {
      throw new ServiceUnavailableException("Media storage unavailable");
    } finally {
      client.destroy();
    }
  }
}
