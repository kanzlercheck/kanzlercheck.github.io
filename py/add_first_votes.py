#!/usr/bin/env python3
"""Adds the FIRST VOTES (Erststimmen) to data/constituencies.json, so the Constituencies tab can switch between second and first votes.

  python py/add_first_votes.py btw25_kerg2.csv

Input: the Bundeswahlleiterin file "btw25_kerg2.csv" (long format: one row per area / party / vote type, 2025 result and, in the Vorp* columns,
the 2021 result recalculated to the 2025 boundaries).  Data: (c) Die Bundeswahlleiterin, Wiesbaden (dl-de/by-2-0).

Per constituency this adds
  f   2025 first-vote shares in %, in the order of "parties" (CDU and CSU are one party; Einzelbewerber, SSW, ... count as "Sonstige")
  fp  the same for the 2021 first votes on the 2025 boundaries
  fv  valid first votes 2025 (weights for national totals)
and a block  model.first  with the numbers the browser needs:
  localSd      how far one constituency strays from its state's swing, per party (log scale) - estimated like the second-vote value in calibrate_model.py,
               from the one transition for which first votes are available here (2021 -> 2025)
  natExtra     extra national uncertainty (log scale): there are no first-vote polls, so the first-vote national result is derived from the
               second-vote poll average (every party's first votes move by the same relative amount as its second votes). natExtra = how far that
               derivation missed in 2025, pooled over the parties
  backtest     the replay test: start from the 2021 first votes, move them with the TRUE 2025 second-vote change, compare with the real 2025 first votes
"""
import csv, json, os, sys
import numpy as np

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEYS = ["CDU/CSU", "AfD", "SPD", "Grüne", "Linke", "BSW", "FDP", "Freie Wähler", "Sonstige"]
GN = {"CDU": "CDU/CSU", "CSU": "CDU/CSU", "AfD": "AfD", "SPD": "SPD", "GRÜNE": "Grüne", "Die Linke": "Linke", "BSW": "BSW", "FDP": "FDP", "FREIE WÄHLER": "Freie Wähler"}
BIG = [0, 1, 2, 3, 4, 6]            # CDU/CSU, AfD, SPD, Grüne, Linke, FDP (BSW did not exist in 2021: gets the average, like in the second-vote model)

def toi(x):
    x = x.strip().replace(".", "")
    return int(x) if x.isdigit() else 0

def read(path):
    r = list(csv.reader(open(path, encoding="utf-8-sig"), delimiter=";"))
    h = next(i for i, x in enumerate(r) if x and x[0] == "Wahlart"); hd = r[h]
    out = {}                                           # wk -> {"end": {key: votes}, "vor": {...}, "name": ...}
    for row in r[h + 1:]:
        d = dict(zip(hd, row))
        if d.get("Gebietsart") != "Wahlkreis" or d.get("Stimme") != "1": continue
        n = int(d["Gebietsnummer"]); rec = out.setdefault(n, {"name": d["Gebietsname"], "end": {}, "vor": {}, "_end": 0, "_vor": 0})
        g = d["Gruppenname"]
        if d["Gruppenart"] == "System-Gruppe":
            if g == "Gültige": rec["_end"], rec["_vor"] = toi(d["Anzahl"]), toi(d["VorpAnzahl"])
        elif d["Gruppenart"] in ("Partei", "Einzelbewerber/Wählergruppe") and g in GN:
            k = GN[g]; rec["end"][k] = rec["end"].get(k, 0) + toi(d["Anzahl"]); rec["vor"][k] = rec["vor"].get(k, 0) + toi(d["VorpAnzahl"])
    return out

def shares(rec, k):
    tot = rec["_" + k]; v = [rec[k].get(p, 0) for p in KEYS[:-1]]
    return [x / tot * 100 for x in v] + [max(0, tot - sum(v)) / tot * 100], tot

def project(Sb, V, T, iters=400):                     # ratio swing, same as the browser / calibrate_model.py (shares in %, T in %)
    L = np.log(np.maximum(Sb, .01) / 100); c = np.zeros(Sb.shape[1])
    for _ in range(iters):
        X = np.exp(L + c); X /= X.sum(1, keepdims=True); nat = (V[:, None] * X).sum(0) / V.sum()
        d = np.log(np.maximum(T, 1e-9) / 100 / np.maximum(nat, 1e-12)); c += .8 * d
        if np.abs(d).max() < 1e-7: break
    return X

