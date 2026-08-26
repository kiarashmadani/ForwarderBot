# Forwarder Bot — Project Notes

Last updated: 2026-08-26

## Purpose

Forwarder Bot is a Telegram bot for sending one user-selected Telegram message to one or more chosen group destinations. Its intended value is a simple forwarding workflow for users who manage their own custom audiences: one message, multiple groups.

The project is a private Node.js application. It requires Node.js 20 or newer.

## Current Architecture

The application has four main responsibilities:

1. A Telegram bot receives updates and presents the user interface.
2. A MongoDB database stores registered users and groups.
3. A forwarding component sends a selected source message to the selected target groups and reports successful and failed destinations.
4. A small HTTP server listens on the platform-provided port so it can be deployed as a web service.

The current bot uses **long polling**. It starts a persistent process that requests Telegram updates, rather than accepting Telegram webhook requests.

## Current User Experience

In a private chat, a user can:

- Start the bot and enter the main menu.
- Add the bot to a new group through Telegram’s add-to-group flow.
- View the groups registered under that user.
- Register a group that the bot has already joined, using either its public Telegram link or numeric group ID.
- Start a forwarding session, send the message to forward, select one or more of their registered groups, and send it.
- Cancel an active forwarding session.
- View the project’s contact information.

The group-selection screen only shows groups whose stored `adder` value matches the current user’s Telegram username. This is the ownership/visibility rule used by the current implementation.

## Telegram and Group Behavior

- Private chats are used for the bot’s menu and forwarding workflow.
- Group and supergroup chats are used as forwarding destinations.
- When the bot is added to a group or promoted there, it records that group in the database.
- When it leaves or is removed from a group, it removes the stored group record.
- The bot attempts to delete its group start message. It needs Telegram’s **Delete Messages** administrator permission to do this; without it, the workflow continues but the start message may remain visible.
- Public group links are resolved through Telegram before registration. A group must already be known to the bot/database before a user can add it to their personal list through the “already joined” flow.
- The forwarding action uses Telegram’s native message-forwarding behavior. A result summary reports the number of successful and failed destinations, including the error returned for failed deliveries.

## Database

The production storage implementation uses MongoDB. The connection string and optional database name are supplied through deployment environment variables; their values must never be committed or placed in documentation.

Default database name: `forwarder_bot`.

### Collections

| Collection | Stored information | Uniqueness rule |
| --- | --- | --- |
| `groups` | Telegram group ID, title, chat type, and the username of the user who registered it | One record per group ID + registering username |
| `users` | Telegram user ID, username (when available), and first name (when available) | One record per Telegram user ID |

The application creates indexes for these rules when it connects.

### Storage Notes

- Earlier local-file storage is retained only as commented-out historical code and is not the active storage method.
- Local files are not appropriate for Render free services or serverless deployments because restarts/spin-down can discard them.
- MongoDB preserves registered users and groups across application restarts.
- Active forwarding sessions and group-registration modes are currently stored only in process memory. They are lost whenever the application restarts, is redeployed, or is spun down. A user can simply start a new forwarding flow afterwards, but an in-progress selection cannot be resumed.

## Current Deployment and Runtime Model

The app starts an HTTP server bound to `0.0.0.0` and uses the hosting platform’s `PORT` value, falling back to port 10000 locally. It returns a simple plain-text response for incoming HTTP requests.

The bot connects to MongoDB before starting. If database connection or bot startup fails, the process exits rather than running in a partially initialized state. On normal shutdown signals, it stops the bot, closes the MongoDB connection, and closes the HTTP server.

Expected deployment configuration includes:

- A Telegram bot token supplied as an environment secret.
- A MongoDB connection URI supplied as an environment secret.
- Optionally, a database-name environment setting.
- A platform-provided port setting.

Secret files are excluded from version control, including local environment files and the Atlas credentials file.

## Long Polling vs. Webhook

### Current: long polling

Long polling needs a continuously running process. It is natural for a conventional always-on server, but is a poor fit for hosts that stop idle services or terminate request handlers.

On a Render free web service, the process may be spun down after 15 minutes without inbound HTTP or WebSocket traffic. The long-polling request made by the bot to Telegram is outbound traffic, so it does not itself satisfy Render’s inbound-traffic requirement. Once asleep, it cannot receive new Telegram updates until it starts again.

### Alternative: Telegram webhook

