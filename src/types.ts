export const TELEGRAM_MAX_LENGTH = 4096;
export const DEBOUNCE_MS = 10_000;
export const TELEGRAM_POLL_TIMEOUT_SECONDS = 30;
export const MESSAGE_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_CONSECUTIVE_POLL_FAILURES = 3;
export const SERVICE_NAME = "telegram-notification";

export type Logger = {
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

export type TelegramChat = {
  id: string | number;
};

export type TelegramMessage = {
  message_id: number;
  chat: TelegramChat;
  text?: string;
  reply_to_message?: TelegramMessage;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
};

export type TelegramSendMessageResponse = {
  ok: boolean;
  result?: {
    message_id: number;
  };
};

export type TelegramUpdatesResponse = {
  ok: boolean;
  result: Array<TelegramUpdate>;
};

export type EventProperties = {
  sessionID?: string;
};

export type PromptClient = Logger & {
  session: {
    promptAsync(input: {
      body: {
        parts: Array<{
          type: "text";
          text: string;
        }>;
      };
      path: {
        id: string;
      };
    }): Promise<unknown>;
  };
};
