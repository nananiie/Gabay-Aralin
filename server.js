import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SUBJECTS,
  NO_ANSWER_NOTE,
  UNCLEAR_MESSAGE,
  OCR_SYSTEM,
  OCR_SCHEMA,
  INTAKE_SYSTEM,
  INTAKE_SCHEMA,
  LESSON_SYSTEM,
  LESSON_SCHEMA,
  WORKSHEET_SYSTEM,
  WORKSHEET_SCHEMA,
  TIPS_SYSTEM,
  TIPS_SCHEMA,
  TUTOR_SYSTEM,
  TUTOR_SCHEMA,
  REVIEW_SYSTEM,
  REVIEW_SCHEMA,
  GUARD_SYSTEM,
  GUARD_SCHEMA,
} from "./prompts.js";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OCR_MODEL = process.env.OCR_MODEL || "gpt-4.1";
const TUTOR_MODEL = process.env.TUTOR_MODEL || "gpt-4.1";
const FAST_MODEL = process.env.FAST_MODEL || "gpt-4.1-mini";
const PORT = Number(process.env.PORT) || 3000;
const MAX_QUESTIONS = 20;
const MAX_TEXT_LENGTH = 6000;
const MAX_TOPIC_LENGTH = 200;
const GRADES = ["Kinder", ...Array.from({ length: 12 }, (_, i) => `Grade ${i + 1}`)];
const MAX_LEAK_FIX_ROUNDS = 2;
const LETTERS = "ABCDE";

if (!OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY. Put it in a .env file next to server.js.");
  process.exit(1);
}

const filled = (s) => typeof s === "string" && s.trim().length > 0;
const norm = (s) => String(s).toLowerCase().replace(/\s+/g, " ").trim();
const strings = (list, max) => (Array.isArray(list) ? list.filter(filled).map((s) => s.trim()).slice(0, max) : []);

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

// ---------- Intake: homework (photo or typed) or a self-study topic ----------

async function extractQuestions({ image, text }) {
  const user = image
    ? [
        { type: "text", text: "Transcribe and categorize the homework questions in this photo. Do not answer them." },
        { type: "image_url", image_url: { url: image, detail: "high" } },
      ]
    : "A parent typed the homework below. Split it into items and categorize them. Do not answer them.\n\n" +
      `<<<HOMEWORK\n${text}\nHOMEWORK>>>`;
  return callJSON({ model: OCR_MODEL, system: OCR_SYSTEM, temperature: 0, schema: OCR_SCHEMA, user });
}

async function homeworkContext(input, grade) {
  const ocr = await extractQuestions(input);
  const questions = (ocr.questions || []).filter((q) => filled(q.text)).slice(0, MAX_QUESTIONS);
  if (!ocr.legible || questions.length === 0) {
    console.log(`[module] unclear homework: ${ocr.unclear_reason || "no questions found"}`);
    return { unclear: input.image ? UNCLEAR_MESSAGE : "That doesn't look like a homework question. Please check the text and try again." };
  }
  // Ordered by how many items belong to each subject, so the main subject comes first.
  const counts = {};
  for (const q of questions) counts[q.subject] = (counts[q.subject] || 0) + 1;
  const subjects = SUBJECTS.filter((s) => counts[s]).sort((a, b) => counts[b] - counts[a]);
  const category = SUBJECTS.includes(ocr.category) ? ocr.category : subjects[0] || "Other";
  const topic = ocr.topic?.trim() || category;
  const skills = strings(ocr.skills, 4);
  return {
    mode: input.image ? "photo" : "text",
    title: ocr.title?.trim() || topic,
    category,
    topic,
    skills: skills.length ? skills : [topic],
    grade,
    questions,
    subjects: subjects.includes(category) ? subjects : [category, ...subjects],
    itemSubjects: questions.map((q) => q.subject),
    truncated: (ocr.questions || []).length > MAX_QUESTIONS,
  };
}

