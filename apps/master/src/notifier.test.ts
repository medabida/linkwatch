import { describe, expect, it, vi } from "vitest";
import { createTelegramNotifier } from "./notifier.js";

const target = { botToken: "123456:SECRETSECRETSECRETSECRET", chatId: "42" };

describe("telegram notifier", () => {
  it("posts the message to the bot's sendMessage endpoint", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    expect(await createTelegramNotifier(fetchMock as never)(target, "hello")).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/bot123456:SECRETSECRETSECRETSECRET/sendMessage");
    expect(JSON.parse(String(init.body))).toMatchObject({ chat_id: "42", text: "hello" });
  });

  it("returns Telegram's error description", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ description: "Unauthorized" }), { status: 401 }));
    expect(await createTelegramNotifier(f as never)(target, "x")).toEqual({ ok: false, error: "Telegram 401: Unauthorized" });
  });

  it("never throws and keeps the token out of network errors", async () => {
    const f = vi.fn(async () => {
      throw new Error(`fetch failed https://api.telegram.org/bot${target.botToken}/sendMessage`);
    });
    const r = await createTelegramNotifier(f as never)(target, "x");
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("SECRETSECRET");
  });
});
