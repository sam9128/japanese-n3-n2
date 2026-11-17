import { appendFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { senseTranslationJobs } from "./sense-translation-jobs.mjs";

const output = process.argv[2];
const useBing = process.argv.includes("--bing");
if (!output) throw new Error("請指定機翻核對資料的 JSONL 輸出路徑");
const jobs = [];
for await (const line of createInterface({ input: process.stdin })) {
  const row = JSON.parse(line);
  jobs.push(...senseTranslationJobs(row));
}
if (!jobs.length) throw new Error("沒有收到教材核對資料");
const digest = (job) => createHash("sha256")
  .update(JSON.stringify([job.id, job.sourceLanguage, job.sourceText, job.sourceEntry]))
  .digest("hex");
const cached = new Map();
if (existsSync(output)) {
  for (const line of readFileSync(output, "utf8").split(/\r?\n/).filter(Boolean)) {
    const row = JSON.parse(line);
    cached.set(row.id, row);
  }
}
mkdirSync(dirname(output), { recursive: true });
const batches = [];
for (const language of ["ja", "en"]) {
  let batch = [];
  let size = 0;
  for (const job of jobs.filter((row) => row.sourceLanguage === language)) {
    if (cached.get(job.id)?.sourceHash === digest(job)) continue;
    const length = job.sourceText.length + job.id.length + 4;
    if (batch.length && (batch.length >= 30 || size + length > (useBing ? 900 : 4000))) {
      batches.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(job);
    size += length;
  }
  if (batch.length) batches.push(batch);
}
let browser;
let page;
if (useBing && batches.length) {
  const { chromium } = await import("playwright-core");
  browser = await chromium.launch({ channel: "msedge", headless: true });
  page = await browser.newPage();
}
async function translate(batch, attempt = 0) {
  try {
    let text;
    if (useBing) {
      const input = batch.map((row, index) =>
        `ZXQ${String(index + 1).padStart(6, "0")} ${row.sourceText.replace(/\s+/g, " ")}`
      ).join("\n");
      const url = new URL("https://www.bing.com/translator");
      url.search = new URLSearchParams({ from: batch[0].sourceLanguage, to: "zh-Hant", text: input });
      const response = await page.goto(url.href, { waitUntil: "networkidle", timeout: 30000 });
      if (!response.ok()) throw new Error(`Bing HTTP ${response.status()}`);
      const actualInput = await page.locator("#tta_input_ta").innerText();
      if (actualInput.replace(/\s+/g, " ").trim() !== input.replace(/\s+/g, " ").trim()) {
        throw new Error("Bing 原文截斷或不符");
      }
      await page.locator("#tta_output_ta").filter({ hasText: "ZXQ" }).waitFor({ timeout: 15000 });
      text = (await page.locator("#tta_output_ta").innerText())
        .replace(/ZXQ(\d{6})/g, "[$1]");
    } else {
    const body = new URLSearchParams({
      client: "gtx", sl: batch[0].sourceLanguage, tl: "zh-TW", dt: "t",
      q: batch.map((row, index) =>
        `[${String(index + 1).padStart(6, "0")}] ${row.sourceText.replace(/\s+/g, " ")}`
      ).join("\n"),
    });
    const response = await fetch("https://translate.googleapis.com/translate_a/single", {
      method: "POST", body, signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const error = new Error(`翻譯 HTTP ${response.status}`);
      error.retryAfterMs = response.status === 429
        ? Math.max(60000, Number(response.headers.get("retry-after")) * 1000 || 0)
        : 0;
      throw error;
    }
    const payload = await response.json();
    text = payload[0].map((part) => part[0]).join("");
    }
    const matches = [...text.matchAll(/\[(\d{6})\]\s*([^]*?)(?=\[\d{6}\]|$)/g)];
    const translated = new Map(
      matches
        .map((match) => [match[1], match[2].trim()]),
    );
    if (matches.length !== batch.length || translated.size !== batch.length ||
        batch.some((row, index) => !translated.get(String(index + 1).padStart(6, "0")))) {
      if (batch.length === 1) throw new Error("譯文識別碼缺失或重複");
      const middle = Math.ceil(batch.length / 2);
      return [...await translate(batch.slice(0, middle)), ...await translate(batch.slice(middle))];
    }
    return batch.map((job, index) => ({
      ...job, sourceHash: digest(job),
      translatedZh: translated.get(String(index + 1).padStart(6, "0")),
      provider: useBing ? "Microsoft Bing Translator" : "Google Translate", targetLanguage: "zh-TW",
      translatedAt: new Date().toISOString(), reviewStatus: "machine-unreviewed",
    }));
  } catch (error) {
    if (attempt >= 2) throw error;
    const delay = error.retryAfterMs || 1500 * (attempt + 1);
    console.log(JSON.stringify({ retry: attempt + 1, delayMs: delay, error: error.message }));
    await new Promise((resolve) => setTimeout(resolve, delay));
    return translate(batch, attempt + 1);
  }
}
let completed = 0;
async function worker() {
  while (batches.length) {
    const batch = batches.shift();
    const results = await translate(batch);
    appendFileSync(output, results.map((row) => JSON.stringify(row)).join("\n") + "\n");
    results.forEach((row) => cached.set(row.id, row));
    completed += results.length;
    console.log(JSON.stringify({ translatedNow: completed, remainingBatches: batches.length }));
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}
try {
  await worker();
} finally {
  await browser?.close();
}
const missing = jobs.filter((job) => cached.get(job.id)?.sourceHash !== digest(job));
if (missing.length) throw new Error(`仍缺 ${missing.length} 筆譯文`);
console.log(JSON.stringify({ complete: true, rows: jobs.length, translatedNow: completed }));
