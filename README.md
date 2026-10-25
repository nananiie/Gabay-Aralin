# Gabay Aralin

An AI homework helper for parents. A parent takes a photo of their child's homework and gets a step-by-step home lesson plan, a simple explanation of each question, and 3 guiding questions to ask the child. **It never gives the answer**, so the child learns to think on their own.

## Features

- **Family setup first**: parents add each child with their grade level before checking homework.
- **Photo or typed input**: snap the worksheet, or type/paste a question.
- **Step-by-step lesson plan**: for every worksheet, a timed home lesson (warm-up → teach the idea with a different example → practice → worksheet together → child tries alone → check and celebrate). Each step says what to do and what to say, using household materials, with tips for when the child gets stuck and a follow-up activity.
- **Guidance per question**: a plain-English explanation of the concept and 3 guiding questions, never the answer.
- **AI subject sorting**: every question is tagged with a Philippine K-12 learning area (English, Math, Science, Filipino, Araling Panlipunan, MAPEH, Values Education), and each assignment gets a title and topic.
- **Assignment history**: organized by child → grade level → subject, with filters, search, a "mark as done" toggle, and quick stats.
- **Grade-aware**: the child's grade level shapes the explanations and the lesson length.
- **Read aloud**: 🔊 reads the lesson plan or guidance aloud.
- **Privacy**: profiles and history stay in the browser (localStorage). The server stores nothing.

## How it works

```
                                         ┌─► 2a. Tutor (gpt-4.1): explanation + 3 hints per question ─┐
Photo/text ─► 1. Vision/OCR (gpt-4.1) ───┤                                                            ├─► 3. Answer-leak guard (gpt-4.1-mini) ─► Parent
              transcribe + categorize    └─► 2b. Lesson planner (gpt-4.1): step-by-step home lesson ──┘    rewrites anything that reveals an answer
```

1. **Vision/OCR + categorization**: extracts each question exactly as printed and tags its subject. It ignores answers the child already handwrote and any text in the image that tries to instruct the AI. If the photo is blurry, blank or not homework, the parent is asked for a clearer photo.
2. **Tutor and lesson planner** run in parallel. Both are told never to reveal answers: no filled blanks, correct options, word meanings, or yes/no questions that contain the answer. Worked examples must use different numbers and words than the worksheet.
3. **Guard**: a separate model reviews every explanation and every lesson-plan step for answer leaks. Anything leaking is regenerated with the reviewer's feedback (up to 2 times). If it still leaks, the question gets safe generic guidance and the lesson plan is left out. Nothing that reveals an answer is ever shown.

All model outputs use OpenAI Structured Outputs (strict JSON schemas), and the server validates them before responding.

## Run

Requires Node.js 20.12+.

```bash
npm install
# create .env containing: OPENAI_API_KEY=sk-...
npm start
# open http://localhost:3000
```

Optional overrides in `.env`: `OCR_MODEL`, `TUTOR_MODEL`, `GUARD_MODEL`, `PORT`.

## Files

- `server.js`: API endpoint and the AI pipeline
- `prompts.js`: all model instructions and JSON schemas
- `public/index.html`: the whole mobile-friendly app (setup, check, lesson plan, history, profile)
