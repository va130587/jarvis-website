# Jarvis — my personal chief of staff

Jarvis helps me keep every promise I make at work, build my case for promotion, and track my path to a CTO or CEO role.

**Live app:** https://va130587.github.io/jarvis-website/
**Blueprint presentation:** https://va130587.github.io/jarvis-website/blueprint/

This is **version 1**. It runs in the web browser. It needs no account, no server and no AI key.

## What each screen does

| Screen | What it is for |
| --- | --- |
| **Today** | Your morning brief: overdue items in red, what's due today and this week, your next career action, drafts waiting for approval and your best-fit role. |
| **Commitments** | Every promise you make: what, to whom, by when, and where you said it. Type a sentence like *"I'll send the vendor comparison to Sara by Thursday"* in **Quick capture**. Jarvis fills in the details for you to check. |
| **Promotion** | Your current level, the next level, and the criteria your company uses. Log wins, metrics and praise as evidence against each criterion. A criterion turns red when it has had no new evidence for 6 weeks. |
| **Career radar** | CTO, VP Engineering and CEO roles you are watching, moved through stages: Interested → Applied → Interviewing → Offer. Each role gets a fit score from your own scoring rules. |
| **Weekly review** | Every Friday: wins this week, promises kept, what slipped, the promotion gap that hasn't moved, and one suggested next step. |
| **Approvals** | Messages to approve, edit or reject before they go out in your name. You add drafts yourself today. In version 2, AI writes them. |
| **My profile** | Your career goal, non-negotiables, strengths, gaps, and your people map (manager, sponsors, mentors, key peers). |
| **Blueprint** | The presentation explaining the full Jarvis architecture. |

## How to start

1. Open the live app. It first shows **sample data** so you can see how it works.
2. Click **Clear sample data**.
3. Fill in **My profile**.
4. In **Promotion**, click **Edit levels and criteria** and paste the criteria from your company's career framework, one per line.
5. Each day, capture promises as you make them. Each Friday, open **Weekly review**.

## Where my data is stored

- Everything is saved **only in this browser, on this device**. Nothing is sent anywhere.
- Clearing your browser data deletes it. Use **Export backup** regularly to download a copy.
- To move to another computer or phone, export a backup there and use **Import backup**.
- Don't type confidential company information into it unless your employer allows it.

## Version 2 plan

1. **Connect Outlook and Teams** (Microsoft Graph, read-only at first). Jarvis will find promises in your email and chat automatically and fill the Today screen from your calendar.
2. **Add Claude AI drafting.** Jarvis will write replies in your voice and put them in Approvals. Nothing is sent without your approval.
3. **Scheduled morning brief.** A summary emailed or sent in Teams every weekday morning.
4. **Job feeds.** New roles at your target companies pulled from their public careers pages.
5. **Secure storage.** Data moves from the browser to a private cloud database, with sign-in.

See the Blueprint for the full architecture.

## Files

- `index.html`, `app.css`, `app.js`: the Jarvis app (plain HTML, CSS and JavaScript, no build step)
- `blueprint/index.html`: the architecture presentation

## Note

This is planning guidance, not legal advice. Check your employment contract and local data-protection rules before connecting work systems to a personal tool.
