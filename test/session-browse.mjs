/**
 * iPhone 13 checks for routine preview vs explicit session correction.
 * Uses an in-memory copy of the sync bin. Never calls the live npoint host.
 * Run: node test/session-browse.mjs
 */
import { createRequire } from "module";
import { spawn } from "child_process";
import http from "http";
import fs from "fs";
import path from "path";

const require = createRequire("/home/ubuntu/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/package.json");
const { chromium, devices } = require("playwright");

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ART = "/opt/cursor/artifacts";
const PORT = 8765;
const TODAY = "2026-11-07";

function sets(...pairs) {
  return { s: pairs.map(([a, b]) => [String(a), String(b)]), d: true };
}
function wo(plan, ex, extra) {
  const o = Object.assign({ plan, ex, done: true }, extra || {});
  return o;
}
function buildBin() {
  const days = {
    "2026-10-31": wo("upper", Object.assign(
      { "incline-press": sets([45, 8], [45, 8], [45, 6]) },
      Object.fromEntries(["smith-incline-press", "lat-pulldown", "lateral-raises", "cable-reverse-fly", "superset-db-curl", "superset-rope-pushdown"].map((id) => [id, sets([50, 8])]))
    )),
    "2026-11-01": wo("active", Object.fromEntries(["bulgarian-split-squat", "hip-thrust", "cable-leg-extension", "cable-leg-curl", "hanging-leg-raises", "cable-crunch", "plank", "cable-woodchoppers"].map((id) => [id, sets([40, 10])]))),
    "2026-11-02": wo("active", { steps: { s: [], d: true } }, { done: false }),
    "2026-11-03": wo("push", Object.fromEntries(["incline-db-press", "smith-flat-press", "seated-db-shoulder-press", "lateral-raises", "rope-pushdown", "overhead-triceps-extension"].map((id) => [id, sets([40, 8])])), { perf: "push", perfAt: 1 }),
    "2026-11-04": wo("active", { steps: { s: [], d: true } }, { perf: "active", perfAt: 2 }),
    "2026-11-05": wo("pull", Object.fromEntries(["lat-pulldown", "chest-supported-row", "seated-cable-row", "face-pulls", "db-curl", "hammer-curl", "hanging-leg-raises", "cable-crunch", "plank"].map((id) => [id, sets([40, 8])]))),
    "2026-11-06": wo("upper", {
      "smith-squat": sets([100, 8], [100, 8], [100, 6], [100, 5]),
      "romanian-deadlift": sets([80, 8], [80, 8], [80, 6]),
      "heels-elevated-goblet-squat": { s: [["40", "10"], ["40", "10"], ["40", "8"]], d: false },
      "cable-leg-curl": sets([30, 12], [30, 12], [30, 10]),
      "smith-calf-raise": sets([70, 15], [70, 15], [70, 12], [70, 12]),
      "smith-incline-press": sets([40, 10], [40, 10], [40, 8]),
      "lat-pulldown": sets([55, 10], [55, 10], [55, 8])
    }, { done: false, perf: "upper", perfAt: 3 }),
    "2026-11-07": { plan: "upper", perf: "upper", perfAt: 4, ex: {}, done: false }
  };
  const bin = { _rev: 1 };
  const seed = {};
  for (const [day, value] of Object.entries(days)) {
    const raw = JSON.stringify(value);
    bin["nn-v1:wo:" + day] = { t: 1, v: raw };
    seed["nn-v1:wo:" + day] = raw;
  }
  const meals = JSON.stringify({ v: 2, meals: [{ id: "keep-meals", slot: "Breakfast", name: "", t: "", items: [], u: 1 }] });
  bin["nn-v1:meals:" + TODAY] = { t: 1, v: meals };
  seed["nn-v1:meals:" + TODAY] = meals;
  return { bin, seed };
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
        const type = ext === ".html" ? "text/html" : ext === ".json" ? "application/json" : "application/octet-stream";
        res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
        res.end(data);
      });
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function dumpStore(page) {
  return page.evaluate(() => {
    const o = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("nn-v1:")) o[k] = localStorage.getItem(k);
    }
    return o;
  });
}
function changedKeys(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => a[k] !== b[k]).sort();
}
function exOf(raw) {
  return JSON.parse(raw).ex;
}