async function topicContext(topic, grade) {
  const intake = await callJSON({
    model: FAST_MODEL,
    system: INTAKE_SYSTEM,
    temperature: 0,
    schema: INTAKE_SCHEMA,
    user: `Child's grade level: ${grade || "Not specified"}\n\n<<<TOPIC\n${topic}\nTOPIC>>>`,
  });
  if (!intake.is_learning_topic) {
    console.log(`[module] not a learning topic: ${intake.reason}`);
    return { unclear: 'Let\'s pick a school topic to learn! Try something like "adding fractions", "nouns and verbs", or "parts of a plant".' };
  }
  const category = SUBJECTS.includes(intake.category) ? intake.category : "Other";
  const name = intake.topic?.trim() || topic;
  const skills = strings(intake.skills, 4);
  return {
    mode: "topic",
    title: intake.title?.trim() || name,
    category,
    topic: name,
    skills: skills.length ? skills : [name],
    grade,
    questions: [],
    subjects: [category],
    itemSubjects: [],
    truncated: false,
  };
}

function formatItems(questions) {
  return questions.map((q, i) => `ITEM ${i + 1}${q.number ? ` (labeled "${q.number}")` : ""}:\n${q.text}`).join("\n\n");
}

// What the lesson, worksheet and tips generators get: subject, topic, grade and skills — never the
// homework items themselves, so they cannot solve or copy the child's homework.
function brief(ctx) {
  return [
    `Subject: ${ctx.category}`,
    `Topic: ${ctx.topic}`,
    `Child's grade level: ${ctx.grade || "Not specified"}`,
    `Skills to teach:\n${ctx.skills.map((s) => `- ${s}`).join("\n")}`,
    ctx.questions.length ? "This prepares the child for a homework assignment." : "This is self-paced study (no homework).",
  ].join("\n");
}

const withFeedback = (text, feedback) =>
  feedback ? `${text}\n\nIMPORTANT — fix these problems from a previous draft:\n${feedback}` : text;

// ---------- Quality check: answer keys + homework copies ----------

const cleanId = (id) => String(id ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();

function describeQuestion(q) {
  const lines = [`[${q.id}] (${q.type}) ${q.question}`];
  if (q.type === "multiple_choice") {
    lines.push(`   Options: ${q.options.map((o, i) => `${LETTERS[i]}) ${o}`).join("   ")}`);
    lines.push(`   Answer key: ${LETTERS[q.answer_index]}) ${q.options[q.answer_index]}`);
  } else {
    const also = q.accepted_answers?.length > 1 ? ` (also accepted: ${q.accepted_answers.slice(1).join(", ")})` : "";
    lines.push(`   Answer key: ${q.answer}${also}`);
  }
  lines.push(q.hint_1 ? `   Hint 1: ${q.hint_1}\n   Hint 2: ${q.hint_2}` : "   Hints: none");
  return lines.join("\n");
}

// Reviewers sometimes write "None" instead of leaving a field empty.
const saysSomething = (s) => filled(s) && !/^(none|n\/a|no|nothing|-)\.?$/i.test(s.trim());

// Code-level backstop for hints: catches a hint that literally contains the answer word or phrase.
function revealsAnswer(text, answers) {
  // Keeps fractions (3/5) and decimals (0.5) whole; drops other punctuation, including sentence periods.
  const words = (s) => norm(s).replace(/[^a-z0-9/.]+/g, " ").replace(/\.(?!\d)/g, " ").replace(/\s+/g, " ").trim();
  const hay = ` ${words(text)} `;
  return answers.some((a) => {
    const needle = words(a);
    return needle.length >= 2 && hay.includes(` ${needle} `);
  });
}

const GENERIC_HINTS = [
  "Look back at the example above. What did we do there?",
  "Read the question again slowly. What is it asking you to find?",
];

