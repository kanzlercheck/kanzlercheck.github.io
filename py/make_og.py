#!/usr/bin/env python3
"""Builds img/og.png (the link-preview / Discord embed image): a dark-mode copy of the
"Federal poll average" chart from the overview, with the site logo at the top.

It reads data/germanpolls.csv + config.json and uses the same smoothing as the website,
so the numbers match the page.  Run automatically by update_data.py; or:  python py/make_og.py
Needs Pillow (pip install pillow).  Also bumps the ?v= cache-buster of the image in index.html
so Discord / Twitter fetch the new picture.
"""
import csv, json, math, os, re
from datetime import date, timedelta
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # repo root (this script lives in py/)
META = {"datum", "institut", "befragungsmethode", "befragungsstart", "befragungsende", "befragtenanzahl"}
S = 2  # supersampling for smooth edges
W, H = 1200, 630

def num(v):
    v = (v or "").strip().replace(",", ".")
    try:
        return float(v)
    except ValueError:
        return None

def pdate(v):
    m = re.match(r"(\d{1,2})\.(\d{1,2})\.(\d{4})", v.strip())
    if m:
        return date(int(m[3]), int(m[2]), int(m[1]))
    m = re.match(r"(\d{4})-(\d{1,2})-(\d{1,2})", v.strip())
    return date(int(m[1]), int(m[2]), int(m[3])) if m else None

def month_ago(d):  # same overflow behaviour as JS setUTCMonth(-1)
    y, m = (d.year, d.month - 1) if d.month > 1 else (d.year - 1, 12)
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

def hexrgb(h):
    h = h.lstrip("#"); return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
def lum(c): return c[0] * .299 + c[1] * .587 + c[2] * .114
def lighten(c, a): return tuple(round(v + (255 - v) * a) for v in c)

def main():
    cfg = json.load(open(os.path.join(HERE, "config.json"), encoding="utf-8"))
    with open(os.path.join(HERE, cfg.get("pollsCsv", "data/germanpolls.csv")), encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    parties = [k for k in rows[0] if k and k.lower() not in META]
    polls = sorted(((pdate(r["Datum"]), {p: num(r.get(p)) for p in parties}) for r in rows if pdate(r["Datum"])), key=lambda x: x[0])
    t_max = polls[-1][0]; bw = cfg.get("smoothingDays", 30)
    pct = {p: smoothed(polls, p, t_max, bw) for p in parties}
    prev = {p: smoothed(polls, p, month_ago(t_max), bw) for p in parties}
    labels, colors = cfg.get("labels", {}), cfg.get("colors", {})
    order = [p for p in cfg.get("barOrder", []) if pct.get(p) is not None]
    gov, res = cfg.get("government", []), cfg.get("electionResults", {})

    # palette = the site's dark theme
    BG, PANEL, INK, MUT, LINE, OK, ERR = (hexrgb(x) for x in ("#1F222A", "#1F222A", "#F1F2F4", "#9AA0AA", "#33373F", "#6FCF97", "#FF7A6E"))
    FD = os.path.join(HERE, "fonts", "og")
    font = lambda w, s: ImageFont.truetype(os.path.join(FD, "IBMPlexSans-%d.ttf" % w), int(s * S))
    img = Image.new("RGB", (W * S, H * S), BG); d = ImageDraw.Draw(img)
    def text(x, y, t, f, fill, anchor="la"): d.text((x * S, y * S), t, font=f, fill=fill, anchor=anchor)

    # logo, centred at the top
    logo = Image.open(os.path.join(HERE, "img", "logo-dark.png")).convert("RGBA")
    lh = 96; lw = round(logo.width * lh / logo.height)
    logo = logo.resize((lw * S, lh * S), Image.LANCZOS)
    img.paste(logo, ((W - lw) // 2 * S, 16 * S), logo)

    # heading
    text(W / 2, 128, "Federal poll average", font(600, 25), INK, "ma")
    text(W / 2, 160, "Latest %s  ·  change vs. 1 month ago" % t_max.strftime("%d %b %Y").lstrip("0"), font(400, 15), MUT, "ma")

    # bars
    left, right, gap, base, maxh = 64, 64, 16, 468, 200
    n = len(order); bw_ = (W - left - right - (n - 1) * gap) / n
    scale = maxh / max(10, *(pct[p] for p in order))
    y5 = base - 5 * scale
    for x in range(left, W - right, 12):
        d.line([(x * S, y5 * S), (min(x + 6, W - right) * S, y5 * S)], fill=LINE, width=2 * S)
    text(left - 8, y5 - 9, "5%", font(500 if os.path.exists(os.path.join(FD, "IBMPlexSans-500.ttf")) else 400, 13), MUT, "ra")
    for i, p in enumerate(order):
        x = left + i * (bw_ + gap); cx = x + bw_ / 2; v = pct[p]; h = max(2, v * scale); top = base - h
        c = hexrgb(colors.get(p) or colors.get("CDU/CSU" if p == "Union" else p, "#9AA0AA"))
        dk = lum(c) < 60
        d.rounded_rectangle([x * S, top * S, (x + bw_) * S, base * S], radius=2 * S, fill=hexrgb("#4A4F58") if dk else c)
        text(cx, top - 54, "%d%%" % round(v), font(700, 27), INK, "ma")
        if prev.get(p) is not None:
            dv = v - prev[p]; flat = abs(dv) < .05
            s = "(=)" if flat else "(%s%.1f)" % ("+" if dv > 0 else "−", abs(dv))
            text(cx, top - 22, s, font(600, 17), INK if flat else (OK if dv > 0 else ERR), "ma")
        tint = lighten(c, .38); name = labels.get(p, p)
        d.rounded_rectangle([x * S, (base + 10) * S, (x + bw_) * S, (base + 42) * S], radius=2 * S, fill=tint)
        fs = 16
        f = font(700, fs)
        while d.textlength(name, font=f) > (bw_ - 10) * S and fs > 10:
            fs -= 1; f = font(700, fs)
        text(cx, base + 26, name, f, (21, 24, 28) if lum(tint) >= 140 else (255, 255, 255), "mm")
        if p in gov:
            text(cx, base + 50, "Gov't", font(600, 14), ERR, "ma")
        if res.get(p) is not None:
            text(cx, base + 72, (str(cfg.get("electionYear", "")) + ": " if i == 0 else "") + "%s%%" % res[p], font(700, 14), MUT, "ma")

    # brand stripe along the bottom (as before)
    for k, col in enumerate(("#15181C", "#C62828", "#F9A825")):
        d.rectangle([k * W // 3 * S, (H - 14) * S, ((k + 1) * W // 3) * S, H * S], fill=hexrgb(col))
    img.resize((W, H), Image.LANCZOS).save(os.path.join(HERE, "img", "og.png"), optimize=True)

    # cache-buster so Discord/Twitter pick up the new image
    ip = os.path.join(HERE, "index.html"); html = open(ip, encoding="utf-8").read()
    new = re.sub(r"(img/og\.png\?v=)[\w.-]*", r"\g<1>" + t_max.strftime("%Y%m%d"), html)
    if new != html:
        open(ip, "w", encoding="utf-8", newline="").write(new)
    print("  embed image -> img/og.png (poll average of %s)" % t_max.isoformat())

if __name__ == "__main__":
    main()
