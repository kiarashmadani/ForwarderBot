//---------------Importing Libraries
const {
    addGroup,
    removeGroup,
    getGroups,
    addUser,
    getUsers,
    getForwardingSession,
    startForwardingSession,
    saveForwardingSession,
    clearForwardingSession
} = require('./storage');

const { Telegraf, Markup } = require('telegraf');

const {
    forwardToTargets
} = require('./forwarder');

//-----------Declaring Variables and Functions
const token = process.env.BOT_TOKEN;
const bot = new Telegraf(token);

if (!token) {
    throw new Error('BOT_TOKEN is missing. Add it to your .env file.');
}

function isPrivateChat(ctx) {
    return ctx.chat && ctx.chat.type === 'private';
}

function isGroupChat(ctx) {
    return ctx.chat && (
        ctx.chat.type === 'group' ||
        ctx.chat.type === 'supergroup'
    );
}

const recentlyAddedGroups = new Map();
const RECENT_GROUP_ADD_TIMEOUT = 60 * 1000;

function markGroupAsRecentlyAdded(chatId) {
    recentlyAddedGroups.set(chatId, Date.now());
}

function wasRecentlyAdded(chatId) {
    const addedAt = recentlyAddedGroups.get(chatId);

    recentlyAddedGroups.delete(chatId);

    return addedAt && Date.now() - addedAt < RECENT_GROUP_ADD_TIMEOUT;
}

async function deleteGroupStartMessage(ctx) {
    try {
        await ctx.deleteMessage();
    } catch (error) {
        console.warn(
            `Could not delete the group start message in ${ctx.chat.id}. ` +
            'Give the bot the Delete Messages admin permission to remove it.'
        );
    }
}

/*
 * Temporary forwarding sessions.
 *
 * Example:
 *
 * {
 *     messageId: 42,
 *     sourceChatId: 123456789,
 *     targets: [-100111111111, 123456789]
 * }
 */
/*
 * Retired for webhook deployment: a Vercel function can stop after any
 * request, so this in-memory Map would lose a user's forwarding session.
 * The original code is preserved below as requested.
 *
const sessions = new Map();

function getSession(userId) {
    if (!sessions.has(userId)) {
        sessions.set(userId, {
            messageId: null,
            sourceChatId: null,
            targets: []
        });
    }

    return sessions.get(userId);
}

function clearSession(userId) {
    sessions.delete(userId);
}
*/

async function buildTargetKeyboard(session) {
    const groups = await getGroups();
    const users = await getUsers();

    const rows = [];

    for (const group of groups) {
        const selected = session.targets.includes(group.id);

        rows.push([
            Markup.button.callback(
                `${selected ? '✅' : '☐'} ${group.title}`,
                `target:g:${group.id}`
            )
        ]);
    }

    for (const user of users) {
        const selected = session.targets.includes(user.id);

        const name = user.username ?
            `@${user.username}(Yourself)` :
            user.firstName || String(user.id);

        rows.push([
            Markup.button.callback(
                `${selected ? '✅' : '☐'} ${name}`,
                `target:u:${user.id}`
            )
        ]);
    }

    rows.push([
        Markup.button.callback(
            'SEND',
            'target:send'
        )
    ]);

    rows.push([
        Markup.button.callback(
            'CANCEL',
            'target:cancel'
        )
    ]);

    return Markup.inlineKeyboard(rows);
}


// ---------------------------------------------------------
// START
// ---------------------------------------------------------

bot.start(async(ctx) => {

    if (isPrivateChat(ctx)) {
        await addUser(ctx.from);

        return ctx.reply(
            'Welcome to the Forwarder Bot! What would you like to do?',
            Markup.inlineKeyboard([
                [
                    Markup.button.callback(
                        'Forward a Message',
                        'forward'
                    )
                ],
                [
                    Markup.button.callback(
                        'Add Bot to a New Group',
                        'add'
                    ),
                    Markup.button.callback(
                        'Already Joined Groups',
                        'listgroups'
                    )
                ]
            ])
        );
    }

    if (!isGroupChat(ctx)) {
        return;
    }

    const isNewGroup = wasRecentlyAdded(ctx.chat.id);

    // addGroup is idempotent: it adds missing groups but never duplicates one.
    await addGroup(ctx.chat);

    if (!isNewGroup) {
        await ctx.telegram.sendMessage(
            ctx.from.id,
            'This bot has been already added to this group!'
        );
    }

    return deleteGroupStartMessage(ctx);
});

