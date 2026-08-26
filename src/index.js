// require('dotenv').config();
// const {
//     connectDatabase,
//     closeDatabase
// } = require('./storage');

// const http = require('http');
// const bot = require('./bot');

// const PORT = process.env.PORT || 10000;

// const server = http.createServer((req, res) => {
//     res.writeHead(200, {
//         'Content-Type': 'text/plain'
//     });

//     res.end('Forwarder Bot is running!');
// });

// server.listen(PORT, '0.0.0.0', () => {
//     console.log(`Web server is running on port ${PORT}`);
// });

// async function startBot() {
//     await connectDatabase();
//     await bot.launch();

//     console.log('Forwarder Bot is running.');
//     console.log('Bot is ready to forward messages.');
// }

// startBot().catch((error) => {
//     console.error('Failed to start the bot:', error);
//     process.exit(1);
// });

// async function stopApplication(signal) {
//     bot.stop(signal);
//     await closeDatabase();

//     server.close();
// }

// process.once('SIGINT', () => {
//     stopApplication('SIGINT');
// });

// process.once('SIGTERM', () => {
//     stopApplication('SIGTERM');
// });



//------------------------------------
//WEBHOOK SETUP
//------------------------------------
require('dotenv').config();
const {
    connectDatabase,
    closeDatabase
} = require('./storage');

const http = require('http');
const bot = require('./bot');

const PORT = process.env.PORT || 10000;

// Render sets RENDER_EXTERNAL_URL automatically. WEBHOOK_DOMAIN lets you
// override it manually (useful on other hosts, or with ngrok for testing).
const DOMAIN = process.env.WEBHOOK_DOMAIN || process.env.RENDER_EXTERNAL_URL;

// Keep this path secret so strangers can't POST fake updates to your bot.
const WEBHOOK_PATH = `/telegraf/${process.env.WEBHOOK_SECRET}`;

// Telegraf gives us a ready-made request handler for this path.
const webhookHandler = bot.webhookCallback(WEBHOOK_PATH);

const server = http.createServer((req, res) => {
    if (req.url === WEBHOOK_PATH) {
        return webhookHandler(req, res);
    }

    res.writeHead(200, {
        'Content-Type': 'text/plain'
    });

    res.end('Forwarder Bot is running!');
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Web server is running on port ${PORT}`);
});

async function startBot() {
    await connectDatabase();

    //button for commands
    await bot.telegram.setMyCommands([
        { command: 'start', description: 'Open the main menu' },
        { command: 'cancel', description: 'Cancel the current action' },
    ]);

    if (!DOMAIN) {
        throw new Error('WEBHOOK_DOMAIN or RENDER_EXTERNAL_URL is missing.');
    }

    if (!process.env.WEBHOOK_SECRET) {
        throw new Error('WEBHOOK_SECRET is missing from the environment variables.');
    }

    await bot.telegram.setWebhook(`${DOMAIN}${WEBHOOK_PATH}`);

    console.log('Forwarder Bot is running with a webhook.');
    console.log('Bot is ready to forward messages.');
}

startBot().catch((error) => {
    console.error('Failed to start the bot:', error);
    process.exit(1);
});

async function stopApplication(signal) {
    console.log(`Received ${signal}, shutting down...`);

    await bot.telegram.deleteWebhook();
    await closeDatabase();

    server.close();
}

process.once('SIGINT', () => {
    stopApplication('SIGINT');
});

process.once('SIGTERM', () => {
    stopApplication('SIGTERM');
});