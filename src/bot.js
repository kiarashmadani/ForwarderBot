//---------------Importing Libraries
const {
    addGroup,
    removeGroup,
    getGroups,
    addUser,
    getUsers
} = require('./storage');

const { Telegraf, Markup } = require('telegraf');

const { forwardToTargets } = require('./forwarder');

//-----------Declaring Variables and Functions
const token = process.env.BOT_TOKEN;
const bot = new Telegraf(token);

if (!token) {
    throw new Error('BOT_TOKEN is missing. Add it to your .env file.');
}

//Check if the bot is running in a private chat
function isPrivateChat(ctx) {
    return ctx.chat && ctx.chat.type === 'private';
}

function isGroupChat(ctx) {
    return ctx.chat && (
        ctx.chat.type === 'group' ||
        ctx.chat.type === 'supergroup'
    );
}

//Function to delete the group start message if the bot has permission 
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

/* Recently Added !!!BUG!!!
const recentlyAddedGroups = new Map();
const RECENT_GROUP_ADD_TIMEOUT = 60 * 1000;

function markGroupAsRecentlyAdded(chatId) {
    recentlyAddedGroups.set(chatId, Date.now());
}

function isAddedBefore(chatId) {
    const addedAt = recentlyAddedGroups.get(chatId);

    recentlyAddedGroups.delete(chatId);

    return addedAt && Date.now() - addedAt < RECENT_GROUP_ADD_TIMEOUT;
}
*/


/* Temporary forwarding sessions.
 *
 *
 * Example:
 *
 * {
 *     messageId: 42,
 *     sourceChatId: 123456789,
 *     targets: [-100111111111, 123456789]
 * }
 */
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

//---------------------------------------------------
//BUILDING THE TARGETS KEYBOARD FOR USERS TO SELECT WHO THEY WANT TO FORWARD THE MESSAGE TO
//------------------------------------------------------

//Function to Display The Targets Toggles for users 
async function buildTargetKeyboard(session, user) {
    const groups = await getGroups(); //Getting These 2 Methods from Database 
    //const users = await getUsers();
    console.log(session);
    const groupsList = groups.filter(group => group.adder == user.username); //Filtering groups to only shows the groups which this user has added the bot to, not all the groups the bot is in

    const rows = [];

    //Adding Groups to the Forward's List
    for (const group of groupsList) {
        const selected = session.targets.includes(group.id);

        rows.push([
            Markup.button.callback(
                `${selected ? '✅' : '☐'} ${group.title}`,
                `target:g:${group.id}`
            )
        ]);
    }


    //Adding Users to the Forward's List
    /*
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
    */

    rows.push([
        Markup.button.callback(
            'SEND',
            'target:send'
        )
    ]);

    rows.push([
        Markup.button.callback(
            'CANCEL',
            'Cancel'
        )
    ]);

    return Markup.inlineKeyboard(rows);
}


// ---------------------------------------------------------
// START
// ---------------------------------------------------------

bot.start(async(ctx) => {
    if (isPrivateChat(ctx)) { //Only Starts for Private Chats, not for Groups
        await addUser(ctx.from); //Add User's Name to the Database

        return ctx.reply(
            `<b>Welcome to the Forwarder Bot!</b> What would you like to do?`,
            Markup.inlineKeyboard([
                [
                    Markup.button.callback(
                        ` <b>Forward a Message</b>`,
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


    // addGroup : it adds missing groups but never duplicates one.
    // const isNewGroup = isAddedBefore(ctx.chat.id);
    // await addGroup(ctx.chat);

    // if (!isNewGroup) {
    //     await ctx.telegram.sendMessage(
    //         ctx.from.id,
    //         'This bot has been already added to this group!'
    //     );
    // }

    return deleteGroupStartMessage(ctx);
});

// ---------------------------------------------------------
// ADD BOT TO GROUP
// ---------------------------------------------------------

// delaring "Add" action
bot.action('add', async(ctx) => {

    await ctx.answerCbQuery(); //Stops the loading animation on the button after recieving data

    if (!isPrivateChat(ctx)) {
        return;
    }

    const botInfo = await ctx.telegram.getMe(); //return an Object of Bot's Information

    const addToGroupUrl = `https://t.me/${botInfo.username}?startgroup`;

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

    const groups = await getGroups(); //Get group's list from the database 
    const groupsList = groups.filter(group => group.adder == ctx.from.username); //Filtering groups to only shows the groups which this user has added the bot to, not all the groups the bot is in
    // console.log(groupsList);
    // console.log(groups);
    // console.log(ctx.from);

    if (groupsList.length === 0) { //Check emptyness
        return ctx.reply(
            'The bot has not joined any groups yet.'
        );
    }

    let message = 'Groups the bot has joined:\n\n';

    for (const group of groupsList) {
        message += `• ${group.title}\n`;
        message += `  ID: ${group.id}\n`;
        message += `  Type: ${group.type}\n`;
        message += `  User: ${group.adder}\n\n`;
    }

    return ctx.reply(message);
});


// ---------------------------------------------------------
// BOT'S ROLE IN GROUPS STATUS
// ---------------------------------------------------------
//Checking and Reacting to the Bot's Membership Changes in Groups (Added, Removed, Kicked, Left)
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

    //Joined
    if (
        newStatus === 'member' ||
        newStatus === 'administrator'
    ) {
        await addGroup(chat, ctx.from); //Add the group to the database if it doesn't exist yet
        console.log(
            `Bot joined group: ${chat.title} (${chat.id})`
        );

        return;
    }

    //Left
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

    clearSession(userId); //Clear any previous session for the user
    getSession(userId); //Create a new session for the user

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

    const messageText = ctx.message.text; // Getting the text from User's message

    if (messageText && messageText.startsWith('/')) { //check if it's not command
        return;
    }

    const session = sessions.get(ctx.from.id); //Giving a Null filled Object with chat's information from sessions Map 

    if (!session) {
        return;
    }

    //Store the message ID and source chat ID in the session for later forwarding
    session.messageId = ctx.message.message_id;
    session.sourceChatId = ctx.chat.id;
    session.targets = [];

    return ctx.reply(
        'Select the destinations:',
        await buildTargetKeyboard(session, ctx.from)
    );
});


// ---------------------------------------------------------
// SELECT / DESELECT GROUP
// ---------------------------------------------------------

bot.action(/^target:g:(-?\d+)$/, async(ctx) => { //Reg ex for matching the group ID in the callback data

    await ctx.answerCbQuery();

    if (!isPrivateChat(ctx)) {
        return;
    }

    const groupId = Number(ctx.match[1]);
    const session = sessions.get(ctx.from.id);

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
    const session = sessions.get(userId);

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

    //Getting results array from forwarder.js
    const results = await forwardToTargets(
        bot,
        session.sourceChatId,
        session.messageId,
        session.targets
    );

    //spliting results to 2 success / failed arrays 
    const successful = results.filter(
        result => result.success
    );

    const failed = results.filter(
        result => !result.success
    );

    //displaying reply
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

    clearSession(userId);

    return ctx.reply(text);
});


// ---------------------------------------------------------
// CANCEL
// ---------------------------------------------------------

bot.action('Cancel', async(ctx) => {

    await ctx.answerCbQuery();

    if (!isPrivateChat(ctx)) {
        return;
    }

    clearSession(ctx.from.id);

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