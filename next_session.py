#!/usr/bin/env python3
"""Nightly next-session helper. Same rule as the workout tab in index.html.

Rotation (actual logged sessions only, never the weekday name and never a routine preview):
  Push -> Pull + Abs -> Legs -> active rest -> Upper + Abs -> Lower + Abs -> rest -> Push

A strength day advances to the session after it. A day with nothing logged, active rest,
or rest uses up a pending active-rest or rest slot, and carries a pending strength
session forward (a missed lift is not skipped).

v2026.10.31-30 change versus the v29 helper:
  Trust wo.perf only when wo.perfFix is set (the separate "I did this session" action).
  Otherwise infer the session from exercises that have logged numbers.
  A perf/plan written by tapping a routine chip is not the performed session.
  Explicit correction never deletes exercises or sets.

This file never writes to the sync bin. --repair-preview only prints a summary.
--repair-write writes a local JSON file the parent can review. It does not POST.

Replace the parent copy at /workspace/dd-backups/next_session.py with this file.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta

ABS = ["hanging-leg-raises", "cable-crunch", "plank", "cable-woodchoppers"]
# Strength ids only. Steps and the incline walk are active rest, not a lift.
PLANS = {
    "push": ["incline-db-press", "smith-flat-press", "seated-db-shoulder-press", "lateral-raises", "rope-pushdown", "overhead-triceps-extension"],
    "pull": ["lat-pulldown", "chest-supported-row", "seated-cable-row", "face-pulls", "db-curl", "hammer-curl"] + ABS,
    "legs": ["smith-squat", "romanian-deadlift", "heels-elevated-goblet-squat", "cable-leg-curl", "smith-calf-raise"],
    "upper": ["smith-incline-press", "lat-pulldown", "lateral-raises", "cable-reverse-fly", "superset-db-curl", "superset-rope-pushdown"] + ABS,
    "lower": ["bulgarian-split-squat", "hip-thrust", "cable-leg-extension", "cable-leg-curl"] + ABS,
    "active": [],
}
PLAN_ORDER = ["push", "pull", "legs", "upper", "lower", "active"]
ROT = ["push", "pull", "legs", "active", "upper", "lower", "none"]
SUGGEST = ["none", "push", "pull", "legs", "active", "upper", "lower"]  # Sun..Sat, only when there is no history
NAMES = {"push": "Push", "pull": "Pull + Abs", "legs": "Legs", "upper": "Upper + Abs", "lower": "Lower + Abs", "active": "Active rest", "none": "Rest"}


def plan_name(pid):
    return NAMES.get(pid, "-")


def shift(day, n):
    d = datetime.strptime(day, "%Y-%m-%d") + timedelta(days=n)
    return d.strftime("%Y-%m-%d")


def weekday_plan(day):
    # JS Date.getDay is Sunday 0 .. Saturday 6. isoweekday is Monday 1 .. Sunday 7.
    return SUGGEST[datetime.strptime(day, "%Y-%m-%d").isoweekday() % 7]


def rot_next(pid):
    return ROT[(ROT.index(pid) + 1) % len(ROT)]


def filled(x):
    return x is not None and str(x).strip() != ""


def ex_has_data(e):
    if not isinstance(e, dict) or not isinstance(e.get("s"), list):
        return False
    return any(isinstance(s, list) and any(filled(x) for x in s) for s in e["s"])


def has_sets(w):
    ex = (w or {}).get("ex") or {}
    return any(i not in ("steps", "incline-walk") and ex_has_data(ex[i]) for i in ex)


def did_active(w):
    ex = (w or {}).get("ex") or {}
    steps = ex.get("steps") if isinstance(ex.get("steps"), dict) else {}
    return bool((steps or {}).get("d") or ex_has_data(ex.get("incline-walk")))


def valid_pid(p):
    return p in PLANS or p == "none"


def explicit_pid(w):
    if w and w.get("perfFix") and valid_pid(w.get("perf")):
        return w["perf"]
    return None


def infer_session(w):
    """Unique plan that owns more than half the logged strength exercises, else None."""
    w = w or {}
    ex = w.get("ex") or {}
    ids = [i for i in ex if i not in ("steps", "incline-walk") and ex_has_data(ex[i])]
    if not ids:
        return "active" if did_active(w) else None
    def sc(p):
        have = set(ids)
        return sum(1 for e in PLANS[p] if e in have)
    best, bs, tie = None, 0, False
    for p in PLAN_ORDER:
        if p == "active":
            continue
        v = sc(p)
        if v > bs:
            best, bs, tie = p, v, False
        elif v == bs and v > 0:
            tie = True
    if best and not tie and bs * 2 > len(ids):
        return best
    return None


def plan_of(day, w):
    w = w or {}
    return w.get("plan") or weekday_plan(day)


def recorded_pid(day, w):
    w = w or {}
    ex = explicit_pid(w)
    if ex:
        return ex
    inf = infer_session(w)
    if inf:
        return inf
    if has_sets(w):
        if w.get("perf") and w.get("perfAt") and valid_pid(w.get("perf")) and w["perf"] not in ("none", "active"):
            return w["perf"]
        base = plan_of(day, w)
        if valid_pid(base) and base not in ("none", "active"):
            return base
        return "active"
    if did_active(w):
        return "active"
    if w.get("done") and valid_pid(w.get("plan")):
        return w["plan"]
    return None


def performed_on(day, w):
    if not w:
        return None
    ex = explicit_pid(w)
    if ex:
        if ex in ("active", "none") and has_sets(w):
            over = infer_session(w)
            return over if over and over != "active" else "active"
        return None if ex == "none" else ex
    if has_sets(w):
        p = infer_session(w)
        if p and p != "active":
            return p
        if w.get("perf") and w.get("perfAt") and valid_pid(w.get("perf")) and w["perf"] not in ("none", "active"):
            return w["perf"]
        return "active"
    return "active" if did_active(w) else None


def rot_info(workouts, target, today):
    days = sorted(d for d in workouts if d < target)
    if not days:
        return {"next": weekday_plan(target), "last": None, "lastDate": None}
    ptr = last = ld = None
    d = days[0]
    while d < target:
        p = performed_on(d, workouts.get(d)) if d <= today else ptr
        if p and p not in ("active", "none"):
            ptr = rot_next(p)
            if d <= today:
                last, ld = p, d
        elif ptr in ("active", "none"):
            ptr = rot_next(ptr)
        d = shift(d, 1)
    return {"next": ptr or "push", "last": last, "lastDate": ld}


def next_up(workouts, today):
    """What the Workout tab calls Next up: today's slot if nothing is logged yet, else tomorrow."""
    w = workouts.get(today)
    trained = bool(w and (has_sets(w) or did_active(w)))
    return rot_info(workouts, shift(today, 1) if trained else today, today)


