# Brief: Video Demo and Presentation for Gabay Aralin

> This brief covers two things about my project:
> 1. A **video demo script**: a 2–3 minute screen-recorded walkthrough with voiceover.
> 2. A **pitch presentation**: about 10 slides for a 10-minute live talk, including a short live demo.
>
> Everything you need about the project is below. Please ask me about anything marked **[ASK ME]** before you finalize. Don't invent statistics, user numbers, or test results. If a slide needs a number I haven't given you, leave a clear placeholder such as `[SOURCE NEEDED: …]`.

---

## 1. The project in one paragraph

**Gabay Aralin** ("learning guide" in Filipino) is a free, mobile-first **home tutor center** for Filipino parents and kids from **Kinder to Grade 12**. A parent snaps a photo of tonight's homework, types it in, or picks a topic. The app builds a full learning module in about a minute. It includes a step-by-step lesson for the child, practice questions with hints, a printable worksheet with an answer key, and coaching tips for the parent. **It never gives away the homework answers.** It teaches the skill behind the homework, then hands the homework back to the child with guiding questions.

**One-line pitch:** *Turn a photo of tonight's homework into a lesson your child can actually learn from, so any parent can tutor at home without knowing the answers themselves.*

## 2. The problem

- It's 8 p.m. and a parent wants to help with homework but can't explain the lesson. Maybe the subject has changed since they were in school, or they're tired, or they never learned it.
- Their options today are paying a tutor, guessing, or doing the homework for the child.
- Generic AI chatbots make that last option effortless. They solve the item, the child copies it, and nobody learns anything.
- Many Filipino kids are supervised by grandparents, older siblings, or caregivers, often because a parent works overseas as an OFW (overseas Filipino worker). These guardians need support even more.

**[ASK ME]** Do I have sourced statistics for the problem slide, such as PISA 2022 results for the Philippines or a parent survey? If I don't, keep the problem slide story-driven and leave a `[SOURCE NEEDED]` placeholder.

## 3. Who it's for

| User | Need |
| --- | --- |
| Busy or less-schooled parents | A plain explanation they can pass on to their child |
| Grandparents, older siblings, caregivers (common in OFW families) | Clear, guided steps they can follow alongside the child |
| Families who can't afford tutors | Tutor-style help at no cost |
| Kids, Kinder to Grade 12 | Short steps, examples from home life, encouragement, no shame for wrong answers |

## 4. What the app does (the four pillars)

Each module the app builds has four parts:

1. **📖 Step-by-step lesson:** 3–5 bite-sized steps written *for the child*. Each step has a worked example and a "note for grown-ups." The examples come from everyday Filipino home life, like food, family, school, playing, and money in pesos.
2. **🧠 Practice questions:** a quick check after every step, answered by tapping or typing. A wrong answer gets an encouraging hint, then a second hint. The answer and its explanation appear only after the third try. The next step unlocks once the check is done.
3. **📝 End-of-module worksheet:** 5–10 mixed questions (multiple choice, fill-in-the-blank, short answer). It's printable and has an answer-key toggle that explains each answer for the parent. Kinder to Grade 1 get only simple multiple choice and fill-in-the-blank.
4. **👪 Parent co-learning tips:** how to guide without doing the work, tricky parts to watch for, memory tricks, study hacks, and a short practice schedule.

**For homework photos:** the app also gives **guiding questions for each homework item, never the answers.** After the lesson, a "Now try your homework" button sends the child back to their own work.

**Other features:**
- **Family setup:** add each child with a name, grade level, and avatar.
- **My Lessons:** lessons are saved per child, then by grade, then by subject. The AI sorts them into Philippine K-12 learning areas: English, Math, Science, Filipino, Araling Panlipunan, MAPEH, Values Education.
- **Resumable progress:** a child can stop and continue a lesson later.
- **Read-aloud:** a 🔊 button reads lesson text out loud for early readers.
- **Privacy-first:** all family data and lessons stay in the browser on the device. There are no accounts, and a parent can clear everything with one button.

## 5. What makes it trustworthy (the "how", for technical judges)

These are real design decisions in the code, and they set the app apart from "just ask ChatGPT":

- **The homework stays unsolved by design.** The parts that write the lesson, worksheet, and tips never see the homework items. They only receive the subject, topic, grade, and skills. A separate **leak guard** checks that the homework guidance doesn't reveal answers. A reviewer also checks that no practice or worksheet question copies a homework item.
- **Answer keys are verified.** A second AI reviewer solves every practice and worksheet question on its own. It drops any question with a wrong key or more than one correct answer. It replaces hints that give the answer away. It adds other accepted answers, such as "seven" for "7".
- **It fails soft.** The four pillars are generated in parallel. If one fails, the others still appear.
- **Structured, validated output.** Every AI response follows a strict JSON schema, and the server validates it before anything reaches the child.

**Pipeline (good for one architecture slide):**

