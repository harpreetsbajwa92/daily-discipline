# Transformation tracker + Daily Discipline

**Live app:** https://harpreetsbajwa92.github.io/daily-discipline/ (`index.html`)

## Transformation (index.html)
Phone-first tracker for a 2–3 month cut (program starts Sat Oct 31, 2026). Single HTML file, no build step, data in `localStorage` (one key: `transformation-tracker`, schema `version: 1`).

- **Today:** morning check-in (weight, energy/hunger/soreness 1–10, sleep), WHOOP numbers (calories burned, steps, strain, recovery %), five habits (3 L water, protein goal, 5,000 steps, workout, personal development). Steps and protein auto-tick from the numbers; tap to override.
- **Food:** log per meal (Breakfast, Pre-gym, Post-gym, Lunch, Snack, Dinner) from a built-in food library or custom foods (saved to the library). Copy yesterday's meals, meal templates, live totals vs targets.
- **Week:** waist at belly button, progress-photo checklist (front/side/back, no images stored).
- **Trends:** weight + 7-day average, calories eaten vs burned, protein, waist, habit streaks, weekly averages table (inline SVG, works offline).
- **History:** calendar + list of logged days; tap to edit any day. ‹ › in the header steps through days.
- **Send to Fitness** (share icon): compact text summary of the selected day via the share sheet, or copied to clipboard.
- **Settings (gear):** targets (default 1,800 kcal, P 150, F 50, C = rest), steps goal, start date, food library, Export/Import JSON backup.

On iPhone: open in Safari → Share → **Add to Home Screen**, and always open it from that icon (Safari and the Home Screen app keep separate storage). Export a backup weekly.

WHOOP data shape per day (`days[YYYY-MM-DD].whoop`): `{ caloriesBurned, steps, strain, recovery, source: 'manual'|'whoop', syncedAt }`, ready for a future API sync.

## Old habit tracker
The earlier Daily Discipline app is kept as `habits.html` (phone) and `desktop.html`. Its notes follow.

# Daily Discipline

A mobile-friendly habit tracker for **Harpreet** — five daily habits (fitness + personal development), streaks, and local backups.

## How to use

1. Open `index.html` in any modern browser (Chrome, Safari, Firefox, Edge).
2. On your phone: open the file (or host it / AirDrop it), then **Add to Home Screen** / bookmark it for an app-like shortcut.
3. Tap the five habit cards on **Today**, then hit **Save / Log today**.
4. At night, use **Log tonight** for a guided one-question-at-a-time check-in.

Works offline once the page has been opened — no internet required after that.

## On your phone

Use **`habits.html`** (formerly mobile.html), the phone-first version (same habits, same data format as `index.html`).

1. Put `mobile.html` somewhere Safari can open as a web address (any static host such as GitHub Pages or Netlify Drop, or your own site). iPhone Safari can't add a local file to the Home Screen.
2. Open it in **Safari**, tap **Share → Add to Home Screen**. It installs as **Discipline** with its own icon.
3. **Always open it from that Home Screen icon.** On iPhone, Safari and the Home Screen app keep separate storage, so logs saved in one won't show up in the other.
4. Each night: tap **Log tonight** (big Yes/No buttons, one question at a time, then calories), then **Send to Fitness**. That opens the share sheet (or copies to clipboard) with a short summary you can paste into the Fitness chat.
5. **Back up weekly:** tap the ⬇ button (top right), then **Export backup** (choose “Save to Files”) or **Copy backup as text**. To restore on a new phone, pick the file or paste the text under **Import** (Merge or Replace).

Phone extras: ‹ › day switcher to fix a missed day (or tap a day in History), Yesterday/Today toggle in the wizard (defaults to yesterday before 4am), unsaved edits survive the app being closed, and a one-time banner plus weekly backup reminder.

## Going back to past days

- **Today screen:** tap **‹ / ›** beside the date (or swipe it on the phone, or press ←/→ on a computer) to step through days. **›** stops at today, and future dates can't be opened.
- **Calendar:** tap the big date to open a month calendar. Any past day can be opened, back to any month.
- On a past day you'll see a gold **"Viewing Wed Oct 7"** bar with **Jump to today**. Edit the checks or numbers and tap **Save Oct 7**. If you switch days with unsaved changes, the app asks first.
- **History** lists every logged day plus the days you missed this month (and the last 7 days), shown as *Missed · not logged*. Tap any row to open it. **Progress:** tap any square in the 30-day grid.
- **Night check-in:** choose **Yesterday**, **Today**, or **📅 Pick** to log any past date.

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
