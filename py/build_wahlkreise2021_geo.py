#!/usr/bin/env python3
"""Converts the Bundeswahlleiterin 2021 Wahlkreis shapefile into data/wahlkreise2021.geojson (the map of the Battleground map for date snapshots
that project the 2021 election, i.e. dates between the 2017 and the 2021 election).

  python py/build_wahlkreise2021_geo.py btw21_geometrie_wahlkreise_vg250_geo_shp.zip [tolerance]

Input: the shapefile in WGS84 ("..._geo_shp.zip") from https://bundeswahlleiterin.de/bundestagswahlen/2021/wahlkreiseinteilung/downloads.html
The file is the full-resolution geometry (~480,000 points, 7.7 MB), far too heavy for the page, so it is simplified here. The simplification keeps
borders SHARED between two constituencies identical on both sides (each shared border is simplified once, as one piece), so there are no gaps or overlaps
between neighbours. tolerance = Douglas-Peucker distance in degrees (default 0.0023, about 250 m), chosen to give about the same level of detail as
data/wahlkreise.geojson (the 2025 map).
Needs nothing but the Python standard library.  Geometry: (c) Die Bundeswahlleiterin, Wiesbaden, Geometrie (c) BKG (dl-de/by-2-0).
"""
import glob, json, math, os, struct, sys, tempfile, zipfile

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # repo root (this script lives in py/)
KX = math.cos(math.radians(51))   # the page draws longitude scaled by cos(51 deg); distances are measured the same way
SCALE = 10 ** 7                   # vertices are compared on a 1e-7 degree grid (shared borders have identical coordinates)

def read_dbf(path):
    f = open(path, "rb").read(); n, hl, rl = struct.unpack("<IHH", f[4:12]); fields = []; pos = 32
    while f[pos] != 0x0D:
        fields.append((f[pos:pos + 11].split(b"\0")[0].decode(), f[pos + 16])); pos += 32
    out = []
    for i in range(n):
        r = f[hl + i * rl: hl + (i + 1) * rl]; o = 1; d = {}
        for name, ln in fields: d[name] = r[o:o + ln].decode("utf-8").strip(); o += ln
        out.append(d)
    return out

def read_shp(path):   # polygons only -> list (per record) of rings [(x, y), ...]
    s = open(path, "rb").read(); pos = 100; out = []
    while pos < len(s):
        _, cl = struct.unpack(">ii", s[pos:pos + 8]); pos += 8
        if struct.unpack("<i", s[pos:pos + 4])[0] != 5: sys.exit("expected polygon shapes")
        npart, npts = struct.unpack("<ii", s[pos + 36:pos + 44])
        parts = list(struct.unpack("<%di" % npart, s[pos + 44:pos + 44 + 4 * npart])) + [npts]
        q = pos + 44 + 4 * npart; pts = struct.unpack("<%dd" % (2 * npts), s[q:q + 16 * npts])
        P = [(pts[2 * i], pts[2 * i + 1]) for i in range(npts)]
        out.append([P[a:b] for a, b in zip(parts, parts[1:])]); pos += cl * 2
    return out

def area(r):  # shoelace; > 0 = counter-clockwise
    return sum(r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1] for i in range(len(r) - 1)) / 2

def dp(pts, eps):   # Douglas-Peucker on an open polyline; returns the kept points (first and last always kept)
    if len(pts) < 3: return list(pts)
    keep = [False] * len(pts); keep[0] = keep[-1] = True; stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop(); ax, ay = pts[a][0] * KX, pts[a][1]; bx, by = pts[b][0] * KX, pts[b][1]
        dx, dy = bx - ax, by - ay; L = math.hypot(dx, dy); best, bi = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[i][0] * KX - ax, pts[i][1] - ay
            d = abs(dx * py - dy * px) / L if L > 0 else math.hypot(px, py)
            if d > best: best, bi = d, i
        if best > eps: keep[bi] = True; stack += [(a, bi), (bi, b)]
    return [p for p, k in zip(pts, keep) if k]

def key(p): return (round(p[0] * SCALE), round(p[1] * SCALE))

