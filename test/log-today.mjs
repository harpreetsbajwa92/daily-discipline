/**
 * iPhone 13 checks: logging always lands on today's real date.
 * Clock fixed to Mon Nov 16 2026 09:30 (a Monday rest day, Lower + Abs pending after Fri Upper + Abs).
 * Uses an in-memory copy of the sync bin. Never calls the live npoint host.
 * Run: node test/log-today.mjs
 */
import { createRequire } from "module";
import http from "http";
import fs from "fs";
import path from "path";

const require = createRequire("/tmp/pw/node_modules/playwright/package.json");
const { chromium, devices } = require("playwright");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ART = process.env.ART || "/opt/cursor/artifacts";
const PORT = +(process.env.PORT || 8766);

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
      const file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
      if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end("no"); return; }
        res.writeHead(200, { "Content-Type": path.extname(file) === ".html" ? "text/html" : "application/json", "Cache-Control": "no-store" });
        res.end(data);
      });
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}
const S = (...p) => ({ s: p.map(([a, b]) => [String(a), String(b)]), d: true });

async function main() {
  fs.mkdirSync(ART, { recursive: true });
  const server = await serve();
  const fri = { plan: "upper", ex: { "smith-incline-press": S([50, 10], [70, 10], [80, 4]), "lat-pulldown": S([180, 10], [200, 10], [220, 5]), "lateral-raises": S([15, 15], [20, 15], [20, 15]) }, done: true, perf: "upper", perfFix: true, perfAt: 1 };
  const thu = { plan: "legs", ex: { "smith-squat": S([100, 8]) , "romanian-deadlift": S([80, 8]), "cable-leg-curl": S([30, 12], [40, 12], [50, 10]) }, done: true, perf: "legs", perfFix: true, perfAt: 1 };
  let bin = { _rev: 1, "nn-v1:wo:2026-11-12": { t: 1, v: JSON.stringify(thu) }, "nn-v1:wo:2026-11-13": { t: 1, v: JSON.stringify(fri) } };
  const seed = { "nn-v1:wo:2026-11-12": JSON.stringify(thu), "nn-v1:wo:2026-11-13": JSON.stringify(fri) };
  let posts = 0;
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ ...devices["iPhone 13"], timezoneId: "America/Toronto" });
  await ctx.route("https://api.npoint.io/**", async (route) => {
    const req = route.request();
    if (req.method() === "POST") { posts++; bin = JSON.parse(req.postData()); await route.fulfill({ status: 200, contentType: "application/json", body: req.postData() }); }
    else await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(bin) });
  });
  await ctx.addInitScript((entries) => {
    if (sessionStorage.getItem("nn-test-seeded")) return;
    for (const [k, v] of entries) localStorage.setItem(k, v);
    sessionStorage.setItem("nn-test-seeded", "1");
  }, Object.entries(seed));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.clock.install({ time: new Date("2026-11-16T09:30:00-05:00") });
  await page.goto("http://127.0.0.1:" + PORT + "/index.html#workout", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__nn && document.getElementById("woSession"));
  const ls = (k) => page.evaluate((k) => localStorage.getItem(k), k);

  // 1) Monday opens on today, shows Rest, and offers the pending Lower + Abs on today
  const open = await page.evaluate(() => ({ date: document.getElementById("dSub").dataset.date, view: document.getElementById("dSub").dataset.viewing, btn: (document.getElementById("woTrainToday") || {}).dataset, txt: (document.getElementById("woTrainBox") || {}).innerText || "" }));
  if (open.date !== "2026-11-16" || open.view !== "none") throw new Error("open " + JSON.stringify(open));
  if (!open.btn || open.btn.p !== "lower" || !/Lower \+ Abs/.test(open.txt) || !/Mon Nov 16/.test(open.txt)) throw new Error("train-today button " + JSON.stringify(open));
  await page.screenshot({ path: path.join(ART, "mon-rest-train-today-iphone13.png") });

  // 2) Yesterday is locked: typing there writes nothing
  await page.click("#dPrev");
  await page.waitForFunction(() => document.getElementById("dSub").dataset.date === "2026-11-15");
  if (!(await page.evaluate(() => window.__nn.woLocked()))) throw new Error("Sunday not locked");
  const rec = await page.locator("#woRecDate").innerText();
  if (!/locked/i.test(rec) || !(await page.locator("#woUnlock").count())) throw new Error("lock banner " + rec);
  await page.evaluate(() => { const el = document.querySelector("#woRoster input[data-id='bulgarian-split-squat'][data-s='0'][data-f='0']"); el.value = "20"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  const ro = await page.evaluate(() => document.querySelector("#woRoster input[data-id='bulgarian-split-squat'][data-s='0'][data-f='0']").readOnly);
  if (!ro) throw new Error("locked input not readonly");
  if (await ls("nn-v1:wo:2026-11-15")) throw new Error("locked Sunday got a write");
  if (await page.locator("#woTrainToday").count()) throw new Error("train-today shown on a past day");
  await page.screenshot({ path: path.join(ART, "sun-locked-iphone13.png") });

  // 3) Coming back after 20+ min snaps Workout back to today
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
  await page.clock.fastForward("21:00");
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForFunction(() => document.getElementById("dSub").dataset.date === "2026-11-16");

  // 4) One tap records Lower + Abs on Monday, sets land on Monday
  await page.click("#woTrainToday");
  await page.waitForFunction(() => document.getElementById("dSub").dataset.session === "lower");
  const roster = await page.evaluate(() => [...document.querySelectorAll("#woRoster .exc")].map((e) => e.dataset.id));
  const lowerIds = await page.evaluate(() => window.__nn.exIds("lower"));
  if (roster.join(",") !== lowerIds.join(",")) throw new Error("roster " + roster.join(","));
  const cues = await page.evaluate(() => [...document.querySelectorAll("#woRoster .exc")].filter((e) => e.querySelector(".r") && e.querySelector(".how")).length);
  if (cues < 4) throw new Error("target/how-to cue missing under exercises: " + cues);
  for (const [f, v] of [["0", "20"], ["1", "10"]]) {
    await page.evaluate(([f, v]) => { const el = document.querySelector("#woRoster input[data-id='bulgarian-split-squat'][data-s='0'][data-f='" + f + "']"); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); }, [f, v]);
  }
  const mon = JSON.parse(await ls("nn-v1:wo:2026-11-16"));
  if (mon.perf !== "lower" || !mon.perfFix || JSON.stringify(mon.ex["bulgarian-split-squat"].s[0]) !== '["20","10"]') throw new Error("monday " + JSON.stringify(mon));
  if (await ls("nn-v1:wo:2026-11-15")) throw new Error("Sunday got a write");
  if (mon.done) throw new Error("marked done without logging the session");
  const nxt = await page.evaluate(() => ({ tue: window.__nn.rotInfo("2026-11-17").next, last: window.__nn.rotInfo("2026-11-17").last }));
  if (nxt.tue !== "push" || nxt.last !== "lower") throw new Error("rotation " + JSON.stringify(nxt));
  await page.screenshot({ path: path.join(ART, "mon-lower-logged-iphone13.png") });

  // 5) Edit unlocks a past day on purpose
  await page.click("#dPrev");
  await page.click("#woUnlock");
  if (await page.evaluate(() => window.__nn.woLocked())) throw new Error("Edit did not unlock");
  await page.click("#dNext"); await page.click("#dPrev");
  if (!(await page.evaluate(() => window.__nn.woLocked()))) throw new Error("unlock survived a date change");
  if (errors.length) throw new Error("page errors " + errors.join("\n"));
  await browser.close(); server.close();
  console.log(JSON.stringify({ ok: true, version: "2026.10.31-37", posts }));
}
main().catch((e) => { console.error(e); process.exit(1); });
