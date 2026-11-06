"""Download the biome backgrounds from the Terraria Wiki into backgrounds/.

Usage (from the project folder):   python tools/fetch_backgrounds.py

Looks up each wiki file page by its id, downloads the full image, and writes
backgrounds/manifest.json, which the site reads. Re-running skips existing files.
"""
import json, os, ssl, urllib.request, urllib.parse

try:
    import truststore; CTX = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
except ImportError:
    try:
        import certifi; CTX = ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        CTX = ssl.create_default_context()

PAGES = {   # wiki page ids picked by Jolt
    'forest': [52124, 76338],
    'desert': [76325, 76323],
    'snow':   [34798, 76318],
}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'backgrounds')
UA = {'User-Agent': 'ttd-calc-background-fetch (personal tool)'}

def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60, context=CTX) as r:
        return r.read()

def main():
    os.makedirs(OUT, exist_ok=True)
    ids = '|'.join(str(i) for v in PAGES.values() for i in v)
    api = 'https://terraria.wiki.gg/api.php?' + urllib.parse.urlencode(
        {'action': 'query', 'pageids': ids, 'prop': 'imageinfo', 'iiprop': 'url', 'format': 'json'})
    pages = json.loads(get(api))['query']['pages']
    manifest = {}
    for biome, idlist in PAGES.items():
        for n, pid in enumerate(idlist, 1):
            p = pages.get(str(pid), {})
            info = (p.get('imageinfo') or [{}])[0]
            url = info.get('url')
            if not url:
                print(f'  ! {biome} #{n}: page {pid} has no image ({p.get("title")})'); continue
            ext = os.path.splitext(urllib.parse.urlparse(url).path)[1] or '.png'
            rel = f'backgrounds/{biome}_{n}{ext}'
            dest = os.path.join(ROOT, rel)
            if not os.path.exists(dest):
                open(dest, 'wb').write(get(url))
            manifest.setdefault(biome, []).append(rel)
            print(f'  {biome} #{n}: {p.get("title")} -> {rel}')
    json.dump(manifest, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=1)
    print('Done. Refresh the calculator.')

if __name__ == '__main__':
    main()