def simplify_arc(arc, eps):
    """arc = vertices from one anchor to the next. It is simplified in a fixed direction (smaller end key first) so that the same border,
    walked in opposite directions by the two neighbouring rings, gives exactly the same result."""
    if len(arc) < 3: return arc
    k0, k1 = key(arc[0]), key(arc[-1])
    if k0 == k1:   # a closed loop with one anchor: split at the vertex farthest from it
        i = max(range(1, len(arc) - 1), key=lambda j: (arc[j][0] - arc[0][0]) ** 2 + (arc[j][1] - arc[0][1]) ** 2)
        return simplify_arc(arc[:i + 1], eps)[:-1] + simplify_arc(arc[i:], eps)
    if k0 > k1: return dp(arc[::-1], eps)[::-1]
    return dp(arc, eps)

def main():
    if len(sys.argv) < 2: sys.exit(__doc__)
    eps = float(sys.argv[2]) if len(sys.argv) > 2 else 0.0023
    src = sys.argv[1]; tmp = tempfile.mkdtemp()
    if src.lower().endswith(".zip"): zipfile.ZipFile(src).extractall(tmp); src = tmp
    shp = glob.glob(os.path.join(src, "**", "*.shp"), recursive=True)
    if not shp: sys.exit("no .shp file found")
    recs, shapes = read_dbf(shp[0][:-4] + ".dbf"), read_shp(shp[0])
    if shapes[0][0][0][0] > 400: sys.exit("This shapefile is in metres (UTM). Use the one ending in _geo_shp.zip (WGS84).")
    # 1. which rings touch which vertex (to find where borders are shared)
    rings = []   # (record index, ring without the closing point)
    for ri, rs in enumerate(shapes):
        for r in rs:
            r = r[:-1] if r[0] == r[-1] else r
            if len(r) >= 3: rings.append((ri, r))
    touch = {}
    for gi, (_, r) in enumerate(rings):
        for p in r: touch.setdefault(key(p), set()).add(gi)
    # 2. split every ring into arcs at the vertices where the set of rings sharing it changes, simplify each arc once, glue the ring back together
    out_rings = []
    for gi, (ri, r) in enumerate(rings):
        sig = [frozenset(touch[key(p)]) for p in r]; n = len(r)
        anchors = [i for i in range(n) if sig[i] != sig[i - 1] or sig[i] != sig[(i + 1) % n]]
        if not anchors: anchors = [min(range(n), key=lambda i: key(r[i]))]   # whole ring unique, or shared in full: same start for both rings
        res = []
        for a, b in zip(anchors, anchors[1:] + [anchors[0] + n]):
            res += simplify_arc([r[i % n] for i in range(a, b + 1)], eps)[:-1]
        # rounded like the 2025 map (3 decimals); consecutive duplicates removed
        pts = []
        for x, y in res:
            p = [round(x, 3), round(y, 3)]
            if not pts or p != pts[-1]: pts.append(p)
        if len(pts) > 1 and pts[0] == pts[-1]: pts.pop()
        if len(pts) < 3: continue   # a speck smaller than the tolerance
        pts.append(pts[0]); out_rings.append((ri, area(rings[gi][1] + [rings[gi][1][0]]) >= 0, pts))
    # 3. polygons: clockwise ring = outer ring (shapefile convention), counter-clockwise = hole of the last outer ring
    feats = []
    for ri, rec in enumerate(recs):
        polys = []
        for rj, ccw, pts in out_rings:
            if rj != ri: continue
            if not ccw or not polys: polys.append([pts])
            else: polys[-1].append(pts)
        feats.append({"type": "Feature", "properties": {"n": int(rec["WKR_NR"]), "name": rec["WKR_NAME"], "land": rec["LAND_NAME"]},
                      "geometry": {"type": "MultiPolygon", "coordinates": polys}})
    feats.sort(key=lambda f: f["properties"]["n"])
    out = os.path.join(HERE, "data", "wahlkreise2021.geojson")
    with open(out, "w", encoding="utf-8") as f: json.dump({"type": "FeatureCollection", "features": feats}, f, ensure_ascii=False, separators=(",", ":"))
    npts = sum(len(r) for f in feats for p in f["geometry"]["coordinates"] for r in p)
    print("%d constituencies, %d points -> data/wahlkreise2021.geojson (%d kB)" % (len(feats), npts, os.path.getsize(out) // 1024))

if __name__ == "__main__":
    main()
