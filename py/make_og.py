#!/usr/bin/env python3
"""Builds the link-preview / Discord embed images: one per address, each = site logo + that page's live data, nothing else.

  img/og.png                  home          federal poll average (bars, change vs. 1 month ago)
  img/og/polls.png            /polls        federal poll trend (12 months) + government approval
  img/og/parliament.png       /parliament   Bundestag seat projection (hemicycle + seats per party)
  img/og/constituencies.png   /constituencies   map of constituency leaders + count per party
  img/og/election.png         /election     2025 result and seats
  img/og/state-<ID>.png       /state/<ID>   that state's poll average vs. its last state election

Everything is computed from the CSV / JSON files in data/ and state_polls/ with the same smoothing and seat rules as the website
(js/app.js), so the numbers match the page.  Run automatically by update_data.py and by the GitHub workflow; or:  python py/make_og.py
Needs Pillow (pip install pillow) - nothing else.  Afterwards it rewrites the per-address copies of index.html (py/build_pages.py) so
every page links its own image; img/og/manifest.json holds the cache-buster ("?v=") of each image so Discord / Twitter fetch the new picture.

Constituency map: simplified version of the site's projection (2025 second votes, one ratio swing per party so the national total equals the poll
average; no state-poll tilt, no pollster-bias correction), so a few close constituencies can differ from the interactive map.
"""
import csv, json, math, os, re
from datetime import date, timedelta
from functools import lru_cache
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # repo root (this script lives in py/)
META = {"datum", "date", "institut", "befragungsmethode", "befragungsstart", "befragungsende", "befragtenanzahl"}
S = 2  # supersampling for smooth edges
W, H = 1200, 630
FALLBACK = ["#1C4E9C", "#C62828", "#2E7D32", "#F9A825", "#6A1B9A", "#00838F", "#8D6E63", "#546E7A"]
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

def hexrgb(h):
    h = h.lstrip("#"); return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
def lum(c): return c[0] * .299 + c[1] * .587 + c[2] * .114
def lighten(c, a): return tuple(round(v + (255 - v) * a) for v in c)

# palette = the site's dark theme
BG, INK, MUT, LINE, OK, ERR = (hexrgb(x) for x in ("#1F222A", "#F1F2F4", "#9AA0AA", "#33373F", "#6FCF97", "#FF7A6E"))
DARKFILL = hexrgb("#4A4F58")   # parties whose colour is (nearly) black, e.g. the Union, are drawn in this grey on the dark background
DARKLINE = hexrgb("#9AA0AA")   # ... and in this lighter grey when used for thin lines / text

# ---------------------------------------------------------------- data helpers
def num(v):
    v = (v or "").strip().replace(",", ".")
    try:
        return float(v)
    except ValueError:
        return None

def pdate(v):
    v = (v or "").strip()
    m = re.match(r"(\d{1,2})\.(\d{1,2})\.(\d{4})", v)
    if m:
        return date(int(m[3]), int(m[2]), int(m[1]))
    m = re.match(r"(\d{4})-(\d{1,2})-(\d{1,2})", v)
    return date(int(m[1]), int(m[2]), int(m[3])) if m else None

def months_ago(d, n=1):  # same overflow behaviour as JS setUTCMonth(-n)
    y, m = d.year, d.month - n
    while m < 1:
        y -= 1; m += 12
    return date(y, m, 1) + timedelta(days=d.day - 1)

def smoothed(polls, key, at, bw_days):  # Gaussian kernel, same as smoothedValueAt() in js/app.js
    bw = max(1, bw_days); w = s = 0.0
    for t, v in polls:
        x = v.get(key)
        if x is None:
            continue
        dx = ((t - at).days) / bw
        if abs(dx) > 3:
            continue
        k = math.exp(-.5 * dx * dx); w += k; s += k * x
    return s / w if w else None

