import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  NO_ANSWER_NOTE,
  UNCLEAR_MESSAGE,
  OCR_SYSTEM,
  OCR_SCHEMA,
  TUTOR_SYSTEM,
  TUTOR_SCHEMA,
  GUARD_SYSTEM,
  GUARD_SCHEMA,
} from "./prompts.js";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OCR_MODEL = process.env.OCR_MODEL || "gpt-4.1";
const TUTOR_MODEL = process.env.TUTOR_MODEL || "gpt-4.1";
const GUARD_MODEL = process.env.GUARD_MODEL || "gpt-4.1-mini";
const PORT = Number(process.env.PORT) || 3000;
const MAX_QUESTIONS = 20;
const MAX_LEAK_FIX_ROUNDS = 2;

if (!OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY. Put it in a .env file next to server.js.");
  process.exit(1);
}

// ---------- OpenAI helper ----------

async function callJSON({ model, system, user, schema, temperature = 0.3 }) {
  const body = {
    model,
    temperature,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_schema", json_schema: schema },
  };

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.error?.message || `HTTP ${res.status}`;
        // Retry only transient failures.
        if (res.status === 429 || res.status >= 500) throw Object.assign(new Error(msg), { retry: true });
        throw new Error(msg);
      }
      const message = data.choices?.[0]?.message;
      if (message?.refusal) throw new Error(`Model refused: ${message.refusal}`);
      return JSON.parse(message.content);
    } catch (err) {
      lastErr = err;
      const transient = err.retry || err.name === "TimeoutError" || err.name === "TypeError";
      if (!transient || attempt === 2) break;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  throw lastErr;
}

// ---------- Pipeline steps ----------

async function extractQuestions(imageDataUrl) {
  return callJSON({
    model: OCR_MODEL,
    system: OCR_SYSTEM,
    temperature: 0,
    schema: OCR_SCHEMA,
    user: [
      { type: "text", text: "Transcribe the homework questions in this photo. Do not answer them." },
      { type: "image_url", image_url: { url: imageDataUrl, detail: "high" } },
    ],
  });
}

function formatItems(questions) {
  return questions.map((q, i) => `ITEM ${i + 1}${q.number ? ` (labeled "${q.number}")` : ""}:\n${q.text}`).join("\n\n");
}

function isValidItem(item) {
  return (
    item &&
    typeof item.summary_en === "string" &&
    item.summary_en.trim() &&
    Array.isArray(item.explanation_steps) &&
    item.explanation_steps.filter((s) => s.trim()).length >= 1 &&
    Array.isArray(item.hints) &&
    item.hints.filter((h) => h.trim()).length >= 3
  );
}

function cleanItem(item) {
  return {
    summary_en: item.summary_en.trim(),
    explanation_steps: item.explanation_steps.map((s) => s.trim()).filter(Boolean),
    hints: item.hints.map((h) => h.trim()).filter(Boolean).slice(0, 3),
  };
}

