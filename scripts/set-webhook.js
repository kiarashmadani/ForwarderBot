// Run this once after deployment to tell Telegram where it should send updates.
require('dotenv').config();

const bot = require('../src/bot');

const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!webhookUrl) {
    throw new Error(
        'TELEGRAM_WEBHOOK_URL is missing. Set it to your Vercel webhook URL.'
    );
}

if (!webhookSecret) {
    throw new Error('TELEGRAM_WEBHOOK_SECRET is missing.');
}

async function setWebhook() {
    await bot.telegram.setWebhook(webhookUrl, {
        secret_token: webhookSecret
    });

    console.log(`Telegram webhook set to ${webhookUrl}`);
}

setWebhook().catch((error) => {
    console.error('Failed to set Telegram webhook:', error);
    process.exitCode = 1;
});
