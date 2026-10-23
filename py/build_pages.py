#!/usr/bin/env python3
"""Writes one real HTML page per address, so that /polls, /parliament, /constituencies, /election and /state/<ID> work
as proper links on GitHub Pages (a static host: it only serves files that exist) and answer with 200, not 404.

  index.html  ->  polls/index.html, parliament/index.html, constituencies/index.html, election/index.html,
                  state/BW/index.html ... state/TH/index.html, 404.html (fallback for any other address), sitemap.xml

Every copy is the same app (same CSS / JS / data, loaded with absolute paths); only <title>, canonical link and link-preview
texts differ. The app itself reads the address and shows the right tab or state.
Run automatically by make_og.py (so also by update_data.py and the GitHub workflow). By hand:  python py/build_pages.py
After editing index.html, run it once so the copies follow.
"""
import json, os, re

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # repo root (this script lives in py/)
SITE = "https://kanzlercheck.github.io"
TABS = {
    "polls": "Polls & Approval",
    "parliament": "Bundestag Projection",
    "constituencies": "Battleground map",
    "election": "2025 Election",
}

def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")

def page(src, route, title):
    """src = index.html text; route = '' or 'polls' or 'state/BY'; title = page name (None = keep the home page texts)."""
    url = SITE + "/" + (route + "/" if route else "")
    out = src
    if title:
        full = "KanzlerCheck: " + title
        out = out.replace("<title>KanzlerCheck</title>", "<title>%s</title>" % esc(title + " \u2013 KanzlerCheck"), 1)
        out = re.sub(r'(<meta property="og:title" content=")[^"]*(")', lambda m: m.group(1) + esc(full) + m.group(2), out, 1)
        out = re.sub(r'(<meta name="twitter:title" content=")[^"]*(")', lambda m: m.group(1) + esc(full) + m.group(2), out, 1)
    out = re.sub(r'(<link rel="canonical" href=")[^"]*(")', lambda m: m.group(1) + url + m.group(2), out, 1)
    out = re.sub(r'(<meta property="og:url" content=")[^"]*(")', lambda m: m.group(1) + url + m.group(2), out, 1)
    return out

def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)

def main():
    with open(os.path.join(HERE, "index.html"), encoding="utf-8", newline="") as f:
        src = f.read()
    with open(os.path.join(HERE, "data", "germany-states.json"), encoding="utf-8") as f:
        states = [(s["id"], s.get("en") or s["name"]) for s in json.load(f)["states"]]
    urls = [""]
    for tab, title in TABS.items():
        write(os.path.join(HERE, tab, "index.html"), page(src, tab, title)); urls.append(tab)
    for sid, name in states:
        write(os.path.join(HERE, "state", sid, "index.html"), page(src, "state/" + sid, name + " state polls")); urls.append("state/" + sid)
    # fallback for every other address (GitHub Pages serves 404.html with status 404, the app then shows the home page)
    write(os.path.join(HERE, "404.html"), src.replace("<meta charset=\"utf-8\">", "<meta charset=\"utf-8\">\n<meta name=\"robots\" content=\"noindex\">", 1))
    write(os.path.join(HERE, "sitemap.xml"),
          '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
          + "".join("  <url><loc>%s/%s</loc></url>\n" % (SITE, (u + "/") if u else "") for u in urls) + "</urlset>\n")
    print("  pages -> %d addresses (polls/, parliament/, constituencies/, election/, state/<ID>/), 404.html, sitemap.xml" % len(urls))

if __name__ == "__main__":
    main()