```
photo / typed homework ─► read photo + categorize ─┐                     ┌─► Lesson + practice ──► answer-key reviewer
                                                   ├─► topic, grade,  ───┼─► Worksheet ─────────► answer-key reviewer
topic ─────────────────► topic intake ─────────────┘    skills only      ├─► Parent tips
                                                                         └─► Homework help ─────► answer-leak guard
```

**Tech stack:** Node.js and Express backend, a single-page mobile-first web app with plain HTML, CSS, and JavaScript, and the OpenAI API (GPT-4.1 for reading photos, lessons, and reviews, GPT-4.1-mini for fast tasks). It runs locally at `http://localhost:3000`.

## 6. The demo click path (use this for both the video and the live demo)

1. **Family setup:** on first open, the app says "Welcome! Let's set up your family first." Add a child, for example "Mika, Grade 3," and pick an avatar.
2. **Learn tab:** the screen asks "What are we learning today?" There are three input modes: 📸 Photo, ⌨️ Type it, 💡 Topic. Grade-based toapic suggestions appear as tappable chips.
3. **Snap homework:** choose 📸 Photo, upload a photo of a real Grade 3 worksheet, and tap **🚀 Build my lesson**.
4. **Lesson stepper:** walk through step 1. Show the worked example and the "note for grown-ups." Tap 🔊 Read to show read-aloud.
5. **Practice check:** give a **wrong answer on purpose.** Show the encouraging hint, then the second hint, then the right answer. *This is the key moment of the demo.*
6. **Worksheet:** tap 📝 Try the worksheet. Show the mixed question types, toggle the answer key, and show 🖨️ Print worksheet.
7. **Parent tips:** tap 👪 Parent tips and scroll the coaching tips.
8. **Homework help:** tap ✏️ Now try your homework. Show the guiding questions and point out that **no answers are given.**
9. **My Lessons:** show the lesson saved under Mika, then Grade 3, then the subject.

**[ASK ME]** Which real homework example should the demo use? Suggest 2–3 options that show off well, such as Grade 3 Math fractions, Grade 5 Science, or a Filipino language worksheet.

## 7. What I need from you

### A. Video demo script (2–3 minutes)
- Write a **two-column script**: what's on screen on the left, the voiceover word for word on the right, with rough timestamps.
- Structure: a hook (0:00–0:15, the 8 p.m. homework struggle), the problem (about 15 s), the demo following the click path in section 6 (about 1:45), the trust features (about 20 s), and the close with the one-line pitch (about 10 s).
- Spend the most time on the **wrong-answer hint moment** and the **"no answers given" homework help.**
- Add recording tips: phone-sized browser window, what to zoom in on, where to cut, captions, and background music mood.
- **[ASK ME]** Should the voiceover be in English, Filipino, or Taglish? Who is narrating?

### B. Pitch presentation (about 10 slides, 10 minutes)
Suggested flow. You can improve it, but explain any change:

1. **Title:** Gabay Aralin, the one-line pitch, team names **[ASK ME]**
2. **The 8 p.m. problem:** a short story of a parent who can't help
3. **Why existing options fail:** tutors cost money, guessing doesn't work, and chatbots give answers away
4. **Our approach:** teach the skill and hand the homework back (the four pillars)
5. **Live demo:** 3–4 minutes using the click path. Include a backup plan: a pre-recorded video if the internet or the AI is slow.
6. **How we keep it honest:** the pipeline diagram, the leak guard, and the answer-key reviewer
7. **Built for Filipino families:** K-12 learning areas, home-life examples, read-aloud, phone-first, privacy-first
8. **Impact and next steps:** **[ASK ME]** for testing results, user feedback, and roadmap items. Possible roadmap: Filipino and Taglish lessons, offline mode, DepEd MATATAG curriculum alignment, teacher dashboard.
9. **The ask:** **[ASK ME]** whether this is for a thesis defense, a competition, funding, or a school pilot
10. **Thank you / Q&A**

For every slide, give me: the slide title, what goes on the slide (keep it visual, with few words), **speaker notes** in a natural speaking voice, and the time allotted.

### C. Likely judge questions with suggested answers
Prepare 8–10 questions, including:
- "Can't kids just use ChatGPT?"
- "How do you know the answer keys are correct?"
- "What if the AI gets something wrong?"
- "How much does it cost to run per lesson, and how will it stay free?" **[ASK ME]** for real numbers.
- "What about child privacy and data?"
- "Does it follow the DepEd curriculum?"
- "What happens with poor internet?"

### D. Visual style
- **Mood:** bright, colorful, kid-friendly, and warm, matching the app's playful design. It should feel like a friendly tutor, not a corporate product.
- Use real screenshots of the app wherever possible. **[ASK ME]** I can send screenshots.
- Keep text on slides minimal and let the demo carry the story.

## 8. Rules for the content
- Never claim the app "solves homework." It **teaches**, and the homework stays the child's to do.
- Don't make up statistics, user counts, test results, or quotes. Use `[SOURCE NEEDED]` or `[ASK ME]` placeholders instead.
- Keep the language simple. Some judges are educators, not engineers.
- The emotional core is a parent who wants to help but doesn't know how, and an app that makes them capable instead of replacing them.
