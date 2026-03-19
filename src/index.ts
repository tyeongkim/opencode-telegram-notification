const TELEGRAM_MAX_LENGTH = 4096;

async function sendTelegramMessage(token: string, chatId: string, text: string): Promise<void> {
  const truncated = text.length > TELEGRAM_MAX_LENGTH ? text.slice(0, TELEGRAM_MAX_LENGTH) : text;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = JSON.stringify({ chat_id: chatId, text: truncated });

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    if (response.ok) return;

    if (attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  throw new Error(`Telegram API failed for chat ${chatId}`);
}
