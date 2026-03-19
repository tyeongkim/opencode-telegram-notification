import type { Plugin } from "@opencode-ai/plugin";

const TELEGRAM_MAX_LENGTH = 4096;

async function sendTelegramMessage(
	token: string,
	chatId: string,
	text: string,
): Promise<void> {
	const truncated =
		text.length > TELEGRAM_MAX_LENGTH
			? text.slice(0, TELEGRAM_MAX_LENGTH)
			: text;
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

			let message: string;

			if (event.type === "session.idle") {
				message = `🔔 Session idle — waiting for input (${label})`;
			} else if (event.type === "permission.updated") {
				message = `⚠️ Permission requested (${label})`;
			} else {
				message = `❌ Session error (${label})`;
			}

			try {
				await sendTelegramMessage(token, chatId, message);
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