// Replace hints that give the answer away, and accept other correct ways of typing the answer.
function polishPractice(p, check) {
  const answers = p.type === "multiple_choice" ? [p.options[p.answer_index]] : p.accepted_answers;
  for (const k of [1, 2]) {
    const flagged = check?.hint_problem === `hint_${k}` || check?.hint_problem === "both" || revealsAnswer(p[`hint_${k}`], answers);
    if (!flagged) continue;
    const safe = check?.[`safe_hint_${k}`];
    p[`hint_${k}`] = filled(safe) && !revealsAnswer(safe, answers) ? safe.trim() : GENERIC_HINTS[k - 1];
  }
  if (p.type === "fill_blank") {
    const extra = strings(check?.also_accept, 6).filter((a) => a.length <= 60);
    p.accepted_answers = [...new Set([...p.accepted_answers, ...extra])];
  }
}

async function reviewContent(ctx, questions, steps) {
  const user = [
    `Child's grade level: ${ctx.grade || "Not specified"}`,
    `Topic: ${ctx.category} - ${ctx.topic}`,
    `HOMEWORK ITEMS:\n${ctx.questions.length ? formatItems(ctx.questions) : "None"}`,
    `QUESTIONS TO CHECK (${questions.length}):\n${questions.map(describeQuestion).join("\n\n") || "None"}`,
    `LESSON STEPS TO CHECK (${steps.length}):\n${steps.map((s) => `[${s.id}] ${s.text}`).join("\n\n") || "None"}`,
    `Return exactly ${questions.length} question checks and ${steps.length} step checks, using the ids above.`,
  ].join("\n\n");

  let checks = { q: new Map(), s: new Map() };
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await callJSON({ model: TUTOR_MODEL, system: REVIEW_SYSTEM, user, schema: REVIEW_SCHEMA, temperature: 0 });
    checks = {
      q: new Map((out.question_checks || []).map((c) => [cleanId(c.id), c])),
      s: new Map((out.step_checks || []).map((c) => [cleanId(c.id), c])),
    };
    if (questions.every((x) => checks.q.has(cleanId(x.id))) && steps.every((x) => checks.s.has(cleanId(x.id)))) break;
  }
  // Anything the reviewer skipped counts as unverified and fails: better to drop a question than show a wrong key.
  return {
    question: (id) => checks.q.get(cleanId(id)),
    passes: (id) => {
      const c = checks.q.get(cleanId(id));
      return !!c && c.key_ok === true && c.copies_homework !== true && !saysSomething(c.other_correct_options);
    },
    why: (id) => {
      const c = checks.q.get(cleanId(id));
      if (!c) return "not verified";
      if (c.copies_homework) return "too close to homework";
      return [c.reason, saysSomething(c.other_correct_options) ? `also correct: ${c.other_correct_options}` : ""].filter(filled).join("; ") || "key not confirmed";
    },
    leaks: (id) => {
      const c = checks.s.get(cleanId(id));
      return !c || c.leaks === true;
    },
  };
}

// ---------- Pillars 1 + 2: lesson guide with practice questions ----------

function cleanOptions(q) {
  const options = Array.isArray(q.options) ? q.options.map((o) => String(o).trim()) : [];
  const ok =
    options.length >= 2 && options.length <= 5 && options.every(Boolean) &&
    new Set(options.map(norm)).size === options.length &&
    Number.isInteger(q.answer_index) && q.answer_index >= 0 && q.answer_index < options.length;
  return ok ? options : null;
}

function cleanPractice(p) {
  if (!p || ![p.question, p.hint_1, p.hint_2, p.explanation].every(filled)) return null;
  const base = { type: p.type, question: p.question.trim(), hint_1: p.hint_1.trim(), hint_2: p.hint_2.trim(), explanation: p.explanation.trim() };
  if (p.type === "multiple_choice") {
    const options = cleanOptions(p);
    return options ? { ...base, options, answer_index: p.answer_index, accepted_answers: [] } : null;
  }
  if (p.type === "fill_blank") {
    const accepted = [...new Set(strings(p.accepted_answers, 8).filter((a) => a.length <= 60))];
    return accepted.length ? { ...base, options: [], answer_index: -1, accepted_answers: accepted } : null;
  }
  return null;
}

