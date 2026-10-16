#!/usr/bin/env python3
"""Builds data/constituencies.json (the "Constituencies" tab) from the Bundeswahlleiterin CSV files.

  python py/build_constituencies.py btw25_kerg.csv btw2025_strukturdaten.csv [w-btw21_kerg.csv [btw17_kerg.csv]]

 - btw25_kerg.csv            official final result 2025 per Wahlkreis (also contains the 2021 result on the 2025 boundaries)
 - btw2025_strukturdaten.csv structural data per Wahlkreis (shown next to each constituency)
 - w-btw21_kerg.csv (optional) re-runs the accuracy check ("backtest") and supplies the 2017 results (its "Vorperiode"); btw17_kerg.csv (optional)
   is only used to report how many 2017 values are identical to the original 2017 result.
   To add 2017 to an existing data file without rebuilding: python py/build_constituencies.py --add-2017 w-btw21_kerg.csv [btw17_kerg.csv]
   To add the structural data of an earlier election ("About this constituency" when the map is switched to 2021 / 2017):
   python py/build_constituencies.py --add-struct 2021 btw21_strukturdaten.csv   (and likewise: --add-struct 2017 btw2017_strukturdaten.csv)
Needs numpy.  Data: (c) Die Bundeswahlleiterin, Wiesbaden (dl-de/by-2-0).
After (re)building this file run  python py/calibrate_model.py  once: it adds the "model" block (noise levels estimated from the 2017/2021/2025 results and
polls, plus a replay test) that the browser needs for the state-poll step and the win chances.
The projection itself runs in the browser (js/app.js): it takes the 2025 result of each constituency and shifts it,
party by party, to the current national poll average (ratio swing), so it updates by itself whenever the polls change.
"""
import csv, json, os, re, sys
import numpy as np

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # repo root (this script lives in py/)
KEYS = ["CDU/CSU", "AfD", "SPD", "Grüne", "Linke", "BSW", "FDP", "Freie Wähler", "Sonstige"]
PM = {"CDU/CSU": ["Christlich Demokratische Union Deutschlands", "Christlich-Soziale Union in Bayern e.V."],
      "SPD": ["Sozialdemokratische Partei Deutschlands"], "AfD": ["Alternative für Deutschland"], "Grüne": ["BÜNDNIS 90/DIE GRÜNEN"],
      "Linke": ["Die Linke", "DIE LINKE"], "FDP": ["Freie Demokratische Partei"],
      "BSW": ["Bündnis Sahra Wagenknecht - Vernunft und Gerechtigkeit"], "Freie Wähler": ["FREIE WÄHLER"]}
SIGMA_LOCAL, SIGMA_NATIONAL = 0.12, 0.10   # log-scale noise (see backtest); national = poll error + 3 years of drift
EPS = 0.002

def toi(x):
    try: return int(x.strip().replace(".", ""))
    except ValueError: return 0

def read_kerg(path):
    """Reads a Bundeswahlleiterin Wahlkreis result file (2017, 2021 or 2025 layout). Per Wahlkreis: second votes of the election
    itself ("end") and of the previous election recalculated to the same boundaries ("vor")."""
    r = list(csv.reader(open(path, encoding="utf-8-sig"), delimiter=";"))
    h = [i for i, x in enumerate(r) if x and x[0] == "Nr"][0]; hdr = r[h]
    gv = [i for i, x in enumerate(hdr) if x.startswith("Gültige")][0]
    cols = {}
    for i, x in enumerate(hdr):
        for p, names in PM.items():
            if x in names: cols.setdefault(p, []).append(i)
    out = {}
    for row in r[h + 3:]:
        # Wahlkreis rows only: state subtotals ("gehört zu" = 99) and the Bundesgebiet row are skipped
        if len(row) < gv + 4 or not row[0].strip().isdigit() or int(row[0]) > 299 or row[2].strip() in ("", "99"): continue
        rec = {"name": row[1], "end": {}, "vor": {}}
        for k, off in (("end", 2), ("vor", 3)):
            tot = toi(row[gv + off]); s = 0
            for p in PM:
                v = sum(toi(row[c + off]) for c in cols.get(p, [])); rec[k][p] = v; s += v
            rec[k]["Sonstige"] = max(0, tot - s); rec[k]["_valid"] = tot
        out[int(row[0])] = rec
    return out

def num(s):
    s = s.strip()
    return float(s.replace(".", "").replace(",", ".")) if re.match(r"^-?[\d.]+(,\d+)?$", s) else float("nan")

def read_struct(path):
    r = list(csv.reader(open(path, encoding="utf-8-sig"), delimiter=";"))
    i = [k for k, x in enumerate(r) if x and x[0] == "Land"][0]
    return {int(x[1]): (x[0], [num(c) for c in x]) for x in r[i + 1:] if len(x) > 3 and x[1].isdigit() and int(x[1]) <= 299}

