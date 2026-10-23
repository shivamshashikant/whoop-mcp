# whoop-mcp

## What this is

A small server that runs on your own computer and lets Claude read your own WHOOP data: profile, recovery, sleep, workouts and daily cycles. It also includes a `weekly_review` prompt and a profile resource.

It follows the Model Context Protocol (MCP), the standard way Claude connects to outside tools.

This is a learning experiment. It is read-only, so it can't change anything in your WHOOP account. It is not affiliated with WHOOP or Anthropic.

## Privacy warning

This project handles personal health data.

- Each person must use their **own WHOOP developer app** and their **own WHOOP account**.
- Your credentials and tokens stay on your own machine.
- **Never commit or share `.env` or `tokens.json`.** They give access to your WHOOP data. Both are already listed in `.gitignore`.

## Requirements

- Node.js 18 or higher
- A WHOOP account
- A WHOOP developer app (free, created at the WHOOP developer dashboard)
- Claude Desktop

## Setup

1. Clone this repository and open a terminal in its folder.
2. Run `npm install`.
3. Create a WHOOP developer app in the WHOOP developer dashboard. Register this redirect URI exactly: `http://localhost:3000/callback`. Note the Client ID and Client Secret.
4. Copy `.env.example` to `.env` and fill in the values:
   ```
   WHOOP_CLIENT_ID=your client id
   WHOOP_CLIENT_SECRET=your client secret
   WHOOP_REDIRECT_URI=http://localhost:3000/callback
   ```
5. Run `npm run auth`. It prints a login link. Open it in your browser, approve access, and wait for "Login successful". This creates `tokens.json`.
6. Run `npm run build`.

## Connect to Claude Desktop

Open Claude Desktop's config file (Settings > Developer > Edit Config) and add this block. Replace the path with the full path to this project's `dist/index.js` on your machine:

```json
{
  "mcpServers": {
    "whoop": {
      "command": "node",
      "args": ["/full/path/to/whoop-mcp/dist/index.js"]
    }
  }
}
```

On Windows, backslashes in the path must be doubled, for example `C:\\Users\\you\\whoop-mcp\\dist\\index.js`.

Then **fully quit Claude Desktop** (right-click its icon in the system tray and choose Quit, since closing the window isn't enough) and open it again.

## Available tools, prompts and resources

**Tools**
- `ping`: replies "pong"; use it to check the connection.
- `get_profile`: your basic WHOOP profile.
- `get_recovery`: daily recovery score, HRV and resting heart rate.
- `get_sleep`: sleep performance, duration, efficiency and time in each stage.
- `get_workouts`: sport, duration, strain and heart rate for each workout.
- `get_cycles`: daily strain and average heart rate.

The four data tools take an optional `days` value (1 to 30, default 7).

**Prompts**
- `weekly_review`: asks Claude to fetch your recent data and write a short review with one suggested change for next week. Optional `days` (default 7).

**Resources**
- `whoop://profile/summary`: your WHOOP user ID and name, fetched live. It doesn't include your email.

## Troubleshooting

- **Server doesn't show up in Claude:** fully quit Claude Desktop from the tray and reopen it. Also check that the path in the config is correct.
- **401 or "unauthorized" errors:** your login has expired or was revoked. Run `npm run auth` again.
- **`dist` folder missing or "cannot find module":** run `npm run build`.
- **Port 3000 already in use during `npm run auth`:** close whatever is using port 3000 and try again. If you'd rather use another port, change it in the redirect URI in both `.env` and the WHOOP developer dashboard.

## Notes

- WHOOP rotates refresh tokens: each one works only once. The app rewrites `tokens.json` after every refresh, so don't delete or edit that file while it's running.
- The `offline` scope, which allows refreshing, is requested in the login link that `npm run auth` generates. You don't need to set it in the WHOOP dashboard.
