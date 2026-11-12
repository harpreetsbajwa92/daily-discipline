/**
 * iPhone 13 check against a read-only copy of the live sync bin.
 * Confirms the routine view lists only that routine, and grey hints are the last log.
 * Any POST is a failure. The bin is never uploaded.
 * Run: node test/hide-offlist.mjs
 */
import { createRequire } from "module";
import http from "http";
import fs from "fs";
import path from "path";

const require = createRequire("/tmp/pw/node_modules/playwright/package.json");
const { chromium, devices } = require("playwright");

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PORT = 8768;
const LIVE = "https://api.npoint.io/84f3d4b3816e2dc69b41";

function getJson(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? require("https") : require("http");
    lib.get(url, { headers: { "User-Agent": "daily-discipline-test", "Accept": "application/json" } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        if (res.statusCode !== 200) reject(new Error("HTTP " + res.statusCode));
        else resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      });
    }).on("error", reject);
  });
}
function filled(x) { return x !== undefined && x !== null && String(x).trim() !== ""; }
function hasData(ex) {
  return ex && Array.isArray(ex.s) && ex.s.some((s) => s && s.some(filled));
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

async function main() {
  const bin = await getJson(LIVE);
  const posts = [];
  const server = await serve();
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext({ ...devices["iPhone 13"] });
  const seed = Object.entries(bin).filter(([k, v]) => k.startsWith("nn-v1:") && v && typeof v.v === "string").map(([k, v]) => [k, v.v]);
  await context.addInitScript((entries) => {
    if (sessionStorage.getItem("nn-live-seeded")) return;
    for (const [k, v] of entries) localStorage.setItem(k, v);
    sessionStorage.setItem("nn-live-seeded", "1");
  }, seed);
  await context.route("https://api.npoint.io/**", async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      posts.push(req.url());
      await route.fulfill({ status: 403, contentType: "application/json", body: "{\"blocked\":true}" });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(bin) });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto("http://127.0.0.1:" + PORT + "/index.html#workout", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__nn && document.getElementById("woRoster"));
  await page.waitForTimeout(2500);
  if (posts.length) throw new Error("sync POSTed on load: " + posts.length);

  const snap = await page.evaluate(() => {
    const o = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("nn-v1:")) o[k] = localStorage.getItem(k);
    }
    return o;
  });

  await page.evaluate(() => window.__nn.setW("2026-11-10"));
  if ((await page.evaluate(() => document.getElementById("dSub").dataset.viewing)) !== "push") {
    await page.locator('.pchip[data-p="push"]').click();
    await page.waitForFunction(() => document.getElementById("dSub").dataset.viewing === "push");
  }
  const push = await page.evaluate(() => {
    const ids = [...document.querySelectorAll("#woRoster .exc")].map((el) => el.dataset.id);
    const body = document.getElementById("woBody").innerText;
    const doneOff = [...document.querySelectorAll("#woRoster .exc.done")].filter((el) => {
      const id = el.dataset.id;
      const w = window.__nn.loadWo("2026-11-10").ex[id];
      const logged = w && Array.isArray(w.s) && w.s.some((s) => s && s.some((x) => x !== undefined && x !== null && String(x).trim() !== ""));
      return !logged;
    }).map((el) => el.dataset.id);
    return {
      ids, want: window.__nn.exIds("push"),
      off: /also logged|not in this list/i.test(body),
      hist: !!document.getElementById("woHist"),
      doneOff
    };
  });
  if (push.ids.join(",") !== push.want.join(",")) throw new Error("Nov 10 Push roster: " + push.ids.join(","));
  if (push.off || push.hist) throw new Error("Nov 10 Push still shows an off-list section");
  if (push.doneOff.length) throw new Error("green without a Nov 10 log: " + push.doneOff.join(","));
  await page.locator('.pchip[data-p="pull"]').click();
  await page.waitForFunction(() => document.getElementById("dSub").dataset.viewing === "pull");
  const pullView = await page.evaluate(() => {
    const body = document.getElementById("woBody").innerText;
    const ids = [...document.querySelectorAll("#woRoster .exc")].map((el) => el.dataset.id);
    const stored = Object.keys(window.__nn.loadWo("2026-11-10").ex || {});
    return {
      ids, want: window.__nn.exIds("pull"),
      off: /also logged|not in this list/i.test(body) || !!document.getElementById("woHist"),
      names: /Incline dumbbell press|Smith machine flat press/.test(body),
      stored: stored.indexOf("incline-db-press") >= 0 && stored.indexOf("smith-flat-press") >= 0
    };
  });
  if (pullView.ids.join(",") !== pullView.want.join(",")) throw new Error("Nov 10 Pull roster: " + pullView.ids.join(","));
  if (pullView.off || pullView.names) throw new Error("Push logs still drawn under Pull");
  if (!pullView.stored) throw new Error("hiding the section removed Nov 10 Push logs from storage");

  const offDate = await page.evaluate(() => {
    const dates = Object.keys(localStorage).map((k) => (k.match(/^nn-v1:wo:(\d{4}-\d{2}-\d{2})$/) || [])[1]).filter(Boolean).sort();
    for (let i = dates.length - 1; i >= 0; i--) {
      const d = dates[i];
      const w = window.__nn.loadWo(d);
      const pid = window.__nn.sessionPid(d, w) || "push";
      const roster = {};
      window.__nn.exIds(pid).forEach((id) => { roster[id] = 1; });
      const extra = Object.keys(w.ex || {}).filter((id) => {
        const e = w.ex[id];
        return e && Array.isArray(e.s) && e.s.some((s) => s && s.some((x) => x !== undefined && x !== null && String(x).trim() !== "")) && !roster[id];
      });
      if (extra.length) return { d, pid, extra };
    }
    return null;
  });
  if (!offDate) throw new Error("live copy has no day with an off-list log to check");
  await page.evaluate((d) => window.__nn.setW(d), offDate.d);
  const hidden = await page.evaluate((extra) => {
    const body = document.getElementById("woBody").innerText;
    const shown = [...document.querySelectorAll("#woRoster .exc")].map((el) => el.dataset.id);
    return {
      section: /also logged|not in this list/i.test(body) || !!document.getElementById("woHist"),
      leaked: extra.filter((id) => shown.indexOf(id) >= 0)
    };
  }, offDate.extra);
  if (hidden.section || hidden.leaked.length) throw new Error("off-list still visible on " + offDate.d + " " + JSON.stringify(hidden));

  await page.evaluate(() => window.__nn.setW("2026-11-10"));
  if ((await page.evaluate(() => document.getElementById("dSub").dataset.viewing)) !== "pull") {
    await page.locator('.pchip[data-p="pull"]').click();
    await page.waitForFunction(() => document.getElementById("dSub").dataset.viewing === "pull" && document.getElementById("dSub").dataset.date === "2026-11-10");
  }
  const hint = await page.evaluate(() => {
    const ids = window.__nn.exIds("pull");
    const w = window.__nn.loadWo(document.getElementById("dSub").dataset.date);
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const cur = w.ex[id];
      const logged = cur && Array.isArray(cur.s) && cur.s.some((s) => s && s.some((x) => x !== undefined && x !== null && String(x).trim() !== ""));
      if (logged) continue;
      const dates = Object.keys(localStorage).map((k) => (k.match(/^nn-v1:wo:(\d{4}-\d{2}-\d{2})$/) || [])[1]).filter((d) => d && d < "2026-11-10").sort();
      let last = null;
      for (let j = dates.length - 1; j >= 0 && !last; j--) {
        const prev = window.__nn.loadWo(dates[j]).ex[id];
        if (prev && Array.isArray(prev.s) && prev.s.some((s) => s && s.some((x) => x !== undefined && x !== null && String(x).trim() !== ""))) last = prev.s;
      }
      if (!last) continue;
      const weight = document.querySelector('#woRoster input[data-id="' + id + '"][data-s="0"][data-f="0"]');
      const reps = document.querySelector('#woRoster input[data-id="' + id + '"][data-s="0"][data-f="1"]');
      const card = document.querySelector('#woRoster .exc[data-id="' + id + '"]');
      const lw = last[0] && last[0][0] != null ? String(last[0][0]).trim() : "";
      const lr = last[0] && last[0][1] != null ? String(last[0][1]).trim() : "";
      return {
        id,
        value: weight ? weight.value : null,
        phW: weight ? weight.placeholder : null,
        phR: reps ? reps.placeholder : null,
        expectW: lw,
        expectR: lr,
        done: card.classList.contains("done")
      };
    }
    return null;
  });
  if (!hint) throw new Error("no Push exercise on Nov 10 had an earlier log to use as a grey hint");
  if (hint.value !== "") throw new Error("hint was filled in: " + JSON.stringify(hint));
  if (hint.phW !== hint.expectW || hint.phR !== hint.expectR) throw new Error("grey hint was not the last log: " + JSON.stringify(hint));
  if (hint.done) throw new Error("unlogged exercise marked done: " + hint.id);

  await page.locator('.pchip[data-p="pull"]').click();
  await page.locator("#dPrev").click();
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => {
    const o = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("nn-v1:")) o[k] = localStorage.getItem(k);
    }
    return o;
  });
  const keys = new Set([...Object.keys(snap), ...Object.keys(after)]);
  const changed = [...keys].filter((k) => snap[k] !== after[k]);
  if (changed.length) throw new Error("browse wrote " + changed.join(","));
  if (posts.length) throw new Error("sync POSTed during browse: " + posts.length);
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(JSON.stringify({ ok: true, version: "2026.10.31-36", posts: posts.length, offDate: offDate.d, offCount: offDate.extra.length, hint: hint.id }));
  await browser.close();
  server.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
