import type { Lead } from "./cms.entities";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function telegramLeadMessage(lead: Lead, frontendOrigin: string) {
  const site = new URL(frontendOrigin);
  const page = new URL(lead.sourceUrl, site);
  const pageUrl = page.origin === site.origin ? page.href : site.href;
  const adminUrl = new URL(`/admin/leads/${encodeURIComponent(lead.id)}`, site);
  const createdAt = lead.createdAt.toISOString().replace("T", " ").slice(0, 19);
  const status = {
    new: "Новая",
    in_progress: "В работе",
    completed: "Завершена",
    spam: "Спам",
  }[lead.status];

  return {
    parse_mode: "HTML" as const,
    text: [
      "📩 <b>Новая заявка с сайта</b>",
      "",
      `👤 <b>Имя:</b> ${escapeHtml(lead.name)}`,
      `📞 <b>Телефон:</b> <code>${escapeHtml(lead.phone)}</code>`,
      "",
      "💬 <b>Комментарий:</b>",
      escapeHtml(lead.message.trim() || "Не указан"),
      "",
      `🌐 <b>Сайт:</b> <a href="${escapeHtml(site.href)}">${escapeHtml(site.host)}</a>`,
      `📍 <b>Страница:</b> <a href="${escapeHtml(pageUrl)}">${escapeHtml(lead.sourceUrl)}</a>`,
      ...(lead.source ? [`<b>Источник:</b> ${escapeHtml(lead.source)}`] : []),
      `🕒 <b>Дата:</b> ${createdAt} UTC`,
      `<b>Статус:</b> ${status}`,
      `<b>ID:</b> <code>${escapeHtml(lead.id)}</code>`,
    ].join("\n"),
    link_preview_options: { is_disabled: true },
    reply_markup: {
      inline_keyboard: [[{ text: "Открыть заявку", url: adminUrl.href }]],
    },
  };
}