def workouts_from_bin(blob):
    """Accept a npoint envelope or a plain {date: workout} map. Does not mutate blob."""
    out = {}
    if not isinstance(blob, dict):
        raise SystemExit("backup is not a JSON object")
    for k, env in blob.items():
        day = None
        raw = None
        if k.startswith("nn-v1:wo:"):
            day = k.split("wo:", 1)[1]
            raw = env.get("v") if isinstance(env, dict) and "v" in env else env
        elif len(k) == 10 and k[4] == "-" and isinstance(env, dict) and ("ex" in env or "plan" in env):
            day, raw = k, env
        if not day:
            continue
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except json.JSONDecodeError:
                continue
        if isinstance(raw, dict):
            out[day] = raw
    return out


def _wo_env(blob, day):
    key = "nn-v1:wo:" + day
    env = blob.get(key)
    if isinstance(env, dict) and isinstance(env.get("v"), str):
        wo = json.loads(env["v"])
        return key, env, wo
    return None, None, None


def propose_repair(blob):
    """Field-level repairs for browsing-contaminated perf. Never drops an exercise or a set.

    Returns a list of {key, day, changes, reason, exercises}. changes maps field -> new value,
    or None when the field should be removed. ex is never in changes.
    """
    notes = []
    for day in sorted(workouts_from_bin(blob)):
        key, env, wo = _wo_env(blob, day)
        if wo is None:
            # plain map, still describe it
            wo = workouts_from_bin(blob)[day]
            key = day
        inf = infer_session(wo)
        perf = wo.get("perf")
        fix = bool(wo.get("perfFix"))
        n_ex = len((wo.get("ex") or {}))
        if not fix and perf and inf and perf != inf and has_sets(wo):
            notes.append({
                "key": key, "day": day, "exercises": n_ex,
                "reason": "stored perf %r disagrees with the logged session %r and perfFix is not set (routine browsing used to write perf)" % (perf, inf),
                "changes": {"perf": inf, "plan": inf, "perfFix": True},
            })
        elif not has_sets(wo) and not did_active(wo) and not wo.get("done") and (wo.get("perf") or (wo.get("plan") and not inf)):
            if wo.get("perf") or wo.get("perfAt") or wo.get("plan"):
                notes.append({
                    "key": key, "day": day, "exercises": n_ex,
                    "reason": "no sets and no active-rest tick, but plan/perf is set (%r / %r). Treat as a preview that was saved by mistake" % (wo.get("plan"), wo.get("perf")),
                    "changes": {"plan": None, "perf": None, "perfAt": None, "perfFix": None},
                })
    return notes


