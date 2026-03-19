# opencode-telegram-notification

OpenCode plugin that sends Telegram notifications when the LLM completes work, requests permission, or encounters an error.

## Installation

```sh
bun add opencode-telegram-notification
# or
npm install opencode-telegram-notification
```

Then add the plugin to your `opencode.json`:

```json
{
  "plugin": ["opencode-telegram-notification"]
}
```

## Create a Telegram Bot

1. Open Telegram and search for `@BotFather`
2. Send `/newbot` and follow the prompts
3. Copy the bot token BotFather gives you
4. Send any message to your new bot
5. Open `https://api.telegram.org/bot<TOKEN>/getUpdates` in your browser and find your `chat_id` in the response

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `OPENCODE_NOTIFICATION_TELEGRAM_BOT_TOKEN` | Yes | Bot token from BotFather |
| `OPENCODE_NOTIFICATION_TELEGRAM_CHAT_ID` | Yes | Chat ID to send notifications to |

Set these in your shell or `.env` file before running OpenCode.

## Events

The plugin listens for three events:

- `session.idle` — LLM finished working, waiting for your input
- `permission.asked` — LLM needs your permission to proceed
- `session.error` — Session encountered an error

## License

MIT