function cleanLesson(l) {
  if (!l || !filled(l.intro) || !filled(l.wrap_up) || !Array.isArray(l.steps)) return null;
  const steps = l.steps
    .filter((s) => s && [s.title, s.explanation, s.example, s.parent_note].every(filled))
    .map((s) => ({
      title: s.title.trim(),
      explanation: s.explanation.trim(),
      example: s.example.trim(),
      parent_note: s.parent_note.trim(),
      practice: cleanPractice(s.practice),
    }));
  if (steps.length !== l.steps.length || steps.length < 3 || steps.length > 6) return null;
  return { intro: l.intro.trim(), steps, wrap_up: l.wrap_up.trim() };
}

async function generateLesson(ctx, feedback = "") {
  const user = withFeedback(`${brief(ctx)}\n\nWrite the lesson.`, feedback);
  let fallback = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const lesson = cleanLesson(await callJSON({ model: TUTOR_MODEL, system: LESSON_SYSTEM, user, schema: LESSON_SCHEMA, temperature: 0.6 }));
    if (lesson?.steps.every((s) => s.practice)) return lesson;
    fallback ||= lesson;
  }
  if (fallback) return fallback;
  throw new Error("Lesson generator returned an unusable lesson twice.");
}

// Regeneration feedback never quotes the homework, so the generator still never sees it.
function lessonFeedback(review, leakySteps, badPractice) {
  return [
    ...leakySteps.map((s) => `- Step ${s.id.slice(1)} is too close to the child's homework. Use a completely different example with different numbers and words.`),
    ...badPractice.map((p) => {
      const c = review.question(p.id);
      return c?.copies_homework
        ? `- The step ${p.id.slice(1)} quick check is too close to the child's homework. Use different numbers and words.`
        : `- The step ${p.id.slice(1)} quick check had a wrong or unclear answer key${c?.reason ? ` (${c.reason})` : ""}. Write a clearer question with exactly one correct answer.`;
    }),
  ].join("\n");
}

async function guardedLesson(ctx) {
  let lesson = await generateLesson(ctx);
  for (let round = 0; round < 2; round++) {
    const practice = lesson.steps.flatMap((s, i) => (s.practice ? [{ id: `P${i + 1}`, ...s.practice, answer: s.practice.accepted_answers[0] }] : []));
    const steps = ctx.questions.length
      ? lesson.steps.map((s, i) => ({ id: `S${i + 1}`, text: `${s.title}: ${s.explanation} Example: ${s.example}` }))
      : [];
    const review = await reviewContent(ctx, practice, steps);
    const badPractice = practice.filter((p) => !review.passes(p.id));
    const leakySteps = steps.filter((s) => review.leaks(s.id));

    if (round === 0 && (leakySteps.length || badPractice.length > practice.length / 2)) {
      console.warn(`[review] lesson: ${leakySteps.length} steps too close to homework, ${badPractice.length}/${practice.length} quick checks failed; regenerating`);
      lesson = await generateLesson(ctx, lessonFeedback(review, leakySteps, badPractice));
      continue;
    }
    // Drop whatever still fails: a step without a quick check is better than a wrong answer key.
    for (const p of practice) {
      const step = lesson.steps[Number(p.id.slice(1)) - 1];
      if (review.passes(p.id)) polishPractice(step.practice, review.question(p.id));
      else {
        console.warn(`[review] lesson: dropped quick check ${p.id} (${review.why(p.id)})`);
        step.practice = null;
      }
    }
    const leaky = new Set(leakySteps.map((s) => Number(s.id.slice(1)) - 1));
    if (leaky.size) console.warn(`[review] lesson: dropped ${leaky.size} steps too close to homework`);
    lesson.steps = lesson.steps.filter((_, i) => !leaky.has(i));
    return lesson.steps.length ? lesson : null;
  }
  return null;
}

// ---------- Pillar 3: end-of-module worksheet ----------

function cleanWorksheetQuestion(q) {
  if (!q || !filled(q.question) || !filled(q.explanation)) return null;
  const base = { type: q.type, question: q.question.trim(), explanation: q.explanation.trim() };
  if (q.type === "multiple_choice") {
    const options = cleanOptions(q);
    return options ? { ...base, options, answer_index: q.answer_index, answer: options[q.answer_index] } : null;
  }
  if ((q.type === "fill_blank" || q.type === "short_answer") && filled(q.answer)) {
    return { ...base, options: [], answer_index: -1, answer: q.answer.trim() };
  }
  return null;
}

