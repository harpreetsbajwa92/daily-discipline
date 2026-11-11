/**
 * Lying leg raises replace prescribed hanging leg raises.
 * How-to and Targets lines are display-only. Live bin is read-only.
 * Run: node test/lying-leg-raise.mjs
 */
import { createRequire } from "module";
import http from "http";
import fs from "fs";
import path from "path";

const require = createRequire("/tmp/pw/node_modules/playwright/package.json");
const { chromium, devices } = require("playwright");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ART = "/opt/cursor/artifacts";
const PORT = 8769;
const LIVE = "https://api.npoint.io/84f3d4b3816e2dc69b41";

function getJson(url) {
  return new Promise((resolve, reject) => {
    require("https").get(url, { headers: { "User-Agent": "daily-discipline-test", "Accept": "application/json" } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => res.statusCode === 200 ? resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))) : reject(new Error("HTTP " + res.statusCode)));
    }).on("error", reject);
  });
}
function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
      const file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
      if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end("no"); return; }
        const ext = path.extname(file);
        res.writeHead(200, { "Content-Type": ext === ".html" ? "text/html" : ext === ".json" ? "application/json" : "application/octet-stream", "Cache-Control": "no-store" });
        res.end(data);
      });
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

const hanging = { s: [[null, "12"], [null, "12"]], d: true };
const seedWo = JSON.stringify({ plan: "pull", done: false, ex: { "hanging-leg-raises": hanging, "lat-pulldown": { s: [["40", "8"]], d: true } } });

