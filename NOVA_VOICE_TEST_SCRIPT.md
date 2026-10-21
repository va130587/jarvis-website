# NOVA voice: 10-minute real-microphone test

The automated tests use a **mock** speech engine, so they prove NOVA's behaviour but **not** how well your browser and microphone recognise you. Run this once on the machine you will actually use. Record the result in the table at the end.

**Setup (1 min).** Use Microsoft Edge (best natural voices) or Chrome, on the internet (these browsers send audio to their vendor for recognition; it costs nothing). Start NOVA (`npm start`), sign in, open **Voice**.

| # | Step | Expected | Pass? |
|---|------|----------|-------|
| 1 | Open the **NOVA's voice** list. | A "★" marks natural voices. In Edge you should see "Microsoft Andrew Online (Natural)". The note under the list says honestly what is installed. If there is no Andrew voice, the note says so (it is then simply not available in your browser). | |
| 2 | Press **Test voice**. | You hear a natural voice say "This is how I sound…". **Stop speaking** stops it at once. | |
| 3 | Click **Start listening**, say "What are my tasks", click **Stop listening**. | Words appear live, then sit in the box. A confidence note appears. Nothing is sent until you press **Send to NOVA**. | |
| 4 | Send it. | NOVA answers in the log and speaks the answer. | |
| 5 | Say "Add a task to call HR by Friday", stop, **read the words**, fix any mistake by typing, Send. | A preview appears with what will change. NOVA says "Say approve or reject." Nothing is created yet. | |
| 6 | Say (press the button) "approve". | The task is created and NOVA reads back what it checked. | |
| 7 | Say "Delete task call HR", then say "approve". | NOVA refuses: deleting needs a button press. Press **Approve** on the card yourself. | |
| 8 | Say only "yes" to a waiting preview. | Nothing happens (a bare "yes" never approves). | |
| 9 | Say "reject" to a waiting preview. | It is rejected and nothing changes. | |
| 10 | Speak slowly with long pauses. | The words are still captured (listening stops after you press Stop, or 90 s). If the browser cuts you off, note it below. | |
| 11 | Play music or a TV nearby and speak. | Low-confidence text is flagged with a warning; you still get to edit before sending. | |
| 12 | Press **Start listening** and stay silent for a few seconds, then stop. | "I did not hear anything", with tips. | |
| 13 | Block the microphone for the site (lock icon > Microphone > Block), reload, press Start. | "Microphone access is blocked" with the steps to fix it. Typing still works. | |
| 14 | Switch the language to **Arabic (UAE)**, say a short Arabic sentence. | Arabic text appears (accuracy depends on your browser). | |
| 15 | Switch the radio to **Hold to talk**; hold the button (or Space) while speaking. | Listening only while held. | |
| 16 | Turn off Wi-Fi, press Start. | "You appear to be offline", typing still works. | |
| 17 | Read the sentence under the status on the Voice page. | One plain sentence about *your* browser: Chrome and Edge "can both listen and speak" (and where the audio goes), Safari "works only partly", Firefox "cannot listen". It ends with what to do. | |
| 18 | Press **Test my microphone** and talk for 10 seconds. | The level bar moves with your voice, the words "Speak now. Level NN% · N s left" count down, and it ends with "Your microphone works." Nothing is recorded or played back. | |
| 19 | Press **Test my microphone**, stay silent, or mute the microphone first. | "NOVA heard almost nothing", with what to check. Run it again after unmuting. | |
| 20 | Block the microphone for the site, then press **Test my microphone**. | "Microphone access is blocked" with the steps; the microphone light does not stay on after any test. | |
| 21 | In **Firefox** (no speech recognition), open the Voice page. | The talk button is off, the first box says **Type or paste your request**; typing `add a task to call HR`, Send, then `approve` works for the small change; for `delete the task call HR`, typing `approve` is refused (button press needed). | |

**Accuracy score (fill in).** Say these 10 phrases once each, normal speed, quiet room, and count how many appear with no errors: "what are my tasks", "add a task to call HR by Friday", "add a note that the lab is closed", "list my notes", "mark call HR done", "delete task call HR", "search my memories for tea", "what time is it", "show my approvals", "who am I".

- Correct without editing: ___ / 10
- Browser and version: ______   Microphone: ______   Natural voice used: ______

**Safety reminders.** Voice is never used to prove who you are. Only small, undoable changes can be approved by voice; deleting, forgetting and anything sent outside NOVA always needs a button.
