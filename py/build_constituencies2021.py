#!/usr/bin/env python3
"""Builds data/constituencies2021.json: the 299 constituencies as they were drawn for the 2021 election, for the date snapshots of the Battleground map
that project the 2021 election (dates between the 2017 and the 2021 election).

  python py/build_constituencies2021.py w-btw21_kerg.csv

 - w-btw21_kerg.csv  official final result 2021 per Wahlkreis (2021 boundaries), which also holds the 2017 result recalculated to the 2021 boundaries
                     (its "Vorperiode"). Shares are second votes; Free Voters are kept apart like in data/constituencies.json (the page counts them as Others).
 - data/wahlkreise2021.geojson must exist (py/build_wahlkreise2021_geo.py): it supplies the state of every constituency and is checked against the CSV.
 - data/constituencies.json (the 2025 file) is read for the structure data ("About this constituency"): a 2021 constituency whose area is the same in 2025
   (its 2021 result equals the 2021 result recalculated to the 2025 boundaries, +-0.05 points) takes the 2021 / 2017 structure data of that 2025 constituency
   (d21 / d17, only present where the area was verified as unchanged, see build_constituencies.py attach_struct). The others (constituencies redrawn in 2025) get none.
Run build_constituencies.py first. Data: (c) Die Bundeswahlleiterin, Wiesbaden (dl-de/by-2-0).
"""
import json, os, sys
from build_constituencies import read_kerg, KEYS, HERE

def main():
    if len(sys.argv) < 2: sys.exit(__doc__)
    K = read_kerg(sys.argv[1]); assert len(K) == 299, "expected 299 Wahlkreise"
    geo = {f["properties"]["n"]: f["properties"] for f in json.load(open(os.path.join(HERE, "data", "wahlkreise2021.geojson"), encoding="utf-8"))["features"]}
    assert set(geo) == set(K) and all(geo[n]["name"] == K[n]["name"] for n in K), "shapefile and result file do not describe the same constituencies"
    c25 = json.load(open(os.path.join(HERE, "data", "constituencies.json"), encoding="utf-8")); assert c25["parties"] == KEYS
    sh = lambda r: [round(r[p] / r["_valid"] * 100, 2) for p in KEYS]
    wk = []; kept = 0
    for n in sorted(K):
        k = K[n]; rec = {"n": n, "name": k["name"], "land": geo[n]["land"], "v": k["end"]["_valid"], "s": sh(k["end"]), "p": sh(k["vor"])}
        same = [w for w in c25["wk"] if w["land"] == rec["land"] and max(abs(a - b) for a, b in zip(w["p"], rec["s"])) <= 0.0501]
        if len(same) == 1 and same[0].get("d21"):   # same area in 2021 and 2025 -> the 2021 structure data of that constituency
            rec["d"] = rec["d21"] = same[0]["d21"]; kept += 1
            if same[0].get("d17"): rec["d17"] = same[0]["d17"]
        wk.append(rec)
    out = {"source": "Die Bundeswahlleiterin (final result 2021, 2017 result recalculated to the 2021 boundaries)", "parties": KEYS, "wk": wk}
    with open(os.path.join(HERE, "data", "constituencies2021.json"), "w", encoding="utf-8") as f: json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print("data/constituencies2021.json written; 2021 structure data for %d of 299 constituencies (the other %d were redrawn in 2025); 2017 structure data for %d" % (kept, 299 - kept, sum(1 for w in wk if w.get("d17"))))

if __name__ == "__main__":
    main()
