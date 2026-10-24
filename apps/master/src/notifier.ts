export type SendResult = { ok: true } | { ok: false; error: string };

export interface TelegramTarget {
  botToken: string;
  chatId: string;
}

export type Notify = (channel: TelegramTarget, text: string) => Promise<SendResult>;

const TIMEOUT_MS = 10_000;

/** Sends plain text through the Telegram Bot API. Never throws: failures come back as `{ ok: false }`. */
export function createTelegramNotifier(fetchImpl: typeof fetch = fetch): Notify {
  return async ({ botToken, chatId }, text) => {
    try {
      const res = await fetchImpl(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) return { ok: true };
      const body = (await res.json().catch(() => null)) as { description?: string } | null;
      return { ok: false, error: `Telegram ${res.status}: ${body?.description ?? res.statusText}` };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg.split(botToken).join("<token>") };
    }
  };
}