function cleanWorksheet(w) {
  if (!w || !filled(w.title) || !filled(w.instructions) || !Array.isArray(w.questions)) return null;
  const questions = w.questions.map(cleanWorksheetQuestion).filter(Boolean).slice(0, 10);
  return questions.length >= 5 ? { title: w.title.trim(), instructions: w.instructions.trim(), questions } : null;
}

async function generateWorksheet(ctx, feedback = "") {
  const user = withFeedback(`${brief(ctx)}\n\nWrite the end-of-module worksheet.`, feedback);
  for (let attempt = 0; attempt < 2; attempt++) {
    const ws = cleanWorksheet(await callJSON({ model: TUTOR_MODEL, system: WORKSHEET_SYSTEM, user, schema: WORKSHEET_SCHEMA, temperature: 0.6 }));
    if (ws) return ws;
  }
  throw new Error("Worksheet generator returned an unusable worksheet twice.");
}

async function guardedWorksheet(ctx) {
  let ws = await generateWorksheet(ctx);
  for (let round = 0; round < 2; round++) {
    const qs = ws.questions.map((q, i) => ({ id: `W${i + 1}`, ...q }));
    const review = await reviewContent(ctx, qs, []);
    const bad = qs.filter((q) => !review.passes(q.id));
    const keep = ws.questions.filter((_, i) => review.passes(`W${i + 1}`));
    for (const q of bad) console.warn(`[review] worksheet: dropped ${q.id} (${review.why(q.id)})`);
    if (keep.length >= 5 || round === 1) return keep.length >= 3 ? { ...ws, questions: keep } : null;
    console.warn(`[review] worksheet: only ${keep.length} questions passed; regenerating`);
    const feedback = bad
      .map((q) => {
        const c = review.question(q.id);
        return c?.copies_homework
          ? "- A question was too close to the child's homework. Use different numbers and words."
          : `- "${q.question}" had a wrong or unclear answer key${c?.reason ? ` (${c.reason})` : ""}.`;
      })
      .join("\n");
    ws = await generateWorksheet(ctx, feedback);
  }
  return null;
}

// ---------- Pillar 4: co-learning and parent study tips ----------

function cleanTips(t) {
  if (!t) return null;
  const guide_tips = (Array.isArray(t.guide_tips) ? t.guide_tips : [])
    .filter((g) => g && filled(g.title) && filled(g.tip))
    .slice(0, 5)
    .map((g) => ({ title: g.title.trim(), tip: g.tip.trim() }));
  const schedule = (Array.isArray(t.schedule) ? t.schedule : [])
    .filter((d) => d && filled(d.day) && filled(d.activity) && Number.isInteger(d.minutes) && d.minutes > 0)
    .slice(0, 7)
    .map((d) => ({ day: d.day.trim(), activity: d.activity.trim(), minutes: Math.min(d.minutes, 60) }));
  const tips = {
    guide_tips,
    tricky_parts: strings(t.tricky_parts, 4),
    memory_tricks: strings(t.memory_tricks, 4),
    study_hacks: strings(t.study_hacks, 4),
    schedule,
  };
  return guide_tips.length && tips.memory_tricks.length && tips.study_hacks.length && schedule.length ? tips : null;
}

async function generateTips(ctx) {
  const user = `${brief(ctx)}\n\nWrite the parent tips.`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const tips = cleanTips(await callJSON({ model: FAST_MODEL, system: TIPS_SYSTEM, user, schema: TIPS_SCHEMA, temperature: 0.6 }));
    if (tips) return tips;
  }
  throw new Error("Tips generator returned unusable tips twice.");
}

// ---------- Homework help: guiding questions per homework item (never the answer) ----------

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

