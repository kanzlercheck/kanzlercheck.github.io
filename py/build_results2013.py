#!/usr/bin/env python3
"""Builds data/results2013.json: the 2013 Bundestag result (first AND second votes) per constituency, used only by py/calibrate_model.py
(noise levels + replay test 2013 -> 2017).  The browser does not load it.

  python py/build_results2013.py btw13_kerg.csv

Input: the Bundeswahlleiter file "btw13_kerg.csv" (2013 result on the 2013 boundaries; Windows-1252 text).  Data: (c) Der Bundeswahlleiter, Wiesbaden.
Only constituencies that have the same number AND name in 2025 are kept (the 2013 boundaries are then taken to be unchanged; the same rule
py/build_firstvotes.py uses for 2017).  Keys are the 2025 constituency numbers.  Shares are in % of valid votes, in the order of K below
(the order of app.js / calibrate_model.py; CDU and CSU are one party; Free Voters, Pirates, NPD, ... = Sonstige; BSW did not exist = 0).
"""
import csv, io, json, os, re, sys
K = ["CDU/CSU", "AfD", "SPD", "Grüne", "Linke", "BSW", "FDP", "Sonstige"]
G = {"CDU": 0, "CSU": 0, "AfD": 1, "SPD": 2, "GRÜNE": 3, "DIE LINKE": 4, "FDP": 6}
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
norm = lambda s: re.sub(r"\s+", " ", s.replace("–", "-").replace("—", "-")).strip().lower()
def toi(x):
    x = (x or "").strip().replace(".", "")
    return int(x) if x.isdigit() else 0
def main(path):
    r = list(csv.reader(io.StringIO(open(path, "rb").read().decode("cp1252")), delimiter=";"))
    h = next(i for i, x in enumerate(r) if x and x[0] == "Nr"); hdr = r[h]
    gv = hdr.index("Gültige")                     # 4 columns per item: first votes (final, previous period), second votes (final, previous period)
    cols = [(i, G[x]) for i, x in enumerate(hdr) if x in G]
    C = json.load(open(os.path.join(HERE, "data", "constituencies.json"), encoding="utf-8")); names = {w["n"]: norm(w["name"]) for w in C["wk"]}
    out = {}
    for row in r[h + 3:]:
        if len(row) <= gv + 2 or not row[0].strip().isdigit() or int(row[0]) > 299 or not row[2].strip().isdigit() or int(row[2]) > 16: continue
        n = int(row[0])
        if names.get(n) != norm(row[1]): continue
        o = {}
        for key, off in (("f13", 0), ("s13", 2)):
            tot = toi(row[gv + off]); c = [0] * 8
            for i, j in cols: c[j] += toi(row[i + off])
            c[7] = max(0, tot - sum(c)); o[key] = [round(v / tot * 100, 2) for v in c]
        out[n] = o
    json.dump({"source": "Der Bundeswahlleiter, Wiesbaden (final result 2013, 2013 boundaries; only constituencies unchanged in number and name until 2025)", "parties": K, "wk": out},
              open(os.path.join(HERE, "data", "results2013.json"), "w", encoding="utf-8"), separators=(",", ":"), ensure_ascii=False)
    print(len(out), "constituencies written to data/results2013.json")
if __name__ == "__main__":
    if len(sys.argv) < 2: sys.exit(__doc__)
    main(sys.argv[1])