async function main() {
  const vmToday = new Date();
  const vmKey = vmToday.getFullYear() + "-" + String(vmToday.getMonth() + 1).padStart(2, "0") + "-" + String(vmToday.getDate()).padStart(2, "0");
  if (vmKey !== TODAY) throw new Error("This test expects the machine date " + TODAY + " but it is " + vmKey);

  const py = spawn("python3", [path.join(ROOT, "next_session.py"), "--self-test"], { stdio: "inherit" });
  const pyCode = await new Promise((r) => py.on("close", r));
  if (pyCode !== 0) throw new Error("next_session.py self-test failed");

  fs.mkdirSync(ART, { recursive: true });
  const server = await serve();
  const { bin: initial, seed } = buildBin();
  let bin = JSON.parse(JSON.stringify(initial));
  const hits = { get: 0, post: 0, otherHost: 0 };

  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const iphone = devices["iPhone 13"];
  async function attach(context) {
    await context.route("https://api.npoint.io/**", async (route) => {
      const req = route.request();
      if (!req.url().startsWith("https://api.npoint.io/")) hits.otherHost++;
      if (req.method() === "POST") {
        hits.post++;
        bin = JSON.parse(req.postData());
        await route.fulfill({ status: 200, contentType: "application/json", body: req.postData() });
      } else {
        hits.get++;
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(bin) });
      }
    });
    context.on("request", (req) => {
      const u = req.url();
      if (u.includes("npoint.io") && !u.startsWith("https://api.npoint.io/")) hits.otherHost++;
    });
  }
  async function waitReady(page) {
    await page.waitForFunction(() => window.__nn && document.getElementById("woSession"), null, { timeout: 20000 });
    await page.waitForFunction(() => {
      try { return !!JSON.parse(localStorage.getItem("nn-sync:at") || "null"); } catch (e) { return false; }
    }, null, { timeout: 20000 });
  }

  const errors = [];
  const contextA = await browser.newContext({ ...iphone });
  await attach(contextA);
  await contextA.addInitScript((entries) => {
    if (sessionStorage.getItem("nn-test-seeded")) return;
    for (const [k, v] of entries) localStorage.setItem(k, v);
    sessionStorage.setItem("nn-test-seeded", "1");
  }, Object.entries(seed));
  const page = await contextA.newPage();
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto("http://127.0.0.1:" + PORT + "/index.html#workout", { waitUntil: "domcontentloaded" });
  await waitReady(page);
  if (errors.length) throw new Error("page errors: " + errors.join("\n"));

  const version = await page.evaluate(() => document.getElementById("appVer").textContent);
  if (!version.includes("2026.10.31-31")) throw new Error("version text: " + version);

  await page.evaluate(() => window.__nn.setW("2026-11-06"));
  await page.waitForFunction(() => document.getElementById("dSub").dataset.session === "legs");
  const opened = await page.evaluate(() => ({
    session: document.getElementById("dSub").dataset.session,
    text: document.getElementById("woSession").innerText,
    done: (document.getElementById("doneBar") || {}).innerText || "",
    squat: document.querySelector('input[data-id="smith-squat"][data-s="0"][data-f="0"]').value,
    squatOff: document.querySelector('input[data-id="smith-squat"][data-s="0"][data-f="0"]').disabled,
    also: document.getElementById("woBody").innerText,
    rec: (document.getElementById("woRecDate") || {}).innerText || "",
    logged: (document.getElementById("loggedBar") || {}).innerText || "",
    fri: [...document.querySelectorAll("#week .wd")].map((b) => b.innerText).find((t) => t.includes("Fri"))
  }));
  if (opened.session !== "legs") throw new Error("Nov 6 session " + opened.session);
  if (!/Session you did:\s*Legs/.test(opened.text)) throw new Error("label: " + opened.text);
  if (opened.squat !== "100" || opened.squatOff) throw new Error("squat hidden, locked, or changed: " + opened.squat);
  if (!/Fri Nov 6/.test(opened.rec) || !/not today/i.test(opened.rec)) throw new Error("recording date: " + opened.rec);
  if (!/7/.test(opened.logged) || !/Fri Nov 6/.test(opened.logged)) throw new Error("logged counter: " + opened.logged);
  if (opened.done.includes("/11")) throw new Error("done bar switched to Upper+Abs: " + opened.done);
  if (!opened.done.includes("/6")) throw new Error("expected legs counter /6: " + opened.done);
  if (!opened.also.includes("Smith machine incline press")) throw new Error("off-plan upper sets not visible");
  if (!opened.fri || !opened.fri.includes("Legs")) throw new Error("week list: " + opened.fri);
  const sched = await page.evaluate(() => ({
    today: window.__nn.rotInfo("2026-11-07").next,
    fri: window.__nn.recordedPid("2026-11-06", window.__nn.loadWo("2026-11-06")),
    carried: window.__nn.rotInfo("2026-11-05").next,
    afterRest: window.__nn.rotInfo("2026-11-08").next
  }));
  if (sched.fri !== "legs" || sched.today !== "active" || sched.carried !== "pull" || sched.afterRest !== "upper") {
    throw new Error("rotation " + JSON.stringify(sched));
  }
  const base = await dumpStore(page);
  await page.screenshot({ path: path.join(ART, "nov6-legs-iphone13.png") });

  const postsBeforeBrowse = hits.post;
  await page.locator('.pchip[data-p="upper"]').click();
  await page.waitForFunction(() => document.getElementById("dSub").dataset.preview === "upper" && document.getElementById("dSub").dataset.session === "legs");
  const browsed = await page.evaluate(() => ({
    session: document.getElementById("dSub").dataset.session,
    text: document.getElementById("woSession").innerText,
    banner: (document.getElementById("woBrowseBar") || {}).innerText || "",
    squat: document.querySelector('input[data-id="smith-squat"][data-s="0"][data-f="0"]').value,
    done: document.getElementById("doneBar").innerText,
    chip: document.querySelector(".pchip.on").innerText,
    prev: document.querySelector(".pchip.prev").innerText
  }));
  if (browsed.session !== "legs" || !browsed.text.includes("Legs")) throw new Error("browse relabeled: " + JSON.stringify(browsed));
  if (browsed.squat !== "100") throw new Error("browse hid squat");
  if (browsed.done.includes("/11")) throw new Error("browse counter " + browsed.done);
  if (!browsed.banner.includes("Not saved") || !browsed.banner.includes("Legs")) throw new Error("banner " + browsed.banner);
  if (!/legs/i.test(browsed.chip) || !/upper/i.test(browsed.prev)) throw new Error("chips " + JSON.stringify(browsed));
  await page.screenshot({ path: path.join(ART, "nov6-preview-upper-iphone13.png") });
  await new Promise((r) => setTimeout(r, 2500));
  let delta = changedKeys(base, await dumpStore(page));
  if (delta.length) throw new Error("browse wrote store keys: " + delta.join(","));
  if (hits.post !== postsBeforeBrowse) throw new Error("browse synced a write");

  await page.click("#dPrev");
  await page.waitForFunction(() => document.getElementById("dSub").dataset.session === "pull" && document.getElementById("dSub").dataset.preview === "");
  const pullText = await page.locator("#woSession").innerText();
  if (!pullText.includes("Pull + Abs")) throw new Error("Nov 5 " + pullText);
  await page.click("#dNext");
  await page.waitForFunction(() => document.getElementById("dSub").dataset.session === "legs");
  const squatBack = await page.locator('input[data-id="smith-squat"][data-s="0"][data-f="0"]').inputValue();
  if (squatBack !== "100") throw new Error("date nav lost squat " + squatBack);
  delta = changedKeys(base, await dumpStore(page));
  if (delta.length) throw new Error("date nav wrote " + delta.join(","));

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitReady(page);
  await page.evaluate(() => window.__nn.setW("2026-11-06"));
  await page.waitForFunction(() => document.getElementById("dSub").dataset.session === "legs");
  if (await page.locator('input[data-id="smith-squat"][data-s="0"][data-f="0"]').inputValue() !== "100") throw new Error("reload lost squat");
  delta = changedKeys(base, await dumpStore(page));
  if (delta.length) throw new Error("reload changed store " + delta.join(","));

  await page.evaluate(() => window.__nn.setW("2026-10-31"));
  await page.waitForFunction(() => document.getElementById("dSub").dataset.session === "upper");
  const oldDay = await page.locator("#woBody").innerText();
  if (!oldDay.includes("Incline barbell press") || !oldDay.includes("old exercise")) throw new Error("retired exercise hidden");
  delta = changedKeys(base, await dumpStore(page));
  if (delta.length) throw new Error("history view wrote " + delta.join(","));

  await page.evaluate(() => window.__nn.setW("2026-11-07"));
  await page.waitForFunction(() => document.getElementById("dSub").dataset.session === "active");
  const beforeFuture = await page.evaluate(() => ({
    today: window.__nn.rotInfo("2026-11-07").next,
    tomorrow: window.__nn.rotInfo("2026-11-08").next
  }));
  await page.locator('.pchip[data-p="push"]').click();
  await page.waitForFunction(() => document.getElementById("dSub").dataset.preview === "push" && document.getElementById("dSub").dataset.session === "active");
  const afterFuture = await page.evaluate(() => ({
    today: window.__nn.rotInfo("2026-11-07").next,
    tomorrow: window.__nn.rotInfo("2026-11-08").next,
    label: document.getElementById("woSession").innerText
  }));
  if (beforeFuture.today !== "active" || afterFuture.today !== "active" || afterFuture.tomorrow !== beforeFuture.tomorrow) {
    throw new Error("preview changed schedule " + JSON.stringify({ beforeFuture, afterFuture }));
  }
  if (!afterFuture.label.includes("Active rest")) throw new Error("today label " + afterFuture.label);
  await new Promise((r) => setTimeout(r, 2500));
  delta = changedKeys(base, await dumpStore(page));
  if (delta.length) throw new Error("today preview wrote " + delta.join(","));
  await page.screenshot({ path: path.join(ART, "today-preview-does-not-reschedule-iphone13.png") });

  const contextB = await browser.newContext({ ...iphone });
  await attach(contextB);
  const pageB = await contextB.newPage();
  pageB.on("pageerror", (err) => errors.push("B " + err));
  await pageB.goto("http://127.0.0.1:" + PORT + "/index.html#workout", { waitUntil: "domcontentloaded" });
  await waitReady(pageB);
  await pageB.evaluate(() => window.__nn.setW("2026-11-06"));
  await pageB.waitForFunction(() => document.getElementById("dSub").dataset.session === "legs");
  const bSquat = await pageB.locator('input[data-id="smith-squat"][data-s="0"][data-f="0"]').inputValue();
  if (bSquat !== "100") throw new Error("device B squat " + bSquat);
  const bStore = await dumpStore(pageB);
  for (const k of Object.keys(base)) {
    if (k.startsWith("nn-v1:wo:") && exOf(base[k]) && JSON.stringify(exOf(base[k])) !== JSON.stringify(exOf(bStore[k] || "null"))) {
      throw new Error("device B lost exercises on " + k);
    }
  }

  await page.evaluate(() => window.__nn.setW("2026-11-06"));
  await page.waitForFunction(() => document.getElementById("dSub").dataset.session === "legs");
  const exBefore = await page.evaluate(() => JSON.stringify(window.__nn.loadWo("2026-11-06").ex));
  await page.locator('.pchip[data-p="upper"]').click();
  await page.click("#woDidThis");
  await page.waitForFunction(() => document.getElementById("dSub").dataset.session === "upper" && document.getElementById("dSub").dataset.preview === "");
  const corrected = await page.evaluate(() => {
    const w = window.__nn.loadWo("2026-11-06");
    return {
      label: document.getElementById("woSession").innerText,
      squat: document.querySelector('input[data-id="smith-squat"][data-s="0"][data-f="0"]').value,
      incline: document.querySelector('input[data-id="smith-incline-press"][data-s="0"][data-f="0"]').value,
      body: document.getElementById("woBody").innerText,
      perf: w.perf, fix: w.perfFix, ex: JSON.stringify(w.ex)
    };
  });
  if (!corrected.label.includes("Upper + Abs")) throw new Error("correction label " + corrected.label);
  if (corrected.squat !== "100" || corrected.incline !== "40") throw new Error("correction dropped sets " + JSON.stringify(corrected));
  if (!/exercises with sets on Fri Nov 6/i.test(corrected.body) || !corrected.body.includes("Smith machine squat")) throw new Error("legs sets not kept on screen");
  if (corrected.ex !== exBefore) throw new Error("correction mutated ex");
  if (corrected.perf !== "upper" || corrected.fix !== true) throw new Error("perfFix not stored");
  const afterFix = await dumpStore(page);
  const fixDelta = changedKeys(base, afterFix).filter((k) => k !== "nn-v1:wo:2026-11-06");
  if (fixDelta.length) throw new Error("correction touched other days: " + fixDelta.join(","));
  await page.evaluate(() => document.getElementById("syNow") && document.getElementById("syNow").click());
  const fixDeadline = Date.now() + 12000;
  while (Date.now() < fixDeadline) {
    const raw = bin["nn-v1:wo:2026-11-06"] && bin["nn-v1:wo:2026-11-06"].v;
    if (raw && JSON.parse(raw).perfFix) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!bin["nn-v1:wo:2026-11-06"] || !JSON.parse(bin["nn-v1:wo:2026-11-06"].v).perfFix) throw new Error("correction did not sync to the mock bin");
  if (JSON.stringify(JSON.parse(bin["nn-v1:wo:2026-11-06"].v).ex) !== exBefore) throw new Error("synced ex changed");

  await pageB.evaluate(() => document.getElementById("syNow") && document.getElementById("syNow").click());
  await pageB.waitForFunction(() => {
    try { return JSON.parse(localStorage.getItem("nn-v1:wo:2026-11-06")).perfFix === true; } catch (e) { return false; }
  }, null, { timeout: 12000 });
  await pageB.evaluate(() => window.__nn.setW("2026-11-06"));
  const bAfter = await pageB.evaluate(() => ({
    session: document.getElementById("dSub").dataset.session,
    squat: document.querySelector('input[data-id="smith-squat"][data-s="0"][data-f="0"]').value,
    ex: JSON.stringify(window.__nn.loadWo("2026-11-06").ex)
  }));
  if (bAfter.session !== "upper" || bAfter.squat !== "100" || bAfter.ex !== exBefore) throw new Error("device B after sync " + JSON.stringify(bAfter));

  const merge = await page.evaluate(() => {
    const keep = JSON.stringify({ plan: "legs", perf: "legs", perfFix: true, perfAt: 1, done: false, ex: { "smith-squat": { s: [["100", "8"]], d: true } } });
    const browse = JSON.stringify({ plan: "upper", perf: "upper", perfAt: 9, done: false, ex: { "smith-squat": { s: [], d: false }, "lat-pulldown": { s: [["55", "10"]], d: true } } });
    const m = JSON.parse(window.__nn.syMerge("nn-v1:wo:2026-11-06", browse, keep, 20, 1));
    return m;
  });
  if (merge.perf !== "legs" || merge.perfFix !== true) throw new Error("merge dropped explicit correction " + JSON.stringify(merge));
  if (!merge.ex["smith-squat"].s[0] || merge.ex["smith-squat"].s[0][0] !== "100") throw new Error("merge dropped sets");
  if (!merge.ex["lat-pulldown"]) throw new Error("merge dropped the other device's new exercise");

  const nov6ex = await page.evaluate(() => JSON.stringify(window.__nn.loadWo("2026-11-06").ex));
  await page.click("#woGoToday");
  await page.waitForFunction(() => document.getElementById("dLab").innerText === "TODAY");
  const switched = await page.evaluate(() => ({
    rec: document.getElementById("woRecDate").innerText,
    session: document.getElementById("dSub").dataset.session,
    nov6: JSON.stringify(window.__nn.loadWo("2026-11-06").ex)
  }));
  if (!/Recording\s+today/i.test(switched.rec)) throw new Error("today recording label: " + switched.rec);
  if (switched.nov6 !== nov6ex) throw new Error("switching to today moved or dropped Friday sets");

  await page.evaluate(() => {
    const row = (w, r) => ({ s: [[String(w), String(r)]], d: true });
    localStorage.setItem("nn-v1:wo:2026-11-09", JSON.stringify({
      plan: "upper", perf: "upper", perfAt: 9, done: false,
      ex: {
        "smith-squat": row(111, 8),
        "romanian-deadlift": row(111, 8),
        "smith-incline-press": row(222, 8),
        "cable-reverse-fly": row(222, 8)
      }
    }));
    window.__nn.setW("2026-11-09");
  });
  await page.waitForFunction(() => document.getElementById("loggedBar"));
  const amb = await page.evaluate(() => {
    const w = window.__nn.loadWo("2026-11-09");
    const vals = ["smith-squat", "romanian-deadlift", "smith-incline-press", "cable-reverse-fly"].map((id) => {
      const el = document.querySelector('input[data-id="' + id + '"][data-s="0"][data-f="0"]');
      return el ? el.value : null;
    });
    return {
      session: document.getElementById("dSub").dataset.session,
      text: document.getElementById("woSession").innerText,
      logged: document.getElementById("loggedBar").innerText,
      body: document.getElementById("woBody").innerText,
      vals,
      performed: window.__nn.recordedPid("2026-11-09", w),
      rec: document.getElementById("woRecDate").innerText
    };
  });
  if (amb.session === "upper" || /Upper \+ Abs/.test(amb.text)) throw new Error("ambiguous day used contaminated perf: " + amb.text);
  if (amb.performed !== null) throw new Error("ambiguous recorded " + amb.performed);
  if (amb.vals.join(",") !== "111,111,222,222") throw new Error("ambiguous sets hidden " + amb.vals);
  if (/0\/11/.test(amb.body)) throw new Error("ambiguous day showed an empty Upper counter");
  if (!/not today/i.test(amb.rec)) throw new Error("future/past date banner missing: " + amb.rec);
  const ambStore = await page.evaluate(() => localStorage.getItem("nn-v1:wo:2026-11-09"));
  for (const pid of ["push", "pull", "legs"]) {
    await page.locator('.pchip[data-p="' + pid + '"]').click();
    await page.waitForFunction((p) => document.getElementById("dSub").dataset.preview === p, pid);
    const still = await page.evaluate(() => ["smith-squat", "romanian-deadlift", "smith-incline-press", "cable-reverse-fly"].map((id) => document.querySelector('input[data-id="' + id + '"][data-s="0"][data-f="0"]').value).join(","));
    if (still !== "111,111,222,222") throw new Error("preview " + pid + " hid sets " + still);
  }
  if ((await page.evaluate(() => localStorage.getItem("nn-v1:wo:2026-11-09"))) !== ambStore) throw new Error("previewing an ambiguous day wrote the store");
  await page.evaluate(() => { window.__nn.loadWo("2026-11-09").perfFix = true; const w = JSON.parse(localStorage.getItem("nn-v1:wo:2026-11-09")); w.perfFix = true; localStorage.setItem("nn-v1:wo:2026-11-09", JSON.stringify(w)); window.__nn.setW("2026-11-09"); });
  await page.waitForFunction(() => document.getElementById("dSub").dataset.session === "upper");
  const kept = await page.evaluate(() => document.querySelector('input[data-id="smith-squat"][data-s="0"][data-f="0"]').value);
  if (kept !== "111") throw new Error("perfFix hid the other plan's sets");

  if (errors.length) throw new Error("page errors: " + errors.join("\n"));
  if (hits.get < 1) throw new Error("mock sync was never read");
  console.log(JSON.stringify({ ok: true, version: "2026.10.31-31", gets: hits.get, posts: hits.post, screenshots: ["nov6-legs-iphone13.png", "nov6-preview-upper-iphone13.png", "today-preview-does-not-reschedule-iphone13.png"] }));
  await browser.close();
  server.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