async function generateGuidance(questions, subject, grade, feedback = []) {
  let extra = "";
  if (feedback.some(Boolean)) {
    extra =
      "\n\nIMPORTANT — a reviewer found that a previous draft REVEALED THE ANSWER for some items. " +
      "Rewrite so the answer is NOT revealed, stated, or confirmed anywhere:\n" +
      feedback.map((f, i) => (f ? `- Item ${i + 1}: ${f}` : null)).filter(Boolean).join("\n");
  }
  const user =
    `Subject: ${subject || "Unknown"}\nChild's grade level: ${grade || "Not specified"}\n` +
    `Number of items: ${questions.length}\n\n${formatItems(questions)}` +
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
    model: FAST_MODEL,
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
      "Read the question slowly together with your child.",
      "Ask your child to tell you, in their own words, what the question is asking for.",
      "Look back at your child's notes or textbook for the lesson this question comes from.",
    ],
    hints: [
      "What do you think this question is asking you to do?",
      "Do you remember a lesson or example from class that looks like this?",
      "Can you explain to me how you got your answer?",
    ],
  };
}

async function guardedGuidance(questions, subject, grade) {
  let items = await generateGuidance(questions, subject, grade);

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
    const fixed = await generateGuidance(subset, subject, grade, feedback);
    leaking.forEach((i, k) => (items[i] = fixed[k]));
  }
  return items;
}

// ---------- Markdown export ----------

const practiceAnswer = (p) =>
  p.type === "multiple_choice" ? `${LETTERS[p.answer_index]}) ${p.options[p.answer_index]}` : p.accepted_answers[0];
const bullets = (list) => list.map((x) => `- ${x}`).join("\n");

function toMarkdown(m) {
  const out = [`# ${m.title}`, `_${[m.category, m.topic, m.grade].filter(Boolean).join(" · ")}_`];
  if (m.lesson) {
    out.push("## 📖 Lesson", m.lesson.intro);
    m.lesson.steps.forEach((s, i) => {
      out.push(`### Step ${i + 1}: ${s.title}`, s.explanation, `**Example:** ${s.example}`, `> **For grown-ups:** ${s.parent_note}`);
      if (s.practice) {
        const opts = s.practice.options.map((o, j) => `- ${LETTERS[j]}) ${o}`).join("\n");
        out.push(`**Quick check:** ${s.practice.question}${opts ? `\n${opts}` : ""}`);
      }
    });
    out.push(`**🏆 ${m.lesson.wrap_up}**`);
  }
  if (m.homework?.length) {
    out.push("## ✏️ Homework Help", `_${NO_ANSWER_NOTE}_`);
    for (const it of m.homework) {
      out.push(
        `### ${it.summary_en}`,
        `**Explanation (for grown-ups):**\n${it.explanation_steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
        `**Guiding questions:**\n${bullets(it.hints)}`
      );
    }
  }
  if (m.worksheet) {
    out.push(`## 📝 Worksheet: ${m.worksheet.title}`, m.worksheet.instructions, "Name: ______________   Date: __________");
    m.worksheet.questions.forEach((q, i) => {
      const opts = q.options.map((o, j) => `   ${LETTERS[j]}) ${o}`).join("\n");
      const lines = q.type === "short_answer" ? "\n   ________________________________" : "";
      out.push(`${i + 1}. ${q.question}${opts ? `\n${opts}` : ""}${lines}`);
    });
  }
  if (m.tips) {
    const t = m.tips;
    out.push(
      "## 👪 Parent Tips",
      `**How to guide:**\n${t.guide_tips.map((g) => `- **${g.title}:** ${g.tip}`).join("\n")}`,
      t.tricky_parts.length ? `**Watch out for:**\n${bullets(t.tricky_parts)}` : "",
      `**Memory tricks:**\n${bullets(t.memory_tricks)}`,
      `**Study hacks:**\n${bullets(t.study_hacks)}`,
      `**Practice schedule:**\n${t.schedule.map((d) => `- ${d.day} (${d.minutes} min): ${d.activity}`).join("\n")}`
    );
  }
  // The answer key goes last, so everything above it can be shared with the child.
  const key = [
    ...(m.lesson?.steps || []).flatMap((s, i) => (s.practice ? [`- Quick check ${i + 1}: ${practiceAnswer(s.practice)}. ${s.practice.explanation}`] : [])),
    ...(m.worksheet?.questions || []).map(
      (q, i) => `- Worksheet ${i + 1}: ${q.type === "multiple_choice" ? `${LETTERS[q.answer_index]}) ` : ""}${q.answer}. ${q.explanation}`
    ),
  ];
  if (key.length) out.push("## 🔑 Answer Key (for grown-ups)", key.join("\n"));
  return out.filter(Boolean).join("\n\n");
}

// ---------- HTTP ----------

const app = express();
app.use(express.json({ limit: "20mb" }));
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), "public")));

