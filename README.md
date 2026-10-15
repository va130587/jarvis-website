# Jarvis

Jarvis is Roshan's free personal assistant website. It looks like a futuristic command center, and you can talk to it like Siri.

- **Live app:** https://va130587.github.io/jarvis-website/
- **Blueprint:** https://va130587.github.io/jarvis-website/blueprint/

It is completely free. There is **no account, no API key, no paid service and no server**. Everything runs in your web browser.

## What Jarvis does

- Keeps your **tasks and reminders**, and says them out loud at the right time.
- Shows your **calendar** (week and month), and connects to **Google Calendar**, **Outlook / Microsoft 365** or any **.ics** calendar file.
- Keeps quick, searchable **notes**.
- Tracks your **goal, skills, wins and certificates**.
- Finds **internships, fresher and graduate jobs in the UAE**, and tracks your **applications**.
- Gives you a **weekly review** and one suggested next step.
- Understands **voice commands** and answers in a calm British voice.

All dates and times use **Dubai time (Asia/Dubai)**. The UAE weekend is **Saturday and Sunday**, so "end of the week" means Friday.

The first time you open Jarvis, it shows **sample data** with a gold "Sample" label. Click **Clear sample data** (top banner or Settings) to remove it.

## How to use each screen

| Screen | How to use it |
| --- | --- |
| **Today** | Your greeting, counts of overdue tasks, tasks due today and tasks due this week, upcoming deadlines and reminders, new jobs found, your weekly application goal, and one suggested next step. Tap the glowing core to talk. |
| **Tasks** | Add tasks with a title, person, date, time, priority and status. In **Quick capture**, type plain English such as *"Submit report to Dr. Ahmed by Sunday"* or *"Call HR tomorrow at 10am"*. Search, filter, edit, complete or delete. Deleting can be undone. |
| **Calendar** | Week and month views of your tasks, interviews, application deadlines and events from Google, Outlook or .ics files (each calendar in its own colour). Saturday and Sunday are shaded as the weekend. Click an event for details; **+ Add** adds a task on a day. See [Calendar connections](#calendar-connections). |
| **Notes** | Write a note, search your notes, and edit or delete them. |
| **Job finder** | One-click searches on the big job sites, plus a live feed of jobs from company job boards. See [How the job finder works](#how-the-job-finder-works). |
| **Applications** | Your tracker: Saved → Applied → Interview → Offer or Rejected. Open a card for details, dates, notes, the checklist and copy-ready cover letter and follow-up email templates. Deadlines and interviews become reminders automatically. Set a weekly application goal at the top. |
| **Growth** | Your goal, the skills you are learning (drag the slider to update progress), and a log of wins and certificates. |
| **Weekly review** | What you finished, what slipped, skills progress, applications this week, and one next step. Click **Read it to me** to hear it. |
| **Profile** | Your name, degree, field, university, skills, languages, preferred UAE cities, desired job titles and job types. Jarvis uses this for job matches and cover letters. Also add important people, so Jarvis recognises their names. |
| **Settings** | Your name, voice on or off, choice of voice, speaking speed, wake mode, interface sounds, browser notifications, weekly goal, backups, clear sample data, and delete all data (asks you to confirm). |
| **Voice commands** | Every command, with a **Try** button, plus help if your microphone does not work. |
| **Blueprint** | The presentation in the `blueprint/` folder. |

## Talking to Jarvis

Start talking in any of these ways:

- Tap the glowing core on the Today screen.
- Press **J** on your keyboard.
- Turn on **wake mode** (Settings) and say **"Hey Jarvis"**. Jarvis also accepts "Jervis" and "Javis".

Your words appear on screen while you speak. Jarvis replies out loud and in the chat panel.

The small core at the bottom right of every screen opens the **chat panel**. You can type any command there instead of speaking.

To interrupt Jarvis, say **"stop"**, tap the core, or press **Esc**.

The core shows what Jarvis is doing:
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
| "Remind me to call HR tomorrow at 10am" | Adds a timed reminder (if you give no time, Jarvis asks when) |
| "Mark submit report as done" | Completes the task |
| "Delete task call HR" | Asks you to confirm with "yes" or "no" |
| "Add note bring printed CVs" | Saves a note |
| "Read my notes" | Reads your latest notes |
| "Log a win finished the SQL course" | Adds a win (say "log a certificate …" for certificates) |
| "What's my next step?" | One suggestion |
| "Find internships" / "Find fresher jobs in Dubai" | Searches the live job feed and opens the job finder |
| "Show new jobs" | Jobs found since you last looked |
| "Save this job" / "Next" / "Save the second job" | Saves the job Jarvis mentioned, or moves to the next one |
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
| "Turn on wake mode" / "Turn off wake mode" | Listen for "Hey Jarvis" |
| "Speak slower" / "Speak faster" | Changes the speaking speed |
| "What time is it?" / "What's the date?" | Dubai time and date |
| "Repeat that" | Says the last reply again |
| "What can you do?" | A short list of commands |
| "Stop" / "Cancel" | Stops speaking, or cancels a question |

If Jarvis is not sure, it asks a short question. If it does not understand, it suggests three example commands.

**Best browsers:** Chrome or Edge on a computer, and Chrome or Safari on a phone. **Firefox cannot listen**, so type your commands in the chat panel instead.

**If the microphone does not work:**
- **Blocked:** click the lock icon next to the web address, set Microphone to **Allow**, then reload the page.
- **No microphone found:** connect one, or type instead.
- **No internet:** in Chrome and Edge, speech-to-text needs the internet. Typing always works.

### Reminders

Give a task a time and Jarvis reminds you at that time while the site is open in a browser tab. It speaks the reminder and shows a message. Turn on **Browser notifications** in Settings to also get a system notification. The browser asks your permission first.

## Calendar connections

Jarvis can show your real calendar next to your tasks. Everything is free. There are three ways to connect, all in **Settings → Calendar connections**.

### Option 1: Google Calendar

You need a free **Client ID** from Google. It takes about 10 minutes, once. The same steps are in the app (open "Setup guide" on the Google card).

1. Open [Google Cloud Console](https://console.cloud.google.com/projectcreate), sign in with your Gmail and **create a project** (for example "Jarvis"). No card is needed.
2. Go to **APIs & Services → Library → Google Calendar API** and click **Enable**.
3. Go to **APIs & Services → OAuth consent screen** (also called "Google Auth Platform"). Choose **External**, enter the app name (Jarvis) and your email. Leave it in **Testing** mode and add your own Gmail under **Test users**.
4. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID** and choose **Web application**.
5. Under **Authorised JavaScript origins**, add exactly:
   - `https://va130587.github.io`
   - `http://localhost:8000`
6. Click **Create** and copy the **Client ID** (it ends with `.apps.googleusercontent.com`).
7. In Jarvis, paste it into **Settings → Calendar connections → Google Calendar**, click **Save**, then **Connect Google Calendar**.
8. Google says the app is "not verified". That is normal for your own test app: click **Continue**.

**Access:**
- **Read only** (the default): Jarvis can see your calendars and events, and cannot change anything.
- **Two-way**: Jarvis can also add, change and delete events, but only after you confirm. It asks Google for the extra permission when you switch.

Google sign-ins last about one hour. When one expires, Jarvis shows a small **Reconnect** button at the top. Click it: the sign-in window opens and closes by itself. Your data is never lost.

### Option 2: Outlook / Microsoft 365

1. Open [Microsoft Entra → App registrations](https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) and click **New registration**. A free account is enough.
2. Name: Jarvis. Supported accounts: **any organizational directory and personal Microsoft accounts**.
3. Redirect URI: choose **Single-page application (SPA)** and add:
   - `https://va130587.github.io/jarvis-website/redirect.html`
   - `http://localhost:8000/redirect.html`
4. Click **Register** and copy the **Application (client) ID** from the Overview page.
5. In Jarvis, paste it into **Settings → Calendar connections → Outlook**, click **Save**, then **Connect Outlook**.

Jarvis asks for **Calendars.Read** (read only) or **Calendars.ReadWrite** (two-way), plus **User.Read** for your name. Microsoft sign-ins renew silently while possible.

### Option 3: no setup at all (.ics files)

- **Import .ics:** add a calendar file exported from Google, Outlook, Apple Calendar or a university timetable. Repeating events, cancelled classes, moved classes, all-day and multi-day events and other time zones are all handled. Imported events are read-only.
- **Export .ics:** downloads all your open Jarvis tasks, interviews and deadlines as one calendar file.
- **Add to calendar:** every task with a date has a calendar button. It opens Google Calendar, Outlook.com or Microsoft 365 with the event filled in, or downloads a single `.ics` file for Apple Calendar.

### What Jarvis does with your calendar

- **Shows it** in the Calendar screen (week and month) and on Today ("Next: Team sync at 10 am"). Choose which calendars to show and change their colours.
- **Syncs** when you open Jarvis, every 15 minutes while it is open, and when you click **Sync now**. It shows "Last synced 2 min ago".
- **Sends your items** when two-way is on. You choose what to send: tasks with a date and time, interviews, and application deadlines (as all-day events). Edits and deletions in Jarvis update the same event. New changes wait in a list: **Review & send** shows each change and sends only after you confirm. Jarvis never changes your calendar without asking.
- **Edits or deletes events** you click on, if two-way is on and the calendar allows it. It always asks first.
- **Reminds you out loud** before events: 15 minutes by default, or change it in Settings (Off, 5, 10, 15, 30 or 60 minutes).
- **Warns about clashes**, for example: *Heads up: you already have "Team sync" at 10 am.*
- **Finds free time** in your working hours: Monday to Friday, 9 am to 6 pm by default, which you can change in Settings.
- **Disconnect** removes the synced events from this browser. For Google, it also revokes Jarvis's access.

**If something goes wrong**, Jarvis says what to do, for example:
- not connected yet;
- sign-in expired (click Reconnect);
- permission not given (choose Two-way and reconnect);
- offline (Jarvis syncs again when you are back online);
- the Calendar API is not enabled;
- the Client ID or web address is wrong (it shows which address to add).

## How the job finder works

**1. One-click searches.** Choose keywords, a level (internship, fresher, graduate or entry level) and a city, then click a site. Jarvis opens a ready-made search **in a new tab** on:
- LinkedIn Jobs
- Indeed UAE
- Bayt
- Naukrigulf
- GulfTalent
- Glassdoor

The search uses your profile's job titles, the level word and the city. Where a site's link supports it, Jarvis also adds that site's own internship or entry-level filter (LinkedIn's experience filter, and Indeed's job-type and experience filters). Jarvis never scrapes or automates these sites. It only opens their normal search pages for you.

**2. Live feed.** Jarvis reads official, public company job boards that are meant to be read this way:
- Greenhouse (`boards-api.greenhouse.io`)
- Lever (`api.lever.co`)
- Ashby (`api.ashbyhq.com`)

It keeps only:
- jobs in the **UAE**, or **remote** jobs open to this region;
- jobs with **fresher-friendly titles** (intern, graduate, trainee, junior, entry level, associate, fresher, or "0–2 years").

Each job gets a **match score** from your skills, job titles, field and preferred cities. Results are saved for **6 hours**. Click **Refresh** for new ones. Sources that fail to load are listed quietly under "could not be loaded".

The starter list is Careem, Cobblestone Energy, Huspy, Datadog, Databricks, MongoDB, GitLab, Binance and Deel. Use **Manage sources** to add any company. Copy the board name from its careers page address, for example `boards.greenhouse.io/careem` → `careem`. You can also turn sources off or remove them.

**3. Job cards** show the title, company, city, type, date and match score. **View & apply** opens the official job page. **Save** adds the job to Applications. Filter by city or level, search, and sort by best match, newest or company.

**Scam safety:** real UAE employers never ask you to pay for a job, visa, training or "registration fee". Jarvis flags any job that mentions fees or deposits in red.

## Privacy

- Everything you enter is saved **only in this browser, on this device**, in local storage. There is no server, and Jarvis never sends your data anywhere.
- The live job feed only **downloads** public job lists from the job boards. Nothing about you is sent to them.
- **Calendar:** your browser talks directly to Google or Microsoft. There is no Jarvis server in between. Synced events are stored only in this browser. Sign-in tokens are kept only in memory (and this tab's session). They are never saved to disk or included in backups. Your Client ID is not a secret.
- **Voice note:** in Chrome and Edge, the browser itself turns your speech into text using its own speech service. Your Jarvis data still stays on your device. Typing avoids this.

## Backups

- **Settings → Export backup** downloads a `.json` file with all your data.
- **Settings → Import backup** restores a backup (you confirm first). Use this to move to another computer or phone.
- Clearing your browser data deletes Jarvis's data, so export a backup regularly.
- **Delete all data** wipes everything after you confirm. Right after, you can still press **Undo**.

## Accessibility

- Everything works with the keyboard: **Tab** to move, **Enter** to choose, **Esc** to close or stop, **J** to talk.
- Focus is always clearly outlined, and text has strong contrast.
- If "reduce motion" is on in your device settings, Jarvis turns off all animation, including the start-up sequence.
- Animations pause when the tab is hidden.

## Files

- `index.html`: the page.
- `app.css`: the design.
- `core.js`: data, Dubai dates, plain-English date and task parsing, and storage.
- `app.js`: screens, reminders and the clock.
- `jobs.js`: the job finder, live feed and application tracker.
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

To run them, install Node.js, then in this folder:

```
npm install
npx playwright install chromium
npm test
```

`npm test -- calendar` runs only the calendar tests. Screenshots of every screen are saved in `tests/screenshots/`.
