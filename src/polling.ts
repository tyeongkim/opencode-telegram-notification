import {
  getErrorMessage,
  logPluginMessage,
  parseTelegramUpdatesResponse,
  setTelegramReaction,
} from "./telegram.js";
import type { PromptClient, TelegramMessage } from "./types.js";
import {
  MAX_CONSECUTIVE_POLL_FAILURES,
  MESSAGE_SESSION_TTL_MS,
  TELEGRAM_POLL_TIMEOUT_SECONDS,
} from "./types.js";

let pollingAbortController: AbortController | undefined;

export function rememberTelegramMessage(
  messageSessions: Map<number, string>,
  messageTimestamps: Map<number, number>,
  messageId: number | undefined,
  sessionID: string,
): void {
  if (messageId === undefined) {
    return;
  }

  messageSessions.set(messageId, sessionID);
  messageTimestamps.set(messageId, Date.now());
}

function cleanupOldTelegramMessages(
  messageSessions: Map<number, string>,
  messageTimestamps: Map<number, number>,
): void {
  const now = Date.now();
  for (const entry of messageTimestamps) {
    const messageId = entry[0];
    const timestamp = entry[1];
    if (now - timestamp > MESSAGE_SESSION_TTL_MS) {
      messageSessions.delete(messageId);
      messageTimestamps.delete(messageId);
    }
  }
}

async function handleTelegramReply(
  client: PromptClient,
  token: string,
  chatId: string,
  messageSessions: Map<number, string>,
  messageTimestamps: Map<number, number>,
  message: TelegramMessage,
): Promise<void> {
  if (message.reply_to_message === undefined) {
    return;
  }

  const sessionID = messageSessions.get(message.reply_to_message.message_id);
  if (sessionID === undefined) {
    return;
  }

  if (message.text === undefined || message.text.length === 0) {
    await setTelegramReaction(token, chatId, message.message_id, "👎").catch(
      () => {},
    );

    return;
  }

  try {
    const promptText =
      "[TELEGRAM REPLY] This message was sent via Telegram reply. " +
      "The user is NOT at the terminal. " +
      "After completing the work requested in this message, you MUST use the send_notification tool to report the result back to the user. " +
      "If a subsequent message does NOT contain this [TELEGRAM REPLY] header, the user has returned to the terminal and you do NOT need to send a notification.\n" +
      "<user-reply>" +
      message.text +
      "</user-reply>";
    await client.session.promptAsync({
      body: {
        parts: [{ type: "text", text: promptText }],
      },
      path: { id: sessionID },
    });
    await setTelegramReaction(token, chatId, message.message_id, "👍");
  } catch (error) {
    await logPluginMessage(
      client,
      "error",
      `Failed to send Telegram reply prompt to session ${sessionID}: ${getErrorMessage(error)}`,
    );
    await setTelegramReaction(token, chatId, message.message_id, "👎").catch(
      () => {},
    );
  }
}

async function pollTelegramReplies(
  client: PromptClient,
  token: string,
  chatId: string,
  messageSessions: Map<number, string>,
  messageTimestamps: Map<number, number>,
  abortSignal: AbortSignal,
): Promise<void> {
  let offset = 0;
  let consecutiveFailures = 0;

  while (!abortSignal.aborted) {
    try {
      cleanupOldTelegramMessages(messageSessions, messageTimestamps);

      const response = await fetch(
        `https://api.telegram.org/bot${token}/getUpdates?timeout=${TELEGRAM_POLL_TIMEOUT_SECONDS}&offset=${offset}`,
        { signal: abortSignal },
      );
      if (!response.ok) {
        throw new Error("Telegram getUpdates API failed while polling replies");
      }

      const parsed = parseTelegramUpdatesResponse(await response.json());
      if (parsed === undefined || !parsed.ok) {
        throw new Error("Telegram getUpdates polling response was invalid");
      }

      consecutiveFailures = 0;

      for (const update of parsed.result) {
        offset = update.update_id + 1;
        if (update.message !== undefined) {
          await handleTelegramReply(
            client,
            token,
            chatId,
            messageSessions,
            messageTimestamps,
            update.message,
          );
        }
      }
    } catch (error) {
      if (abortSignal.aborted) {
        return;
      }

      consecutiveFailures++;
      await logPluginMessage(
        client,
        "error",
        `Telegram reply polling failed: ${getErrorMessage(error)}`,
      );

      if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
        await logPluginMessage(
          client,
          "error",
          "Telegram reply polling stopped after repeated failures",
        );

        if (pollingAbortController !== undefined) {
          pollingAbortController.abort();
        }

        pollingAbortController = undefined;

        return;
      }
    }
  }
}

export function startTelegramReplyPolling(
  client: PromptClient,
  token: string,
  chatId: string,
  messageSessions: Map<number, string>,
  messageTimestamps: Map<number, number>,
): void {
  if (pollingAbortController !== undefined) {
    pollingAbortController.abort();
  }

  pollingAbortController = new AbortController();
  const abortSignal = pollingAbortController.signal;
  pollTelegramReplies(
    client,
    token,
    chatId,
    messageSessions,
    messageTimestamps,
    abortSignal,
  ).catch(async (error: unknown): Promise<void> => {
    await logPluginMessage(
      client,
      "error",
      `Telegram reply polling crashed: ${getErrorMessage(error)}`,
    );
  });
}
