// Vercel runs this function whenever Telegram POSTs an update to the webhook URL.
require('dotenv').config();

const { connectDatabase } = require('../src/storage');
const bot = require('../src/bot');

const webhookPath = '/api/telegram-webhook';
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!webhookSecret) {
    throw new Error(
        'TELEGRAM_WEBHOOK_SECRET is missing from the environment variables.'
    );
}

// Telegraf validates Telegram's secret-token header before processing an update.
const handleTelegramUpdate = bot.webhookCallback(webhookPath, {
    secretToken: webhookSecret
});

module.exports = async function telegramWebhook(req, res) {
    try {
        // Reuses an existing connection in a warm Vercel function, or opens one
        // when Vercel starts a fresh function instance.
        await connectDatabase();

        return handleTelegramUpdate(req, res);
    } catch (error) {
        console.error('Unable to process Telegram webhook:', error);

        if (!res.headersSent) {
            res.status(500).json({ error: 'Webhook processing failed.' });
        }
    }
};
