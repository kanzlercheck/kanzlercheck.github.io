#!/usr/bin/env python3
"""Writes one real HTML page per address, so that /polls, /parliament, /constituencies, /election and /state/<ID> work
as proper links on GitHub Pages (a static host: it only serves files that exist) and answer with 200, not 404.

  index.html  ->  polls/index.html, parliament/index.html, constituencies/index.html, election/index.html,
                  state/BW/index.html ... state/TH/index.html, 404.html (fallback for any other address), sitemap.xml

Every copy is the same app (same CSS / JS / data, loaded with absolute paths); only <title>, canonical link and link-preview
texts + image (img/og/<page>.png, made by make_og.py) differ. The app itself reads the address and shows the right tab or state.
Run automatically by make_og.py (so also by update_data.py and the GitHub workflow). By hand:  python py/build_pages.py
After editing index.html, run it once so the copies follow.
"""
import hashlib, json, os, re

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # repo root (this script lives in py/)
SITE = "https://kanzlercheck.github.io"
TABS = {
    "polls": "Polls & Approval",
    "parliament": "Bundestag Projection",
    "constituencies": "Battleground Map",
    "election": "2025 Election",
}

def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")

def og_manifest():
    """img/og/manifest.json (written by make_og.py): cache-buster of every per-address embed image."""
    try:
        with open(os.path.join(HERE, "img", "og", "manifest.json"), encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}

def page(src, route, title, image=None):
    """src = index.html text; route = '' or 'polls' or 'state/BY'; title = page name (None = keep the home page texts);
    image = (slug, version) of this address' own embed image img/og/<slug>.png (None = keep the home image img/og.png)."""
    url = SITE + "/" + (route + "/" if route else "")
    out = src
    if title:
        full = "KanzlerCheck: " + title
        out = out.replace("<title>KanzlerCheck</title>", "<title>%s</title>" % esc(title + " \u2013 KanzlerCheck"), 1)
        out = re.sub(r'(<meta property="og:title" content=")[^"]*(")', lambda m: m.group(1) + esc(full) + m.group(2), out, 1)
        out = re.sub(r'(<meta name="twitter:title" content=")[^"]*(")', lambda m: m.group(1) + esc(full) + m.group(2), out, 1)
    out = re.sub(r'(<link rel="canonical" href=")[^"]*(")', lambda m: m.group(1) + url + m.group(2), out, 1)
    out = re.sub(r'(<meta property="og:url" content=")[^"]*(")', lambda m: m.group(1) + url + m.group(2), out, 1)
    if image:
        slug, ver = image
        new = SITE + "/img/og/" + slug + ".png" + ("?v=" + ver if ver else "")
        out = re.sub(r"https://kanzlercheck\.github\.io/img/og\.png(\?v=[\w.-]*)?", lambda m: new, out)
        alt = "KanzlerCheck: " + (title or "") + " (live data)"
        out = re.sub(r'(<meta property="og:image:alt" content=")[^"]*(")', lambda m: m.group(1) + esc(alt) + m.group(2), out, 1)
    return out

def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)

def stamp():
    """Cache-busting without hand-edited numbers: the ?v= of css/style.css and js/app.js (and /version.json, which open pages compare with
    to reload themselves once after a deploy) is a fingerprint of index.html + style.css + app.js. Any change to one of them = new id."""
    ip = os.path.join(HERE, "index.html")
    with open(ip, encoding="utf-8", newline="") as f:
        src = f.read()
    norm = lambda t: t.replace("\r\n", "\n")
    h = hashlib.sha1()
    h.update(norm(re.sub(r"(style\.css|app\.js)\?v=[\w.-]+", r"\1?v=X", src)).encode("utf-8"))
    for rel in ("css/style.css", "js/app.js"):
        with open(os.path.join(HERE, *rel.split("/")), encoding="utf-8", newline="") as f:
            h.update(norm(f.read()).encode("utf-8"))
    vid = "b" + h.hexdigest()[:8]
    new = re.sub(r"((?:style\.css|app\.js)\?v=)[\w.-]+", lambda m: m.group(1) + vid, src)
    if new != src:
        write(ip, new)
    write(os.path.join(HERE, "version.json"), '{"v":"%s"}\n' % vid)
    return vid

def main():
    vid = stamp()
    with open(os.path.join(HERE, "index.html"), encoding="utf-8", newline="") as f:
        src = f.read()
    with open(os.path.join(HERE, "data", "germany-states.json"), encoding="utf-8") as f:
        states = [(s["id"], s.get("en") or s["name"]) for s in json.load(f)["states"]]
    man = og_manifest(); img = lambda slug: (slug, man[slug]) if slug in man and os.path.exists(os.path.join(HERE, "img", "og", slug + ".png")) else None
    urls = [""]
    for tab, title in TABS.items():
        write(os.path.join(HERE, tab, "index.html"), page(src, tab, title, img(tab))); urls.append(tab)
    for sid, name in states:
        write(os.path.join(HERE, "state", sid, "index.html"), page(src, "state/" + sid, name + " state polls", img("state-" + sid))); urls.append("state/" + sid)
    # fallback for every other address (GitHub Pages serves 404.html with status 404, the app then shows the home page)
    write(os.path.join(HERE, "404.html"), src.replace("<meta charset=\"utf-8\">", "<meta charset=\"utf-8\">\n<meta name=\"robots\" content=\"noindex\">", 1))
    write(os.path.join(HERE, "sitemap.xml"),
          '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
          + "".join("  <url><loc>%s/%s</loc></url>\n" % (SITE, (u + "/") if u else "") for u in urls) + "</urlset>\n")
    print("  pages -> %d addresses (polls/, parliament/, constituencies/, election/, state/<ID>/), 404.html, sitemap.xml" % len(urls))

if __name__ == "__main__":
    main()