def read_polls(path, hidden=()):
    with open(path, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    parties = [k for k in rows[0] if k and k.lower() not in META and k not in hidden]
    polls = sorted(((pdate(r.get("Datum") or r.get("Date")), {p: num(r.get(p)) for p in parties}) for r in rows
                    if pdate(r.get("Datum") or r.get("Date"))), key=lambda x: x[0])
    return parties, polls

def party_color(cfg, p, i=0):
    if p == "SSW": return "#003C8F"
    c = cfg.get("colors", {})
    return c.get(p) or c.get("CDU/CSU" if p == "Union" else p) or FALLBACK[i % len(FALLBACK)]

def bar_color(hexcol):
    c = hexrgb(hexcol); return DARKFILL if lum(c) < 60 and hexcol.lower() != "#003c8f" else c
def line_color(hexcol):
    c = hexrgb(hexcol); return DARKLINE if lum(c) < 60 and hexcol.lower() != "#003c8f" else c

# ---------------------------------------------------------------- drawing helpers
@lru_cache(maxsize=None)
def _font(w, s):
    fd = os.path.join(HERE, "fonts", "og")
    p = os.path.join(fd, "IBMPlexSans-%d.ttf" % w)
    if not os.path.exists(p): p = os.path.join(fd, "IBMPlexSans-400.ttf")
    return ImageFont.truetype(p, int(s * S))

class Card:
    """1200x630 dark canvas: logo centred at the top, heading + one muted line."""
    def __init__(self, title, sub):
        self.img = Image.new("RGB", (W * S, H * S), BG); self.d = ImageDraw.Draw(self.img)
        logo = Image.open(os.path.join(HERE, "img", "logo-dark.png")).convert("RGBA")
        lh = 108; lw = round(logo.width * lh / logo.height)
        logo = logo.resize((lw * S, lh * S), Image.LANCZOS)
        self.img.paste(logo, ((W - lw) // 2 * S, 10 * S), logo)
        self.text(W / 2, 122, title, 600, 34, INK, "ma")
        self.text(W / 2, 164, sub, 400, 21, MUT, "ma")
    def text(self, x, y, t, w, s, fill, anchor="la"):
        self.d.text((x * S, y * S), t, font=_font(w, s), fill=fill, anchor=anchor)
    def width(self, t, w, s): return self.d.textlength(t, font=_font(w, s)) / S
    def line(self, pts, fill, width):
        self.d.line([(x * S, y * S) for x, y in pts], fill=fill, width=int(width * S), joint="curve")
    def dashed(self, pts, fill, width, on=6, off=5):
        pen, draw, left = pts[0], True, on
        for q in pts[1:]:
            seg = math.hypot(q[0] - pen[0], q[1] - pen[1]); pos = 0.0
            while pos < seg:
                step = min(left, seg - pos); f0, f1 = pos / seg, (pos + step) / seg
                if draw:
                    self.line([(pen[0] + (q[0] - pen[0]) * f0, pen[1] + (q[1] - pen[1]) * f0),
                               (pen[0] + (q[0] - pen[0]) * f1, pen[1] + (q[1] - pen[1]) * f1)], fill, width)
                pos += step; left -= step
                if left <= 1e-9: draw = not draw; left = on if draw else off
            pen = q
    def rrect(self, x0, y0, x1, y1, r, fill):
        self.d.rounded_rectangle([x0 * S, y0 * S, x1 * S, y1 * S], radius=r * S, fill=fill)
    def save(self, path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.img.resize((W, H), Image.LANCZOS).save(path, optimize=True)

def draw_bars(card, items, vfmt=lambda v: "%d%%" % round(v), foot_dy=88, base=508):
    """items: dict(name, color(hex), v, [prev], [gov], [foot]).  Same bar chart as the home page of the site."""
    left, right, gap = 52, 40, 16
    maxh = base - 280
    n = len(items); bw = (W - left - right - (n - 1) * gap) / n
    scale = maxh / max(10, *(it["v"] for it in items))
    y5 = base - 5 * scale
    for x in range(left, W - right, 14):
        card.line([(x, y5), (min(x + 7, W - right), y5)], LINE, 3)
    card.text(left - 8, y5 - 12, "5%", 500, 17, MUT, "ra")
    for i, it in enumerate(items):
        x = left + i * (bw + gap); cx = x + bw / 2; v = it["v"]; h = max(2, v * scale); top = base - h
        c = bar_color(it["color"])
        card.rrect(x, top, x + bw, base, 3, c)
        has_d = it.get("prev") is not None
        card.text(cx, top - (76 if has_d else 48), vfmt(v), 700, 38, INK, "ma")
        if has_d:
            dv = v - it["prev"]; flat = abs(dv) < .05
            s = "(=)" if flat else "(%s%.1f)" % ("+" if dv > 0 else "\u2212", abs(dv))
            card.text(cx, top - 34, s, 600, 24, INK if flat else (OK if dv > 0 else ERR), "ma")
        tint = lighten(c, .38)
        card.rrect(x, base + 12, x + bw, base + 56, 3, tint)
        name = it["name"]; fs = 22
        while card.width(name, 700, fs) > bw - 10 and fs > 11: fs -= 1
        if card.width(name, 700, fs) > bw - 10:
            while len(name) > 1 and card.width(name + "\u2026", 700, fs) > bw - 10: name = name[:-1]
            name += "\u2026"
        card.text(cx, base + 34, name, 700, fs, (21, 24, 28) if lum(tint) >= 140 else (255, 255, 255), "mm")
        if it.get("gov"): card.text(cx, base + 62, "Gov't", 600, 19, ERR, "ma")
        if it.get("foot"): card.text(cx, base + foot_dy, it["foot"], 700, 19, MUT, "ma")

def line_panel(card, box, series, t0, t1, ymin, ymax, step, lab_w, month_step=2, ylab_w=48):
    """Smoothed trend lines.  series: dict(label, color(hex), pts[(date, value|None)]).  box = (x0, y0, x1, y1) incl. axis labels."""
    x0, y0, x1, y1 = box; L = x0 + ylab_w; R = x1 - lab_w; B = y1 - 32; T = y0
    X = lambda t: L + (t - t0).days / max(1, (t1 - t0).days) * (R - L)
    Y = lambda v: B - (v - ymin) / (ymax - ymin) * (B - T)
    v = ymin
    while v <= ymax + 1e-9:
        card.line([(L, Y(v)), (R, Y(v))], LINE, 2)
        card.text(L - 8, Y(v) - 11, "%d%%" % v, 400, 17, MUT, "ra"); v += step
    d = date(t0.year, t0.month, 1)   # month ticks
    while d <= t1:
        if d >= t0 and (d.month - 1) % month_step == 0:
            card.text(X(d), B + 8, MON[d.month - 1], 400, 16, MUT, "ma")
        d = date(d.year + (d.month == 12), d.month % 12 + 1, 1)
    ends = []
    for s in series:
        pts = [(X(t), Y(v)) for t, v in s["pts"] if v is not None]
        if len(pts) < 2: continue
        col = line_color(s["color"]); card.line(pts, col, 5)
        ends.append([pts[-1][1], s, col, [v for _, v in s["pts"] if v is not None][-1]])
    ends.sort(key=lambda e: e[0])
    for i in range(1, len(ends)):   # keep the end labels apart
        if ends[i][0] - ends[i - 1][0] < 24: ends[i][0] = ends[i - 1][0] + 24
    for y, s, col, val in ends:
        card.text(R + 10, y - 12, "%s %d%%" % (s["label"], round(val)), 700, 18, col)

# ---------------------------------------------------------------- hemicycle (port of layoutSeats() in js/app.js)
def sainte_lague(pct, seats):
    res = {k: 0 for k in pct}
    for _ in range(seats):
        if not res: break
        best = max(res, key=lambda k: pct[k] / (2 * res[k] + 1)); res[best] += 1
    return res

def layout_seats(N, cx, cy, r_in, r_out):
    k = 2
    while k < 80:
        pitch = (r_out - r_in) / (k - 1)
        if math.pi * k * (r_in + r_out) / (2 * N) >= pitch: break
        k += 1
    pitch = (r_out - r_in) / (k - 1); radii = [r_in + i * pitch for i in range(k)]
    circ = [math.pi * r for r in radii]; cs = sum(circ); raw = [c / cs * N for c in circ]; fl = [int(v) for v in raw]
    rem = N - sum(fl); order = sorted(range(k), key=lambda i: -(raw[i] - fl[i]))
    for j in range(rem): fl[order[j % k]] += 1
    rows = []
    for i, r in enumerate(radii):
        m = fl[i]; items = []
        for j in range(m):
            ang = 90 if m == 1 else 180 - j * (180 / (m - 1)); a = math.radians(ang)
            items.append({"angle": ang, "x": cx + r * math.cos(a), "y": cy - r * math.sin(a)})
        rows.append({"r": r, "items": items})
    slots = [it for row in rows for it in row["items"]]
    slots.sort(key=lambda s: -s["angle"])
    for i, s in enumerate(slots): s["gi"] = i
    return rows, slots, max(2.4, pitch * .46)

# ---------------------------------------------------------------- the pages
def card_home(cfg, polls, parties):
    t_max = polls[-1][0]; bw = cfg.get("smoothingDays", 30)
    pct = {p: smoothed(polls, p, t_max, bw) for p in parties}
    prev = {p: smoothed(polls, p, months_ago(t_max), bw) for p in parties}
    labels, res, gov = cfg.get("labels", {}), cfg.get("electionResults", {}), cfg.get("government", [])
    order = [p for p in cfg.get("barOrder", []) if pct.get(p) is not None]
    c = Card("Federal poll average", "Latest %s  \u00b7  change vs. 1 month ago" % t_max.strftime("%d %b %Y").lstrip("0"))
    items = []
    for i, p in enumerate(order):
        foot = None
        if res.get(p) is not None: foot = (str(cfg.get("electionYear", "")) + ": " if i == 0 else "") + "%s%%" % res[p]
        items.append(dict(name=labels.get(p, p), color=party_color(cfg, p), v=pct[p], prev=prev.get(p), gov=p in gov, foot=foot))
    draw_bars(c, items)
    return c, t_max

def card_polls(cfg, polls, parties):
    t_max = polls[-1][0]; bw = cfg.get("smoothingDays", 30); t0 = date(t_max.year - 1, t_max.month, min(t_max.day, 28))
    days = (t_max - t0).days; labels = cfg.get("labels", {})
    ps = [p for p in cfg.get("barOrder", []) if p in parties and not re.search(r"sonstige|others?|andere", p, re.I)
          and smoothed(polls, p, t_max, bw) is not None]
    series = [dict(label=labels.get(p, p), color=party_color(cfg, p),
                   pts=[(t0 + timedelta(days=round(days * k / 100)), smoothed(polls, p, t0 + timedelta(days=round(days * k / 100)), bw)) for k in range(101)]) for p in ps]
    top = max(v for s in series for _, v in s["pts"] if v is not None)
    c = Card("Election polls & approval", "Federal voting intention, last 12 months  \u00b7  latest %s" % t_max.strftime("%d %b %Y").lstrip("0"))
    c.text(24, 204, "Poll average", 700, 21, MUT)
    line_panel(c, (24, 238, 612, 622), series, t0, t_max, 0, math.ceil(top / 5) * 5, 5, lab_w=122)
    # government approval (right)
    try:
        with open(os.path.join(HERE, cfg.get("approvalCsv", "data/government_approval.csv")), encoding="utf-8-sig", newline="") as f:
            rows = list(csv.DictReader(f))
        kd = next(k for k in rows[0] if k.lower() in ("datum", "date"))
        ka = next(k for k in rows[0] if re.search(r"zufrieden|approv|satisf", k, re.I) and not re.match(r"un|dis", k, re.I))
        kb = next((k for k in rows[0] if re.search(r"unzufrieden|disapprov|dissatisf", k, re.I)), None)
        ap = sorted(((pdate(r[kd]), {"a": num(r[ka]), "b": num(r[kb]) if kb else None}) for r in rows if pdate(r[kd])), key=lambda x: x[0])
        a_max = ap[-1][0]; a0 = date(a_max.year - 1, a_max.month, min(a_max.day, 28)); ad = (a_max - a0).days
        if a0 < ap[0][0]: a0 = ap[0][0]; ad = (a_max - a0).days
        ac = cfg.get("approvalColors", {}); ser = []
        for key, nm, col in (("a", "Approve", ac.get("approve", "#2E7D32")), ("b", "Disapprove", ac.get("disapprove", "#C62828"))):
            if not any(v[key] is not None for _, v in ap): continue
            ser.append(dict(label=nm, color="#%02X%02X%02X" % lighten(hexrgb(col), .32),
                            pts=[(a0 + timedelta(days=round(ad * k / 60)), smoothed(ap, key, a0 + timedelta(days=round(ad * k / 60)), 15)) for k in range(61)]))
        try:  # chancellor approval: drawn on the same axis, in the overview page's colours (#B0FA20 / #F49AA9 on dark)
            with open(os.path.join(HERE, "data", "chancellor_approval.csv"), encoding="utf-8-sig", newline="") as f:
                cr = list(csv.DictReader(f))
            ch = sorted(((pdate(r["Date"]), {"a": num(r.get("Approve")), "b": num(r.get("Disapprove"))}) for r in cr if pdate(r["Date"])), key=lambda x: x[0])
            for key, nm, col in (("a", "Chanc. approve", "#B0FA20"), ("b", "Chanc. disapprove", "#F49AA9")):
                if any(v[key] is not None for _, v in ch):
                    ser.append(dict(label=nm, color=col, pts=[(a0 + timedelta(days=round(ad * k / 60)), smoothed(ch, key, a0 + timedelta(days=round(ad * k / 60)), 15)) for k in range(61)]))
        except Exception as e:
            print("  (chancellor approval skipped: %s)" % e)
        for x in ser:
            if x["label"] in ("Approve", "Disapprove"): x["label"] = "Gov. " + x["label"].lower()
        vals = [v for s in ser for _, v in s["pts"] if v is not None]
        lo, hi = math.floor(min(vals) / 10) * 10, math.ceil(max(vals) / 10) * 10
        c.text(628, 204, "Government & chancellor approval", 700, 21, MUT)
        line_panel(c, (628, 238, 1190, 622), ser, a0, a_max, lo, hi, 10, lab_w=216, month_step=4)
    except Exception as e:
        print("  (approval panel skipped: %s)" % e)
    return c, t_max

def seat_model(cfg, polls, parties, at=None):
    t_max = at or polls[-1][0]; bw = cfg.get("smoothingDays", 30); N = cfg.get("seats", 630); thr = cfg.get("threshold", 5)
    spec = cfg.get("spectrum", []); sp = lambda p: spec.index(p) if p in spec else len(spec)
    order = sorted([*parties, "SSW"], key=sp)   # stable, like the JS sort
    pct = {p: (None if p == "SSW" else smoothed(polls, p, t_max, bw)) for p in order}
    elig = [p for p in order if pct[p] is not None and pct[p] >= thr and not re.search(r"sonstige|others?|andere", p, re.I)]
    sl = sainte_lague({p: pct[p] for p in elig}, N - 1)
    return order, pct, {p: (1 if p == "SSW" else sl.get(p, 0)) for p in order}, N

def card_parliament(cfg, polls, parties):
    t_max = polls[-1][0]; order, pct, seats, N = seat_model(cfg, polls, parties); maj = N // 2 + 1; labels = cfg.get("labels", {})
    c = Card("Bundestag projection", "Seats based on the poll average of %s" % t_max.strftime("%d %b %Y").lstrip("0"))
    cx, cy, r_out, r_in = W / 2, 498, 294, 158
    rows, slots, dot = layout_seats(N, cx, cy, r_in, r_out)
    owner = [p for p in order for _ in range(seats[p])]
    for i, s in enumerate(slots):
        p = owner[i] if i < len(owner) else None
        col = bar_color(party_color(cfg, p)) if p else hexrgb("#33373F")
        c.d.ellipse([(s["x"] - dot) * S, (s["y"] - dot) * S, (s["x"] + dot) * S, (s["y"] + dot) * S], fill=col)
    # dashed line between seat 315 and 316 (majority)
    bp = []
    for row in rows:
        m = len(row["items"]); k = 0
        while k < m and row["items"][k]["gi"] < maj: k += 1
        a = 180 if k <= 0 else 0 if k >= m else (row["items"][k - 1]["angle"] + row["items"][k]["angle"]) / 2
        bp.append((cx + row["r"] * math.cos(math.radians(a)), cy - row["r"] * math.sin(math.radians(a))))
    ang = lambda p: math.atan2(cy - p[1], p[0] - cx)
    ext = lambda r, p: (cx + r * math.cos(ang(p)), cy - r * math.sin(ang(p)))
    full = [ext(r_in - 14, bp[0]), *bp, ext(r_out + 14, bp[-1])]
    c.line(full, BG, 8); c.dashed(full, INK, 4, 8, 6)
    c.text(cx, cy - 124, str(N), 700, 58, INK, "ma"); c.text(cx, cy - 62, "Seats", 400, 22, MUT, "ma")
    c.text(cx, cy - 30, "%d needed for majority" % maj, 700, 18, MUT, "ma")
    act = [p for p in order if seats[p] > 0]; gp = 12
    ws = [max(80, c.width(labels.get(p, p), 700, 22) + 34) for p in act]; x = cx - (sum(ws) + gp * (len(act) - 1)) / 2
    for p, w in zip(act, ws):
        col = bar_color(party_color(cfg, p)); c.rrect(x, cy + 30, x + w, cy + 76, 8, col)
        c.text(x + w / 2, cy + 53, labels.get(p, p), 700, 22, (21, 24, 28) if lum(col) >= 140 else (255, 255, 255), "mm")
        c.text(x + w / 2, cy + 82, str(seats[p]), 700, 30, INK, "ma"); x += w + gp
    return c, t_max

def project_constituencies(cfg, polls, parties):
    """Leader of every constituency: 2025 second votes, ratio swing so that the national total = current poll average."""
    C = json.load(open(os.path.join(HERE, "data", "constituencies.json"), encoding="utf-8"))
    PI = C["parties"]; K = ["CDU/CSU", "AfD", "SPD", "Gr\u00fcne", "Linke", "BSW", "FDP", "Sonstige"]; m = len(K)
    fw = PI.index("Freie W\u00e4hler") if "Freie W\u00e4hler" in PI else -1
    merge = lambda a: [a[PI.index(k)] + (a[fw] if k == "Sonstige" and fw >= 0 else 0) for k in K]
    wk = [(w["n"], w["v"], merge(w["s"])) for w in C["wk"]]; Vt = sum(v for _, v, _ in wk)
    t_max = polls[-1][0]; bw = cfg.get("smoothingDays", 30); pct = {p: smoothed(polls, p, t_max, bw) for p in parties}
    nat = [sum(v * s[j] for _, v, s in wk) / Vt for j in range(m)]
    T = []
    for j, k in enumerate(K):
        if k == "Sonstige":
            a, b = pct.get("Sonstige"), pct.get("Freie W\u00e4hler"); T.append(nat[j] if a is None and b is None else (a or 0) + (b or 0))
        else: T.append(pct[k] if pct.get(k) is not None else nat[j])
    ts = sum(T); T = [v / ts * 100 for v in T]
    f = [1.0] * m
    for _ in range(300):
        tot = [0.0] * m
        for _, v, s in wk:
            x = [s[j] * f[j] for j in range(m)]; z = sum(x) or 1
            for j in range(m): tot[j] += v * x[j] / z * 100 / Vt
        for j in range(m):
            if tot[j] > 0: f[j] *= T[j] / tot[j]
    lead = {}
    for n, _, s in wk:
        x = [s[j] * f[j] for j in range(m - 1)]; lead[n] = K[x.index(max(x))]
    return lead

def card_constituencies(cfg, polls, parties):
    t_max = polls[-1][0]; lead = project_constituencies(cfg, polls, parties); labels = cfg.get("labels", {})
    g = json.load(open(os.path.join(HERE, "data", "wahlkreise.geojson"), encoding="utf-8"))
    pts = [p for f in g["features"] for poly in f["geometry"]["coordinates"] for ring in poly for p in ring]
    lo0, lo1 = min(p[0] for p in pts), max(p[0] for p in pts); la0, la1 = min(p[1] for p in pts), max(p[1] for p in pts)
    kx = math.cos(math.radians((la0 + la1) / 2)); mh = 420; sc = mh / (la1 - la0); mw = (lo1 - lo0) * kx * sc
    counts = {}
    for p in lead.values(): counts[p] = counts.get(p, 0) + 1
    rows = sorted(counts.items(), key=lambda kv: -kv[1]); lw = 430; gap = 70
    mx = (W - (mw + gap + lw)) / 2; my = 200
    c = Card("Battleground Map", "Who leads in each of the %d constituencies  \u00b7  poll average of %s" % (len(lead), t_max.strftime("%d %b %Y").lstrip("0")))
    pr = lambda p: ((mx + (p[0] - lo0) * kx * sc) * S, (my + (la1 - p[1]) * sc) * S)
    for ft in g["features"]:
        col = bar_color(party_color(cfg, lead.get(ft["properties"]["n"], "Sonstige")))
        for poly in ft["geometry"]["coordinates"]:
            c.d.polygon([pr(p) for p in poly[0]], fill=col, outline=BG, width=S)
            for hole in poly[1:]: c.d.polygon([pr(p) for p in hole], fill=BG)
    rh = min(68, mh / len(rows)); lx = mx + mw + gap; ly = my + (mh - rh * len(rows)) / 2
    for i, (p, n) in enumerate(rows):
        y = ly + i * rh; col = bar_color(party_color(cfg, p)); cy_ = y + rh / 2
        c.rrect(lx, cy_ - 20, lx + 40, cy_ + 20, 6, col)
        c.text(lx + 60, cy_, labels.get(p, p), 700, 34, INK, "lm"); c.text(lx + lw, cy_, str(n), 700, 46, INK, "rm")
    return c, t_max

def card_election(cfg):
    E = json.load(open(os.path.join(HERE, "data", "election2025.json"), encoding="utf-8")); labels = cfg.get("labels", {})
    res, order = cfg.get("electionResults", {}), cfg.get("barOrder", []); items = []
    for p in order:
        if res.get(p) is None: continue
        sd = (E["parties"].get(p) or {}).get("seats")
        items.append(dict(name=labels.get(p, p), color=party_color(cfg, p), v=res[p], gov=False,
                          foot=None if p == "Sonstige" else ("%d seats" % sd if sd else "no seats")))
    d = E["date"]; ds = date(int(d[:4]), int(d[5:7]), int(d[8:10])).strftime("%d %b %Y").lstrip("0")
    c = Card("%s federal election" % cfg.get("electionYear", d[:4]), "Result & Bundestag seats  \u00b7  %s  \u00b7  turnout %s%%" % (ds, ("%.1f" % E["turnout"]).rstrip("0").rstrip(".")))
    def vf(v):  # one decimal; BSW (4.98) must not read as 5.0 = "above the threshold"
        t = "%.1f" % v
        return ("%.2f" % v if v < 5 <= float(t) else t) + "%"
    draw_bars(c, items, vfmt=vf, foot_dy=68, base=524)
    return c, date.fromisoformat(d)

def card_state(cfg, sid, slug, en, results):
    rows = list(csv.DictReader(open(os.path.join(HERE, cfg.get("stateFolder", "state_polls"), slug + ".csv"), encoding="utf-8-sig", newline="")))
    parties = [k for k in rows[0] if k and k.lower() not in META]
    polls = sorted(((pdate(r["Datum"]), {p: num(r.get(p)) for p in parties}) for r in rows if pdate(r["Datum"])), key=lambda x: x[0])
    t = polls[-1][0]; bw = cfg.get("stateSmoothingDays", 60); labels = cfg.get("labels", {})
    pct = {p: smoothed(polls, p, t, bw) for p in parties}
    other = [p for p in parties if re.search(r"sonstige|others?|andere", p, re.I)]
    main = sorted([p for p in parties if p not in other and pct[p] is not None and pct[p] >= 1.5], key=lambda p: -pct[p])[:7]
    main += [p for p in other if pct[p] is not None]
    last = None
    if results:
        dts = sorted(results); last = dts[-1]
    items = []
    for i, p in enumerate(main):
        foot = None
        if last and results[last].get(p) is not None: foot = (last[:4] + ": " if i == 0 else "") + "%s%%" % results[last][p]
        items.append(dict(name=labels.get(p, p), color=party_color(cfg, p, parties.index(p)), v=pct[p], gov=False, foot=foot))
    sub = "Latest poll %s" % t.strftime("%d %b %Y").lstrip("0")
    if last: sub += "  \u00b7  last state election (%s) below" % date.fromisoformat(last).strftime("%d %b %Y").lstrip("0")
    c = Card("%s poll average" % en, sub)
    draw_bars(c, items, foot_dy=68, base=524)
    return c, t

# ---------------------------------------------------------------- main
def main():
    cfg = json.load(open(os.path.join(HERE, "config.json"), encoding="utf-8"))
    parties, polls = read_polls(os.path.join(HERE, cfg.get("pollsCsv", "data/germanpolls.csv")), cfg.get("hiddenParties", []))
    out = os.path.join(HERE, "img", "og"); man = {}
    stamp = lambda d: d.strftime("%Y%m%d")

    c, t = card_home(cfg, polls, parties); c.save(os.path.join(HERE, "img", "og.png")); man["home"] = stamp(t)
    print("  embed image -> img/og.png (poll average of %s)" % t.isoformat())
    for slug, fn in (("polls", card_polls), ("parliament", card_parliament), ("constituencies", card_constituencies)):
        c, t = fn(cfg, polls, parties); c.save(os.path.join(out, slug + ".png")); man[slug] = stamp(t)
    c, t = card_election(cfg); c.save(os.path.join(out, "election.png")); man["election"] = stamp(t)
    geo = json.load(open(os.path.join(HERE, cfg.get("statesMap", "data/germany-states.json")), encoding="utf-8"))["states"]
    try: sres = json.load(open(os.path.join(HERE, "data", "state_results.json"), encoding="utf-8"))
    except Exception: sres = {}
    for s in geo:
        sid = s["id"]; slug = (cfg.get("stateFiles") or {}).get(sid)
        if not slug or not os.path.exists(os.path.join(HERE, cfg.get("stateFolder", "state_polls"), slug + ".csv")): continue
        try:
            c, t = card_state(cfg, sid, slug, s.get("en") or s["name"], sres.get(sid)); c.save(os.path.join(out, "state-%s.png" % sid)); man["state-" + sid] = stamp(t)
        except Exception as e:
            print("  (state %s skipped: %s)" % (sid, e))
    json.dump(man, open(os.path.join(out, "manifest.json"), "w"), indent=1, sort_keys=True)
    print("  embed images -> img/og/ (%d pages)" % len(man))

    # cache-buster of the home image, so Discord/Twitter pick up the new picture
    ip = os.path.join(HERE, "index.html"); html = open(ip, encoding="utf-8", newline="").read()
    new = re.sub(r"(img/og\.png\?v=)[\w.-]*", r"\g<1>" + man["home"], html)
    if new != html:
        open(ip, "w", encoding="utf-8", newline="").write(new)
    try:  # the per-address copies of index.html (polls/, state/BY/, ...) link their own image: rebuild them
        import build_pages; build_pages.main()
    except Exception as e:
        print("  (pages not rebuilt: %s - run: python py/build_pages.py)" % e)

if __name__ == "__main__":
    main()
