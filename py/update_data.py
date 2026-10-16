#!/usr/bin/env python3
"""Imports ALL polls from the dawum.de API (https://api.dawum.de/) into this site's CSV files.

  data/germanpolls.csv          federal polls (Bundestag, all institutes)
  state_polls/<State>.csv       one file per Bundesland, e.g. state_polls/Bayern.csv

Run by double-clicking update_data.cmd (Windows) or:  python py/update_data.py
It also refreshes the embed image (make_og.py, needs pillow) and the constituency model (calibrate_model.py, needs numpy).
The download itself only needs the Python standard library.  Data: dawum.de (ODC-ODbL).
"""
import csv, json, os, re, sys, time, urllib.request
from datetime import datetime

API = "https://api.dawum.de/"
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # repo root (this script lives in py/)
FEDERAL_CSV = os.path.join(HERE, "data", "germanpolls.csv")
STATE_DIR = os.path.join(HERE, "state_polls")

# file name (ASCII, like the dawum.de URLs) -> German name
STATES = {
    "Baden-Wuerttemberg": "Baden-Württemberg", "Bayern": "Bayern", "Berlin": "Berlin",
    "Brandenburg": "Brandenburg", "Bremen": "Bremen", "Hamburg": "Hamburg", "Hessen": "Hessen",
    "Mecklenburg-Vorpommern": "Mecklenburg-Vorpommern", "Niedersachsen": "Niedersachsen",
    "Nordrhein-Westfalen": "Nordrhein-Westfalen", "Rheinland-Pfalz": "Rheinland-Pfalz",
    "Saarland": "Saarland", "Sachsen": "Sachsen", "Sachsen-Anhalt": "Sachsen-Anhalt",
    "Schleswig-Holstein": "Schleswig-Holstein", "Thueringen": "Thüringen",
}
META = ["Datum", "Institut", "Befragungsmethode", "Befragungsstart", "Befragungsende", "Befragtenanzahl"]
CANON = ["CDU/CSU", "SPD", "AfD", "Grüne", "Linke", "FDP", "BSW", "Freie Wähler"]
ALIAS = {
    "cdu/csu": "CDU/CSU", "union": "CDU/CSU", "cdu": "CDU/CSU", "csu": "CDU/CSU", "spd": "SPD", "afd": "AfD",
    "grüne": "Grüne", "gruene": "Grüne", "die grünen": "Grüne", "bündnis 90/die grünen": "Grüne",
    "linke": "Linke", "die linke": "Linke", "fdp": "FDP", "bsw": "BSW",
    "fw": "Freie Wähler", "freie wähler": "Freie Wähler", "sonstige": "Sonstige", "sonstiges": "Sonstige",
}

def norm(s):
    s = re.sub(r"\(.*?\)", "", (s or "").lower())
    for a, b in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        s = s.replace(a, b)
    return re.sub(r"[^a-z0-9\- ]", "", s).strip()

STATE_KEYS = {norm(k): k for k in STATES}
STATE_KEYS.update({norm(v): k for k, v in STATES.items()})

def fetch(url):
    last = None
    for i in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; dawum-importer/1.0)"})
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            last = e
            time.sleep(2 * (i + 1))
    sys.exit("ERROR: could not download %s\n%s" % (url, last))

def target_of(p):
    """'federal', a state file name, or None (EU parliament etc.)"""
    short, name = norm(p.get("Shortcut")), norm(p.get("Name"))
    if short == "bundestag" or name == "bundestag":
        return "federal"
    if short in STATE_KEYS:
        return STATE_KEYS[short]
    hits = [k for k in STATE_KEYS if k and (k in name or k in short)]
    return STATE_KEYS[max(hits, key=len)] if hits else None

def de_date(iso):
    try:
        return datetime.strptime((iso or "")[:10], "%Y-%m-%d").strftime("%d.%m.%Y")
    except ValueError:
        return ""

def de_num(v):
    return ("%.1f" % float(v)).replace(".", ",")

