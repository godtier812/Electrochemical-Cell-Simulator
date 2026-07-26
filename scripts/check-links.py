#!/usr/bin/env python3
"""Post-build link checker: verifies every internal href/src resolves inside
dist/, including #fragment targets. Run after `npm run build`."""
import os, re, sys
from urllib.parse import urlparse, unquote

DIST = 'dist'
BASE = '/Electrochemical-Cell-Simulator/'
pages = {}
for root, _, files in os.walk(DIST):
    for f in files:
        if f.endswith('.html'):
            p = os.path.join(root, f)
            pages[p] = open(p, encoding='utf8').read()

ids = {p: set(re.findall(r'\bid="([^"]+)"', html)) for p, html in pages.items()}

def page_for(path):
    rel = unquote(path)[len(BASE):]
    for cand in (os.path.join(DIST, rel, 'index.html'), os.path.join(DIST, rel)):
        if cand in pages:
            return cand
    return None

broken = []
for page, html in pages.items():
    for attr, url in re.findall(r'(href|src)="([^"]+)"', html):
        if url.startswith(('http', 'mailto:', 'data:')):
            continue
        parsed = urlparse(url)
        if url.startswith('#'):
            if parsed.fragment and parsed.fragment not in ids[page]:
                broken.append((page, url, 'missing local fragment'))
            continue
        if not parsed.path.startswith(BASE):
            broken.append((page, url, 'outside base path'))
            continue
        rel = unquote(parsed.path)[len(BASE):]
        fs = os.path.join(DIST, rel)
        ok = os.path.exists(fs) if not parsed.path.endswith('/') and os.path.splitext(rel)[1] else os.path.exists(os.path.join(fs, 'index.html'))
        if not ok:
            broken.append((page, url, 'no such file'))
            continue
        if parsed.fragment:
            target = page_for(parsed.path)
            if target and parsed.fragment not in ids[target]:
                broken.append((page, url, 'missing fragment in target'))

for p, u, why in sorted(set(broken)):
    print(f'BROKEN [{why}] {p.replace(DIST, "")}: {u}')
print(f'{len(pages)} pages, {len(set(broken))} broken references')
sys.exit(1 if broken else 0)