def main():
    if len(sys.argv) < 2: sys.exit(__doc__)
    K = read(sys.argv[1]); path = os.path.join(HERE, "data", "constituencies.json"); C = json.load(open(path, encoding="utf-8"))
    assert C["parties"] == KEYS and len(K) == 299, "unexpected party list / number of constituencies"
    wk = C["wk"]; M = len(KEYS)
    for w in wk:
        k = K[w["n"]]; assert k["name"].replace("–", "-")[:12] == w["name"].replace("–", "-")[:12], (w["n"], k["name"], w["name"])
        s, tot = shares(k, "end"); p, _ = shares(k, "vor")
        w["f"] = [round(x, 3) for x in s]; w["fp"] = [round(x, 2) for x in p]; w["fv"] = tot
    ids = list(range(len(wk)))
    V2 = np.array([w["v"] for w in wk], float); V1 = np.array([w["fv"] for w in wk], float); land = np.array([w["land"] for w in wk])
    F25 = np.array([w["f"] for w in wk]); F21 = np.array([w["fp"] for w in wk]); S25 = np.array([w["s"] for w in wk]); S21 = np.array([w["p"] for w in wk])
    nat = lambda S, V: (V[:, None] * S).sum(0) / V.sum()
    n1_25, n1_21, n2_25, n2_21 = nat(F25, V1), nat(F21, V1), nat(S25, V2), nat(S21, V2)
    # --- the rule used by the browser: first votes move by the same relative amount as the party's second votes ---
    def derive(n1_base, n2_base, n2_target):
        t = np.where(n1_base > 0, n1_base * n2_target / np.maximum(n2_base, 1e-9), 0); return t / t.sum() * 100
    T1 = derive(n1_21, n2_21, n2_25)                  # first-vote national result implied by the TRUE 2025 second-vote result
    X = project(F21, V1, T1)
    # (1) national extra uncertainty: how far was that derivation from the real 2025 first-vote national result?
    ex = [np.log(n1_25[j] / T1[j]) for j in BIG if n1_25[j] > 2 and T1[j] > 2]
    natExtra = float(np.sqrt(np.mean(np.square(ex))))
    # (2) local noise per party: move the 2021 first votes to the TRUE 2025 first-vote national result, split the rest into a state part and a local part
    Xt = project(F21, V1, n1_25); local = {}
    for j in BIG:
        ok = (F21[:, j] >= .5) & (F25[:, j] >= .5); e = np.log(np.maximum(F25[:, j], .01) / 100) - np.log(np.maximum(Xt[:, j], 1e-9)); lv = []
        for s in set(land):
            m = (land == s) & ok
            if m.sum() < 2: continue
            w = V1[m]; mu = np.average(e[m], weights=w); lv.append(np.average((e[m] - mu) ** 2, weights=w) * m.sum() / (m.sum() - 1))
        local[KEYS[j]] = round(float(np.sqrt(np.mean(lv))), 4)
    local["BSW"] = round(float(np.mean([local[KEYS[j]] for j in BIG])), 4)
    # --- replay test, with the rule the browser uses ---
    lead = lambda A: A[:, :7].argmax(1)          # the 7 parties the page maps (Free Voters and others are "Sonstige" there)
    srt = np.sort(F25[:, :7], 1); margin = srt[:, -1] - srt[:, -2]
    ok_model = lead(X) == lead(F25); ok_naive = lead(F21) == lead(F25)
    main = [0, 1, 2, 3, 4, 6]
    bt = {"leaderRightPct": round(float(ok_model.mean() * 100), 1), "sameLeaderAs2021Pct": round(float(ok_naive.mean() * 100), 1),
          "maePts": round(float(np.abs(X * 100 - F25)[:, main].mean()), 2), "n": 299,
          "leaderRightWhenMargin5PlusPct": round(float(ok_model[margin >= 5].mean() * 100), 1)}
    # the same test for second votes (so both can be shown side by side)
    X2 = project(S21, V2, n2_25); lead2 = lambda A: A[:, :7].argmax(1)
    bt["secondVoteLeaderRightPct"] = round(float((lead2(X2) == lead2(S25)).mean() * 100), 1); bt["secondVoteSameLeaderAs2021Pct"] = round(float((lead2(S21) == lead2(S25)).mean() * 100), 1)
    C["model"]["first"] = {"localSd": local, "natExtra": round(natExtra, 3), "backtest": bt,
                           "note": "2021 -> 2025 only (2017 first votes are not in the source file); natExtra pools the 6 big parties"}
    json.dump(C, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("first votes added to", len(wk), "constituencies")
    print("national first votes 2025 :", dict(zip(KEYS, np.round(n1_25, 1))))
    print("national second votes 2025:", dict(zip(KEYS, np.round(n2_25, 1))))
    print("localSd first:", local); print("localSd second:", C["model"]["localSd"]); print("natExtra:", round(natExtra, 3), "from", [round(float(e), 3) for e in ex])
    print("backtest:", bt)

if __name__ == "__main__":
    main()