def apply_repair(blob):
    """Return a deep copy with only the proposed field edits. Every ex object is unchanged."""
    out = json.loads(json.dumps(blob))
    for note in propose_repair(blob):
        key = note["key"]
        if key not in out or not isinstance(out[key], dict) or not isinstance(out[key].get("v"), str):
            continue
        wo = json.loads(out[key]["v"])
        before_ex = json.dumps(wo.get("ex"), sort_keys=True)
        for field, value in note["changes"].items():
            if field == "ex":
                raise RuntimeError("repair tried to touch exercises")
            if value is None:
                wo.pop(field, None)
            else:
                wo[field] = value
        after_ex = json.dumps(wo.get("ex"), sort_keys=True)
        if before_ex != after_ex:
            raise RuntimeError("repair changed exercises on " + key)
        out[key]["v"] = json.dumps(wo, separators=(",", ":"), ensure_ascii=False)
    return out


def _print_days(workouts, today):
    print("today %s" % today)
    info = next_up(workouts, today)
    print("next %s (%s)" % (info["next"], plan_name(info["next"])))
    if info["last"]:
        print("last %s (%s) on %s" % (info["last"], plan_name(info["last"]), info["lastDate"]))
    for day in sorted(workouts):
        w = workouts[day]
        perf = performed_on(day, w)
        print("  %s performed %s stored-plan %s stored-perf %s perfFix %s" % (
            day, perf, w.get("plan"), w.get("perf"), bool(w.get("perfFix"))))


def _synthetic():
    def sets(*pairs):
        return {"s": [[str(a), str(b)] for a, b in pairs], "d": True}
    def wo(plan, ex, **extra):
        o = {"plan": plan, "ex": ex, "done": extra.pop("done", True)}
        o.update(extra)
        return o
    return {
        "2026-10-31": wo("upper", {i: sets((50, 8)) for i in ("smith-incline-press", "lat-pulldown", "lateral-raises", "cable-reverse-fly", "superset-db-curl", "superset-rope-pushdown")} | {"incline-press": sets((40, 8))}),
        "2026-11-01": wo("active", {i: sets((40, 10)) for i in ("bulgarian-split-squat", "hip-thrust", "cable-leg-extension", "cable-leg-curl", "hanging-leg-raises", "cable-crunch", "plank", "cable-woodchoppers")}),
        "2026-11-02": wo("active", {"steps": {"s": [], "d": True}}, done=False),
        "2026-11-03": wo("push", {i: sets((40, 8)) for i in PLANS["push"]}, perf="push", perfAt=1),
        "2026-11-04": wo("active", {"steps": {"s": [], "d": True}}, perf="active", perfAt=2),
        "2026-11-05": wo("pull", {i: sets((40, 8)) for i in ("lat-pulldown", "chest-supported-row", "seated-cable-row", "face-pulls", "db-curl", "hammer-curl", "hanging-leg-raises", "cable-crunch", "plank")}),
        "2026-11-06": wo("upper", {
            "smith-squat": sets((100, 8), (100, 8), (100, 6), (100, 5)),
            "romanian-deadlift": sets((80, 8)),
            "heels-elevated-goblet-squat": sets((40, 10)),
            "cable-leg-curl": sets((30, 12)),
            "smith-calf-raise": sets((70, 15)),
            "smith-incline-press": sets((40, 10)),
            "lat-pulldown": sets((50, 10)),
        }, done=False, perf="upper", perfAt=3),
        "2026-11-07": {"plan": "upper", "perf": "upper", "perfAt": 4, "ex": {}, "done": False},
    }


