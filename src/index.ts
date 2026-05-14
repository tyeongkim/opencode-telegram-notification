import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";

const TELEGRAM_MAX_LENGTH = 4096;
const DEBOUNCE_MS = 10_000;
const SERVICE_NAME = "telegram-notification";

type Logger = {
  app: {
    log(input: {
      body: {
        service: string;
        level: "warn" | "error" | "info";
        message: string;
      };
    }): Promise<unknown>;
  };
};

type TelegramChat = {
  id: string | number;
};

type TelegramMessage = {
  chat: TelegramChat;
};

type TelegramUpdate = {
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
};

type TelegramUpdatesResponse = {
  ok: boolean;
  result: Array<TelegramUpdate>;
};

type EventProperties = {
  sessionID?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTelegramChat(value: unknown): value is TelegramChat {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.id === "string" || typeof value.id === "number";
}

function isTelegramMessage(value: unknown): value is TelegramMessage {
  if (!isRecord(value)) {
    return false;
  }

  return isTelegramChat(value.chat);
}

function parseTelegramUpdate(value: unknown): TelegramUpdate | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const update: TelegramUpdate = {};
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

function parseTelegramUpdatesResponse(
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

function getChatIdFromUpdate(update: TelegramUpdate): string | undefined {
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

function getLatestChatId(updates: Array<TelegramUpdate>): string | undefined {
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

function getEventProperties(value: unknown): EventProperties {
  if (!isRecord(value) || typeof value.sessionID !== "string") {
    return {};
  }

  return { sessionID: value.sessionID };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function logPluginMessage(
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

async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string,
  silent: boolean,
): Promise<void> {
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
      return;
    }

    if (attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  throw new Error(`Telegram API failed for chat ${chatId}`);
}

async function detectChatId(token: string): Promise<string | undefined> {
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

const plugin: Plugin = async ({ client }) => {
  const token = process.env.OPENCODE_NOTIFICATION_TELEGRAM_BOT_TOKEN;
  let chatId = process.env.OPENCODE_NOTIFICATION_TELEGRAM_CHAT_ID;
  const lastNotifications = new Map<string, number>();

  if (token === undefined || token.length === 0) {
    await logPluginMessage(
      client,
      "warn",
      "OPENCODE_NOTIFICATION_TELEGRAM_BOT_TOKEN not set — notifications disabled",
    );

    return {};
  }

  if (chatId === undefined || chatId.length === 0) {
    try {
      chatId = await detectChatId(token);
    } catch (error) {
      await logPluginMessage(
        client,
        "error",
        `Failed to auto-detect Telegram chat_id: ${getErrorMessage(error)}`,
      );
    }
  }

  if (chatId === undefined || chatId.length === 0) {
    await logPluginMessage(
      client,
      "warn",
      "Send any message to your bot to enable notifications, then restart OpenCode",
    );

    return {};
  }

	await logPluginMessage(client, "info", "Telegram notifications enabled");

  return {
    tool: {
      send_notification: tool({
        description:
          "Send a Telegram notification to the user. Use this when you complete a significant task, finish a long-running operation, or have important information the user should see even if they're away from the terminal.",
        args: {
          message: tool.schema
            .string()
            .describe(
              "The notification message to send. Keep it concise and informative.",
            ),
          urgency: tool.schema
            .union([
              tool.schema.literal("low"),
              tool.schema.literal("normal"),
              tool.schema.literal("high"),
            ])
            .default("normal")
            .describe(
              "Notification urgency: low is silent, normal uses default behavior, high ensures sound.",
            ),
        },
        async execute(args, context): Promise<string> {
          try {
            const session = await client.session.get({
              path: { id: context.sessionID },
            });
            if (
              session.data !== undefined &&
              session.data.parentID !== undefined
            ) {
              return "Notification skipped — only the primary session can send notifications.";
            }
          } catch {
            // If session lookup fails, allow the notification to proceed
          }

          const silent = args.urgency === "low";

          try {
            await sendTelegramMessage(token, chatId, args.message, silent);
          } catch (error) {
            await logPluginMessage(
              client,
              "error",
              `Failed to send Telegram notification: ${getErrorMessage(error)}`,
            );

            return "Notification failed.";
          }

          return "Notification sent successfully.";
        },
      }),
    },

    event: async ({ event }): Promise<void> => {
      const eventType: string = event.type;
      const props = getEventProperties(event.properties);
      let sessionID: string | undefined;

      if (eventType === "permission.updated") {
        sessionID = props.sessionID;
      } else if (eventType === "session.error") {
        sessionID = props.sessionID;
      } else if (eventType === "question.asked") {
        sessionID = props.sessionID;
      } else {
        return;
      }

      if (sessionID === undefined) {
        return;
      }

      const debounceKey = `${sessionID}:${eventType}`;
      const now = Date.now();
      const lastNotification = lastNotifications.get(debounceKey);
      if (
        lastNotification !== undefined &&
        now - lastNotification < DEBOUNCE_MS
      ) {
        return;
      }
      lastNotifications.set(debounceKey, now);

      let label = sessionID;

      try {
        const session = await client.session.get({
          path: { id: sessionID },
        });
        if (session.data !== undefined && session.data.parentID !== undefined) {
          return;
        }
        if (session.data !== undefined && session.data.title !== undefined) {
          label = session.data.title;
        }
      } catch (error) {
        await logPluginMessage(
          client,
          "error",
          `Failed to fetch session ${sessionID} for label: ${getErrorMessage(error)}`,
        );
      }

      let message: string;

      if (eventType === "permission.updated") {
        message = `⚠️ Permission requested (${label})`;
      } else if (eventType === "question.asked") {
        message = `❓ Question asked — needs your answer (${label})`;
      } else {
        message = `❌ Session error (${label})`;
      }

      try {
        await sendTelegramMessage(token, chatId, message, false);
      } catch (error) {
        await logPluginMessage(
          client,
          "error",
          `Failed to send Telegram notification: ${getErrorMessage(error)}`,
        );
      }
    },
  };
};

export default plugin;
