# Start here

NOVA is a personal assistant that runs **on your computer**. The GitHub website shows only the original "Classic tools"; the assistant features need NOVA running.

## Run the demo (fictional data, 2 minutes)

1. Install **Node.js LTS** (22.13 or newer) from https://nodejs.org, then reopen your terminal.
2. Download this project (green **Code** button, then **Download ZIP**) and unzip it. Or `git clone https://github.com/va130587/jarvis-website.git`.
3. Open a terminal in the folder (Windows: click the folder's address bar, type `cmd`, press Enter).
4. Run `npm run demo`.
5. Open **http://127.0.0.1:8788** and sign in with **demo@nova.local**.

Stop it with **Ctrl+C**. `npm run demo:reset` starts the demo over. A guided 8-minute tour: `NOVA_DEMO_GUIDE.md`.

## Run it for real (your own data)

Run `npm start`. The first time, the terminal prints a setup address and a one-time code; open it, enter the code and your e-mail, and follow the page. After that NOVA runs at **http://127.0.0.1:8787** and `npm start` goes straight in. Always-on, Docker and online options: `DEPLOYMENT.md`.

## What each page does

| Page | In one line |
|---|---|
| Dashboard | Greeting, what matters today, approvals waiting, promises at a glance |
| Daily Briefing | Overdue, due today, follow-ups, important e-mail, and "the one thing" |
| NOVA Chat | Ask in plain words; NOVA shows a preview and waits for your approval |
| Voice Assistant | Push-to-talk with an editable transcript |
| Smart Email | Gmail (read-only) or a demo inbox, sorted by priority with reasons; never sends |
| Tasks and Calendar | Your NOVA tasks with Done and Delete (preview first), plus the Classic tools |
| Focus and Planner | Fits your tasks into your working hours; focus timer |
| Life Tracker | Timed reminders, habits with streaks, spending in AED |
| ProofLoop | Promises with evidence, from "request" to "verified"; proof receipts |
| Weekly Insights | Reliability score, tasks done, focus time, charts |
| Automation Centre | Jobs that run by themselves at Dubai times; run history |
| Personal Identity | Your name and personalisation switch |
| Memory Vault | Memories you approved |
| Knowledge Base | Your notes and files; answers with the exact passage |
| AI Usage and Cost | What was answered by built-in rules or a model (free by default) |
| Connected Apps | What is connected and what is missing |
| Security and Settings | Sessions, audit log, export, delete, light/dark theme |

Press **Ctrl+K** (Cmd+K on a Mac) anywhere to search everything.

## If something does not start

- `'npm' is not recognized`: install Node.js, then close and reopen the terminal.
- `node --version` is below 22: install the newer LTS.
- "Address already in use": close the other NOVA window first.