app.post("/api/module", async (req, res) => {
  const { image, text, topic } = req.body || {};
  const grade = GRADES.includes(req.body?.grade) ? req.body.grade : "";
  const hasImage = typeof image === "string" && /^data:image\/(jpeg|png|webp|gif);base64,/.test(image);
  const hasText = !hasImage && filled(text);
  const hasTopic = !hasImage && !hasText && filled(topic);
  if (!hasImage && !hasText && !hasTopic) {
    return res.status(400).json({ status: "error", message: "Please add a homework photo, type the homework, or enter a topic to learn." });
  }
  if (hasText && text.length > MAX_TEXT_LENGTH) {
    return res.status(400).json({ status: "error", message: `Please keep typed homework under ${MAX_TEXT_LENGTH} characters.` });
  }
  if (hasTopic && topic.length > MAX_TOPIC_LENGTH) {
    return res.status(400).json({ status: "error", message: `Please keep the topic under ${MAX_TOPIC_LENGTH} characters.` });
  }

  const started = Date.now();
  try {
    const ctx = hasTopic
      ? await topicContext(topic.trim(), grade)
      : await homeworkContext(hasImage ? { image } : { text: text.trim() }, grade);
    if (ctx.unclear) return res.json({ status: "unclear", message: ctx.unclear });

    // The four pillars are generated in parallel. Each fails soft, so one bad section never blocks the others.
    const soft = (label, promise) =>
      promise.catch((err) => {
        console.error(`[${label}] failed:`, err.message);
        return null;
      });
    const [lesson, worksheet, tips, homework] = await Promise.all([
      soft("lesson", guardedLesson(ctx)),
      soft("worksheet", guardedWorksheet(ctx)),
      soft("tips", generateTips(ctx)),
      ctx.questions.length ? soft("homework", guardedGuidance(ctx.questions, `${ctx.category} - ${ctx.topic}`, grade)) : null,
    ]);
    if (!lesson && !worksheet && !homework) throw new Error("No lesson, worksheet or homework help could be generated.");

    const module = {
      mode: ctx.mode,
      title: ctx.title,
      category: ctx.category,
      topic: ctx.topic,
      subjects: ctx.subjects,
      itemSubjects: ctx.itemSubjects,
      skills: ctx.skills,
      grade,
      truncated: ctx.truncated,
      lesson,
      worksheet,
      tips,
      homework,
    };
    console.log(
      `[module] ${ctx.mode}: ${ctx.category} / ${ctx.topic}, ${grade || "no grade"} | ` +
        `lesson ${lesson ? `${lesson.steps.length} steps, ${lesson.steps.filter((s) => s.practice).length} checks` : "none"} | ` +
        `worksheet ${worksheet ? worksheet.questions.length : "none"} | tips ${tips ? "yes" : "none"} | ` +
        `homework ${homework ? homework.length : "-"} | ${((Date.now() - started) / 1000).toFixed(1)}s`
    );
    res.json({ status: "ok", ...module, markdown: toMarkdown(module) });
  } catch (err) {
    console.error("[module] failed:", err.message);
    res.status(502).json({
      status: "error",
      message: "Something went wrong while building the lesson. Please try again in a few seconds.",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Gabay Aralin running at http://localhost:${PORT}`);
  console.log(`Models -> OCR: ${OCR_MODEL}, Tutor: ${TUTOR_MODEL}, Fast: ${FAST_MODEL}`);
});
