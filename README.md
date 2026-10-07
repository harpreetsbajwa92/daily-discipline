# Daily Discipline

A mobile-friendly habit tracker for **Harpreet Singh** — five daily habits (fitness + personal development), streaks, and local backups.

## How to use

1. Open `index.html` in any modern browser (Chrome, Safari, Firefox, Edge).
2. On your phone: open the file (or host it / AirDrop it), then **Add to Home Screen** / bookmark it for an app-like shortcut.
3. Tap the five habit cards on **Today**, then hit **Save / Log today**.
4. At night, use **Log tonight** for a guided one-question-at-a-time check-in.

Works offline once the page has been opened — no internet required after that.

## On your phone

Use **`mobile.html`**, the phone-first version (same habits, same data format as `index.html`).

1. Put `mobile.html` somewhere Safari can open as a web address (any static host such as GitHub Pages or Netlify Drop, or your own site). iPhone Safari can't add a local file to the Home Screen.
2. Open it in **Safari**, tap **Share → Add to Home Screen**. It installs as **Discipline** with its own icon.
3. **Always open it from that Home Screen icon.** On iPhone, Safari and the Home Screen app keep separate storage, so logs saved in one won't show up in the other.
4. Each night: tap **Log tonight** (big Yes/No buttons, one question at a time, then calories), then **Send to Fitness**. That opens the share sheet (or copies to clipboard) with a short summary you can paste into the Fitness chat.
5. **Back up weekly:** tap the ⬇ button (top right), then **Export backup** (choose “Save to Files”) or **Copy backup as text**. To restore on a new phone, pick the file or paste the text under **Import** (Merge or Replace).

Phone extras: ‹ › day switcher to fix a missed day (or tap a day in History), Yesterday/Today toggle in the wizard (defaults to yesterday before 4am), unsaved edits survive the app being closed, and a one-time banner plus weekly backup reminder.

## What it tracks

| Habit | Type |
|-------|------|
| Drank 3 liters of water | Yes / No |
| Hit protein intake | Yes / No |
| Walked 5,000 steps | Yes / No (+ optional step count) |
| Worked out | Yes / No |
| Personal development (read, learn, or practice a skill) | Yes / No |

### Daily metrics (not required for streak)

| Metric | Type |
|--------|------|
| Calories burned (from WHOOP or your tracker) | Number (optional) |

## Features

- **Today** dashboard with big date and tappable habit cards
- **Streak** — consecutive days with all 5 habits complete
- **Weekly consistency %** and score
- **30-day heatmap** on the Progress tab
- **History** list of past days
- **Log tonight** wizard for end-of-day check-in
- **Export / Import JSON** to back up or move devices
- **Calories burned** optional daily number (WHOOP / tracker)
- Motivational one-liner on the home screen

## Data storage

All data stays on your device in the browser’s **localStorage** under the key:

```
harpreet-fitness-daily-v1
```

Nothing is uploaded to a server. Clearing site data / cache for this origin will wipe logs — use **Settings → Export JSON** regularly.

Entries may include a `personalDev` boolean and a `caloriesBurned` number (both added later). Older saved days without those fields still load; missing `personalDev` is treated as not done, and missing `caloriesBurned` is treated as null. Calories are optional and do **not** affect the perfect-day streak (still all 5 yes habits).

To move phones or browsers: Export JSON on the old device → Import JSON on the new one.

## Fitness bot reminder

The Fitness bot will ping Harpreet each night to log. When that ping arrives, open this page (or the home-screen bookmark) and run **Log tonight**.

## Files

- `index.html` — the full app (CSS + JS embedded; no build step, no CDN)
- `mobile.html` — phone-first version for iPhone / Home Screen (same storage key and schema)
- `README.md` — this file
