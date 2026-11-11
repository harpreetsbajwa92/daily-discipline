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

const require = createRequire("/tmp/pw/node_modules/playwright/package.json");
const { chromium, devices } = require("playwright");

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ART = "/opt/cursor/artifacts";
const PORT = 8765;
const TODAY = "2026-11-11";

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
  if (!version.includes("2026.10.31-35")) throw new Error("version text: " + version);
  const openedOn = await page.evaluate(() => ({ lab: document.getElementById("dLab").innerText, date: document.getElementById("dSub").dataset.date, rec: document.getElementById("woRecDate").innerText }));
  if (openedOn.lab !== "TODAY" || openedOn.date !== TODAY || !/Recording\s+today/i.test(openedOn.rec)) throw new Error("open did not start on today: " + JSON.stringify(openedOn));

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
  if (!/Recorded session:\s*Legs/.test(opened.text)) throw new Error("label: " + opened.text);
  if (opened.squat !== "100" || opened.squatOff) throw new Error("squat hidden, locked, or changed: " + opened.squat);
  if (!/Fri Nov 6/.test(opened.rec) || !/not today/i.test(opened.rec)) throw new Error("recording date: " + opened.rec);
  const friRoster = await page.evaluate(() => [...document.querySelectorAll("#woRoster .exc")].map((el) => el.dataset.id));
  const friHist = await page.evaluate(() => [...document.querySelectorAll("#woHist .exc")].map((el) => el.dataset.id));
  const legsIds = await page.evaluate(() => window.__nn.exIds("legs"));
  if (friRoster.join(",") !== legsIds.join(",")) throw new Error("Legs roster is not the fixed list: " + friRoster.join(","));
  if (friRoster.includes("smith-incline-press") || friRoster.includes("lat-pulldown")) throw new Error("off-plan exercise injected into Legs roster");
  if (friHist.length || /also logged/i.test(opened.also) || /not in this list/i.test(opened.also)) throw new Error("off-list section still shown");
  if (opened.also.includes("Smith machine incline press")) throw new Error("off-list exercise still drawn on the routine");
  const friStored = await page.evaluate(() => window.__nn.loadWo("2026-11-06").ex);
  if (!friStored["smith-incline-press"] || !friStored["smith-squat"]) throw new Error("hiding the off-list section deleted stored sets");
  if (opened.done.includes("/11")) throw new Error("done bar switched to Upper+Abs: " + opened.done);
  if (!opened.done.includes("/6")) throw new Error("expected legs counter /6: " + opened.done);
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
    squatStored: (window.__nn.loadWo("2026-11-06").ex["smith-squat"].s[0] || [])[0],
    squatOnScreen: !!document.querySelector("#woRoster [data-id='smith-squat']"),
    done: document.getElementById("doneBar").innerText,
    chip: document.querySelector(".pchip.on").innerText,
    recChip: (document.querySelector(".pchip.rec") || {}).innerText || "",
    viewing: document.getElementById("woViewing").innerText,
    roster: [...document.querySelectorAll("#woRoster .exc")].map((el) => el.dataset.id),
    hist: [...document.querySelectorAll("#woHist .exc")].map((el) => el.dataset.id)
  }));
  if (browsed.session !== "legs" || !/Recorded session:\s*Legs/.test(browsed.text)) throw new Error("browse relabeled: " + JSON.stringify(browsed));
  if (!/Upper \+ Abs/.test(browsed.viewing) || !/preview/i.test(browsed.viewing)) throw new Error("viewing label: " + browsed.viewing);
  if (browsed.squatStored !== "100" || browsed.squatOnScreen) throw new Error("Upper view showed or dropped Legs sets");
  const upperIds = await page.evaluate(() => window.__nn.exIds("upper"));
  if (browsed.roster.join(",") !== upperIds.join(",")) throw new Error("Upper preview roster changed: " + browsed.roster.join(","));
  if (browsed.roster.includes("smith-squat")) throw new Error("Legs exercise injected into Upper roster");
  if (browsed.hist.length || /also logged/i.test(browsed.banner + browsed.viewing)) throw new Error("off-list section while previewing");
  if (!browsed.banner.includes("Recorded session stays") || !browsed.banner.includes("Legs")) throw new Error("banner " + browsed.banner);
  if (!/upper/i.test(browsed.chip) || !/legs/i.test(browsed.recChip)) throw new Error("chips " + JSON.stringify(browsed));
  await page.screenshot({ path: path.join(ART, "nov6-preview-upper-iphone13.png") });
  await new Promise((r) => setTimeout(r, 2500));
  let delta = changedKeys(base, await dumpStore(page));
  if (delta.length) throw new Error("browse wrote store keys: " + delta.join(","));
  if (hits.post !== postsBeforeBrowse) throw new Error("browse synced a write");

  await page.click("#dPrev");
  await page.waitForFunction(() => document.getElementById("dSub").dataset.session === "pull" && document.getElementById("dSub").dataset.preview === "");
  const pullText = await page.locator("#woSession").innerText();
  if (!/Recorded session:\s*Pull \+ Abs/.test(pullText)) throw new Error("Nov 5 " + pullText);
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
  const oldKept = await page.evaluate(() => {
    const x = window.__nn.loadWo("2026-10-31").ex["incline-press"];
    return !!(x && x.s && x.s.length);
  });
  if (!oldKept) throw new Error("retired incline-press log was deleted");
  if (/Incline barbell press|also logged|not in this list/i.test(oldDay)) throw new Error("retired exercise still drawn on the routine");
  await page.evaluate(() => window.__nn.show("trends"));
  await page.waitForFunction(() => /incline barbell press/i.test(document.getElementById("exArea").innerText));
  await page.evaluate(() => window.__nn.show("workout"));
  delta = changedKeys(base, await dumpStore(page));
  if (delta.length) throw new Error("history view wrote " + delta.join(","));

  await page.evaluate((d) => window.__nn.setW(d), TODAY);
  await page.waitForFunction((d) => document.getElementById("dSub").dataset.date === d && document.getElementById("dSub").dataset.preview === "", TODAY);
  const beforeFuture = await page.evaluate((d) => ({
    next: window.__nn.rotInfo(d).next,
    session: document.getElementById("dSub").dataset.session,
    label: document.getElementById("woSession").innerText
  }), TODAY);
  const previewPick = beforeFuture.session === "push" ? "legs" : "push";
  await page.locator('.pchip[data-p="' + previewPick + '"]').click();
  await page.waitForFunction((p) => document.getElementById("dSub").dataset.preview === p, previewPick);
  const afterFuture = await page.evaluate((d) => ({
    next: window.__nn.rotInfo(d).next,
    session: document.getElementById("dSub").dataset.session,
    label: document.getElementById("woSession").innerText,
    viewing: document.getElementById("woViewing").innerText
  }), TODAY);
  if (afterFuture.session !== beforeFuture.session || afterFuture.label !== beforeFuture.label) throw new Error("today preview relabeled " + JSON.stringify({ beforeFuture, afterFuture }));
  if (!/preview/i.test(afterFuture.viewing)) throw new Error("viewing did not say preview: " + afterFuture.viewing);
  if (beforeFuture.next !== afterFuture.next) throw new Error("preview changed schedule " + JSON.stringify({ beforeFuture, afterFuture }));
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
      squat: (w.ex["smith-squat"].s[0] || [])[0],
      incline: document.querySelector('#woRoster input[data-id="smith-incline-press"][data-s="0"][data-f="0"]').value,
      squatOnScreen: !!document.querySelector('#woRoster [data-id="smith-squat"]'),
      body: document.getElementById("woBody").innerText,
      perf: w.perf, fix: w.perfFix, ex: JSON.stringify(w.ex)
    };
  });
  if (!/Recorded session:\s*Upper \+ Abs/.test(corrected.label)) throw new Error("correction label " + corrected.label);
  if (corrected.squat !== "100" || corrected.incline !== "40" || corrected.squatOnScreen) throw new Error("correction changed what is stored or drawn " + JSON.stringify(corrected));
  if (/also logged/i.test(corrected.body) || /not in this list/i.test(corrected.body)) throw new Error("off-list section returned");
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
    squat: (window.__nn.loadWo("2026-11-06").ex["smith-squat"].s[0] || [])[0],
    onScreen: !!document.querySelector("#woRoster [data-id='smith-squat']"),
    ex: JSON.stringify(window.__nn.loadWo("2026-11-06").ex)
  }));
  if (bAfter.session !== "upper" || bAfter.squat !== "100" || bAfter.onScreen || bAfter.ex !== exBefore) throw new Error("device B after sync " + JSON.stringify(bAfter));

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
  const nov7before = await page.evaluate(() => localStorage.getItem("nn-v1:wo:2026-11-07"));
  const beforeHint = await page.evaluate(() => document.getElementById("woSession").innerText);
  if (!/Recorded session:\s*Legs/.test(beforeHint)) {
    await page.locator('.pchip[data-p="legs"]').click();
    await page.waitForFunction(() => document.getElementById("dSub").dataset.viewing === "legs");
  }
  const hint = await page.evaluate(() => {
    const el = document.querySelector('#woRoster input[data-id="smith-squat"][data-s="0"][data-f="0"]');
    return {
      value: el ? el.value : "missing",
      ph: el ? el.placeholder : "",
      filled: [...document.querySelectorAll("#woRoster input")].filter((i) => i.value !== "").map((i) => i.dataset.id),
      roster: [...document.querySelectorAll("#woRoster .exc")].map((e) => e.dataset.id).join(","),
      recorded: document.getElementById("woSession").innerText,
      want: window.__nn.exIds("legs").join(",")
    };
  });
  if (hint.value !== "") throw new Error("today copied a historical squat into the box: " + hint.value);
  if (hint.ph !== "100") throw new Error("grey hint was not a placeholder: " + hint.ph);
  if (hint.filled.length) throw new Error("today roster has saved numbers: " + hint.filled.join(","));
  if (hint.roster !== hint.want) throw new Error("today Legs preview roster " + hint.roster);
  if (hint.recorded !== beforeHint) throw new Error("preview relabeled today: " + hint.recorded + " from " + beforeHint);
  if ((await page.evaluate(() => localStorage.getItem("nn-v1:wo:2026-11-07"))) !== nov7before) throw new Error("preview wrote today's workout");
  if ((await page.evaluate(() => JSON.stringify(window.__nn.loadWo("2026-11-06").ex))) !== nov6ex) throw new Error("preview changed Friday's sets");

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
  await page.waitForFunction(() => /no prescribed list/i.test(document.getElementById("woViewing").innerText));
  const amb = await page.evaluate(() => {
    const w = window.__nn.loadWo("2026-11-09");
    const stored = ["smith-squat", "romanian-deadlift", "smith-incline-press", "cable-reverse-fly"].map((id) => (w.ex[id].s[0] || [])[0]);
    return {
      session: document.getElementById("dSub").dataset.session,
      text: document.getElementById("woSession").innerText,
      body: document.getElementById("woBody").innerText,
      roster: [...document.querySelectorAll("#woRoster .exc")].map((el) => el.dataset.id),
      stored,
      performed: window.__nn.recordedPid("2026-11-09", w),
      rec: document.getElementById("woRecDate").innerText
    };
  });
  if (amb.session === "upper" || /Recorded session:\s*Upper/.test(amb.text)) throw new Error("ambiguous day used contaminated perf: " + amb.text);
  if (amb.performed !== null) throw new Error("ambiguous recorded " + amb.performed);
  if (amb.roster.length) throw new Error("ambiguous day invented a prescribed roster: " + amb.roster.join(","));
  if (/also logged|not in this list|Smith machine squat/i.test(amb.body)) throw new Error("off-list sets drawn with no roster");
  if (amb.stored.join(",") !== "111,111,222,222") throw new Error("ambiguous sets deleted " + amb.stored);
  if (!/not today/i.test(amb.rec)) throw new Error("date banner missing: " + amb.rec);
  const ambStore = await page.evaluate(() => localStorage.getItem("nn-v1:wo:2026-11-09"));
  for (const pid of ["push", "pull", "legs", "upper", "lower", "active", "none"]) {
    await page.locator('.pchip[data-p="' + pid + '"]').click();
    await page.waitForFunction((p) => document.getElementById("dSub").dataset.preview === p && document.getElementById("dSub").dataset.session === "", pid);
    const check = await page.evaluate((p) => {
      const want = p === "none" ? [] : window.__nn.exIds(p);
      const got = [...document.querySelectorAll("#woRoster .exc")].map((el) => el.dataset.id);
      const squat = document.querySelector('#woRoster input[data-id="smith-squat"][data-s="0"][data-f="0"]');
      const stored = (window.__nn.loadWo("2026-11-09").ex["smith-squat"].s[0] || [])[0];
      const off = document.getElementById("woBody").innerText;
      return { got: got.join(","), want: want.join(","), squat: squat ? squat.value : null, stored, recorded: document.getElementById("woSession").innerText, off: /also logged|not in this list/i.test(off) };
    }, pid);
    if (check.got !== check.want) throw new Error(pid + " roster " + check.got + " expected " + check.want);
    if (/Recorded session:\s*Upper/.test(check.recorded)) throw new Error("preview relabeled recorded session");
    if (check.stored !== "111") throw new Error(pid + " preview deleted squat " + check.stored);
    if (check.off) throw new Error(pid + " still shows an off-list section");
    const squatInPlan = check.want.split(",").indexOf("smith-squat") >= 0;
    if (squatInPlan && check.squat !== "111") throw new Error(pid + " did not show the set logged that day");
    if (!squatInPlan && check.squat !== null) throw new Error(pid + " showed a squat that is not in that list");
  }
  if ((await page.evaluate(() => localStorage.getItem("nn-v1:wo:2026-11-09"))) !== ambStore) throw new Error("previewing an ambiguous day wrote the store");
  await page.evaluate(() => { window.__nn.loadWo("2026-11-09").perfFix = true; const w = JSON.parse(localStorage.getItem("nn-v1:wo:2026-11-09")); w.perfFix = true; localStorage.setItem("nn-v1:wo:2026-11-09", JSON.stringify(w)); window.__nn.setW("2026-11-09"); });
  await page.waitForFunction(() => document.getElementById("dSub").dataset.session === "upper");
  const kept = await page.evaluate(() => ({
    stored: (window.__nn.loadWo("2026-11-09").ex["smith-squat"].s[0] || [])[0],
    onScreen: !!document.querySelector("#woRoster [data-id='smith-squat']"),
    section: /also logged|not in this list/i.test(document.getElementById("woBody").innerText)
  }));
  if (kept.stored !== "111" || kept.onScreen || kept.section) throw new Error("perfFix drew or dropped off-list sets " + JSON.stringify(kept));

  if (errors.length) throw new Error("page errors: " + errors.join("\n"));
  if (hits.get < 1) throw new Error("mock sync was never read");
  console.log(JSON.stringify({ ok: true, version: "2026.10.31-35", gets: hits.get, posts: hits.post }));
  await browser.close();
  server.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
