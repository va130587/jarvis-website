# NOVA demo guide (about 13 minutes)

A script for showing NOVA to someone. It uses a **separate demo database with fictional data**, so your own NOVA is never touched. Everything below was run by the automated tests; anything that needs real accounts or a real microphone is marked.

## Start

```bash
npm run demo          # first time creates the demo data; next times reuse it
npm run demo:reset    # start the demo over from scratch
```

Open **http://127.0.0.1:8788** and sign in with **demo@nova.local**. (Use Microsoft Edge for the most natural voice.)

## 1. The idea (30 seconds)

> "Most assistants say 'done' when they have only tried. NOVA's rule is: **from request to verified result**. It shows what it will change before it acts, checks the result afterwards, and is honest about what it could not prove."

Point at the **orb**: it changes with what NOVA is doing (listening, understanding, waiting for approval, executing, completed, error).

## 2. Daily Briefing (1 minute)

Open **Daily Briefing**.
- The banner: greeting, a one-line summary, the **day load** ring, and **"The one thing"** with the reason it was picked (a promise that is already late beats an overdue task).
- Sections: Overdue, Due today, Next three days, Follow-ups (things people owe you), E-mail with a phishing warning.
- Press **Read it to me**.
- Say or type **"brief me"** in NOVA Chat: same briefing, no approval needed because nothing changes.

## 3. Approve before acting (1 minute)

In **NOVA Chat** type: `add a task to send the portfolio link to Sara by Thursday`
- The **Future Preview** card: action, why, where, what will change, consequences, can it be undone. Nothing has changed yet.
- **Approve**. The reply ends with what NOVA *checked*: "Read back from the database: task #... exists". Then press **Undo this**.
- Type `forget that I prefer short answers`: deleting is destructive, so it always needs a button press (and is not undoable).

## 4. ProofLoop (1.5 minutes)

Open **ProofLoop**. The demo has nine commitments in different states.
- Open "Send the updated project proposal to Alex Rivera": it is **Awaiting Confirmation**, not verified. NOVA will not move it to Verified without verified evidence.
- Add evidence ("Alex replied that he received it", kind *verified*), move it to **Verified**, then **Completed**, then **Export proof receipt**: the receipt says plainly what the evidence does and does not prove ("verified only by your own confirmation" vs "an independent check").
- In chat: `Omar owes me the final figures by Thursday` creates a commitment owed to you; the follow-up job will nudge you on its follow-up date.

## 5. Smart Email (1.5 minutes)

Open **Smart Email**. The demo inbox is fictional (labelled DEMO).
- Filters: Important, Critical, Needs a reply, Deadlines, **Check first** (possible phishing).
- Open the interview invitation: **why** it is Critical (asks you something, about a job, deadline tomorrow).
- **Write a draft reply**, edit it, **Save**. Press **Send…**: NOVA refuses, because it only has read-only Gmail access. It never sends e-mail.
- Open the "Gulf Bank" message: "Check first", with the reasons; NOVA will not draft or track it.
- Open Omar's message: **Track their promise in ProofLoop**.
- Say **"any important emails?"**

Real Gmail: needs your own Google OAuth client (free) and `NOVA_SECRET_KEY`; tested only against a stand-in Google. See DEPLOYMENT.md.

## 5b. Knowledge Base and Ctrl+K (1 minute)

Open **Knowledge Base**. The demo has three sample documents (labelled demo).
- Ask **"when should I renew my visa?"**: the answer quotes the passage and shows the source with the matching words highlighted. Ask something that is not in the documents: NOVA says it found nothing instead of guessing.
- Say or type **"what do my notes say about the p-value"** in Chat or Voice.
- Press **Ctrl+K** (Cmd+K on a Mac) anywhere: type "visa" to find documents, memories, tasks and e-mail in one list; type a page name to jump there; start with **>** to ask NOVA.

## 5c. Plan my day, focus, and your week (1 minute)

Open **Focus and Planner**: NOVA fits the overdue and due tasks and your promises into today's working hours, with the reason for each block, lunch kept free and short breaks after 90 minutes. Things that do not fit are listed with why. Change the end time to 11:00 to see it re-plan.
- Press **Focus on this** on a block: the ring counts down, the orb turns violet ("Focusing") and a timer appears in the top bar on every page. At the end NOVA tells you; **Mark the task done** still goes through the normal approval.
- Open **Weekly Insights**: the reliability score (promises kept on time, from ProofLoop), tasks done and focus time compared with last week, two charts (hover or Tab onto a bar; "Show as a table"), and plain sentences about what stands out.
- Say **"plan my day"** or **"how was my week?"**.

