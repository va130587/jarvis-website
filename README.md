# Jarvis

Jarvis is a free personal assistant website for Roshan. You can talk to it, like Siri, and it talks back.

It helps you keep your promises, grow your skills, and track jobs, projects and courses.

- **Live app:** https://va130587.github.io/jarvis-website/
- **Blueprint:** https://va130587.github.io/jarvis-website/blueprint/

It is free. It needs **no account, no API key and no paid service**. It runs in your web browser.

## What Jarvis does

| Screen | What it shows |
| --- | --- |
| **Today** | The glowing core, your greeting, how many promises are overdue, due today and due this week, and one suggested next step. |
| **Commitments** | Your promises: what, to whom and by when. Type a sentence like *"I'll send the report to Omar by Friday"* in **Quick capture**. Jarvis finds the person and the date. |
| **Growth** | Your goal, the skills you are building, and a log of your wins. A skill turns **red** after 6 weeks with no new win. |
| **Opportunities** | Jobs, projects and courses. Each one has a match score and moves through four stages: Interested, Applied, In progress, Done. Amounts are shown in AED. |
| **Weekly review** | Your wins this week, promises kept, what slipped, and one next step. |
| **Approvals** | Draft messages. You can approve, edit or reject each one. Approving copies the text so you can paste and send it yourself. |
| **My profile** | Your name, goal, strengths and important people. Voice settings and your data are here too. |
| **Blueprint** | A link to the presentation in the `blueprint/` folder. |

The first time you open Jarvis, it shows **sample data** marked with a gold "Sample" label. Click **Clear sample data** to remove it and start with your own.

## Talking to Jarvis

To talk, do one of these:

- Tap the glowing core on the Today screen.
- Click **Talk to Jarvis**.
- Press **J** on your keyboard.

The first time, your browser asks to use the microphone. Click **Allow**.

To stop Jarvis talking, say **"stop"**, tap the core, or press **Esc**.

**Chat panel:** tap the small orb at the bottom right. It shows the conversation and has a box to type in, if you prefer typing.

**"Hey Jarvis" mode:** switch it on in the chat panel or in My profile. While the page is open, say "Hey Jarvis" and then your request, for example "Hey Jarvis, what's due today?" If you just say "Hey Jarvis", it answers "Yes?" and waits for your request.

**The core changes colour:** calm blue when idle, brighter and faster when listening, and gold when speaking.

### Things you can say

| Say | What Jarvis does |
| --- | --- |
| "Brief me" or "Good morning" | Reads your day: overdue items, what's due, drafts waiting, and your next step |
| "What's overdue?" | Lists overdue promises |
| "What's due today?" | Lists today's promises |
| "What's coming up this week?" | Lists promises due by Friday |
| "Remind me to send the report to Omar by Friday" | Adds a promise with the person and date |
| "Mark the vendor comparison as done" | Finds the promise and completes it |
| "Log a win: cut cloud costs by 12 percent" | Adds the win to your Growth log |
| "What's my next step?" | Suggests the one thing to do next |
| "Add opportunity Head of Engineering at Acme" | Adds it to Opportunities with a match score |
| "Open growth" / "Show approvals" | Opens that screen |
| "What time is it?" / "What's the date?" | Tells you, in Dubai time |
| "How was my week?" | Reads your weekly review |
| "What can you do?" | Lists what Jarvis understands |
| "Stop" | Stops Jarvis talking |

You can use your own words. For example, "what's late", "anything due today" and "catch me up" also work. Dates like "tomorrow", "Thursday", "next Monday", "end of the week", "in 3 days", "20 Oct" and "3/11" (day/month) are understood.

If Jarvis doesn't understand, it tells you politely what it can do. Jarvis follows set commands. It is not a free-chat AI.

**Best browsers:** Chrome or Edge on a computer, and Chrome or Safari on a phone. Firefox can't listen, so type in the chat panel instead. Jarvis picks a calm British English male voice if your device has one. You can choose another voice in My profile.

## UAE settings

- All dates and times use the **Asia/Dubai** time zone.
- The weekend is **Saturday and Sunday**, so "end of the week" means **Friday**.
- Money is shown in **AED**.

## Privacy

- Your data is saved **only in this browser, on this device** (in "local storage"). Jarvis has no server and sends your data nowhere.
- Clearing your browser data deletes it. Use **Export backup** often to download a copy.
- To move to another device, export a backup and use **Import backup** there.
- **Voice note:** in Chrome and Edge, the browser itself turns your speech into text using its own speech service, so your spoken words go to that service. Your Jarvis data still stays on your device. If you prefer, type instead.

## Accessibility

- Everything works with the keyboard. Press **Tab** to move and **Enter** to choose.
- If "reduce motion" is switched on in your device settings, Jarvis turns off all animation, including the start-up screen.

## Files

- `index.html`: the page structure
- `app.css`: the design
- `app.js`: data, dates and the screens
- `voice.js`: listening, speaking, the chat panel, the animated core, the background and the start-up screen
- `blueprint/`: the presentation (unchanged)

There is no build step. To run it on your computer, open the folder with any simple web server, for example `python3 -m http.server`, then visit http://localhost:8000. It also runs free on GitHub Pages.
