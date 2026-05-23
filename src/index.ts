import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import {
  rememberTelegramMessage,
  startTelegramReplyPolling,
} from "./polling.js";
import { DEBOUNCE_MS } from "./types.js";
import {
  detectChatId,
  getErrorMessage,
  getEventProperties,
  logPluginMessage,
  sendTelegramMessage,
} from "./telegram.js";

const plugin: Plugin = async ({ client }) => {
  const token = process.env.OPENCODE_NOTIFICATION_TELEGRAM_BOT_TOKEN;
  let chatId = process.env.OPENCODE_NOTIFICATION_TELEGRAM_CHAT_ID;
  const lastNotifications = new Map<string, number>();
  const messageSessions = new Map<number, string>();
  const messageTimestamps = new Map<number, number>();

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
  startTelegramReplyPolling(
    client,
    token,
    chatId,
    messageSessions,
    messageTimestamps,
  );

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
          } catch (error) {
            await logPluginMessage(
              client,
              "warn",
              `Failed to check session ${context.sessionID} parent before notification: ${getErrorMessage(error)}`,
            );
          }

          const silent = args.urgency === "low";

          try {
            const messageId = await sendTelegramMessage(
              token,
              chatId,
              args.message,
              silent,
            );
            rememberTelegramMessage(
              messageSessions,
              messageTimestamps,
              messageId,
              context.sessionID,
            );
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
      } else {
        message = `❓ Question asked — needs your answer (${label})`;
      }

      try {
        const messageId = await sendTelegramMessage(
          token,
          chatId,
          message,
          false,
        );
        rememberTelegramMessage(
          messageSessions,
          messageTimestamps,
          messageId,
          sessionID,
        );
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
