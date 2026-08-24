/* Local Saving method :
    use the local file system to store targets and forwarding sessions. This is simpler to set up, but it won't work if the bot is restarted or deployed to a serverless environment.
// const fs = require('fs');
// const path = require('path');

// const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
// const DATA_FILE = path.join(DATA_DIR, 'targets.json');

// function ensureStorage() {
//     if (!fs.existsSync(DATA_DIR)) {
//         fs.mkdirSync(DATA_DIR, { recursive: true });
//     }

//     if (!fs.existsSync(DATA_FILE)) {
//         fs.writeFileSync(
//             DATA_FILE,
//             JSON.stringify({ groups: [], users: [] }, null, 2)
//         );
//     }
// }

// function loadTargets() {
//     ensureStorage();

//     return JSON.parse(
//         fs.readFileSync(DATA_FILE, 'utf8')
//     );
// }

// function saveTargets(targets) {
//     ensureStorage();

//     fs.writeFileSync(
//         DATA_FILE,
//         JSON.stringify(targets, null, 2)
//     );
// }

// function addGroup(chat) {
//     const targets = loadTargets();

//     const exists = targets.groups.some(
//         group => group.id === chat.id
//     );

//     if (!exists) {
//         targets.groups.push({
//             id: chat.id,
//             title: chat.title,
//             type: chat.type
//         });

//         saveTargets(targets);
//     }
// }

// function removeGroup(chatId) {
//     const targets = loadTargets();

//     targets.groups = targets.groups.filter(
//         group => group.id !== chatId
//     );

//     saveTargets(targets);
// }

// function getGroups() {
//     return loadTargets().groups;
// }

// function addUser(user) {
//     const targets = loadTargets();

//     const exists = targets.users.some(
//         existing => existing.id === user.id
//     );

//     if (!exists) {
//         targets.users.push({
//             id: user.id,
//             username: user.username || null,
//             firstName: user.first_name || null
//         });

//         saveTargets(targets);
//     }
// }

// function getUsers() {
//     return loadTargets().users;
// }

// module.exports = {
//     loadTargets,
//     saveTargets,
//     addGroup,
//     removeGroup,
//     getGroups,
//     addUser,
//     getUsers
// };

*/

// MongoDB method :

const { MongoClient } = require('mongodb');

let client;
let database;

async function connectDatabase() {
    if (database) {
        return database;
    }

    const uri = process.env.MONGODB_URI;
    const databaseName = process.env.MONGODB_DB || 'forwarder_bot';

    if (!uri) {
        throw new Error('MONGODB_URI is missing from the environment variables.');
    }

    client = new MongoClient(uri);
    await client.connect();
    database = client.db(databaseName);

    // One user should have only one record for a group, but different users
    // may save the same group separately.
    try {
        await database.collection('groups').dropIndex('id_1');
    } catch (error) {
        // Error code 27 means the old index does not exist yet.
        if (error.code !== 27) {
            throw error;
        }
    }

    await database.collection('groups').createIndex(
        { id: 1, adder: 1 },
        { unique: true }
    );
    await database.collection('users').createIndex({ id: 1 }, { unique: true });

    console.log(`Connected to MongoDB database: ${databaseName}`);
    return database;
}

async function closeDatabase() {
    if (client) {
        await client.close();
        client = null;
        database = null;
    }
}

function getDatabase() {
    if (!database) {
        throw new Error('MongoDB is not connected yet.');
    }

    return database;
}

async function addGroup(chat, user) {
    await getDatabase().collection('groups').updateOne({
        id: chat.id,
        adder: user.username
    }, {
        $set: {
            id: chat.id,
            title: chat.title,
            type: chat.type,
            adder: user.username
        }
    }, { upsert: true });
}

async function removeGroup(chatId) {
    await getDatabase().collection('groups').deleteOne({
        id: chatId
    });
}

async function getGroups() {
    return getDatabase()
        .collection('groups')
        .find()
        .sort({ title: 1 })
        .toArray();
}

async function addUser(user) {
    await getDatabase().collection('users').updateOne({ id: user.id }, {
        $set: {
            id: user.id,
            username: user.username || null,
            firstName: user.first_name || null
        }
    }, { upsert: true });
}

async function getUsers() {
    return getDatabase()
        .collection('users')
        .find()
        .sort({ firstName: 1 })
        .toArray();
}

module.exports = {
    connectDatabase,
    closeDatabase,
    addGroup,
    removeGroup,
    getGroups,
    addUser,
    getUsers
};
