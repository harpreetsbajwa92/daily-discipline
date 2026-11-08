/**
 * iPhone 13: lying bodyweight crunch replaces prescribed cable crunch.
 * Old cable-crunch logs stay on that id. Never calls the live sync host.
 * Run: node test/bodyweight-crunch.mjs
 */
import { createRequire } from "module";
import http from "http";
import fs from "fs";
import path from "path";

const require = createRequire("/home/ubuntu/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/package.json");
const { chromium, devices } = require("playwright");

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ART = "/opt/cursor/artifacts";
const PORT = 8767;
const TODAY = "2026-11-08";

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
      const file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
      if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end("no"); return; }
        const ext = path.extname(file);
        const type = ext === ".html" ? "text/html" : ext === ".json" ? "application/json" : "application/octet-stream";
        res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
        res.end(data);
      });
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

const cable = { s: [["80", "12"], ["80", "12"], ["75", "10"]], d: true };
const seedWo = JSON.stringify({
  plan: "pull", perf: "pull", perfFix: true, perfAt: 1, done: false,
  ex: { "cable-crunch": cable, "lat-pulldown": { s: [["40", "8"]], d: true } }
});

async function main() {
  const vm = new Date();
  const vmKey = vm.getFullYear() + "-" + String(vm.getMonth() + 1).padStart(2, "0") + "-" + String(vm.getDate()).padStart(2, "0");
  if (vmKey !== TODAY) throw new Error("expected machine date " + TODAY + ", got " + vmKey);
  fs.mkdirSync(ART, { recursive: true });
  const server = await serve();
  let bin = { _rev: 1, "nn-v1:wo:2026-11-08": { t: 1, v: seedWo }, "nn-v1:meals:2026-11-08": { t: 1, v: JSON.stringify({ v: 2, meals: [{ id: "keep", slot: "Breakfast", items: [], u: 1 }] }) } };
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext({ ...devices["iPhone 13"] });
  await context.route("https://api.npoint.io/**", async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      bin = JSON.parse(req.postData());
      await route.fulfill({ status: 200, contentType: "application/json", body: req.postData() });
    } else {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(bin) });
    }
  });
  await context.addInitScript((raw) => {
    if (sessionStorage.getItem("nn-crunch-seeded")) return;
    localStorage.setItem("nn-v1:wo:2026-11-08", raw);
    sessionStorage.setItem("nn-crunch-seeded", "1");
  }, seedWo);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto("http://127.0.0.1:" + PORT + "/index.html#workout", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__nn && document.getElementById("woSession"));
  if ((await page.locator("#dLab").innerText()) !== "TODAY") throw new Error("did not open on today");

  const lists = await page.evaluate(() => {
    const ids = (p) => window.__nn.exIds(p);
    return { push: ids("push"), pull: ids("pull"), legs: ids("legs"), upper: ids("upper"), lower: ids("lower"), active: ids("active") };
  });
  for (const p of ["pull", "upper", "lower"]) {
    if (!lists[p].includes("bodyweight-crunch")) throw new Error(p + " missing lying crunch");
    if (lists[p].includes("cable-crunch")) throw new Error(p + " still prescribes cable crunch");
  }
  for (const p of ["push", "legs", "active"]) {
    if (lists[p].includes("bodyweight-crunch") || lists[p].includes("cable-crunch")) throw new Error(p + " roster changed: " + lists[p].join(","));
  }
  if (lists.pull.filter((id) => id === "hanging-leg-raises").length !== 1) throw new Error("leg raises were changed");

  await page.evaluate(() => window.__nn.setW("2026-11-08"));
  await page.waitForSelector("#woRoster .exc[data-id='bodyweight-crunch']");
  const card = await page.evaluate(() => {
    const roster = [...document.querySelectorAll("#woRoster .exc")].map((el) => el.dataset.id);
    const crunch = document.querySelector("#woRoster .exc[data-id='bodyweight-crunch']");
    const inputs = [...crunch.querySelectorAll("input")];
    const old = document.querySelector("#woHist .exc[data-id='cable-crunch']");
    const oldWeight = old ? old.querySelector("input[data-f='0']").value : null;
    return {
      roster,
      text: crunch.innerText,
      fields: inputs.map((i) => i.dataset.f),
      values: inputs.map((i) => i.value),
      placeholders: inputs.map((i) => i.placeholder),
      oldWeight,
      oldText: old ? old.innerText : "",
      recorded: document.getElementById("woSession").innerText
    };
  });
  if (card.roster.join(",") !== lists.pull.join(",")) throw new Error("pull roster drifted");
  if (!/Lying bodyweight crunch/.test(card.text) || !/Bodyweight/.test(card.text) || !/no added weight/i.test(card.text)) throw new Error("crunch label: " + card.text);
  if (card.fields.some((f) => f !== "1") || card.fields.length !== 3) throw new Error("expected 3 rep-only boxes, got " + JSON.stringify(card.fields));
  if (card.values.some((v) => v !== "")) throw new Error("empty crunch inherited a number: " + card.values.join(","));
  if (card.placeholders.some((v) => v === "80" || v === "75")) throw new Error("cable load reused as crunch hint: " + card.placeholders.join(","));
  if (card.oldWeight !== "80" || !/Cable crunch/.test(card.oldText)) throw new Error("old cable crunch not readable: " + card.oldWeight + " " + card.oldText);
  await page.locator("#woRoster .exc[data-id='bodyweight-crunch']").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(ART, "lying-bodyweight-crunch-iphone13.png") });

  await page.evaluate(() => {
    const el = document.querySelector("#woRoster input[data-id='bodyweight-crunch'][data-s='0']");
    el.value = "15";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForFunction(() => {
    const w = JSON.parse(localStorage.getItem("nn-v1:wo:2026-11-08") || "{}");
    const c = w.ex && w.ex["bodyweight-crunch"];
    const old = w.ex && w.ex["cable-crunch"];
    return !!(c && c.s && c.s[0] && c.s[0][1] === "15" && old && old.s[0][0] === "80");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__nn);
  await page.evaluate(() => window.__nn.setW("2026-11-08"));
  await page.waitForSelector("#woRoster input[data-id='bodyweight-crunch']");
  const after = await page.evaluate(() => {
    const raw = localStorage.getItem("nn-v1:wo:2026-11-08");
    const w = raw ? JSON.parse(raw) : null;
    const box = document.querySelector("#woRoster input[data-id='bodyweight-crunch'][data-s='0']");
    return {
      reps: box ? box.value : null,
      keys: w && w.ex ? Object.keys(w.ex) : [],
      cable: w && w.ex && w.ex["cable-crunch"] ? w.ex["cable-crunch"].s : null,
      crunch: w && w.ex && w.ex["bodyweight-crunch"] ? w.ex["bodyweight-crunch"].s : null,
      date: document.getElementById("dSub") ? document.getElementById("dSub").dataset.date : null
    };
  });
  if (after.reps !== "15" || after.date !== "2026-11-08") throw new Error("reload lost the new crunch " + JSON.stringify(after));
  if (!after.cable || after.cable[0][0] !== "80" || (after.crunch[0] && after.crunch[0][0])) throw new Error("cable log was rewritten " + JSON.stringify(after));

  await page.locator('.pchip[data-p="upper"]').click();
  await page.waitForFunction(() => document.getElementById("dSub").dataset.preview === "upper");
  const upper = await page.evaluate(() => ({
    recorded: document.getElementById("woSession").innerText,
    roster: [...document.querySelectorAll("#woRoster .exc")].map((el) => el.dataset.id).join(","),
    want: window.__nn.exIds("upper").join(","),
    crunch: document.querySelector("#woRoster input[data-id='bodyweight-crunch'][data-s='0']").value,
    cable: document.querySelector("#woHist input[data-id='cable-crunch'][data-f='0']").value
  }));
  if (!/Recorded session:\s*Pull \+ Abs/.test(upper.recorded)) throw new Error("preview relabeled " + upper.recorded);
  if (upper.roster !== upper.want || !upper.roster.includes("bodyweight-crunch") || upper.roster.includes("cable-crunch")) throw new Error("upper roster " + upper.roster);
  if (upper.crunch !== "15" || upper.cable !== "80") throw new Error("preview mixed values " + JSON.stringify(upper));

  const contextB = await browser.newContext({ ...devices["iPhone 13"] });
  await contextB.route("https://api.npoint.io/**", async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      bin = JSON.parse(req.postData());
      await route.fulfill({ status: 200, contentType: "application/json", body: req.postData() });
    } else {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(bin) });
    }
  });
  const pageB = await contextB.newPage();
  await page.evaluate(() => document.getElementById("syNow") && document.getElementById("syNow").click());
  await page.waitForFunction(() => {
    try { return JSON.parse(localStorage.getItem("nn-sync:at")); } catch (e) { return false; }
  });
  await pageB.goto("http://127.0.0.1:" + PORT + "/index.html#workout", { waitUntil: "domcontentloaded" });
  await pageB.waitForFunction(() => {
    try { return JSON.parse(localStorage.getItem("nn-v1:wo:2026-11-08")).ex["cable-crunch"]; } catch (e) { return false; }
  });
  const synced = await pageB.evaluate(() => JSON.parse(localStorage.getItem("nn-v1:wo:2026-11-08")).ex);
  if (synced["cable-crunch"].s[0][0] !== "80" || synced["bodyweight-crunch"].s[0][1] !== "15") throw new Error("sync dropped a crunch log");
  if (synced["lat-pulldown"].s[0][0] !== "40") throw new Error("sync dropped another exercise");

  if (errors.length) throw new Error(errors.join("\n"));
  console.log(JSON.stringify({ ok: true, version: "2026.10.31-33", sessions: ["pull", "upper", "lower"], sets: 3, reps: "12-20" }));
  await browser.close();
  server.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
