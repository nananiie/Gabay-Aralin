# Gabay Aralin: Home Tutor Center

A free, mobile-first home tutor center for parents and kids. Snap a homework photo, type the homework, or pick any topic. The app builds a complete learning module:

1. **📖 Step-by-step lesson**: 3–5 bite-sized steps written for the child, each with a worked example and a "note for grown-ups".
2. **🧠 Practice questions**: a quick check after every step (tap or type). Wrong answers get an encouraging hint, then a second hint. The answer is shown with an explanation only after the third try, and the next step unlocks once the check is done.
3. **📝 End-of-module worksheet**: 5–10 mixed questions (multiple choice, fill-in-the-blank, short answer). It's printable, with an answer-key toggle that explains each answer for parents.
4. **👪 Parent co-learning tips**: how to guide without doing the work, tricky parts to watch for, memory tricks, study hacks for home and mobile, and a short practice schedule.

For homework, the app also gives **guiding questions for each homework item, never the answers**.

Also included: family setup (each child with a grade level), lessons saved per child → grade → subject (sorted by AI), resumable lesson progress, read-aloud, and a privacy-first design where everything stays in the browser.

## How it works

```
photo / typed homework ─► OCR + categorize (gpt-4.1) ─┐                  ┌─► Lesson + practice (gpt-4.1) ──► answer-key reviewer
                                                       ├─► topic, grade, ─┼─► Worksheet (gpt-4.1) ─────────► answer-key reviewer
topic ─────────────────► topic intake (gpt-4.1-mini) ──┘    skills only   ├─► Parent tips (gpt-4.1-mini)
                                                                          └─► Homework help (gpt-4.1) ─────► answer-leak guard
```

- **Homework stays unsolved by design.** The lesson, worksheet and tips generators never see the homework items, only the subject, topic, grade and skills. A reviewer also checks that no practice or worksheet question copies a homework item.
- **Answer keys are verified.** A separate reviewer solves every practice and worksheet question. It drops questions with a wrong key or more than one correct answer, replaces hints that give the answer away, and adds other accepted spellings (e.g. "seven" for "7").
- **Fails soft.** The four pillars are generated in parallel. If one fails, the others still show.
- All model output uses OpenAI Structured Outputs (strict JSON schemas) and is validated by the server.

## Run

Requires Node.js 20.12+.

```bash
npm install
# create .env containing: OPENAI_API_KEY=sk-...
npm start
# open http://localhost:3000
```

Optional overrides in `.env`: `OCR_MODEL`, `TUTOR_MODEL`, `FAST_MODEL`, `PORT`, `LIMIT_PER_HOUR`, `LIMIT_PER_DAY`, `LIMIT_SITE_PER_DAY`.

## Usage limits

Every lesson build spends OpenAI credits, so the server caps them at 10 per hour and 20 per day for each visitor, and 100 per day for the whole site. Days reset at midnight Philippine time. Change the numbers with the `LIMIT_*` settings above.

On a single server the counts are kept in memory. On Vercel, connect an Upstash Redis database from the Vercel Marketplace so that every copy of the server shares the same counts. The app reads `KV_REST_API_URL` and `KV_REST_API_TOKEN`, or `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Visitors are stored only as a salted hash, and each count expires when its hour or day ends.

## Deploy on Vercel

1. Import this repository in Vercel. No `vercel.json` is needed.
2. Add `OPENAI_API_KEY` under Environment Variables. The `.env` file is never uploaded.
3. Connect Upstash Redis from the Vercel Marketplace so the usage limits hold, then redeploy.

## Files

- `prompts.js`: every system prompt and JSON schema (intake, lesson, worksheet, tips, homework help, reviewers)
- `server.js`: `POST /api/module`, the generation pipeline and the quality checks
- `limits.js`: per-visitor and site-wide usage limits
- `public/index.html`: the whole mobile-first app (family setup, learn, lesson stepper, worksheet + print, tips, my lessons)