def shares(K, k, ids):
    V = np.array([K[w][k]["_valid"] for w in ids], float)
    return np.array([[K[w][k][p] / K[w][k]["_valid"] for p in KEYS] for w in ids]), V

def project(Sb, V, T, iters=300):  # ratio swing: scale each party by a constant (log), renormalise per constituency, match national T
    c = np.zeros(len(KEYS)); L = np.log(np.maximum(Sb, 1e-6))
    for _ in range(iters):
        X = np.exp(L + c); X /= X.sum(1, keepdims=True); c += np.log(np.maximum(T, 1e-6) / ((V[:, None] * X).sum(0) / V.sum())) * .8
    X = np.exp(L + c); return X / X.sum(1, keepdims=True)

def backtest(K25, ids):
    """Start from the 2021 result (2025 boundaries), move it to the TRUE 2025 national result, compare with the actual 2025 result."""
    Sb, V = shares(K25, "vor", ids); Se, V5 = shares(K25, "end", ids)
    T = (V5[:, None] * Se).sum(0) / V5.sum(); X = project(Sb, V5, T)
    main = [KEYS.index(p) for p in ("CDU/CSU", "AfD", "SPD", "Grüne", "Linke", "FDP")]
    mae = float(np.abs(X - Se)[:, main].mean() * 100); right = float((X.argmax(1) == Se.argmax(1)).mean() * 100)
    close = np.sort(Se, 1); margin = (close[:, -1] - close[:, -2]) * 100
    return {"maePts": round(mae, 2), "leaderRightPct": round(right, 1), "n": len(ids),
            "leaderRightWhenMargin5PlusPct": round(float((X.argmax(1) == Se.argmax(1))[margin >= 5].mean() * 100), 1)}

def attach_2017(wk, K21, K17=None):
    """Adds the 2017 second-vote shares ("q") to every Wahlkreis whose area is verifiably the same in 2017/2021/2025.

    Constituency NUMBERS changed with the 2025 reform (e.g. 2025 no. 74 Berlin-Mitte was no. 75 in 2021), so numbers are never used.
    A 2025 constituency is linked to the 2021 constituency whose ACTUAL 2021 result equals the 2021 result stored for the 2025
    boundaries ("p", +-0.05 points = rounding). Exactly one such constituency must exist, otherwise no 2017 value is attached.
    The 2017 value is then the official "Vorperiode" of that 2021 constituency (2017 recalculated to the 2021 boundaries by the
    Bundeswahlleiterin). If the 2017 file is given, it is only used to report how many are identical to the original 2017 result."""
    sh = lambda r: [r[p] / r["_valid"] * 100 for p in KEYS]
    S21 = {n: sh(r["end"]) for n, r in K21.items()}
    kept = orig = 0; miss = []
    for rec in wk:
        rec.pop("q", None)
        c = [j for j, e in S21.items() if max(abs(x - y) for x, y in zip(e, rec["p"])) <= 0.0501]
        if len(c) != 1 or K21[c[0]]["vor"]["_valid"] <= 0: miss.append(rec["n"]); continue
        v = K21[c[0]]["vor"]; rec["q"] = [round(v[p] / v["_valid"] * 100, 1) for p in KEYS]; kept += 1
        if K17 and c[0] in K17 and all(K17[c[0]]["end"][p] == v[p] for p in KEYS + ["_valid"]): orig += 1
    print(f"2017 result attached to {kept} of {len(wk)} constituencies" + (f" ({orig} identical to the original 2017 result, the rest recalculated by the Bundeswahlleiterin to the 2021 boundaries)" if K17 else "")
          + f"; none for {len(miss)} with changed boundaries: {miss}")

# Columns of the structural-data tables, in the order of D in main(): population, foreign %, density, aged 18-34, aged 60+, college-qualified school leavers %, income, unemployment.
# The 2021 and 2025 files share one layout; in the 2017 file the college-qualification and income columns sit elsewhere (checked against the headers).
DEMO_COLS = {2025: [5, 7, 8, (12, 13), (15, 16), 32, 35, 46], 2021: [5, 7, 8, (12, 13), (15, 16), 32, 35, 46], 2017: [5, 7, 8, (12, 13), (15, 16), 33, 25, 46]}

def read_text_rows(path):
    """The 2017 file is CP 1252, the newer ones UTF-8 (with BOM)."""
    raw = open(path, "rb").read()
    try: txt = raw.decode("utf-8-sig")
    except UnicodeDecodeError: txt = raw.decode("cp1252")
    return list(csv.reader(txt.splitlines(), delimiter=";"))