def build_rows(db):
    parties = {}
    for pid, p in db.get("Parties", {}).items():
        raw = (p.get("Shortcut") or p.get("Name") or "").strip()
        parties[pid] = ALIAS.get(raw.lower(), raw)
    targets = {pid: target_of(p) for pid, p in db.get("Parliaments", {}).items()}
    inst, meth = db.get("Institutes", {}), db.get("Methods", {})
    out = {}
    for s in db.get("Surveys", {}).values():
        t = targets.get(str(s.get("Parliament_ID")))
        if not t:
            continue
        per = s.get("Survey_Period") or {}
        row = {
            "_iso": (s.get("Date") or "")[:10],
            "Datum": de_date(s.get("Date")),
            "Institut": (inst.get(str(s.get("Institute_ID"))) or {}).get("Name", ""),
            "Befragungsmethode": (meth.get(str(s.get("Method_ID"))) or {}).get("Name", ""),
            "Befragungsstart": de_date(per.get("Date_Start")),
            "Befragungsende": de_date(per.get("Date_End")),
            "Befragtenanzahl": str(s.get("Surveyed_Persons") or ""),
        }
        for pid, val in (s.get("Results") or {}).items():
            if val in (None, ""):
                continue
            row[parties.get(str(pid), "Partei " + str(pid))] = de_num(val)
        out.setdefault(t, []).append(row)
    return out

def columns(rows):
    names = {k for r in rows for k in r if k not in META and not k.startswith("_")}
    first = [p for p in CANON if p in names]
    mid = sorted(n for n in names if n not in CANON and n != "Sonstige")
    return META + first + mid + (["Sonstige"] if "Sonstige" in names else [])

def write_csv(path, rows):
    cols = columns(rows)
    rows = sorted(rows, key=lambda r: (r["_iso"], r["Institut"]))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(cols)
        for r in rows:
            w.writerow([r.get(c, "") for c in cols])
    os.replace(tmp, path)
    return len(rows), rows[0]["Datum"] if rows else "-", rows[-1]["Datum"] if rows else "-"

def old_federal_rows(cutoff_iso):
    """Keep your existing history from BEFORE the API's first poll (the API starts in 2017)."""
    if not os.path.exists(FEDERAL_CSV):
        return []
    keep = []
    with open(FEDERAL_CSV, encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            m = re.match(r"(\d{1,2})\.(\d{1,2})\.(\d{4})$", (r.get("Datum") or "").strip())
            if not m:
                continue
            iso = "%s-%02d-%02d" % (m.group(3), int(m.group(2)), int(m.group(1)))
            if iso < cutoff_iso:
                r = {k: (v or "").strip() for k, v in r.items() if k}
                r["_iso"] = iso
                keep.append(r)
    return keep

def main():
    if "--file" in sys.argv:
        with open(sys.argv[sys.argv.index("--file") + 1], encoding="utf-8") as f:
            db = json.load(f)
        print("Reading local file (test mode)")
    else:
        print("Downloading %s ..." % API)
        db = fetch(API)
    print("dawum.de database, last update: %s" % (db.get("Database") or {}).get("Last_Update", "?"))
    groups = build_rows(db)

    fed = groups.get("federal", [])
    if not fed:
        sys.exit("ERROR: no Bundestag polls found in the API response - nothing written.")
    cutoff = min(r["_iso"] for r in fed if r["_iso"])
    old = old_federal_rows(cutoff)
    n, a, b = write_csv(FEDERAL_CSV, old + fed)
    print("  federal  -> data/germanpolls.csv: %d polls (%s - %s)%s" % (n, a, b, "  [%d older rows kept from your previous file]" % len(old) if old else ""))

    print("State polls -> state_polls/")
    for slug in STATES:
        rows = groups.get(slug, [])
        if not rows:
            print("  %-24s no polls" % slug)
            continue
        n, a, b = write_csv(os.path.join(STATE_DIR, slug + ".csv"), rows)
        print("  %-24s %4d polls (%s - %s)" % (slug + ".csv", n, a, b))
    try:  # refresh the link-preview image (img/og.png) from the new polls
        import make_og
        make_og.main()
    except Exception as e:
        print("  (embed image not updated: %s - run: pip install pillow)" % e)
    try:  # re-estimate the constituency model's noise levels + replay test (data/constituencies.json "model")
        import calibrate_model
        print("Constituency model -> data/constituencies.json (a few seconds) ...")
        m = calibrate_model.main(run_backtest=True, verbose=False); v = m.get("validation", {})
        print("  noise levels re-estimated; replay 2021->2025: %s%% of constituency leaders right (expected %s%%)" % (v.get("2025", {}).get("leaderRightPct", "?"), v.get("2025", {}).get("expectedRightPct", "?")))
    except Exception as e:
        print("  (constituency model not updated: %s - run: pip install numpy)" % e)
    print("Done. Data from dawum.de (ODC-ODbL).")

if __name__ == "__main__":
    main()
