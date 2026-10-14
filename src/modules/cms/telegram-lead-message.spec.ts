import type { Lead } from "./cms.entities";
import { telegramLeadMessage } from "./telegram-lead-message";

const lead = {
  id: "0b17324c-a84d-4883-a2ec-8e39d5529a84",
  name: "Кирилл",
  phone: "+79001234567",
  message: "Нужны камеры\nПозвоните вечером",
  source: "/contacts",
  sourceUrl: "/contacts",
  status: "new",
  createdAt: new Date("2026-10-14T12:00:00Z"),
} as Lead;

describe("Telegram lead message", () => {
  it("includes lead details, site, page, timestamp and an admin button", () => {
    const result = telegramLeadMessage(lead, "https://site.example.test");
    for (const value of [
      lead.name,
      lead.phone,
      lead.message,
      lead.sourceUrl,
      lead.id,
      "site.example.test",
      "2026-10-14 12:00:00 UTC",
      "Новая",
    ])
      expect(result.text).toContain(value);
    expect(result.parse_mode).toBe("HTML");
    expect(result.reply_markup.inline_keyboard[0][0].url).toBe(
      `https://site.example.test/admin/leads/${lead.id}`,
    );
    expect(result.link_preview_options.is_disabled).toBe(true);
  });

  it("escapes user input and safely handles an empty comment", () => {
    const result = telegramLeadMessage(
      { ...lead, name: '<b>A & "B"</b>', message: "   " },
      "https://site.example.test",
    );
    expect(result.text).toContain("&lt;b&gt;A &amp; &quot;B&quot;&lt;/b&gt;");
    expect(result.text).toContain("Не указан");
    expect(result.text).not.toContain('<b>A & "B"</b>');
  });

  it("keeps source links on the configured site", () => {
    const result = telegramLeadMessage(
      { ...lead, sourceUrl: "//other.example.test" },
      "https://site.example.test",
    );
    expect(result.text).not.toContain('href="https://other.example.test');
  });

  it("fits the Telegram text limit with maximum-length lead fields", () => {
    const result = telegramLeadMessage(
      {
        ...lead,
        name: "И".repeat(100),
        message: "Т".repeat(2000),
        source: "С".repeat(100),
        sourceUrl: "/" + "п".repeat(499),
      },
      "https://site.example.test",
    );
    const visible = result.text.replace(/<[^>]*>/g, "");
    expect(visible.length).toBeLessThanOrEqual(4096);
  });
});