def self_test():
    w = _synthetic()
    assert infer_session(w["2026-11-06"]) == "legs", infer_session(w["2026-11-06"])
    assert performed_on("2026-11-06", w["2026-11-06"]) == "legs"
    assert infer_session(w["2026-11-01"]) == "lower"
    assert performed_on("2026-11-04", w["2026-11-04"]) == "active"
    assert rot_info(w, "2026-11-05", "2026-11-07")["next"] == "pull"  # missed pull carried across active rest
    assert rot_info(w, "2026-11-06", "2026-11-07")["next"] == "legs"
    assert rot_info(w, "2026-11-07", "2026-11-07")["next"] == "active"
    assert rot_info(w, "2026-11-08", "2026-11-07")["next"] == "upper"  # unused active-rest slot is consumed
    assert next_up(w, "2026-11-07")["next"] == "active"
    # browsing must not be modeled as a write; the stored upper perf is already ignored
    assert recorded_pid("2026-11-07", w["2026-11-07"]) is None
    # explicit correction overrides inference and keeps the caller-supplied exercises
    corrected = json.loads(json.dumps(w["2026-11-06"]))
    ex_before = json.dumps(corrected["ex"], sort_keys=True)
    corrected["perf"] = "upper"
    corrected["perfFix"] = True
    corrected["plan"] = "upper"
    assert performed_on("2026-11-06", corrected) == "upper"
    assert json.dumps(corrected["ex"], sort_keys=True) == ex_before
    blob = {"_rev": 1}
    for day, wo in w.items():
        blob["nn-v1:wo:" + day] = {"t": 1, "v": json.dumps(wo, separators=(",", ":"))}
        blob["nn-v1:meals:" + day] = {"t": 1, "v": "{\"v\":2,\"meals\":[{\"id\":\"keep\"}]}"}
    notes = propose_repair(blob)
    days = [n["day"] for n in notes]
    assert days == ["2026-11-06", "2026-11-07"], days
    repaired = apply_repair(blob)
    for k, env in blob.items():
        if not k.startswith("nn-v1:wo:"):
            assert repaired[k] == env
        else:
            assert json.loads(repaired[k]["v"]).get("ex") == json.loads(env["v"]).get("ex")
    wo6 = json.loads(repaired["nn-v1:wo:2026-11-06"]["v"])
    assert wo6["perf"] == "legs" and wo6["perfFix"] is True and "smith-squat" in wo6["ex"]
    wo7 = json.loads(repaired["nn-v1:wo:2026-11-07"]["v"])
    assert "perf" not in wo7 and "plan" not in wo7 and wo7["ex"] == {}
    print("self-test ok")
    return 0


def main(argv):
    p = argparse.ArgumentParser(description="Next session from actual logged workouts")
    p.add_argument("--file", help="local backup JSON (npoint envelope or date map). Never fetched unless --url is passed")
    p.add_argument("--url", help="GET a backup. This script never POSTs")
    p.add_argument("--today", help="YYYY-MM-DD (default: today in local time)")
    p.add_argument("--repair-preview", action="store_true", help="print field repairs; do not write")
    p.add_argument("--repair-write", help="write a repaired copy to this local path; does not upload")
    p.add_argument("--self-test", action="store_true")
    args = p.parse_args(argv)
    if args.self_test:
        return self_test()
    if args.url and args.file:
        raise SystemExit("pass only one of --file or --url")
    if args.url:
        import urllib.request
        with urllib.request.urlopen(args.url, timeout=30) as r:
            blob = json.loads(r.read().decode())
    elif args.file:
        with open(args.file, encoding="utf-8") as f:
            blob = json.load(f)
    else:
        raise SystemExit("pass --file, --url, or --self-test")
    today = args.today or datetime.now().strftime("%Y-%m-%d")
    workouts = workouts_from_bin(blob)
    _print_days(workouts, today)
    if args.repair_preview or args.repair_write:
        notes = propose_repair(blob)
        print("repair-preview (%d day(s); exercises are not deleted)" % len(notes))
        if not notes:
            print("  none")
        for n in notes:
            print("  %s exercises-kept %d" % (n["key"], n["exercises"]))
            print("    %s" % n["reason"])
            print("    fields %s" % json.dumps(n["changes"], sort_keys=True))
        if args.repair_write:
            repaired = apply_repair(blob)
            with open(args.repair_write, "w", encoding="utf-8") as f:
                json.dump(repaired, f, ensure_ascii=False, separators=(",", ":"))
            print("wrote %s (local only, not uploaded)" % args.repair_write)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
