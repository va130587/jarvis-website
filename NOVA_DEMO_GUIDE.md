# NOVA demo guide (about 8 minutes)

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

## 9. Look and feel (30 seconds)

- **Security and Settings → Appearance**: switch between **Deep Space** (dark) and **Daylight** (light). The choice is remembered in this browser and applied before the page appears.
- Point out the **orb** gliding between states, the sidebar groups (Today, Work, Life, Knowledge, System) and, on a phone, the bottom bar.
- **Tasks and Calendar**: each NOVA task has **Done** and **Delete**; both show a preview first. Press **Reject** to show that nothing changed.
- Honest errors: if the server or the connection fails, the page says what happened, offers **Try again**, and reloads by itself when the connection is back. Nothing you typed in Chat is lost.

## Questions people ask

- *Does it cost anything?* No. Built-in rules and an optional free local model; Claude is optional and off.
- *Can it send e-mail or act on my behalf outside NOVA?* No. Gmail is read-only and the send endpoint always refuses.
- *What if the AI is tricked by a malicious e-mail?* E-mail text is treated as data, never as instructions, and every change still needs your approval.
- *Where is my data?* In one SQLite file on your machine (`.nova/nova.db`). `npm run backup` makes a checked copy.
