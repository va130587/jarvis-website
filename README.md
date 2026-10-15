# Jarvis

Jarvis is Roshan's free personal assistant website. It looks like a futuristic command center, and you can talk to it like Siri.

- **Live app:** https://va130587.github.io/jarvis-website/
- **Blueprint:** https://va130587.github.io/jarvis-website/blueprint/

It is completely free. There is **no account, no API key, no paid service and no server**. Everything runs in your web browser.

## What Jarvis does

- Keeps your **tasks and reminders**, and says them out loud at the right time.
- Shows your **week in a calendar**.
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
| **Calendar** | A Monday-to-Sunday week view of tasks, application deadlines and interviews. Saturday and Sunday are shaded as the weekend. Use the arrows to change week, and **+ Add** to add a task on a day. |
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
| "What's on my calendar this week?" | Your week |
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
- `blueprint/`: the presentation (unchanged).

There is no build step. To run it on your computer, start a simple web server in this folder, for example `python3 -m http.server`, and open http://localhost:8000. It runs free on GitHub Pages.
