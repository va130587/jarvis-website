# NOVA

**NOVA: From Request to Verified Result.** A personal AI assistant by Roshan. This repository holds two things that work together:

1. **NOVA server mode (new, Phase 1):** sign-in, a private database, a Memory Vault, a chat that explains what it did, an activity history, usage tracking and security controls. Free to run on your own computer.
2. **The Classic tools (original):** tasks, notes, calendar connections, a UAE job assistant and a voice system. They keep working exactly as before, with data stored in your browser.

See `NOVA_AUDIT.md` (what was found), `NOVA_IMPLEMENTATION_PLAN.md` (the phases), `NOVA_FEATURE_STATUS.md` (what works, honestly), `ARCHITECTURE.md` and `NOVA_TEST_REPORT.md`.

## Run NOVA on your computer (free, nothing to install)

You need **Node.js 22.13 or newer**. There are no packages to install to run it.

```
OWNER_EMAILS=you@gmail.com AUTH_MODE=dev node server/index.js
```

Open http://127.0.0.1:8787, type the same e-mail, and you are in. `AUTH_MODE=dev` is the local development sign-in: it only works on this computer (the server refuses to start in dev mode on any other address). Your data is stored in `.nova/nova.db` (ignored by git).

**Real Google sign-in (free):** in Google Cloud Console create an OAuth client of type *Web application* with the redirect address `http://127.0.0.1:8787/auth/google/callback`, then start the server with `AUTH_MODE=google GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... OWNER_EMAILS=you@gmail.com`. See `.env.example` for every setting. Never put these values in a file that is committed.

**Understand normal sentences with a free local model (Ollama).** Install Ollama from https://ollama.com, then:

```
ollama pull qwen2.5:7b          # once (use qwen2.5:3b on an 8 GB laptop, qwen2.5:14b on a strong one)
NOVA_AI_PROVIDER=ollama OWNER_EMAILS=you@gmail.com AUTH_MODE=dev node server/index.js
```
NOVA tries its fixed rules first, then the local model with the approved tools. The model only proposes: tool calls are validated, changes ask your approval, and when it is unsure it asks you a short question instead of guessing. Every reply carries a badge (*built-in rule*, *local model* or *cloud*). Connected Apps shows whether Ollama is running and what is missing. To measure how well *your* model understands, run `node scripts/eval-nlu.js --provider ollama --min 0.8` (65 phrasings; add `--verbose` to see the misses). With keyword rules alone the same test scores 23%, which is the gap the model closes.

**Cloud AI is optional and paid.** By default NOVA uses free built-in rules (who am I, remember, list memories, time, help) and tells you honestly when a question needs an AI model. To connect Claude later, set `NOVA_AI_PROVIDER=claude`, `ANTHROPIC_API_KEY` and a spending cap `NOVA_MONTHLY_LIMIT_USD`, and run `npm install @anthropic-ai/sdk`. The Claude Code subscription you use to build NOVA and the Claude API key a running NOVA uses are billed separately.

**What works today:** sign-in and sessions, an agent that can create tasks and notes, complete or delete tasks and forget memories **only after you approve each change** (you see a preview first, NOVA re-reads the result to verify it, and most changes have Undo), the Memory Vault (you approve every memory; secrets are refused; sensitive details need confirmation), chat with plain-English "what NOVA did" steps, the NOVA orb, activity and usage pages, data export and deletion, voice requests that reach NOVA. In server mode, voice or typed phrases like "add a task to call HR by Friday" go to NOVA (server tasks, with approval) instead of the browser-only NOVA task list. **Upcoming and clearly labelled in the app:** Smart Email, ProofLoop, Automation Centre, Knowledge Base.

**Static mode:** if you open the same pages from GitHub Pages (no server), NOVA's server features are simply absent and the Classic tools work as before.

---

# Classic tools (original README)

NOVA is Roshan's free personal assistant website. It looks like a futuristic command center, and you can talk to it like Siri.

