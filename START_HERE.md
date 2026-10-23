# Start here

NOVA is a personal assistant that runs **on your computer**. The GitHub website shows only the original "Classic tools"; the assistant features need NOVA running.

## Easiest way: double-click

After installing **Node.js LTS** (https://nodejs.org) and unzipping this folder:
- **Windows:** double-click **`Start NOVA demo.bat`**. A black window opens and your browser opens NOVA by itself.
- **Mac:** double-click **`Start NOVA demo.command`** (if the Mac refuses, right-click it, choose **Open**, then **Open**).

Sign in with **demo@nova.local**. Keep the black window open while you use NOVA; close it to stop. If Node.js is missing or too old, the window says so in plain words and tells you what to do.

## Run the demo by typing (fictional data, 2 minutes)

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
| Dashboard | Greeting, what matters today, approvals waiting, and the **Promise Orbit**: dots around the orb for your open promises, deadlines and tasks (distance = how soon) |
| Daily Briefing | Overdue, due today, follow-ups, important e-mail, and "the one thing" |
| NOVA Chat | Ask in plain words; NOVA shows a preview and waits for your approval |
| Voice Assistant | Push-to-talk with an editable transcript |
| Weekly Review | Your last full week from your own data, with three suggested priorities for next week, and an optional Sunday evening reminder |
| What if I say yes? | Try a possible commitment first: see its effect on that day before you agree, nothing is changed |
| ProofLoop | Your promises tracked to a verified result, with **Can people rely on me?**: how reliable you and others have been, and a heads-up before you promise in a busy week |
| Smart Email | Gmail (read-only) or a demo inbox, sorted by priority with reasons; never sends. **Connect Gmail: step by step** guides you through the free Google setup, with a live checklist and a Test connection button |
| Tasks and Calendar | Your NOVA tasks with Done and Delete (preview first), plus the Classic tools |
| Focus and Planner | Fits your tasks into your working hours; focus timer |
| Life Tracker | Timed reminders, habits with streaks, spending in AED |
| ProofLoop | Promises with evidence, from "request" to "verified"; proof receipts |
| Weekly Insights | Reliability score, tasks done, focus time, charts, and the **Life Radar** (five measures, this week against last) |
| Day Replay | What NOVA did on any day, in order, with a time slider; below it the **Undo list** (your last 20 changes, each with a preview before it is undone) |
| Automation Centre | Jobs that run by themselves at Dubai times; run history |
| Personal Identity | Your name and personalisation switch |
| Memory Vault | Memories you approved |
| Knowledge Base | Your notes and files; answers with the exact passage |
| AI Usage and Cost | What was answered by built-in rules or a model (free by default) |
| Connected Apps | What is connected and what is missing |
| Security and Settings | Sessions, audit log, export and import, delete, light/dark theme, **High contrast** and **Larger text**, show the tour again |
| Help | How to start, what each page is for, common problems, and **Check my setup** |

Press **Ctrl+K** (Cmd+K on a Mac) anywhere to search everything.

The first time you sign in, a short **tour** (six steps) shows you around; **Esc** skips it. In the demo, a **Guided demo** box on the Dashboard lists five things to try and ticks each one when you have done it. If anything seems wrong, open **Help** and press **Check my setup**.

Also worth trying: every **approval preview** now has an **Effects** line (what else it touches, such as other items due that day), and a ProofLoop **proof receipt** ends with a fingerprint you can check at **/verify** (the printable version has a QR code).

## If something does not start

- `'npm' is not recognized`: install Node.js, then close and reopen the terminal.
- `node --version` is below 22: install the newer LTS.
- "Address already in use": close the other NOVA window first.