async function generateGuidance(questions, subject, feedback = []) {
  let extra = "";
  if (feedback.some(Boolean)) {
    extra =
      "\n\nIMPORTANT — a reviewer found that a previous draft REVEALED THE ANSWER for some items. " +
      "Rewrite so the answer is NOT revealed, stated, or confirmed anywhere:\n" +
      feedback.map((f, i) => (f ? `- Item ${i + 1}: ${f}` : null)).filter(Boolean).join("\n");
  }
  const user =
    `Subject: ${subject || "Unknown"}\nNumber of items: ${questions.length}\n\n${formatItems(questions)}` +
    `\n\nReturn exactly ${questions.length} entries, each with exactly 3 hints. Remember: NEVER give the answer.${extra}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await callJSON({ model: TUTOR_MODEL, system: TUTOR_SYSTEM, user, schema: TUTOR_SCHEMA, temperature: 0.5 });
    const items = out.items || [];
    if (items.length === questions.length && items.every(isValidItem)) return items.map(cleanItem);
  }
  throw new Error("Tutor model returned malformed guidance twice.");
}

async function reviewForLeaks(questions, items) {
  const payload = questions
    .map(
      (q, i) =>
        `ITEM ${i + 1} QUESTION:\n${q.text}\n\nGUIDANCE:\n` +
        items[i].explanation_steps.map((s, j) => `Step ${j + 1}: ${s}`).join("\n") +
        "\n" +
        items[i].hints.map((h, j) => `Hint ${j + 1}: ${h}`).join("\n")
    )
    .join("\n\n---\n\n");
  const out = await callJSON({
    model: GUARD_MODEL,
    system: GUARD_SYSTEM,
    temperature: 0,
    schema: GUARD_SCHEMA,
    user: `Review these ${questions.length} items and return exactly ${questions.length} verdicts.\n\n${payload}`,
  });
  const verdicts = out.verdicts || [];
  // If the reviewer miscounts, re-check each item individually rather than trusting a misaligned list.
  if (verdicts.length !== questions.length) {
    // Unverifiable single item: treat as leaking so it gets rewritten (or replaced by the safe fallback).
    if (questions.length === 1) return [{ leaks: true, reason: "Reviewer could not verify; rewrite conservatively." }];
    const single = await Promise.all(questions.map((q, i) => reviewForLeaks([q], [items[i]])));
    return single.map((v) => v[0]);
  }
  return verdicts;
}

function safeFallback(question) {
  return {
    summary_en: question.text.length > 160 ? question.text.slice(0, 157) + "..." : question.text,
    explanation_steps: [
      "Basahin po muna ninyo nang dahan-dahan ang tanong kasama ang inyong anak.",
      "Tanungin ang bata kung ano sa tingin niya ang hinihingi ng tanong, gamit ang sarili niyang salita.",
      "Balikan ang aralin o libro ng bata para sa bahaging may kinalaman sa tanong.",
    ],
    hints: [
      "Ano sa tingin mo ang hinihingi ng tanong na ito?",
      "May naaalala ka bang aralin o halimbawa sa klase na kahawig nito?",
      "Paano mo ipapaliwanag sa akin kung paano mo nakuha ang iyong sagot?",
    ],
  };
}

async function guardedGuidance(questions, subject) {
  let items = await generateGuidance(questions, subject);

  for (let round = 0; round <= MAX_LEAK_FIX_ROUNDS; round++) {
    const verdicts = await reviewForLeaks(questions, items);
    const leaking = verdicts.map((v, i) => (v.leaks ? i : -1)).filter((i) => i >= 0);
    if (leaking.length === 0) return items;

    console.warn(`[guard] round ${round}: answer leak in items ${leaking.map((i) => i + 1).join(", ")}`);
    if (round === MAX_LEAK_FIX_ROUNDS) {
      // Still leaking after all rewrites: never ship it.
      for (const i of leaking) items[i] = safeFallback(questions[i]);
      return items;
    }
    const subset = leaking.map((i) => questions[i]);
    const feedback = leaking.map((i) => verdicts[i].reason || "The answer was revealed.");
    const fixed = await generateGuidance(subset, subject, feedback);
    leaking.forEach((i, k) => (items[i] = fixed[k]));
  }
  return items;
}

function toMarkdown(items) {
  return items
    .map(
      (it) =>
        `### ${it.summary_en}\n` +
        `#### Paliwanag sa Tagalog\n` +
        it.explanation_steps.map((s, i) => `**Hakbang ${i + 1}:** ${s}`).join("\n\n") +
        `\n\n#### Mga Gabay na Tanong sa Bata\n` +
        it.hints.map((h, i) => `${i + 1}. ${h}`).join("\n") +
        `\n\n_Note: ${NO_ANSWER_NOTE}_`
    )
    .join("\n\n---\n\n");
}

// ---------- HTTP ----------

const app = express();
app.use(express.json({ limit: "20mb" }));
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), "public")));

app.post("/api/analyze", async (req, res) => {
  const image = req.body?.image;
  if (typeof image !== "string" || !/^data:image\/(jpeg|png|webp|gif);base64,/.test(image)) {
    return res.status(400).json({ status: "error", message: "Pakipili po ng larawan (JPG o PNG) ng homework." });
  }

  const started = Date.now();
  try {
    const ocr = await extractQuestions(image);
    const questions = (ocr.questions || []).filter((q) => q.text?.trim()).slice(0, MAX_QUESTIONS);

    if (!ocr.legible || questions.length === 0) {
      console.log(`[analyze] unclear: ${ocr.unclear_reason || "no questions found"}`);
      return res.json({ status: "unclear", message: UNCLEAR_MESSAGE });
    }

    const items = await guardedGuidance(questions, ocr.subject);
    console.log(`[analyze] ${items.length} items, ${ocr.subject}, ${((Date.now() - started) / 1000).toFixed(1)}s`);
    res.json({
      status: "ok",
      subject: ocr.subject,
      truncated: (ocr.questions || []).length > MAX_QUESTIONS,
      note: NO_ANSWER_NOTE,
      items,
      markdown: toMarkdown(items),
    });
  } catch (err) {
    console.error("[analyze] failed:", err.message);
    res.status(502).json({
      status: "error",
      message: "May problema po sa pagproseso. Pakisubukan po ulit pagkalipas ng ilang segundo.",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Gabay Aralin running at http://localhost:${PORT}`);
  console.log(`Models -> OCR: ${OCR_MODEL}, Tutor: ${TUTOR_MODEL}, Guard: ${GUARD_MODEL}`);
});
