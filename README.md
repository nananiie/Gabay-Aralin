# Gabay Aralin

An AI homework helper for Filipino parents. A parent takes a photo of their child's English homework and gets a step-by-step explanation in simple Tagalog, plus 3 guiding questions to ask the child. **It never gives the answer**, so the child learns to think on their own.

## How it works

```
Photo ──► 1. Vision/OCR (gpt-4.1) ──► 2. Tagalog tutor (gpt-4.1) ──► 3. Answer-leak guard (gpt-4.1-mini) ──► Parent
          transcribe questions        explanation + 3 hints            leaked items are rewritten (max 2x);
          only, never solve           per question                     if still leaking → safe generic guidance
```

1. **Vision/OCR**: extracts each question exactly as printed. It ignores answers the child already handwrote and any text in the image that tries to instruct the AI. If the photo is blurry, blank or not homework, the parent is asked for a clearer photo.
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
