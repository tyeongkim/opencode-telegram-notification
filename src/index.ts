import type { Plugin } from "@opencode-ai/plugin";

const TELEGRAM_MAX_LENGTH = 4096;

function escapeMarkdownV2(text: string): string {
	return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

function escapeMarkdownV2Code(text: string): string {
	return text.replace(/([`\\])/g, "\\$1");
}

async function sendTelegramMessage(
	token: string,
	chatId: string,
	text: string,
	parseMode?: string,
): Promise<void> {
	const truncated =
		text.length > TELEGRAM_MAX_LENGTH
			? text.slice(0, TELEGRAM_MAX_LENGTH)
			: text;
	const url = `https://api.telegram.org/bot${token}/sendMessage`;
	const payload: Record<string, string> = { chat_id: chatId, text: truncated };
	if (parseMode) {
		payload.parse_mode = parseMode;
	}
	const body = JSON.stringify(payload);

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

const plugin: Plugin = async ({ client }) => {
	const token = process.env.OPENCODE_NOTIFICATION_TELEGRAM_BOT_TOKEN;
	const chatId = process.env.OPENCODE_NOTIFICATION_TELEGRAM_CHAT_ID;

	if (!token || !chatId) {
		await client.app.log({
			body: {
				service: "telegram-notification",
				level: "warn",
				message:
					"OPENCODE_NOTIFICATION_TELEGRAM_BOT_TOKEN or OPENCODE_NOTIFICATION_TELEGRAM_CHAT_ID not set — notifications disabled",
			},
		});

		return {};
	}

	return {
		event: async ({ event }) => {
			let sessionID: string | undefined;

			if (event.type === "session.idle") {
				sessionID = event.properties.sessionID;
			} else if (event.type === "permission.updated") {
				sessionID = event.properties.sessionID;
			} else if (event.type === "session.error") {
				sessionID = event.properties.sessionID;
			} else {
				return;
			}

			let label = sessionID ?? "unknown";
			if (sessionID) {
				try {
					const session = await client.session.get({
						path: { id: sessionID },
					});
					if (session.data?.parentID) {
						return;
					}
					if (session.data?.title) {
						label = session.data.title;
					}
				} catch {
					await client.app.log({
						body: {
							service: "telegram-notification",
							level: "error",
							message: `Failed to fetch session ${sessionID} for label`,
						},
					});
				}
			}

			let lastAssistantText = "";
			if (sessionID && event.type === "session.idle") {
				try {
					const messagesRes = await client.session.messages({
						path: { id: sessionID },
						query: { limit: 10 },
					});
					const messages = messagesRes.data;
					if (messages) {
						for (let i = messages.length - 1; i >= 0; i--) {
							const msg = messages[i];
							if (msg !== undefined && msg.info.role === "assistant") {
								const textParts = msg.parts
									.filter(
										(p): p is Extract<typeof p, { type: "text" }> =>
											p.type === "text",
									)
									.map((p) => p.text)
									.join("");
								if (textParts.length > 0) {
									lastAssistantText = textParts;
								}
								break;
							}
						}
					}
				} catch {
					await client.app.log({
						body: {
							service: "telegram-notification",
							level: "error",
							message: `Failed to fetch messages for session ${sessionID}`,
						},
					});
				}
			}

			let message: string;

			let parseMode: string | undefined;

			if (event.type === "session.idle") {
				message = `🔔 Session idle — waiting for input \\(${escapeMarkdownV2(label)}\\)`;
				if (lastAssistantText.length > 0) {
					message += `\n\n💬 Last response:\n\`\`\`\n${escapeMarkdownV2Code(lastAssistantText)}\n\`\`\``;
					parseMode = "MarkdownV2";
				}
			} else if (event.type === "permission.updated") {
				message = `⚠️ Permission requested (${label})`;
			} else {
				message = `❌ Session error (${label})`;
			}

			try {
				await sendTelegramMessage(token, chatId, message, parseMode);
			} catch (err) {
				await client.app.log({
					body: {
						service: "telegram-notification",
						level: "error",
						message: `Failed to send Telegram notification: ${err instanceof Error ? err.message : String(err)}`,
					},
				});
			}
		},
	};
};

export default plugin;