def attach_struct(wk, path, year):
    """Adds the structural data of an earlier election (key \"d21\" / \"d17\") to every Wahlkreis whose AREA is the same as in 2025.

    Numbers can't be used (renumbered in 2025). A 2025 constituency is linked to the earlier-file row of the same state with the same name
    (or, if renamed, the closest area) and is only accepted if its area (km2) is within 1 %. The 2025 area is recomputed from population and
    density. This is checked against the 2017 result link of attach_2017: every constituency with a verified identical area has a deviation
    of <= 0.6 %, every one with changed boundaries >= 2 %, so 1 % separates them cleanly. Anything else gets no value (the page then shows
    the 2025 figures, labelled as such)."""
    r = read_text_rows(path)
    i = [k for k, x in enumerate(r) if x and x[0] == "Land"][0]
    rows = [x for x in r[i + 1:] if len(x) > 40 and x[1].isdigit() and int(x[1]) <= 299]
    cols = DEMO_COLS[year]
    assert len(rows) == 299, f"expected 299 Wahlkreise in the {year} file, found {len(rows)}"
    key = "d" + str(year)[2:]; kept = 0; miss = []
    for w in wk:
        w.pop(key, None)
        pop, dens = w["d"][0], w["d"][2]; area25 = pop * 1000 / dens
        same = [x for x in rows if x[0] == w["land"] and x[2] == w["name"]]
        cand = same or sorted((x for x in rows if x[0] == w["land"] and abs(num(x[5]) / pop - 1) < .10), key=lambda x: abs(num(x[4]) / area25 - 1))[:1]
        if not cand or abs(num(cand[0][4]) / area25 - 1) > .01: miss.append(w["n"]); continue
        x = cand[0]; v = [num(x[c[0]]) + num(x[c[1]]) if isinstance(c, tuple) else num(x[c]) for c in cols]
        if any(np.isnan(v)): miss.append(w["n"]); continue
        w[key] = [round(a, 1) for a in v]; kept += 1
    print(f"{year} structural data attached to {kept} of {len(wk)} constituencies; none for {len(miss)} with changed area: {miss}")

def main():
    if "--add-struct" in sys.argv:   # python py/build_constituencies.py --add-struct 2021 btw21_strukturdaten.csv
        a = [x for x in sys.argv[1:] if not x.startswith("-")]
        path = os.path.join(HERE, "data", "constituencies.json"); out = json.load(open(path, encoding="utf-8"))
        attach_struct(out["wk"], a[1], int(a[0]))
        json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":")); return
    if "--add-2017" in sys.argv:   # python py/build_constituencies.py --add-2017 w-btw21_kerg.csv [btw17_kerg.csv]: patch the existing data file
        a = [x for x in sys.argv[1:] if not x.startswith("-")]
        path = os.path.join(HERE, "data", "constituencies.json"); out = json.load(open(path, encoding="utf-8"))
        assert out["parties"] == KEYS
        attach_2017(out["wk"], read_kerg(a[0]), read_kerg(a[1]) if len(a) > 1 else None)
        json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":")); return
    a = [x for x in sys.argv[1:] if not x.startswith("-")]
    if len(a) < 2: sys.exit(__doc__)
    K25 = read_kerg(a[0]); S25 = read_struct(a[1]); ids = sorted(K25)
    assert len(ids) == 299 and set(S25) >= set(ids), "expected 299 Wahlkreise"
    # demographics shown in the side panel: (label, column in the Strukturdaten table, number of decimals)
    D = [("Population (1,000)", 5, 0), ("Foreign population %", 7, 1), ("Density (per km²)", 8, 0), ("Aged 18–34 %", (12, 13), 1),
         ("Aged 60+ %", (15, 16), 1), ("School leavers qualified for college %", 32, 1), ("Disposable income (€ per head)", 35, 0), ("Unemployment rate %", 46, 1)]
    def dv(row, c): return round(sum(row[j] for j in c) if isinstance(c, tuple) else row[c], 1)
    wk = []
    for w in ids:
        k = K25[w]; v = k["end"]["_valid"]; vv = k["vor"]["_valid"]
        wk.append({"n": w, "name": S25[w][1][2] if False else k["name"], "land": S25[w][0], "v": v,
                   "s": [round(k["end"][p] / v * 100, 2) for p in KEYS], "p": [round(k["vor"][p] / vv * 100, 1) for p in KEYS],
                   "d": [dv(S25[w][1], c) for _, c, _ in D]})
    out = {"source": "Die Bundeswahlleiterin (final result 2025, structural data 2025)", "parties": KEYS,
           "sigmaLocal": SIGMA_LOCAL, "sigmaNational": SIGMA_NATIONAL,
           "demo": [{"label": l, "dec": d} for l, _, d in D], "wk": wk}
    out["backtest"] = backtest(K25, ids)
    # optional: 2021 pair -> same check one election earlier (2017 -> 2021 with the true 2021 national result)
    if len(a) >= 3:
        K21 = read_kerg(a[2]); out["backtest21"] = backtest(K21, sorted(K21))
        attach_2017(wk, K21, read_kerg(a[3]) if len(a) >= 4 else None)
    with open(os.path.join(HERE, "data", "constituencies.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print("data/constituencies.json written;", out["backtest"], out.get("backtest21", ""))

if __name__ == "__main__":
    main()