## 5d. Life Tracker (1 minute)

Open **Life Tracker**. The demo has two habits with 12 weeks of history, two reminders, a month of spending and a budget.
- In the capture bar type **"remind me at 11pm to lock the door"**: a preview appears; press Approve. A clock time makes a timed reminder that the server delivers (bell, pop-up, phone push) even with the page closed. A date only ("tomorrow") still makes a task.
- Type **"spent 25 dirhams on karak"**: NOVA picks the category (food) and asks first.
- Tick a habit: the streak and the 13-week heatmap update.
- Money: this month by category, compared with last month, and the budget bar with a marker for an even pace through the month. NOVA warns you once at 80% and once at 100%.
- By voice: **"how much did I spend this month?"**, **"check in reading"**.

## 6. Automation and notifications (1 minute)

Open **Automation Centre**.
- Four jobs at Dubai times. Change a time, switch one off, press **Run now** and look at **Run history** (attempts, result).
- Explain: runs on the server even with the browser closed; failed runs are retried, never duplicated; if the computer was off, missed briefings are merged into one.
- **Send a test notification**: the **bell** in the top bar gets a count; with browser permission a pop-up appears. Phone push works with the free ntfy app (`NOVA_NTFY_TOPIC`; not part of the demo).

## 7. Voice (1 minute; needs a microphone)

Open **Voice Assistant**.
- Press **Start listening**, say "what are my tasks", press **Stop**. The words appear in a box you can **edit** before sending. Low confidence is flagged.
- NOVA picks a natural voice when the browser has one (Edge: "Microsoft Andrew Online (Natural)"), marked with a star. **Test voice**.
- Say "add a task to call the bank", then say **"approve"**: small, undoable changes can be approved by voice. A bare "yes" is ignored; deleting needs a button.
- Real-microphone accuracy depends on the browser and room: NOVA_VOICE_TEST_SCRIPT.md is the 10-minute check.

## 8. Trust (30 seconds)

**Security and Settings**: the tool list with risk levels, active sessions, the audit log, **Download everything (JSON)** and the delete buttons. **AI Usage and Cost**: every reply is free here (built-in rules, or a local model with `NOVA_AI_PROVIDER=ollama`).

## 9. The five newest features (2 minutes)

- **Promise Orbit** (Dashboard): dots circle the orb, one per open promise, deadline or task, nearest first. A red ring with **!** is overdue, a dashed amber ring is waiting for proof, a green tick is verified. Press **Tab** to a dot: the line under the orb says what it is; **Enter** opens it. **Show as a list** gives the same information as a table.
- **Day Replay** (Life group): what NOVA did today, in order. Drag the slider or press **Home**, **End** and the arrow keys: rows later than the marker go quiet and say "later". Use **Previous day** to look back. It is read-only.
- **Life Radar** (Weekly Insights): five measures from 0 to 100, this week (solid) against last week (dashed). Hover or Tab to a point for the exact numbers; **Show as a table**. A measure with no data says "not enough data yet" instead of a number.
- **Proof receipt check**: in ProofLoop open a commitment, **Export proof receipt**. It ends with a fingerprint. Open **/verify** (or **Check a receipt** in ProofLoop), paste the receipt: **Matches**. Change one letter: **Does not match**. The printable receipt has a QR code. Nothing from your paste is shown back.
- **What happens if**: in Chat type `add a task to call HR by friday`. The preview now has an **Effects** row (what else is due that day, the ProofLoop tracking NOVA will add). A request with nothing else affected says "No other effects found." Reject it.

## 9a. The ten improvements (3 minutes)

