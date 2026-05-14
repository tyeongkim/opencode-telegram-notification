import type {
  EventProperties,
  Logger,
  TelegramChat,
  TelegramMessage,
  TelegramSendMessageResponse,
  TelegramUpdate,
  TelegramUpdatesResponse,
} from "./types.js";
import {
  SERVICE_NAME,
  TELEGRAM_MAX_LENGTH,
} from "./types.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isTelegramChat(value: unknown): value is TelegramChat {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.id === "string" || typeof value.id === "number";
}

export function isTelegramMessage(value: unknown): value is TelegramMessage {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.message_id !== "number" || !isTelegramChat(value.chat)) {
    return false;
  }

  if (value.text !== undefined && typeof value.text !== "string") {
    return false;
  }

  if (
    value.reply_to_message !== undefined &&
    !isTelegramMessage(value.reply_to_message)
  ) {
    return false;
  }

  return true;
}

export function parseTelegramUpdate(value: unknown): TelegramUpdate | undefined {
  if (!isRecord(value) || typeof value.update_id !== "number") {
    return undefined;
  }

  const update: TelegramUpdate = { update_id: value.update_id };

  if (isTelegramMessage(value.message)) {
    update.message = value.message;
  }
  if (isTelegramMessage(value.edited_message)) {
    update.edited_message = value.edited_message;
  }
  if (isTelegramMessage(value.channel_post)) {
    update.channel_post = value.channel_post;
  }
  if (isTelegramMessage(value.edited_channel_post)) {
    update.edited_channel_post = value.edited_channel_post;
  }

  return update;
}

export function parseTelegramSendMessageResponse(
  value: unknown,
): TelegramSendMessageResponse | undefined {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    return undefined;
  }

  if (value.result === undefined) {
    return { ok: value.ok };
  }

  if (!isRecord(value.result) || typeof value.result.message_id !== "number") {
    return undefined;
  }

  return {
    ok: value.ok,
    result: {
      message_id: value.result.message_id,
    },
  };
}

export function parseTelegramUpdatesResponse(
  value: unknown,
): TelegramUpdatesResponse | undefined {
  if (
    !isRecord(value) ||
    typeof value.ok !== "boolean" ||
    !Array.isArray(value.result)
  ) {
    return undefined;
  }

  const result: Array<TelegramUpdate> = [];
  for (const rawUpdate of value.result) {
    const update = parseTelegramUpdate(rawUpdate);
    if (update !== undefined) {
      result.push(update);
    }
  }

  return { ok: value.ok, result };
}

export function getChatIdFromUpdate(update: TelegramUpdate): string | undefined {
  if (update.message !== undefined) {
    return String(update.message.chat.id);
  }
  if (update.edited_message !== undefined) {
    return String(update.edited_message.chat.id);
  }
  if (update.channel_post !== undefined) {
    return String(update.channel_post.chat.id);
  }
  if (update.edited_channel_post !== undefined) {
    return String(update.edited_channel_post.chat.id);
  }

  return undefined;
}

export function getLatestChatId(
  updates: Array<TelegramUpdate>,
): string | undefined {
  for (let index = updates.length - 1; index >= 0; index--) {
    const update = updates[index];
    if (update !== undefined) {
      const chatId = getChatIdFromUpdate(update);
      if (chatId !== undefined) {
        return chatId;
      }
    }
  }

  return undefined;
}

export function getEventProperties(value: unknown): EventProperties {
  if (!isRecord(value) || typeof value.sessionID !== "string") {
    return {};
  }

  return { sessionID: value.sessionID };
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export async function logPluginMessage(
  client: Logger,
  level: "warn" | "error" | "info",
  message: string,
): Promise<void> {
  await client.app.log({
    body: {
      service: SERVICE_NAME,
      level,
      message,
    },
  });
}

export async function setTelegramReaction(
  token: string,
  chatId: string,
  messageId: number,
  emoji: string,
): Promise<void> {
  const url = `https://api.telegram.org/bot${token}/setMessageReaction`;
  const body = JSON.stringify({
    chat_id: chatId,
    message_id: messageId,
    reaction: [{ type: "emoji", emoji }],
  });

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  if (!response.ok) {
    throw new Error(`Telegram setMessageReaction failed for chat ${chatId}`);
  }
}

export async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string,
  silent: boolean,
): Promise<number | undefined> {
  const truncated =
    text.length > TELEGRAM_MAX_LENGTH
      ? text.slice(0, TELEGRAM_MAX_LENGTH)
      : text;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = JSON.stringify({
    chat_id: chatId,
    text: truncated,
    disable_notification: silent,
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    if (response.ok) {
      const parsed = parseTelegramSendMessageResponse(await response.json());
      if (parsed === undefined || !parsed.ok) {
        return undefined;
      }

      if (parsed.result !== undefined) {
        return parsed.result.message_id;
      }

      return undefined;
    }

    if (attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  throw new Error(`Telegram API failed for chat ${chatId}`);
}

export async function detectChatId(token: string): Promise<string | undefined> {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/getUpdates`,
  );
  if (!response.ok) {
    throw new Error("Telegram getUpdates API failed");
  }

  const parsed = parseTelegramUpdatesResponse(await response.json());
  if (parsed === undefined || !parsed.ok) {
    throw new Error("Telegram getUpdates response was invalid");
  }

  return getLatestChatId(parsed.result);
}
