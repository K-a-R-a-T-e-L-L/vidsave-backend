import { createServer } from "node:http";
import { jest } from "@jest/globals";
import { AddressInfo } from "node:net";
import { DataSource } from "typeorm";
import { LeadsService } from "./leads.service";
import type { Lead } from "./cms.entities";

describe("Telegram proxy delivery", () => {
  it.each([200, 503])(
    "routes through authenticated CONNECT proxy (status %s)",
    async (status) => {
      const previous = { ...process.env };
      let authorization: string | undefined;
      let destination: string | undefined;
      const proxy = createServer();
      proxy.on("connect", (request, socket) => {
        authorization = request.headers["proxy-authorization"];
        destination = request.url;
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        socket.once("data", () => {
          const body = JSON.stringify({ ok: status === 200 });
          socket.end(
            `HTTP/1.1 ${status} Result\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
          );
        });
      });
      await new Promise<void>((resolve) =>
        proxy.listen(0, "127.0.0.1", resolve),
      );
      const port = (proxy.address() as AddressInfo).port;
      const update = jest
        .fn<(...args: unknown[]) => Promise<void>>()
        .mockResolvedValue(undefined);
      const db = {
        query: jest
          .fn<() => Promise<unknown>>()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            [{ id: "event", leadId: "lead", attempts: 1 }],
            1,
          ]),
        getRepository: () => ({
          findOneBy: jest.fn<() => Promise<Partial<Lead>>>().mockResolvedValue({
            id: "lead",
            name: "Fixture name",
            phone: "+79001234567",
            message: "Fixture comment",
            source: "/contacts",
            sourceUrl: "/contacts",
            status: "new",
            createdAt: new Date("2026-10-14T12:00:00Z"),
          }),
          update,
        }),
      } as unknown as DataSource;
      const service = new LeadsService(db);
      try {
        process.env.TELEGRAM_BOT_TOKEN = "fixture";
        process.env.TELEGRAM_LEADS_CHAT_ID = "fixture-chat";
        process.env.TELEGRAM_API_BASE_URL = "http://telegram.invalid";
        process.env.TELEGRAM_PROXY_URL = `http://user:pass@127.0.0.1:${port}`;
        process.env.FRONTEND_ORIGIN = "https://site.example.test";
        await service.deliver();
        expect(destination).toBe("telegram.invalid:80");
        expect(authorization).toBe(
          `Basic ${Buffer.from("user:pass").toString("base64")}`,
        );
        expect(update).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            status: status === 200 ? "sent" : "pending",
            lastHttpStatus: status,
          }),
        );
      } finally {
        await service.onModuleDestroy();
        await new Promise<void>((resolve) => proxy.close(() => resolve()));
        process.env = previous;
      }
    },
  );
});