- **Guided demo** (Dashboard, demo only): five numbered steps; each ticks when you do it and is remembered. **Hide this guide** puts it away.
- **Lived-in data:** **Day Replay → Previous day**: every one of the last 14 days has sign-ins, requests, approvals, focus sessions and a morning briefing at different times. The Life Radar has real shapes; the budget is near 80%; **Life Tracker** shows two habits with different streaks (9 days and 3 weekdays).
- **First-run tour:** sign in as a *new* e-mail on a server with `OWNER_EMAILS` listing it; six steps. **Security and Settings → Show the tour again** repeats it.
- **Help:** open **Help** (System), press **Check my setup**. Each line says OK, Needs attention (with the exact step) or Not set up (and why that is fine).
- **Undo:** in Chat add a task with a date and approve it. Open **Day Replay**: the Undo list shows it. Press **Undo**: a preview lists what changes and what else it touches (for example the ProofLoop commitment that will be cancelled). Nothing is undone until you press **Approve undo**. The bell menu links here too.
- **Export and import:** **Security and Settings → Download a readable copy (Markdown)**; **Import a NOVA export**, choose a JSON you downloaded: a preview with counts, "already there" and "left out"; nothing is added until **Approve import**.
- **Backups:** **Automation Centre → Backups**: press **Run now** on the **Backup** job, then **Test my latest backup**: it rebuilds the copy in a temporary place and says your live data was not touched.
- **Calendar-aware plan:** in **Tasks and Calendar** import an `.ics` file (or connect a calendar), then open **Focus and Planner**: events are fixed blocks and tasks are planned around them. NOVA never adds or changes calendar events.
- **Voice:** the sentence under the status says what your browser can do; **Test my microphone** (needs a microphone) shows a level for 10 seconds and records nothing.
- **Accessibility:** **Security and Settings → Contrast and text size**: **High contrast**, **Larger (150%)**. Press **Tab** on any page: **Skip to content** appears.

## 9c. The newest features (4 minutes)

- **Quick capture:** press **Capture** in the top bar (or Ctrl+K, then type `capture:`). Paste: `call Sara tomorrow 3pm, AED 40 lunch, note: visa photos need a white background, I promised Sam the slides by Friday, delete my tasks`. One preview: a reminder, an expense, a note and a promise are ticked; the unsure part is not; "delete my tasks" is "Not understood" because Quick capture only adds. Nothing is added until **Approve selected**; then each one is in the Undo list.
- **Can people rely on me?** (ProofLoop): how many promises you kept on time, per person, with the rule shown. With fewer than 3 counted promises it says "not enough data yet". **Before I promise** (a date) warns when that week already holds 3 or more open promises.
- **What if I say yes?** (Work): type `Join the workshop tomorrow 2pm to 5pm`. NOVA shows the effect on that day (clashes, free hours, tight tasks and promises, the most at-risk item) and changes nothing. **Add it for real** opens Quick capture.
- **Weekly Review** (Life): the last full Dubai week with a week picker, three priorities for next week with the rule behind each, **Copy as text** and **Download as Markdown**. In **Automation Centre**, the **Weekly review notification** (Sunday 18:00) is off until you turn it on.
- **Energy marks** (Focus and Planner): tap High, Medium or Low for the morning, afternoon and evening. The demo has 8 days of marks, so it shows "You usually mark high energy in the morning (6 of 8 days)" and the planner switch is available.
- **Decision Journal** (Life): the demo has five answered decisions (so the record shows), one waiting for its answer today, and two coming up. Record a new one: a preview first, nothing saved until you approve.
- **Life Timeline** (Life): everything per day, newest first. Filter by kind, search, press **Show more**.
- **Privacy** (System, "What NOVA knows about me"): real counts, connected accounts and what each may do, what is encrypted, what NOVA never does, a download, and **Delete…** for one kind of data (preview, type DELETE, approve; it cannot be undone).
- **Connect Gmail: step by step** (Smart Email, also on Help): the exact addresses for your server with Copy buttons and a live checklist. Real Gmail needs your own Google account (UNVERIFIED here).

## 9b. Look and feel (30 seconds)

- **Security and Settings → Appearance**: switch between **Deep Space** (dark) and **Daylight** (light). The choice is remembered in this browser and applied before the page appears.
- Point out the **orb** gliding between states, the sidebar groups (Today, Work, Life, Knowledge, System) and, on a phone, the bottom bar.
- **Tasks and Calendar**: each NOVA task has **Done** and **Delete**; both show a preview first. Press **Reject** to show that nothing changed.
- Honest errors: if the server or the connection fails, the page says what happened, offers **Try again**, and reloads by itself when the connection is back. Nothing you typed in Chat is lost.

## Questions people ask

- *Does it cost anything?* No. Built-in rules and an optional free local model; Claude is optional and off.
- *Can it send e-mail or act on my behalf outside NOVA?* No. Gmail is read-only and the send endpoint always refuses.
- *What if the AI is tricked by a malicious e-mail?* E-mail text is treated as data, never as instructions, and every change still needs your approval.
- *Where is my data?* In one SQLite file on your machine (`.nova/nova.db`). `npm run backup` makes a checked copy.
