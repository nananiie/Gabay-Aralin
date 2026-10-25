# Gabay Aralin

An AI homework helper for Filipino parents. A parent takes a photo of their child's English homework and gets a step-by-step explanation in simple Tagalog, plus 3 guiding questions to ask the child. **It never gives the answer**, so the child learns to think on their own.

## Features

- **Photo or typed input**: snap the worksheet, or type/paste a question.
- **Tagalog guidance**: a step-by-step explanation and 3 guiding questions per item, never the answer.
- **AI subject sorting**: every question is tagged with a Philippine K-12 learning area (English, Math, Science, Filipino, Araling Panlipunan, MAPEH, Values Education), and each assignment gets a title and topic.
- **Assignment history**: saved per child and grouped by subject, with subject filters, search, a "mark as done" toggle, and quick stats (total / done / this week).
- **Parent and child profiles**: multiple children, each with a grade level and avatar. The active child's grade is sent to the AI so explanations match their level.
- **Read aloud**: the 🔊 button reads the Tagalog guidance aloud, for parents who find reading difficult.
- **Privacy**: profiles and history stay in the browser (localStorage). The server stores nothing.

## How it works

```
Photo ──► 1. Vision/OCR (gpt-4.1) ──► 2. Tagalog tutor (gpt-4.1) ──► 3. Answer-leak guard (gpt-4.1-mini) ──► Parent
          transcribe questions        explanation + 3 hints            leaked items are rewritten (max 2x);
          only, never solve           per question                     if still leaking → safe generic guidance
```

1. **Vision/OCR + categorization**: extracts each question exactly as printed and tags its subject. It ignores answers the child already handwrote and any text in the image that tries to instruct the AI. If the photo is blurry, blank or not homework, the parent is asked for a clearer photo.
2. **Tutor**: for each question, writes 3–5 explanation steps and exactly 3 progressive hints (general → clue → final thinking step) in conversational Tagalog addressed to the parent. The prompt forbids answers, filled blanks, correct options, word meanings or translations, and yes/no hints that contain the answer.
3. **Guard**: a separate model reviews every item for answer leaks. Leaking items are regenerated with the reviewer's feedback. Nothing that still leaks is ever shown.

All model outputs use OpenAI Structured Outputs (strict JSON schemas). The server then validates them and assembles the required markdown format, so the structure is always correct.

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

- `server.js`: API endpoint and the 3-step pipeline
- `prompts.js`: all model instructions and JSON schemas
- `public/index.html`: mobile-friendly UI (camera/upload, results, copy as markdown)
