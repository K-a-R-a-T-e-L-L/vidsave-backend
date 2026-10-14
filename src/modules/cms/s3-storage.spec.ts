import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { MediaStorage } from "./media-storage.service";

it("round-trips private images through signed path-style S3 requests", async () => {
  const previous = { ...process.env };
  const objects = new Map<string, Buffer>();
  const requests: {
    method: string;
    path: string;
    signed: boolean;
    acl?: string;
  }[] = [];
  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    requests.push({
      method: req.method ?? "",
      path,
      signed:
        req.headers.authorization?.startsWith("AWS4-HMAC-SHA256 ") ?? false,
      acl: req.headers["x-amz-acl"] as string | undefined,
    });
    if (req.method === "PUT") {
      const chunks: Uint8Array[] = [];
      for await (const chunk of req) {
        const value: unknown = chunk;
        if (value instanceof Uint8Array) chunks.push(value);
        else if (typeof value === "string") chunks.push(Buffer.from(value));
        else throw new Error("Unexpected request chunk");
      }
      objects.set(path, Buffer.concat(chunks));
      res.setHeader("ETag", '"fixture"');
      res.end();
    } else if (req.method === "GET" && objects.has(path)) {
      res.setHeader("Content-Type", "image/webp");
      res.end(objects.get(path));
    } else if (req.method === "DELETE") {
      objects.delete(path);
      res.writeHead(204);
      res.end();
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  console.log("Owned S3 protocol fixture PID", process.pid, "port", port);
  try {
    Object.assign(process.env, {
      MEDIA_S3_ENDPOINT: "http://127.0.0.1:" + port,
      MEDIA_S3_BUCKET: "private-media",
      MEDIA_S3_REGION: "default",
      MEDIA_S3_ACCESS_KEY_ID: "fixture-key",
      MEDIA_S3_SECRET_ACCESS_KEY: "fixture-secret",
      MEDIA_S3_FORCE_PATH_STYLE: "true",
    });
    const storage = new MediaStorage();
    const bytes = Buffer.from("already-optimized-webp-fixture");
    const key = await storage.put(bytes);
    expect(key).toMatch(/^images\/[0-9a-f-]{36}\.webp$/);
    expect(Buffer.from(await storage.get(key))).toEqual(bytes);
    await storage.remove(key);
    expect(objects.size).toBe(0);
    expect(requests.map((r) => r.method)).toEqual(["PUT", "GET", "DELETE"]);
    for (const request of requests) {
      expect(request.path).toBe("/private-media/" + key);
      expect(request.signed).toBe(true);
      expect(request.acl).toBeUndefined();
    }
  } finally {
    for (const key of [
      "MEDIA_S3_ENDPOINT",
      "MEDIA_S3_BUCKET",
      "MEDIA_S3_REGION",
      "MEDIA_S3_ACCESS_KEY_ID",
      "MEDIA_S3_SECRET_ACCESS_KEY",
      "MEDIA_S3_FORCE_PATH_STYLE",
    ]) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    console.log("Closed S3 fixture port", port);
  }
});