- **Live app:** https://va130587.github.io/jarvis-website/
- **Blueprint:** https://va130587.github.io/jarvis-website/blueprint/

It is completely free. There is **no account, no API key, no paid service and no server**. Everything runs in your web browser.

## What NOVA does

- Keeps your **tasks and reminders**, and says them out loud at the right time.
- Shows your **calendar** (week and month), and connects to **Google Calendar**, **Outlook / Microsoft 365** or any **.ics** calendar file.
- Keeps quick, searchable **notes**.
- Tracks your **goal, skills, wins and certificates**.
- Finds **internships, fresher and graduate jobs in the UAE**, and tracks your **applications**.
- **Automatic job assistant:** collects real jobs every 6 hours, works out which ones could hire you, explains why, and tells you what to learn to get more. See [The automatic job assistant](#the-automatic-job-assistant).
- Gives you a **weekly review** and one suggested next step.
- Understands **voice commands** and answers in a calm British voice.

All dates and times use **Dubai time (Asia/Dubai)**. The UAE weekend is **Saturday and Sunday**, so "end of the week" means Friday.

The first time you open NOVA, it shows **sample data** with a gold "Sample" label. Click **Clear sample data** (top banner or Settings) to remove it.

## How to use each screen

| Screen | How to use it |
| --- | --- |
| **Today** | Your greeting, counts of overdue tasks, tasks due today and tasks due this week, upcoming deadlines and reminders, new jobs found, your weekly application goal, and one suggested next step. Tap the glowing core to talk. |
| **Tasks** | Add tasks with a title, person, date, time, priority and status. In **Quick capture**, type plain English such as *"Submit report to Dr. Ahmed by Sunday"* or *"Call HR tomorrow at 10am"*. Search, filter, edit, complete or delete. Deleting can be undone. |
| **Calendar** | Week and month views of your tasks, interviews, application deadlines and events from Google, Outlook or .ics files (each calendar in its own colour). Saturday and Sunday are shaded as the weekend. Click an event for details; **+ Add** adds a task on a day. See [Calendar connections](#calendar-connections). |
| **Notes** | Write a note, search your notes, and edit or delete them. |
| **Jobs for you** | The job assistant's dashboard: **Best matches**, **Stretch**, **New today**, **Closing soon** and **Not eligible**, with filters, a **Why this job?** panel on every card, and a list of skills that would unlock more jobs. |
| **Job finder** | One-click searches on the big job sites, plus a live feed of jobs from company job boards. See [How the job finder works](#how-the-job-finder-works). |
| **Applications** | Your tracker: Saved → Applied → Interview → Offer or Rejected. Open a card for details, dates, notes, the checklist and copy-ready cover letter and follow-up email templates. Deadlines and interviews become reminders automatically. Set a weekly application goal at the top. |
| **Growth** | Your goal, the skills you are learning (drag the slider to update progress), and a log of wins and certificates. |
| **Weekly review** | What you finished, what slipped, skills progress, applications this week, and one next step. Click **Read it to me** to hear it. |
| **Profile** | Your name, degree, field, university, skills, languages, preferred UAE cities, desired job titles and job types. NOVA uses this for job matches and cover letters. Also add important people, so NOVA recognises their names. |
| **Settings** | Your name, voice on or off, choice of voice, speaking speed, wake mode, interface sounds, browser notifications, weekly goal, backups, clear sample data, and delete all data (asks you to confirm). |
| **Voice commands** | Every command, with a **Try** button, plus help if your microphone does not work. |
| **Blueprint** | The presentation in the `blueprint/` folder. |

## Talking to NOVA

Start talking in any of these ways:

- Tap the glowing core on the Today screen.
- Press **J** on your keyboard.
- Turn on **wake mode** (Settings) and say **"Hey NOVA"**. NOVA also accepts "Jervis" and "Javis".

Your words appear on screen while you speak. NOVA replies out loud and in the chat panel.

The small core at the bottom right of every screen opens the **chat panel**. You can type any command there instead of speaking.

To interrupt NOVA, say **"stop"**, tap the core, or press **Esc**.

The core shows what NOVA is doing:
- **Calm cyan:** idle.
- **Bright and fast:** listening.
- **Pulsing:** thinking.
- **Gold:** speaking.

### All voice commands

You can use your own words. These are examples.

| Say | What happens |
| --- | --- |
| "Brief me" / "Good morning" | A short summary of your day |
| "What's due today?" / "What's due this week?" / "What's overdue?" | Lists your tasks |
| "Add task submit report to Dr. Ahmed by Sunday" | Adds a task with the person and date |
| "Remind me to call HR tomorrow at 10am" | Adds a timed reminder (if you give no time, NOVA asks when) |
| "Mark submit report as done" | Completes the task |
| "Delete task call HR" | Asks you to confirm with "yes" or "no" |
| "Add note bring printed CVs" | Saves a note |
| "Read my notes" | Reads your latest notes |
| "Log a win finished the SQL course" | Adds a win (say "log a certificate …" for certificates) |
| "What's my next step?" | One suggestion |
| "Find internships" / "Find fresher jobs in Dubai" | Searches the live job feed and opens the job finder |
| "Show new jobs" | Jobs found since you last looked |
| "Save this job" / "Next" / "Save the second job" | Saves the job NOVA mentioned, or moves to the next one |
| "What jobs can hire me?" / "Find jobs I can get" / "Show my best matches" | Your best matches, top three read out |
| "Why did you match this job?" / "What am I missing for this job?" | The reasons for and against the job NOVA just mentioned |
| "Show new jobs since yesterday" / "Read the top three" | New matches, and the top three read out |
| "Which job should I apply to first?" | Best score, plus nearest deadline |
| "What should I learn to get more jobs?" | Skills that would unlock the most jobs, with a free link |
| "Set an alert for data analyst jobs in Dubai above 70 percent" | Asks you to confirm, then saves a rule |
| "Turn job alerts on" / "Turn job alerts off" | Switches spoken job alerts |
| "Run the job search now" / "When did you last check?" | Reloads the job list / says when jobs were last collected |
| "Prepare an application for this job" | Asks you to confirm, then saves it with a checklist, cover letter, CV keywords, interview questions and reminders |
| "Read my job digest" / "Weekly job report" | The daily digest, or the weekly report |
| "Set up my job profile" | Asks short questions by voice (say "skip" to pass one, "cancel" to stop) |
| "How many applications do I have?" | Counts by stage and your weekly goal |
| "What deadlines are coming up?" | Application deadlines and interviews |
| "What's on my calendar today / tomorrow / this week?" | Events, interviews and tasks for that day or week |
| "What's my next meeting?" | Your next event (also "next interview") |
| "Am I free at 3 pm tomorrow?" | Checks your calendar and timed tasks |
| "When am I free on Monday?" | Free time inside your working hours |
| "Add interview with Careem on Sunday at 11am" | Asks you to confirm, then adds it (and sends it to Google or Outlook if two-way is on) |
| "Move my 3 pm meeting to 4 pm" | Asks you to confirm, then moves it |
| "Cancel the call with HR" | Asks yes or no, then cancels it |
| "Sync my calendar" | Refreshes Google Calendar and Outlook |
| "How was my week?" | Your weekly review |
| "Open calendar" (or any screen) / "Go back" | Moves between screens |
| "Voice off" / "Voice on" | Text-only replies, or spoken replies again |
| "Turn on wake mode" / "Turn off wake mode" | Listen for "Hey NOVA" |
| "Speak slower" / "Speak faster" | Changes the speaking speed |
| "What time is it?" / "What's the date?" | Dubai time and date |
| "Repeat that" | Says the last reply again |
| "What can you do?" | A short list of commands |
| "Stop" / "Cancel" | Stops speaking, or cancels a question |

If NOVA is not sure, it asks a short question. If it does not understand, it suggests three example commands.

**Best browsers:** Chrome or Edge on a computer, and Chrome or Safari on a phone. **Firefox cannot listen**, so type your commands in the chat panel instead.

**If the microphone does not work:**
- **Blocked:** click the lock icon next to the web address, set Microphone to **Allow**, then reload the page.
- **No microphone found:** connect one, or type instead.
- **No internet:** in Chrome and Edge, speech-to-text needs the internet. Typing always works.

### Reminders

Give a task a time and NOVA reminds you at that time while the site is open in a browser tab. It speaks the reminder and shows a message. Turn on **Browser notifications** in Settings to also get a system notification. The browser asks your permission first.

## Calendar connections

NOVA can show your real calendar next to your tasks. Everything is free. There are three ways to connect, all in **Settings → Calendar connections**.

### Option 1: Google Calendar

You need a free **Client ID** from Google. It takes about 10 minutes, once. The same steps are in the app (open "Setup guide" on the Google card).

1. Open [Google Cloud Console](https://console.cloud.google.com/projectcreate), sign in with your Gmail and **create a project** (for example "NOVA"). No card is needed.
2. Go to **APIs & Services → Library → Google Calendar API** and click **Enable**.
3. Go to **APIs & Services → OAuth consent screen** (also called "Google Auth Platform"). Choose **External**, enter the app name (NOVA) and your email. Leave it in **Testing** mode and add your own Gmail under **Test users**.
4. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID** and choose **Web application**.
5. Under **Authorised JavaScript origins**, add exactly:
   - `https://va130587.github.io`
   - `http://localhost:8000`
6. Click **Create** and copy the **Client ID** (it ends with `.apps.googleusercontent.com`).
7. In NOVA, paste it into **Settings → Calendar connections → Google Calendar**, click **Save**, then **Connect Google Calendar**.
8. Google says the app is "not verified". That is normal for your own test app: click **Continue**.

**Access:**
- **Read only** (the default): NOVA can see your calendars and events, and cannot change anything.
- **Two-way**: NOVA can also add, change and delete events, but only after you confirm. It asks Google for the extra permission when you switch.

Google sign-ins last about one hour. When one expires, NOVA shows a small **Reconnect** button at the top. Click it: the sign-in window opens and closes by itself. Your data is never lost.

### Option 2: Outlook / Microsoft 365

1. Open [Microsoft Entra → App registrations](https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) and click **New registration**. A free account is enough.
2. Name: NOVA. Supported accounts: **any organizational directory and personal Microsoft accounts**.
3. Redirect URI: choose **Single-page application (SPA)** and add:
   - `https://va130587.github.io/jarvis-website/redirect.html`
   - `http://localhost:8000/redirect.html`
4. Click **Register** and copy the **Application (client) ID** from the Overview page.
5. In NOVA, paste it into **Settings → Calendar connections → Outlook**, click **Save**, then **Connect Outlook**.

NOVA asks for **Calendars.Read** (read only) or **Calendars.ReadWrite** (two-way), plus **User.Read** for your name. Microsoft sign-ins renew silently while possible.

### Option 3: no setup at all (.ics files)

- **Import .ics:** add a calendar file exported from Google, Outlook, Apple Calendar or a university timetable. Repeating events, cancelled classes, moved classes, all-day and multi-day events and other time zones are all handled. Imported events are read-only.
- **Export .ics:** downloads all your open NOVA tasks, interviews and deadlines as one calendar file.
- **Add to calendar:** every task with a date has a calendar button. It opens Google Calendar, Outlook.com or Microsoft 365 with the event filled in, or downloads a single `.ics` file for Apple Calendar.

### What NOVA does with your calendar

- **Shows it** in the Calendar screen (week and month) and on Today ("Next: Team sync at 10 am"). Choose which calendars to show and change their colours.
- **Syncs** when you open NOVA, every 15 minutes while it is open, and when you click **Sync now**. It shows "Last synced 2 min ago".
- **Sends your items** when two-way is on. You choose what to send: tasks with a date and time, interviews, and application deadlines (as all-day events). Edits and deletions in NOVA update the same event. New changes wait in a list: **Review & send** shows each change and sends only after you confirm. NOVA never changes your calendar without asking.
- **Edits or deletes events** you click on, if two-way is on and the calendar allows it. It always asks first.
- **Reminds you out loud** before events: 15 minutes by default, or change it in Settings (Off, 5, 10, 15, 30 or 60 minutes).
- **Warns about clashes**, for example: *Heads up: you already have "Team sync" at 10 am.*
- **Finds free time** in your working hours: Monday to Friday, 9 am to 6 pm by default, which you can change in Settings.
- **Disconnect** removes the synced events from this browser. For Google, it also revokes NOVA's access.

**If something goes wrong**, NOVA says what to do, for example:
- not connected yet;
- sign-in expired (click Reconnect);
- permission not given (choose Two-way and reconnect);
- offline (NOVA syncs again when you are back online);
- the Calendar API is not enabled;
- the Client ID or web address is wrong (it shows which address to add).

## The automatic job assistant

NOVA finds jobs for you **automatically**, even when your browser is closed, and explains why each one fits.

**How it works, in four steps**

1. **A free GitHub Action collects jobs every 6 hours.** It reads the public job boards of real companies (Greenhouse, Lever and Ashby), keeps jobs in the UAE (or remote jobs open to this region) that are friendly to freshers, removes duplicates, and flags or drops scams. It saves the result in `data/jobs.json`. Jobs that disappear from a company's board are removed. After 45 days a job is moved to an archive.
2. **Your browser reads `data/jobs.json`.** If the file is missing or older than 12 hours, your browser fetches the boards itself as a fallback. The **Refresh** button does this on demand. Every job shows its **source**, a **link** to the official page, and when it was **last seen**. NOVA never invents a job.
3. **NOVA matches the jobs to your profile on your device.** Your profile never leaves your browser.
4. **NOVA tells you.** Strong new matches are spoken and shown while NOVA is open. With ntfy (optional, free) they also reach your phone when NOVA is closed.

**NOVA never applies for you.** You always press **View & apply** on the company's own page.

### How matching works

Every job gets a score from **0 to 100**, made of six parts you can see in **Why this job?**:

| Part | Points | What it checks |
| --- | --- | --- |
| Job title | 30 | Does the title match the roles you want? |
| Skills | 35 | How many of the skills the listing mentions do you have? (a skill you rate "strong" counts more than "beginner") |
| Experience level | 15 | Is it an internship, graduate or entry-level job, and does the "years of experience" fit you? |
| Location | 10 | Your preferred cities, remote work, and your visa |
| Freshness | 5 | Recently posted jobs score higher |
| Languages | 5 | Languages the listing asks for |

On top of the score, NOVA gives a plain verdict:

- **You can apply:** nothing blocks you.
- **Stretch: apply anyway:** a gap such as one year too little experience, a missing degree, or a language. Many fresher jobs are still worth a try.
- **Probably not eligible:** for example "UAE nationals only", 3 or more years required, a visit visa for a job that needs residence, or a scam sign.

It also lists **reasons for** the match, **gaps against** it, and **skills to learn** with free links. The **skills gap summary** says things like *"Learning Tableau would open 2 more jobs"*.

The rules are in `match.js`, written in plain JavaScript, so you can read exactly how a score was made. **Scores are estimates, not a promise of being hired.** NOVA does not guess salaries: it shows pay only when the listing states it.

### Set up your job profile (2 minutes)

Open **Jobs for you → Job profile** (or say **"Set up my job profile"**). It asks for your degree and field, graduation date, GPA, skills with levels (beginner, working, strong), tools, languages, years of experience, internships and projects, nationality and visa status, preferred cities, job types, remote preference, salary floor in AED, notice period, target job titles and industries to avoid. You can type it or answer by voice. **All of it stays in this browser.**

### Turn the automation on (exact clicks)

You do this once, on github.com, in the `va130587/jarvis-website` repository. The repository must be **public** (GitHub Actions are free for public repositories).

1. Open the repository → **Settings** → **Actions** → **General**.
2. Under **Workflow permissions**, choose **Read and write permissions** and click **Save**.
3. Open the **Actions** tab. If GitHub asks, click **I understand my workflows, go ahead and enable them**.
4. Click **Collect jobs** in the left list → **Run workflow** → **Run workflow**. Wait about 2 minutes.
5. Open the finished run. The summary lists every source and whether it worked. The workflow also saves the results in `data/jobs.json` and a table in `data/SOURCES.md`.
6. Make sure GitHub Pages publishes your site: **Settings** → **Pages** → **Source: Deploy from a branch** → branch **main** → **Save**.
7. After this the job runs by itself every 6 hours. Open NOVA and look at **Jobs for you**.

**If you only see "No jobs loaded yet":** the Action has not run yet. Do steps 1 to 4, or press **Refresh** in NOVA to use your browser's own fetch.

**Good to know:** the first run checks every source in `data/sources.json` and records which ones work in `data/SOURCES.md`. A source that fails four times in a row is skipped, and tried again every Monday. If a run finds nothing new, it does not save a commit.

### Phone alerts with ntfy (free, optional)

[ntfy.sh](https://ntfy.sh) sends a push notification to your phone. There is no account.

1. Install the **ntfy** app on your phone (iPhone or Android).
2. In the app, tap **+** and subscribe to a **topic name that only you know**, for example `roshan-jobs-k7x2q9m4` (treat it like a password: anyone who knows it can read your alerts).
3. On github.com: repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**. Name: `NTFY_TOPIC`. Value: your topic. Click **Add secret**.
4. Optional: under the **Variables** tab, add these so the Action knows what to look for. They are only used to choose which jobs to send:
   `ALERT_TITLES` (for example `Data Analyst, Software Engineer`), `ALERT_SKILLS` (for example `Python, SQL, Excel`), `ALERT_CITIES` (for example `Dubai, Abu Dhabi`), `ALERT_MIN_SCORE` (default 70), `ALERT_VISA` (`resident`, `golden`, `visit` or `needs-sponsorship`), `ALERT_YEARS` (default 0), `ALERT_NATIONALITY`.
5. Run the **Collect jobs** workflow again. From then on, you get one message with the top five new matches (and "and N more") whenever the Action finds strong new ones. Nothing is sent when there is nothing new.

The topic lives **only** in the repository secret. It is never written to any file and never printed in the logs.

### Alerts, saved searches and reminders in NOVA

- **Saved searches (rules):** *Jobs for you → Alerts & rules*, or say *"Set an alert for data analyst jobs in Dubai above 70 percent"*. A rule that notifies you speaks and shows a message when a new matching job appears while NOVA is open.
- **Strong new matches** (your score threshold in Settings, 75% by default) are spoken once and shown. Turn them on or off by voice or in Settings. If you allowed browser notifications, you also get a system notification. The first time NOVA loads jobs, nothing counts as "new", so you do not get a flood.
- **Daily digest** on **Today** and by voice: new matches, best match, closing soon, follow-ups due.
- **Weekly report** in **Weekly review** (and by voice): jobs found, best match, what to learn, and applications.
- **Save & prepare** on any card makes an application with a checklist, a **deadline reminder** when the listing gives a closing date, a **follow-up reminder 7 days later**, a **tailored cover letter**, **CV keywords** to include, and **interview preparation questions**. It is saved, never submitted.

### Smart mode (optional, off by default)

**Settings → Smart mode** switches on a small AI that runs **on your device**. It can explain a match in plain words, polish a cover-letter draft, and guess what you meant when a voice command is unclear (it always asks "yes or no" before doing anything). It only **suggests**: it never changes your data or applies for anything.

- It works with **Chrome's built-in AI** where available, or **WebLLM** on browsers with WebGPU.
- Turning it on shows a clear message, and the **model is downloaded once** (roughly 0.5 to 2 GB) only after you click Download. A progress bar shows the download.
- Nothing you type is sent to a server. If your browser cannot run it, NOVA says so and keeps working with the normal rule-based matching.

### Staying safe from job scams

Every job shows its source and date. NOVA flags listings that mention a fee or deposit in **red**. Each **Why this job?** panel has a **Verify the company** tip: check that the company has a real website and a careers page listing the job, that emails come from its own domain, and that nobody asks for money or passport copies before a written offer. Real UAE employers never charge applicants. The dashboard also shows how many listings NOVA **scanned, kept and hid**, and why.

### Add or remove job sources

Open `data/sources.json` and add a line, for example:

```
{ "type": "greenhouse", "slug": "careem", "name": "Careem" }
```

Types are `greenhouse`, `greenhouse-eu`, `lever`, `ashby` and `remotive`. The slug is in the company's careers address (`boards.greenhouse.io/careem` → `careem`). To turn a source off, add `"enabled": false`, or delete its line. The next run checks it and records the result in `data/SOURCES.md`.

**Not used on purpose:** LinkedIn, Indeed, Glassdoor and Bayt do not allow scraping, so NOVA only opens their normal search pages for you (the one-click searches).

### What is public and what is private

- The repository is public, so **`data/jobs.json`, `data/sources.json` and the workflow are public**. They contain only public job listings and company names. No personal data is ever written there (a test checks this).
- **Your profile, applications, notes and rules stay in your browser** and are never uploaded.
- **Secrets** (the ntfy topic) live in GitHub repository secrets, not in files.

## How the job finder works

**1. One-click searches.** Choose keywords, a level (internship, fresher, graduate or entry level) and a city, then click a site. NOVA opens a ready-made search **in a new tab** on:
- LinkedIn Jobs
- Indeed UAE
- Bayt
- Naukrigulf
- GulfTalent
- Glassdoor

The search uses your profile's job titles, the level word and the city. Where a site's link supports it, NOVA also adds that site's own internship or entry-level filter (LinkedIn's experience filter, and Indeed's job-type and experience filters). NOVA never scrapes or automates these sites. It only opens their normal search pages for you.

**2. Live feed.** NOVA reads official, public company job boards that are meant to be read this way:
- Greenhouse (`boards-api.greenhouse.io`)
- Lever (`api.lever.co`)
- Ashby (`api.ashbyhq.com`)

It keeps only:
- jobs in the **UAE**, or **remote** jobs open to this region;
- jobs with **fresher-friendly titles** (intern, graduate, trainee, junior, entry level, associate, fresher, or "0–2 years").

Each job gets a **match score** from your skills, job titles, field and preferred cities. Results are saved for **6 hours**. Click **Refresh** for new ones. Sources that fail to load are listed quietly under "could not be loaded".

The starter list is Careem, Cobblestone Energy, Huspy, Datadog, Databricks, MongoDB, GitLab, Binance and Deel. Use **Manage sources** to add any company. Copy the board name from its careers page address, for example `boards.greenhouse.io/careem` → `careem`. You can also turn sources off or remove them.

**3. Job cards** show the title, company, city, type, date and match score. **View & apply** opens the official job page. **Save** adds the job to Applications. Filter by city or level, search, and sort by best match, newest or company.

**Scam safety:** real UAE employers never ask you to pay for a job, visa, training or "registration fee". NOVA flags any job that mentions fees or deposits in red.

## Privacy

- Everything you enter is saved **only in this browser, on this device**, in local storage. There is no server, and NOVA never sends your data anywhere.
- The live job feed only **downloads** public job lists from the job boards. Nothing about you is sent to them.
- **Calendar:** your browser talks directly to Google or Microsoft. There is no NOVA server in between. Synced events are stored only in this browser. Sign-in tokens are kept only in memory (and this tab's session). They are never saved to disk or included in backups. Your Client ID is not a secret.
- **Voice note:** in Chrome and Edge, the browser itself turns your speech into text using its own speech service. Your NOVA data still stays on your device. Typing avoids this.

## Backups

- **Settings → Export backup** downloads a `.json` file with all your data.
- **Settings → Import backup** restores a backup (you confirm first). Use this to move to another computer or phone.
- Clearing your browser data deletes NOVA's data, so export a backup regularly.
- **Delete all data** wipes everything after you confirm. Right after, you can still press **Undo**.

## Accessibility

- Everything works with the keyboard: **Tab** to move, **Enter** to choose, **Esc** to close or stop, **J** to talk.
- Focus is always clearly outlined, and text has strong contrast.
- If "reduce motion" is on in your device settings, NOVA turns off all animation, including the start-up sequence.
- Animations pause when the tab is hidden.

## Files

- `index.html`: the page.
- `app.css`: the design.
- `core.js`: data, Dubai dates, plain-English date and task parsing, and storage.
- `app.js`: screens, reminders and the clock.
- `match.js`: the transparent job-matching rules (also used by the collector).
- `matches.js`: the Jobs for you dashboard, Why panel, rules and alerts, digest, weekly report, application pack, profile questions and job voice commands.
- `smart.js`: optional on-device Smart mode.
- `jobs.js`: the job finder, live feed, `data/jobs.json` loader and application tracker.
- `scripts/collect-jobs.js`: the one dependency-free Node script the Action runs; `scripts/check-links.js` checks the learning links weekly.
- `data/`: `sources.json` (where to look), `jobs.json` (collected jobs), `SOURCES.md` (which sources work), `links-status.json`.
- `.github/workflows/collect-jobs.yml`: the 6-hourly Action.
- `voice.js`: the animated core, voice, wake mode, chat and commands.
- `calendar.js`: Google Calendar and Outlook connections, sync, the calendar screens, reminders, clashes and free time.
- `ics.js`: reading and writing `.ics` calendar files, and the "add to Google / Outlook" links.
- `redirect.html`: the blank page the Microsoft sign-in window returns to.
- `vendor/msal-browser-4.30.0.min.js`: Microsoft's sign-in library (MIT licence), stored here so nothing loads from other sites.
- `tests/`: the automated tests.
- `blueprint/`: the presentation (unchanged).

There is no build step. To run it on your computer, start a simple web server in this folder, for example `python3 -m http.server`, and open http://localhost:8000. It runs free on GitHub Pages.

## Tests

The tests check every calendar feature automatically:
- `.ics` reading and writing: Google, Outlook, Apple and university files; time zones, daylight saving, repeats, all-day and multi-day events.
- Google Calendar and Outlook: connect, list, create, update and delete; token expiry and reconnect; permission errors; offline; disconnect. These use stand-ins for Google and Microsoft, because a real sign-in needs a person.
- Every calendar voice command, typed.
- Every screen at 1440, 768 and 390 pixels wide: no sideways scrolling, no overlaps, no console errors.
- Live checks that Google's real sign-in library and Calendar API answer the browser.

The job assistant is tested too:
- **Matching:** 45 sample job descriptions with expected verdicts and score parts, plus years, skills, scams and learning links.
- **Collector:** fixtures for each kind of source: normalising, filtering, duplicates, removed and old jobs, failing sources, no pointless commits, the phone message (with a stand-in for ntfy), the workflow file, and a check that no secret or personal data is committed.
- **Browser:** the dashboard, tabs, filters, Why panel, saved searches, alerts, application pack, digest and profile; every new voice command typed; Smart mode with a stand-in model (detection, consent, progress, fallback, no action without confirmation).
- **Layout** at 1440, 768 and 390 pixels, **keyboard-only** use, and an **axe-core** accessibility scan (no serious or critical problems).

To run them, install Node.js, then in this folder:

```
npm install
npx playwright install chromium
npm test
```

`npm test -- calendar` runs only the calendar tests; `npm test -- jobs`, `match`, `collector` and `smart` run the job assistant tests. Screenshots of every screen are saved in `tests/screenshots/`.
