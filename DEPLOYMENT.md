# Running NOVA for real

NOVA is one Node.js process with a built-in SQLite database. It costs nothing to run. Pick the option that fits you.

| Option | Who it is for | Sign-in | Runs the scheduler when your browser is closed? |
|---|---|---|---|
| 1. Your own computer (`npm start`) | Trying NOVA, daily use on one computer | Development sign-in (this computer only) | Yes, while the computer is on and NOVA is running |
| 2. Always-on at home (systemd or pm2) | A spare PC, mini PC or Raspberry Pi 5 | Development sign-in on that machine, or Google | Yes, all the time |
| 3. Docker | You already use Docker | Google sign-in | Yes |
| 4. A free cloud VM with HTTPS | Use NOVA from your phone anywhere | Google sign-in | Yes |

Requirements everywhere: **Node.js 22.13 or newer** (free from nodejs.org). No `npm install` is needed to run NOVA; it is only needed for the tests.

## 1. Your own computer

```bash
git clone https://github.com/va130587/jarvis-website.git nova && cd nova
npm start
```

The first time, NOVA has no settings, so it opens a **setup page** instead: open the address it prints, paste the setup code from the terminal, enter your e-mail, choose built-in rules or a free local AI model, and optionally phone notifications. NOVA writes a private `.env` file (with a new random `NOVA_SECRET_KEY`) and starts. Next time `npm start` goes straight in.

Want to show NOVA to someone without your own data? `npm run demo` (see NOVA_DEMO_GUIDE.md).

## 2. Always-on at home

The scheduler (daily briefing, deadline check, follow-up nudges, e-mail check) runs inside the NOVA process. To have it run every day, keep NOVA running on a machine that stays on.

**systemd (Linux, Raspberry Pi):** save as `/etc/systemd/system/nova.service`, then `sudo systemctl enable --now nova`.

```ini
[Unit]
Description=NOVA personal assistant
After=network-online.target

[Service]
User=YOUR_USER
WorkingDirectory=/home/YOUR_USER/nova
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
# NOVA reads .env from its folder by itself.

[Install]
WantedBy=multi-user.target
```

**pm2 (Windows, macOS, Linux):** `npm install -g pm2`, then `pm2 start server/index.js --name nova` and `pm2 save`.

To use it from other devices on your home network you need Google sign-in (development sign-in only works on the machine itself): see section 4 for the Google settings, then set `HOST=0.0.0.0` and `BASE_URL=http://<machine-ip>:8787`. Google allows `http://` only for `localhost`, so for other devices use HTTPS (section 4).

## 3. Docker

```bash
docker build -t nova .
docker run -d --name nova --restart unless-stopped -p 127.0.0.1:8787:8787 -v nova-data:/data --env-file .env.docker nova
```

`.env.docker` (keep private) needs at least `OWNER_EMAILS`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BASE_URL` and `NOVA_SECRET_KEY`. The database lives in the `nova-data` volume. Development sign-in is refused in a container on purpose (it would be reachable from outside the container).

## 4. A free cloud VM with HTTPS (use NOVA from your phone)

1. Create a free small VM (for example an "Always Free" Ubuntu VM). Install Node 22 and Caddy (free, gets HTTPS certificates automatically).
2. Point a domain or free subdomain at the VM.
3. `/etc/caddy/Caddyfile`:
   ```
   nova.example.com {
     reverse_proxy 127.0.0.1:8787
   }
   ```
4. Google sign-in (free): Google Cloud Console > APIs and Services > Credentials > Create OAuth client ID > Web application.
   Authorised redirect URIs: `https://nova.example.com/auth/google/callback` and, for Gmail, `https://nova.example.com/auth/gmail/callback`.
   For Gmail also enable the **Gmail API**. While the consent screen is in "Testing", add your own Google account as a test user.
5. `.env` on the VM:
   ```
   OWNER_EMAILS=you@gmail.com
   AUTH_MODE=google
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   BASE_URL=https://nova.example.com
   HOST=127.0.0.1
   NOVA_SECRET_KEY=<node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))">
   ```
6. Run NOVA with systemd (section 2). Only Caddy is exposed to the internet; NOVA listens on 127.0.0.1.

With `BASE_URL` on https, cookies are marked Secure automatically.

## Proof receipts and the check page

Every proof receipt ends with a fingerprint, and NOVA remembers the fingerprints it issued (never the receipt text). Anyone can check a receipt at `https://your-address/verify`; it needs no sign-in and is rate limited. Set `BASE_URL` (as above) so the QR code on the printable receipt opens that check page; without it the QR code holds just the fingerprint. The check only knows receipts issued by this NOVA, so keep the database (and its backups) for as long as you want old receipts to stay checkable.

## Automatic backups (on by default)

NOVA makes a checked backup by itself every night at 03:30 Dubai time (the **Backup** job in the Automation Centre; it needs NOVA to be running, with the scheduler on) and keeps the newest 14 (`NOVA_BACKUP_KEEP`) in `backups/` (`NOVA_BACKUP_DIR`). **Automation Centre → Backups** shows the latest one, its size and health, and **Test my latest backup** rebuilds it in a temporary place and reports your item counts without touching your live data. The dashboard warns if there is no backup for 7 days. The folder is on the same computer: copy it now and then to a USB stick or a private cloud drive. **Keep `NOVA_SECRET_KEY` safe** (a password manager is ideal): it unlocks your saved Gmail connection. A backup restores your data without it, but you would have to connect Gmail again. Never share it or put it online.

## Speed and size

NOVA compresses its text files (gzip, Node's own zlib) and answers "304 Not Modified" for unchanged files; nothing under `/api/` or `/auth/` is ever cached. Behind a proxy (nginx, Caddy), let NOVA do the compression and pass `Accept-Encoding` and `If-None-Match` through. `npm run perf` (also run by GitHub Actions) checks that the first page stays under its saved size plus 15%, that first content is under 1 second, and that no file over 200 KB is added outside `docs/` and `fonts/`.

## Backups by hand


```bash
npm run backup              # backups/nova-YYYYMMDD-HHMMSS.db + .json manifest, checked after writing
npm run backup -- --keep 14 # also keep only the newest 14
npm run restore -- backups/nova-20261020-074500.db   # stop NOVA first; your current database is kept as a safety copy
```

Backups are consistent even while NOVA runs. Schedule one daily (cron: `30 3 * * * cd ~/nova && npm run backup -- --keep 14`). Keep backups private and keep a copy of `NOVA_SECRET_KEY` with them: without it, Gmail must be reconnected after a restore (everything else works).

## Security checklist

- `OWNER_EMAILS` lists only you. Nobody else can sign in.
- `.env`, `.nova/` and `backups/` are never committed (they are in `.gitignore`) and never copied into the Docker image (`.dockerignore`).
- Development sign-in only works on 127.0.0.1/localhost; NOVA refuses to start it on any other address.
- Expose NOVA to the internet only through HTTPS (Caddy) with Google sign-in.
- Gmail access is read-only. Disconnect any time in Smart Email (NOVA also asks Google to revoke the access).
- Phone push: the ntfy topic is like a password. Use a long random one (the setup page makes one) or your own ntfy server with `NOVA_NTFY_TOKEN`.

## Updating

```bash
git pull && npm run backup && (restart NOVA)
```

The database upgrades itself (versioned migrations) when NOVA starts.