With a webhook, Telegram sends an HTTPS request to the application whenever there is a bot update. Webhook and long polling are mutually exclusive Telegram update-delivery methods.

Webhook is a better architecture for this project on a request-driven/serverless host because the bot processes an incoming update, performs the forwarding work, returns a successful HTTP response, and does not need an endlessly running polling loop.

Webhook delivery must be designed to:

- Respond quickly with a successful HTTP status.
- Validate that incoming requests are genuinely from Telegram, preferably using Telegram’s webhook secret-token header.
- Be safe if Telegram retries a delivery after a failed/non-successful response. Updates should be deduplicated if duplicate forwarding would be harmful.
- Store any state needed after a request finishes in MongoDB or another persistent store, not only in memory.

## Render Free Plan Findings

As of the documentation checked on 2026-08-25, Render spins down a Free web service after 15 minutes with no inbound HTTP traffic or WebSocket messages. The next HTTP request or new WebSocket connection starts it again, with an advertised startup time of about one minute. Free services can also restart at any time.

Implications:

- Switching to a webhook **while staying on Render free** does not guarantee that the service never sleeps.
- A webhook can make the behavior feel more reliable: a new Telegram update reaches Render, wakes the service, and Telegram retries unsuccessful webhook deliveries. The first update after inactivity can nevertheless be delayed by the cold start.
- The inspected friend’s webhook bot follows exactly this pattern. Its code does not contain a self-ping, cron scheduler, or other mechanism that prevents Render sleep.
- An external scheduler can request a lightweight endpoint every 10–14 minutes to prevent idle spin-down. The scheduler must run outside Render; an in-app cron stops when the service sleeps.
- Continuous pings keep the instance running and consume its free hours. Render currently grants 750 free instance-hours per workspace per calendar month; one service running continuously for a 31-day month uses about 744 hours. It also remains a free service that can restart, so this is not a production reliability guarantee.
- There is no official no-cost setting on Render free that disables idle spin-down. A paid service removes the Free-instance limitations.

## Vercel Findings

Vercel Functions are request-driven rather than a permanently running server process. They may experience a cold start, but they do not use Render’s 15-minute free-web-service idle spin-down model.

For this bot:

- **Long polling on Vercel is not suitable.** A function invocation has a maximum duration and cannot be used as a permanent polling process.
- **Webhook on Vercel is suitable** when each Telegram update is handled and completed quickly.
- No keep-awake ping is required for a webhook function.
- A Vercel Hobby deployment has usage and execution limits. The function must not depend on in-memory state persisting between invocations.

At the time checked, Vercel documentation listed a maximum Hobby-plan function duration of up to five minutes with Fluid Compute enabled; this forwarding workflow should normally complete in seconds.

## Recommended Direction

For a free, responsive deployment of this project, migrate from long polling to **Telegram webhook + Vercel Functions**. This is a real architectural change and avoids the need to keep a polling process awake.

If remaining on Render free:

- Webhook is still preferable to long polling for update delivery.
- Accept that the first update after inactivity may be delayed by the service start.
- Use an external scheduled health request only if avoiding that delay is worth consuming almost all free instance-hours.

If the bot needs guaranteed low latency, continuous background work, or production-grade uptime, choose a paid always-on runtime rather than relying on any free-tier workaround.

## Important Follow-up Improvements

- Move ephemeral session state into persistent storage if users must survive restarts while selecting destinations.
- Add webhook request authentication using Telegram’s secret-token feature when implementing webhooks.
- Add idempotency/deduplication for Telegram update IDs before performing forwarding actions.
- Confirm bot permissions in every destination group, especially permission to post/forward messages and optionally delete its start message.
- Handle users without a Telegram username carefully. The current group-ownership model is username-based, which can be absent or changed; stable Telegram user IDs are more reliable for ownership.
- Review removal behavior: removing one group record by group ID currently removes one matching record even though the data model allows the same group to be registered by multiple users.
- Keep all tokens, database URIs, credential files, and deployment secrets outside the repository and documentation.

## External References

- Render free-service behavior: https://render.com/docs/free
- Telegram Bot API webhook documentation: https://core.telegram.org/bots/api#setwebhook
- Vercel function limits: https://vercel.com/docs/functions/limitations
- Friend’s webhook example reviewed: https://github.com/kiarashmadani/FCPMentoringBot/blob/main/bot.js
