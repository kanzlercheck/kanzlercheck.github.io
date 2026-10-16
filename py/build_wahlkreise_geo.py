#!/usr/bin/env python3
"""Converts the Bundeswahlleiterin Wahlkreis shapefile into data/wahlkreise.geojson (the map of the "Constituencies" tab).

  python py/build_wahlkreise_geo.py btw25_geometrie_wahlkreise_shp_geo.zip

Download (generalised, WGS84 / "geografische Koordinaten"):
  https://bundeswahlleiterin.de/bundestagswahlen/2025/wahlkreiseinteilung/downloads.html
Needs pyshp (pip install pyshp).  Geometry: (c) Die Bundeswahlleiterin, Wiesbaden, Geometrie (c) BKG (dl-de/by-2-0).
"""
import glob, json, os, sys, tempfile, zipfile
import shapefile

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # repo root (this script lives in py/)

def area(r):  # shoelace; > 0 = counter-clockwise
    return sum(r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1] for i in range(len(r) - 1)) / 2

def main():
    if len(sys.argv) < 2: sys.exit(__doc__)
    tmp = tempfile.mkdtemp()
    if sys.argv[1].lower().endswith(".zip"):
        zipfile.ZipFile(sys.argv[1]).extractall(tmp)
    shp = glob.glob(os.path.join(tmp if sys.argv[1].lower().endswith(".zip") else sys.argv[1], "**", "*.shp"), recursive=True)
    if not shp: sys.exit("no .shp file found")
    sf = shapefile.Reader(shp[0], encoding="utf-8")
    names = [f[0] for f in sf.fields[1:]]
    feats = []
    for rec, sh in zip(sf.records(), sf.shapes()):
        r = dict(zip(names, rec))
        n = int(r.get("WKR_NR") or r.get("WKR"))
        if abs(sh.points[0][0]) > 400: sys.exit("This shapefile is in metres (UTM). Use the one ending in _shp_geo.zip (WGS84).")
        parts = list(sh.parts) + [len(sh.points)]; polys = []
        for a, b in zip(parts, parts[1:]):
            ring = []
            for x, y in sh.points[a:b]:
                p = [round(x, 3), round(y, 3)]
                if not ring or p != ring[-1]: ring.append(p)
            if len(ring) < 4: continue
            if area(ring) < 0 or not polys: polys.append([ring])   # clockwise = outer ring (shapefile convention)
            else: polys[-1].append(ring)                            # counter-clockwise = hole
        feats.append({"type": "Feature", "properties": {"n": n, "name": r.get("WKR_NAME", ""), "land": r.get("LAND_NAME", "")},
                      "geometry": {"type": "MultiPolygon", "coordinates": polys}})
    feats.sort(key=lambda f: f["properties"]["n"])
    out = os.path.join(HERE, "data", "wahlkreise.geojson")
    with open(out, "w", encoding="utf-8") as f: json.dump({"type": "FeatureCollection", "features": feats}, f, ensure_ascii=False, separators=(",", ":"))
    print("%d constituencies -> data/wahlkreise.geojson (%d kB)" % (len(feats), os.path.getsize(out) // 1024))

if __name__ == "__main__":
    main()
