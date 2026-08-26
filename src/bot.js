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

const welcome_message =
    `👋 <b>Welcome to Forwarder Bot!</b>

I'm here to help you forward messages to your groups without the copy-paste gymnastics. Think of me as your personal courier pigeon — except I don't get lost and I definitely don't leave feathers everywhere. 🐦

<b>Here's what I can do:</b>
📨 <i>Forward any message to one or more of your groups</i>
➕ Join new groups on your behalf
📋 Keep track of the groups you've added me to

<b>A few house rules before we start:</b> 📜
🚫 No spamming — nobody likes a chatty pigeon
🚫 No illegal content, links, or requests
🚫 No hate speech, harassment, or rude behavior towards others
🔒 Only forward content you actually have the right to share
⚖️ You're responsible for what you forward through me — I just carry the message, I don't read your mail

Follow those, and we'll get along great. 🤝

Tap a button below (or use /start anytime) to get going!`;

const token = process.env.BOT_TOKEN;
const bot = new Telegraf(token);


//Logging for finding bug
process.on('unhandledRejection', (reason) => {
    console.error('🔴 UNHANDLED REJECTION (this was likely crashing your server):', reason);
});

process.on('uncaughtException', (error) => {
    console.error('🔴 UNCAUGHT EXCEPTION (this was likely crashing your server):', error);
});

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
const groupRegistrationModes = new Map();

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
    console.log(`[/start] triggered by user ${ctx.from.id} (${ctx.from.username || 'no username'}) in chat type: ${ctx.chat.type}`);

    if (isPrivateChat(ctx)) {
        await addUser(ctx.from);

        try {
            console.log('[/start] Attempting to send HTML welcome message...');

            await ctx.reply(welcome_message, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [
                        Markup.button.callback('Forward a Message', 'forward')
                    ],
                    [
                        Markup.button.callback('Add Bot to a New Group', 'add'),
                        Markup.button.callback('Already Joined Groups', 'listgroups')
                    ],
                    [
                        Markup.button.callback('Add Groups Which Bot Already Joined', 'add-existing-group'),
                        Markup.button.callback('Contact', 'contact')
                    ]
                ]),
            });

            console.log('[/start] Welcome message sent successfully.');
        } catch (error) {
            console.error('[/start] FAILED to send welcome message:', error.message);
            console.error('[/start] Full error:', JSON.stringify(error, null, 2));
        }

        return;
    }

    if (!isGroupChat(ctx)) {
        return;
    }

    return deleteGroupStartMessage(ctx);
});
// ---------------------------------------------------------
// ADD AN ALREADY-JOINED GROUP
// ---------------------------------------------------------

bot.action('add-existing-group', async(ctx) => {
    await ctx.answerCbQuery();

    if (!isPrivateChat(ctx)) {
        return;
    }

    return ctx.reply( //2 Buttons for the user to choose the way of identifcation of the group
        'How would you like to find the group?',
        Markup.inlineKeyboard([
            [Markup.button.callback('Public Group Link', 'existing-group:link')],
            [Markup.button.callback('Group ID', 'existing-group:id')]
        ])
    );
});

bot.action('existing-group:id', async(ctx) => { //action for id button
    await ctx.answerCbQuery();
    groupRegistrationModes.set(ctx.from.id, 'id');

    return ctx.reply('Send the group ID (for example: -1001234567890).');
});

bot.action('existing-group:link', async(ctx) => { //action for link button
    await ctx.answerCbQuery();
    groupRegistrationModes.set(ctx.from.id, 'link');

    return ctx.reply('Send the public group link (for example: https://t.me/group_name).');
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
    const addToGroupUrl = `https://t.me/${botInfo.username}?startgroup`; //URL to add the bot to a new group

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
    const groups = await getGroups();
    const targetGroup = groups.filter(group => group.id == chat.id)

    if (
        chat.type !== 'group' &&
        chat.type !== 'supergroup'
    ) {
        return;
    }

    const newStatus = update.new_chat_member.status;

    //Action when added to a group
    if (
        newStatus === 'member' ||
        newStatus === 'administrator'
    ) {
        if (targetGroup.length > 0) { //If the group already exists in the database, don't add it again
            console.log("The bot has already joined this group before, no need to add it again.");
            await addGroup(chat, ctx.from); //Update database for new adder
        } else {
            console.log(
                `Bot joined group: ${chat.title} (${chat.id})`
            );
            await addGroup(chat, ctx.from); //Add the group to the database if it doesn't exist yet

            return;
        }
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

    const registrationMode = groupRegistrationModes.get(ctx.from.id);

    if (registrationMode) {
        if (!messageText) {
            return ctx.reply('Please send a group ID or public group link as text.');
        }

        let groupId;

        if (registrationMode === 'id') {
            if (!/^-?\d+$/.test(messageText.trim())) { //check for valid id
                return ctx.reply('That is not a valid group ID. Try again.');
            }

            groupId = Number(messageText.trim());
        } else {
            const linkMatch = messageText.trim().match(
                /^(?:https?:\/\/)?t\.me\/([A-Za-z0-9_]+)\/?$/i //check for valid link
            );

            if (!linkMatch) {
                return ctx.reply('Send a public link such as https://t.me/group_name.');
            }

            try {
                const chat = await ctx.telegram.getChat(`@${linkMatch[1]}`);
                groupId = chat.id;
            } catch (error) {
                return ctx.reply('I could not find that public group link. Try again.');
            }
        }

        const groups = await getGroups();
        const matchingGroups = groups.filter(group => group.id === groupId);
        const existingGroup = matchingGroups[0];

        if (!existingGroup) {
            return ctx.reply('That group is not already in my database, so I cannot add it to your list.');
        }

        const isAlreadyInUsersList = matchingGroups.some(
            group => group.adder === ctx.from.username
        );

        if (isAlreadyInUsersList) {
            groupRegistrationModes.delete(ctx.from.id);
            return ctx.reply('That group is already in your group list.');
        }

        await addGroup(existingGroup, ctx.from);
        groupRegistrationModes.delete(ctx.from.id);

        return ctx.reply(`"${existingGroup.title}" was added to your group list.`);
    }

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
        (await buildTargetKeyboard(session, ctx.from)).reply_markup
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

    //checking session's validity
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

async function handleCancel(ctx) {
    if (!isPrivateChat(ctx)) {
        return;
    }

    clearSession(ctx.from.id);
    groupRegistrationModes.delete(ctx.from.id);

    return ctx.reply('Cancelled.');
}

bot.action('Cancel', async(ctx) => {
    await ctx.answerCbQuery();
    return handleCancel(ctx);
});

bot.command('cancel', handleCancel);

// ---------------------------------------------------------
// ERROR HANDLING
// ---------------------------------------------------------

bot.catch((error, ctx) => {
    console.error(
        `Unhandled error for update ${ctx.update.update_id}:`,
        error
    );
});

// ---------------------------------------------------------
//Contact
// ---------------------------------------------------------
bot.action('contact', async(ctx) => {
    await ctx.answerCbQuery();

    if (!isPrivateChat(ctx)) {
        return;
    }

    return ctx.reply(
        'Contact us via email:\n' +
        'Behradmoosavi1385@gmail.com\n' +
        'kiarash.madani85@gmail.com'
    );
});

module.exports = bot;