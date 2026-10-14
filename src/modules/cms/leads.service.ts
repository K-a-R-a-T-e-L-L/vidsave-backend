import {
  BadRequestException,
  ConflictException,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DataSource } from "typeorm";
import { createHmac, randomUUID } from "node:crypto";
import { ProxyAgent } from "undici";
import { Lead, NotificationOutbox, SiteSettings } from "./cms.entities";
import { leadInput, normalizedPhone, parseInput } from "./cms.validation";
import { privacyDocuments } from "./privacy-documents";
import { RateLimitExceededException } from "../../common/exceptions/rate-limit-exceeded.exception";
import { telegramLeadMessage } from "./telegram-lead-message";

@Injectable()
export class LeadsService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private proxy: ProxyAgent | undefined;
  constructor(private readonly db: DataSource) {}
  onModuleInit() {
    this.timer = setInterval(() => {
      void this.deliver().catch(() => undefined);
    }, 2000);
    this.timer.unref();
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.proxy?.destroy();
  }
  configured() {
    return !!(
      process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_LEADS_CHAT_ID
    );
  }
  async config() {
    const row = await this.db
      .getRepository(SiteSettings)
      .findOneBy({ id: "main" });
    const documents = privacyDocuments(row?.data ?? {});
    return {
      enabled: !!row,
      policyVersion: documents.policyVersion,
      consentText: documents.consentText,
      policyUrl: "/privacy",
      consentUrl: "/consent",
    };
  }
  async submit(body: unknown, ip: string) {
    const input = parseInput(leadInput, body);
    if (input.website) throw new BadRequestException("Invalid request");
    const phone = normalizedPhone(input.phone);
    const hash = (v: string) =>
      createHmac("sha256", process.env.JWT_SECRET ?? "")
        .update(v)
        .digest("hex");
    try {
      return await this.db.transaction(async (manager) => {
        const existing = await manager
          .getRepository(Lead)
          .findOneBy({ requestKey: input.requestKey });
        if (existing) {
          if (
            existing.phone !== phone ||
            existing.name !== input.name ||
            existing.message !== input.message
          )
            throw new ConflictException("Request already used");
          return { accepted: true };
        }
        const settings = await manager.getRepository(SiteSettings).findOne({
          where: { id: "main" },
          lock: { mode: "pessimistic_read" },
        });
        if (!settings)
          throw new ServiceUnavailableException("Requests are not enabled");
        const documents = privacyDocuments(settings.data);
        if (documents.policyVersion !== input.policyVersion)
          throw new ConflictException("Consent text changed");
        for (const [key, maximum] of [
          [hash(`lead-phone:${phone}`), 5],
          [hash(`lead-ip:${ip}`), 100],
        ] as const) {
          const rows = await manager.query<{ count: number }[]>(
            `INSERT INTO cms_rate_limits (key, "windowStart", count) VALUES ($1, now(), 1) ON CONFLICT (key) DO UPDATE SET count = CASE WHEN cms_rate_limits."windowStart" < now() - interval '10 minutes' THEN 1 ELSE cms_rate_limits.count + 1 END, "windowStart" = CASE WHEN cms_rate_limits."windowStart" < now() - interval '10 minutes' THEN now() ELSE cms_rate_limits."windowStart" END RETURNING count`,
            [key],
          );
          if (Number(rows[0].count) > maximum)
            throw new RateLimitExceededException(600);
        }
        const lead = await manager.getRepository(Lead).save({
          requestKey: input.requestKey,
          name: input.name,
          phone,
          message: input.message,
          source: input.source,
          sourceUrl: input.sourceUrl,
          policyVersion: documents.policyVersion,
          consentText: JSON.stringify({
            confirmation: documents.consentText,
            document: documents.consentBody,
          }),
          consentAt: new Date(),
          status: "new",
        });
        await manager.getRepository(NotificationOutbox).save({
          leadId: lead.id,
          status: this.configured() ? "pending" : "disabled",
        });
        return { accepted: true };
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        const row = await this.db
          .getRepository(Lead)
          .findOneBy({ requestKey: input.requestKey });
        if (
          row &&
          row.phone === phone &&
          row.name === input.name &&
          row.message === input.message
        )
          return { accepted: true };
        throw new ConflictException("Request already used");
      }
      throw error;
    }
  }
  async deliver() {
    if (this.running || !this.configured()) return;
    this.running = true;
    try {
      const token = randomUUID();
      await this.db.query(
        `UPDATE cms_notification_outbox SET status = 'failed', "leaseToken" = NULL, "leaseUntil" = NULL WHERE status = 'processing' AND "leaseUntil" < now() AND attempts >= 8`,
      );
      const [returned] = await this.db.query<[NotificationOutbox[], number]>(
        `WITH candidate AS (SELECT id FROM cms_notification_outbox WHERE (status = 'pending' AND "availableAt" <= now()) OR (status = 'processing' AND "leaseUntil" < now()) ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE cms_notification_outbox SET status = 'processing', attempts = attempts + 1, "leaseToken" = $1, "leaseUntil" = now() + interval '30 seconds' WHERE id IN (SELECT id FROM candidate) RETURNING *`,
        [token],
      );
      const event = returned[0] as NotificationOutbox | undefined;
      if (!event) return;
      const lead = await this.db
        .getRepository(Lead)
        .findOneBy({ id: event.leadId });
      if (!lead) return;
      let httpStatus = 0;
      let sent = false;
      let delay = Math.min(3600, 2 ** event.attempts * 5);
      try {
        const base =
          process.env.TELEGRAM_API_BASE_URL || "https://api.telegram.org";
        const response = await fetch(
          `${base}/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            dispatcher: this.telegramProxy(),
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              chat_id: process.env.TELEGRAM_LEADS_CHAT_ID,
              ...telegramLeadMessage(lead, process.env.FRONTEND_ORIGIN!),
            }),
            signal: AbortSignal.timeout(8000),
            redirect: "error",
          } as RequestInit & { dispatcher?: ProxyAgent },
        );
        httpStatus = response.status;
        const data = (await response.json()) as {
          ok?: boolean;
          parameters?: { retry_after?: number };
        };
        sent = response.ok && data.ok === true;
        if (response.status === 429)
          delay = Math.min(
            86400,
            Math.max(delay, Number(data.parameters?.retry_after) || delay),
          );
      } catch {
        /* No credentials, provider payloads or personal data in ordinary logs. */
      }
      const permanent =
        httpStatus >= 400 && httpStatus < 500 && httpStatus !== 429;
      await this.db.getRepository(NotificationOutbox).update(
        { id: event.id, leaseToken: token, status: "processing" },
        {
          status: sent
            ? "sent"
            : permanent || event.attempts >= 8
              ? "failed"
              : "pending",
          lastHttpStatus: httpStatus || null,
          availableAt: new Date(Date.now() + delay * 1000),
          leaseToken: null,
          leaseUntil: null,
        },
      );
    } finally {
      this.running = false;
    }
  }
  private telegramProxy() {
    const url = process.env.TELEGRAM_PROXY_URL?.trim();
    if (!url) return undefined;
    return (this.proxy ??= new ProxyAgent(url));
  }
}