async function main() {
  fs.mkdirSync(ART, { recursive: true });
  const server = await serve();
  const posts = [];
  const mealsToday = JSON.stringify({ v: 2, meals: [{ id: "keep", items: [] }] });
  const mockBin = JSON.stringify({ _rev: 1, "nn-v1:wo:2026-11-11": { t: 1, v: seedWo }, "nn-v1:meals:2026-11-11": { t: 1, v: mealsToday } });
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext({ ...devices["iPhone 13"] });
  await context.route("https://api.npoint.io/**", async (route) => {
    if (route.request().method() === "POST") { posts.push(1); await route.abort(); return; }
    await route.fulfill({ status: 200, contentType: "application/json", body: mockBin });
  });
  await context.addInitScript((raw) => {
    if (sessionStorage.getItem("nn-llr")) return;
    localStorage.setItem("nn-v1:wo:2026-11-11", raw);
    localStorage.setItem("nn-v1:meals:2026-11-11", JSON.stringify({ v: 2, meals: [{ id: "keep", items: [] }] }));
    sessionStorage.setItem("nn-llr", "1");
  }, seedWo);
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:" + PORT + "/index.html#workout", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__nn && document.getElementById("woRoster"));
  const lists = await page.evaluate(() => ({
    push: window.__nn.exIds("push"), pull: window.__nn.exIds("pull"), legs: window.__nn.exIds("legs"),
    upper: window.__nn.exIds("upper"), lower: window.__nn.exIds("lower"), active: window.__nn.exIds("active")
  }));
  for (const p of ["pull", "upper", "lower"]) {
    if (lists[p][lists[p].indexOf("bodyweight-crunch") - 1] !== "lying-leg-raise") throw new Error(p + " lying leg raise is not in the hanging-leg-raise slot");
    if (lists[p].includes("hanging-leg-raises")) throw new Error(p + " still prescribes hanging leg raises");
  }
  for (const p of ["push", "legs", "active"]) {
    if (lists[p].includes("lying-leg-raise") || lists[p].includes("hanging-leg-raises")) throw new Error(p + " roster changed");
  }
  const cues = await page.evaluate(() => {
    const missing = [];
    ["push", "pull", "legs", "upper", "lower", "active"].forEach((p) => {
      window.__nn.exIds(p).forEach((id) => {
        document.querySelector('.pchip[data-p="' + p + '"]').click();
      });
    });
    return missing;
  });
  for (const p of ["push", "pull", "legs", "upper", "lower", "active"]) {
    await page.locator('.pchip[data-p="' + p + '"]').click();
    await page.waitForFunction((id) => document.getElementById("dSub").dataset.viewing === id, p);
    const gap = await page.evaluate((pid) => {
      const ids = window.__nn.exIds(pid);
      const bad = [];
      ids.forEach((id) => {
        const cue = document.querySelector('#woRoster .how[data-cue="' + id + '"]');
        const tgt = document.querySelector('#woRoster .tgt[data-tgt="' + id + '"]');
        if (!cue || !cue.textContent.trim()) bad.push(id + " cue");
        if (!tgt || !/^Targets: /.test(tgt.textContent)) bad.push(id + " targets");
      });
      const store = JSON.stringify(localStorage);
      const leaked = /Targets: Abs|Press your lower back/.test(store);
      return { bad, leaked, n: ids.length };
    }, p);
    if (gap.bad.length) throw new Error(p + " missing lines: " + gap.bad.join(", "));
    if (gap.leaked) throw new Error("cue or targets were written into storage");
    if (!cues) throw new Error("unused");
  }
  await page.evaluate(() => window.__nn.setW("2026-11-11"));
  await page.locator('.pchip[data-p="pull"]').click();
  await page.waitForFunction(() => document.getElementById("dSub").dataset.viewing === "pull");
  await page.waitForSelector("#woRoster .exc[data-id='lying-leg-raise']");
  const card = await page.evaluate(() => {
    const el = document.querySelector("#woRoster input[data-id='lying-leg-raise'][data-s='0']");
    const w = window.__nn.loadWo("2026-11-11");
    return {
      value: el.value,
      ph: el.placeholder,
      fields: [...document.querySelector("#woRoster .exc[data-id='lying-leg-raise']").querySelectorAll("input")].map((i) => i.dataset.f),
      hangingOnScreen: !!document.querySelector("#woRoster [data-id='hanging-leg-raises']"),
      hanging: w.ex["hanging-leg-raises"],
      lying: w.ex["lying-leg-raise"] || null,
      how: document.querySelector('#woRoster .how[data-cue="lying-leg-raise"]').textContent,
      tgt: document.querySelector('#woRoster .tgt[data-tgt="lying-leg-raise"]').textContent,
      done: document.querySelector("#woRoster .exc[data-id='lying-leg-raise']").classList.contains("done")
    };
  });
  if (card.value !== "" || card.ph !== "12-20") throw new Error("lying boxes inherited hanging reps: " + JSON.stringify(card));
  if (card.fields.join(",") !== "1,1,1") throw new Error("expected 3 rep-only boxes");
  if (card.hangingOnScreen) throw new Error("hanging leg raises drawn on the pull list");
  if (!card.hanging || card.hanging.s[0][1] !== "12" || card.hanging.s[1][1] !== "12") throw new Error("stored hanging log changed");
  if (card.lying) throw new Error("lying-leg-raise was created in storage");
  if (card.done) throw new Error("empty lying leg raise marked done");
  if (!/lower back/.test(card.how) || card.tgt !== "Targets: Abs (lower emphasis), hip flexors") throw new Error("cue/targets " + card.how + " | " + card.tgt);
  await page.locator("#woRoster .exc[data-id='lying-leg-raise']").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(ART, "lying-leg-raise-iphone13.png") });

  const live = await getJson(LIVE);
  const raw = live["nn-v1:wo:2026-11-11"] && live["nn-v1:wo:2026-11-11"].v;
  const liveWo = raw ? JSON.parse(raw) : null;
  const liveH = liveWo && liveWo.ex && liveWo.ex["hanging-leg-raises"];
  if (!liveH || JSON.stringify(liveH.s) !== JSON.stringify([[null, "12"], [null, "12"]])) throw new Error("unexpected live Nov 11 hanging record");
  if (liveWo.ex["lying-leg-raise"]) throw new Error("live store already has lying-leg-raise");
  const livePosts = [];
  const liveCtx = await browser.newContext({ ...devices["iPhone 13"] });
  const liveSeed = Object.entries(live).filter(([k, v]) => k.startsWith("nn-v1:") && v && typeof v.v === "string").map(([k, v]) => [k, v.v]);
  await liveCtx.addInitScript((entries) => {
    for (const [k, v] of entries) localStorage.setItem(k, v);
  }, liveSeed);
  await liveCtx.route("https://api.npoint.io/**", async (route) => {
    if (route.request().method() === "POST") { livePosts.push(1); await route.abort(); return; }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(live) });
  });
  const livePage = await liveCtx.newPage();
  await livePage.goto("http://127.0.0.1:" + PORT + "/index.html#workout", { waitUntil: "domcontentloaded" });
  await livePage.waitForFunction(() => window.__nn);
  await livePage.evaluate(() => window.__nn.setW("2026-11-11"));
  if ((await livePage.evaluate(() => document.getElementById("dSub").dataset.viewing)) !== "pull") {
    await livePage.locator('.pchip[data-p="pull"]').click();
  }
  await livePage.waitForFunction(() => document.getElementById("dSub").dataset.viewing === "pull");
  const seen = await livePage.evaluate(() => {
    const el = document.querySelector("#woRoster input[data-id='lying-leg-raise'][data-s='0']");
    const body = document.getElementById("woBody").innerText;
    const w = JSON.parse(localStorage.getItem("nn-v1:wo:2026-11-11"));
    return {
      ph: el ? el.placeholder : null,
      value: el ? el.value : null,
      hangingText: /Hanging leg raises/.test(body),
      stored: w.ex["hanging-leg-raises"] ? w.ex["hanging-leg-raises"].s : null,
      created: !!w.ex["lying-leg-raise"]
    };
  });
  if (seen.value !== "" || seen.ph !== "12-20" || seen.hangingText || seen.created) throw new Error("live view mixed the logs " + JSON.stringify(seen));
  if (!seen.stored || seen.stored[0][1] !== "12" || seen.stored[1][1] !== "12") throw new Error("live hanging log changed " + JSON.stringify(seen.stored));
  if (posts.length || livePosts.length) throw new Error("a sync POST was attempted (" + posts.length + " local, " + livePosts.length + " live)");
  console.log(JSON.stringify({
    ok: true,
    nov11: { id: "hanging-leg-raises", sets: liveH.s, tick: liveH.d, lyingKey: false, plan: liveWo.plan }
  }));
  await browser.close();
  server.close();
}
main().catch((err) => { console.error(err); process.exit(1); });
