# opencode-telegram-notification

OpenCode plugin that sends Telegram notifications via LLM tool calls and critical event hooks, with bidirectional reply support.

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

## Setup

### 1. Create a Telegram Bot

1. Open Telegram and search for `@BotFather`
2. Send `/newbot` and follow the prompts
3. Copy the bot token BotFather gives you

### 2. Set the Bot Token

```sh
export OPENCODE_NOTIFICATION_TELEGRAM_BOT_TOKEN="your-bot-token"
```

### 3. Send a Message to Your Bot

Open your bot in Telegram and send any message (e.g. "hello"). The plugin will automatically detect your `chat_id` on startup.

That's it! The plugin will start sending notifications and listening for your replies.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `OPENCODE_NOTIFICATION_TELEGRAM_BOT_TOKEN` | Yes | Bot token from BotFather |
| `OPENCODE_NOTIFICATION_TELEGRAM_CHAT_ID` | No | Chat ID (auto-detected if not set) |

## How It Works

### Tool: `send_notification`

The plugin registers a `send_notification` tool that the LLM can call to send you a Telegram message. The LLM decides when to notify you — typically after completing a significant task or when it has important information you should see while away.

**Urgency levels:**

| Level | Behavior |
|---|---|
| `low` | Silent notification (no sound) |
| `normal` | Default notification |
| `high` | Ensures notification sound |

### Event-Based Notifications

The plugin automatically sends notifications for critical events:

- `permission.updated` — LLM needs your permission to proceed
- `question.asked` — LLM asked a question that needs your answer
- `session.error` — Session encountered an error

Duplicate notifications for the same event within 10 seconds are suppressed. Notifications from child sessions (subagents) are filtered out.

### Reply-to-Prompt

Reply to any bot notification in Telegram and your message will be injected as a prompt into the corresponding OpenCode session. The agent will process your request and send the result back via notification.

- Reply is confirmed with a 👍 reaction on your message
- If the reply fails, a 👎 reaction is shown instead
- The agent is instructed to notify you of the result since you're away from the terminal
- Messages sent directly in the terminal are not affected

This creates a bidirectional loop: notification → reply → agent processes → notification → reply...

### Polling

The plugin uses Telegram long-polling (`getUpdates` with 30s timeout) to listen for replies. This runs in the background with minimal resource usage. Polling stops automatically after 3 consecutive failures.

## License

MIT
