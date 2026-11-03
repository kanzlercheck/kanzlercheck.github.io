"""Builds data/firstvotes.json (first votes per constituency: 2025, 2021 on 2025 boundaries, 2017 where boundaries are unchanged).
Usage: python py/build_firstvotes.py btw25_kerg2.csv [w-btw21_kerg.csv]
Order of shares: CDU/CSU, AfD, SPD, Grüne, Linke, BSW, FDP, Sonstige (as in app.js). Everything else (incl. Freie Wähler, independents) = Sonstige."""
import csv, json, os, sys
K = ["CDU/CSU", "AfD", "SPD", "Grüne", "Linke", "BSW", "FDP", "Sonstige"]
G = {"CDU": 0, "CSU": 0, "AfD": 1, "SPD": 2, "GRÜNE": 3, "DIE LINKE": 4, "Die Linke": 4, "BSW": 5, "FDP": 6}
def toi(x):
    x = (x or "").strip().replace(".", "")
    return int(x) if x.lstrip("-").isdigit() else 0
def shares(c):
    t = sum(c) or 1
    return [round(v / t * 100, 2) for v in c]
def read25(path):
    out = {}
    for x in csv.reader(open(path, encoding="utf-8-sig"), delimiter=";"):
        if len(x) < 14 or x[2] != "Wahlkreis" or x[10] != "1" or x[7] == "System-Gruppe": continue
        n = int(x[3]); o = out.setdefault(n, {"name": x[4], "f25": [0] * 8, "f21": [0] * 8})
        j = G.get(x[8], 7)
        o["f25"][j] += toi(x[11]); o["f21"][j] += toi(x[13])
    return out
def read21(path, names):
    """2017 first votes = 'Vorperiode' of the 2021 file; only where the constituency has the same number and name in 2025."""
    r = list(csv.reader(open(path, encoding="utf-8-sig"), delimiter=";"))
    h = [i for i, x in enumerate(r) if x and x[0] == "Nr"][0]; hdr = r[h]
    gv = [i for i, x in enumerate(hdr) if x.startswith("Gültige")][0]
    P = {"Christlich Demokratische Union Deutschlands": 0, "Christlich-Soziale Union in Bayern": 0, "Alternative für Deutschland": 1,
         "Sozialdemokratische Partei Deutschlands": 2, "BÜNDNIS 90/DIE GRÜNEN": 3, "DIE LINKE": 4, "Freie Demokratische Partei": 6}
    cols = [(i, P[x]) for i, x in enumerate(hdr) if x in P]
    out = {}
    for row in r[h + 3:]:
        if len(row) < gv + 4 or not row[0].strip().isdigit() or int(row[0]) > 299 or row[2].strip() in ("", "99"): continue
        n = int(row[0])
        if names.get(n) != row[1]: continue
        c = [0] * 8
        for i, j in cols: c[j] += toi(row[i + 1])
        c[7] = max(0, toi(row[gv + 1]) - sum(c))
        out[n] = shares(c)
    return out
if __name__ == "__main__":
    d = read25(sys.argv[1]); res = {}
    s17 = read21(sys.argv[2], {n: v["name"] for n, v in d.items()}) if len(sys.argv) > 2 else {}
    for n, v in sorted(d.items()):
        res[n] = {"f25": shares(v["f25"]), "f21": shares(v["f21"]) if sum(v["f21"]) else None, "f17": s17.get(n)}
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "firstvotes.json")
    json.dump({"parties": K, "wk": res}, open(out, "w", encoding="utf-8"), separators=(",", ":"), ensure_ascii=False)
    print(len(res), "constituencies;", sum(1 for v in res.values() if v["f21"]), "with 2021;", sum(1 for v in res.values() if v["f17"]), "with 2017")