// ---------------------------------------------------------
// ADD BOT TO GROUP
// ---------------------------------------------------------

bot.action('add', async(ctx) => {

    await ctx.answerCbQuery();

    if (!isPrivateChat(ctx)) {
        return;
    }

    const botInfo = await ctx.telegram.getMe();

    const addToGroupUrl =
        `https://t.me/${botInfo.username}?startgroup`;

    return ctx.reply(
        'Choose the group where you want to add me:',
        Markup.inlineKeyboard([
            [
                Markup.button.url(
                    'Add Bot to a New Group',
                    addToGroupUrl
                )
            ]
        ])
    );
});


// ---------------------------------------------------------
// GROUP LIST
// ---------------------------------------------------------

bot.action('listgroups', async(ctx) => {

    await ctx.answerCbQuery();

    if (!isPrivateChat(ctx)) {
        return;
    }

    const groups = await getGroups();

    if (groups.length === 0) {
        return ctx.reply(
            'The bot has not joined any groups yet.'
        );
    }

    let message = 'Groups the bot has joined:\n\n';

    for (const group of groups) {
        message += `• ${group.title}\n`;
        message += `  ID: ${group.id}\n`;
        message += `  Type: ${group.type}\n\n`;
    }

    return ctx.reply(message);
});


// ---------------------------------------------------------
// BOT GROUP MEMBERSHIP CHANGES
// ---------------------------------------------------------

bot.on('my_chat_member', async(ctx) => {

    const update = ctx.myChatMember;
    const chat = update.chat;

    if (
        chat.type !== 'group' &&
        chat.type !== 'supergroup'
    ) {
        return;
    }

    const newStatus = update.new_chat_member.status;

    if (
        newStatus === 'member' ||
        newStatus === 'administrator'
    ) {
        await addGroup(chat);
        markGroupAsRecentlyAdded(chat.id);
        console.log(
            `Bot joined group: ${chat.title} (${chat.id})`
        );

        return;
    }

    if (
        newStatus === 'left' ||
        newStatus === 'kicked'
    ) {
        await removeGroup(chat.id);

        console.log(
            `Bot left group: ${chat.title} (${chat.id})`
        );
    }
});


// ---------------------------------------------------------
// FORWARD FLOW
// ---------------------------------------------------------

bot.action('forward', async(ctx) => {

    await ctx.answerCbQuery();

    if (!isPrivateChat(ctx)) {
        return;
    }

    const userId = ctx.from.id;

    // Retired: clearSession(userId); // Memory-only sessions do not survive Vercel restarts.
    await clearForwardingSession(userId);

    // Retired: getSession(userId); // A MongoDB session is created instead.
    await startForwardingSession(userId);

    return ctx.reply(
        'Send me the message you want to forward.'
    );
});


// ---------------------------------------------------------
// RECEIVE MESSAGE TO FORWARD
// ---------------------------------------------------------

bot.on('message', async(ctx) => {

    if (!isPrivateChat(ctx)) {
        return;
    }

    const messageText = ctx.message.text;

    if (messageText && messageText.startsWith('/')) {
        return;
    }

    // Retired: const session = sessions.get(ctx.from.id); // Memory-only lookup.
    const session = await getForwardingSession(ctx.from.id);

    if (!session) {
        return;
    }

    session.messageId = ctx.message.message_id;
    session.sourceChatId = ctx.chat.id;
    session.targets = [];

    await saveForwardingSession(session);

    return ctx.reply(
        'Select the destinations:',
        await buildTargetKeyboard(session)
    );
});


// ---------------------------------------------------------
// SELECT / DESELECT GROUP
// ---------------------------------------------------------

bot.action(/^target:g:(-?\d+)$/, async(ctx) => {

    await ctx.answerCbQuery();

    if (!isPrivateChat(ctx)) {
        return;
    }

    const groupId = Number(ctx.match[1]);
    // Retired: const session = sessions.get(ctx.from.id); // Memory-only lookup.
    const session = await getForwardingSession(ctx.from.id);

    if (!session) {
        return ctx.reply(
            'There is no active forwarding session.'
        );
    }

    const index = session.targets.indexOf(groupId);

    if (index === -1) {
        session.targets.push(groupId);
    } else {
        session.targets.splice(index, 1);
    }

    await saveForwardingSession(session);

    return ctx.editMessageReplyMarkup(
        (await buildTargetKeyboard(session)).reply_markup
    );
});


// ---------------------------------------------------------
// SELECT / DESELECT USER
// ---------------------------------------------------------

bot.action(/^target:u:(\d+)$/, async(ctx) => {

    await ctx.answerCbQuery();

    if (!isPrivateChat(ctx)) {
        return;
    }

    const userId = Number(ctx.match[1]);
    // Retired: const session = sessions.get(ctx.from.id); // Memory-only lookup.
    const session = await getForwardingSession(ctx.from.id);

    if (!session) {
        return ctx.reply(
            'There is no active forwarding session.'
        );
    }

    const index = session.targets.indexOf(userId);

    if (index === -1) {
        session.targets.push(userId);
    } else {
        session.targets.splice(index, 1);
    }

    await saveForwardingSession(session);

    return ctx.editMessageReplyMarkup(
        (await buildTargetKeyboard(session)).reply_markup
    );
});


// ---------------------------------------------------------
// SEND
// ---------------------------------------------------------

bot.action('target:send', async(ctx) => {

    await ctx.answerCbQuery();

    if (!isPrivateChat(ctx)) {
        return;
    }

    const userId = ctx.from.id;
    // Retired: const session = sessions.get(userId); // Memory-only lookup.
    const session = await getForwardingSession(userId);

    if (!session) {
        return ctx.reply(
            'There is no active forwarding session.'
        );
    }

    if (!session.messageId || !session.sourceChatId) {
        return ctx.reply(
            'No message has been selected.'
        );
    }

    if (session.targets.length === 0) {
        return ctx.reply(
            'Please select at least one destination.'
        );
    }

    await ctx.reply(
        `Forwarding to ${session.targets.length} destination(s)...`
    );

    const results = await forwardToTargets(
        bot,
        session.sourceChatId,
        session.messageId,
        session.targets
    );

    const successful = results.filter(
        result => result.success
    );

    const failed = results.filter(
        result => !result.success
    );

    let text =
        `Forwarding completed.\n\n` +
        `Successful: ${successful.length}\n` +
        `Failed: ${failed.length}`;

    if (failed.length > 0) {

        text += '\n\nFailed destinations:\n';

        for (const failure of failed) {
            text += `\n${failure.target}\n`;
            text += `${failure.error}\n`;
        }
    }

    // Retired: clearSession(userId); // Memory-only cleanup.
    await clearForwardingSession(userId);

    return ctx.reply(text);
});


// ---------------------------------------------------------
// CANCEL
// ---------------------------------------------------------

bot.action('target:cancel', async(ctx) => {

    await ctx.answerCbQuery();

    if (!isPrivateChat(ctx)) {
        return;
    }

    // Retired: clearSession(ctx.from.id); // Memory-only cleanup.
    await clearForwardingSession(ctx.from.id);

    return ctx.editMessageText(
        'Forwarding cancelled.'
    );
});


// ---------------------------------------------------------
// ERROR HANDLING
// ---------------------------------------------------------

bot.catch((error, ctx) => {
    console.error(
        `Unhandled error for update ${ctx.update.update_id}:`,
        error
    );
});

module.exports = bot;
