"""Download every item/unit/enemy sprite from the Trello board export.

Usage (from the project folder):
    python tools/fetch_icons.py

Reads tools/board.json, saves sprites to icons/<category>/<Name>.png and writes
icons/manifest.json (name -> path) which the site uses. Re-running skips files
that already exist, so it's safe to run again after a board update.

Trello usually requires login to download attachments. If the first download
fails with 401/403, the script asks for a Trello API key + token:
  1. Go to https://trello.com/power-ups/admin  -> New Power-Up (any name/workspace)
  2. Open it -> API key -> "Generate a new API key" -> copy the key
  3. On that page click the "Token" link -> Allow -> copy the token
You can also set them as environment variables TRELLO_KEY / TRELLO_TOKEN.
"""
import json, os, re, sys, time, ssl, urllib.request, urllib.error

# Windows Python often can't see the system's trusted certificates (CERTIFICATE_VERIFY_FAILED).
# Prefer the Windows certificate store via `truststore`, then the `certifi` bundle.
SSL_CTX = None
try:
    import truststore
    SSL_CTX = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
except ImportError:
    try:
        import certifi
        SSL_CTX = ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        SSL_CTX = ssl.create_default_context()
        SSL_CTX.load_default_certs()

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
LISTS = {'Units': 'units', 'Accessories': 'accessories', 'Weapons': 'weapons', 'Armors': 'armors',
         'Whips': 'whips', 'Enemies': 'enemies', 'Consumables': 'consumables', 'Achievements': 'achievements'}

def safe(name):
    # apostrophes become underscores ("Zephyr's Grip" -> "Zephyr_s Grip"): safe in URLs and across Mac/PC sync
    return re.sub(r'[<>:"/\\|?*]', '', name).replace("'", "_").replace("’", "_").strip()

def main():
    board = json.load(open(os.path.join(HERE, 'board.json'), encoding='utf-8'))
    lists = {l['id']: l['name'] for l in board['lists']}
    jobs = []
    for c in board['cards']:
        cat = LISTS.get(lists.get(c['idList']))
        if not cat or c['closed'] or '_Information_' not in c['desc']:
            continue
        cover = (c.get('cover') or {}).get('idAttachment')
        att = next((a for a in c.get('attachments', []) if a['id'] == cover), None) \
              or next((a for a in c.get('attachments', []) if (a.get('mimeType') or '').startswith('image')), None)
        if att:
            ext = os.path.splitext(att.get('fileName') or att['url'])[1] or '.png'
            jobs.append((cat, c['name'], att['url'], f'icons/{cat}/{safe(c["name"])}{ext}'))

    key, token = os.environ.get('TRELLO_KEY'), os.environ.get('TRELLO_TOKEN')
    manifest, ok, failed = {}, 0, []
    print(f'{len(jobs)} sprites to fetch')
    for i, (cat, name, url, rel) in enumerate(jobs):
        dest = os.path.join(ROOT, rel)
        manifest.setdefault(cat, {})[name] = rel
        if os.path.exists(dest):
            ok += 1; continue
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        while True:
            req = urllib.request.Request(url, headers={'User-Agent': 'ttd-calc-icon-fetch'})
            if key and token:
                req.add_header('Authorization', f'OAuth oauth_consumer_key="{key}", oauth_token="{token}"')
            try:
                with urllib.request.urlopen(req, timeout=30, context=SSL_CTX) as r:
                    open(dest, 'wb').write(r.read())
                ok += 1
                break
            except urllib.error.HTTPError as e:
                if e.code in (401, 403) and not (key and token):
                    print(f'\nTrello wants a login to download attachments (HTTP {e.code}).')
                    print('See the instructions at the top of this file for getting a key + token.')
                    key = input('Trello API key: ').strip()
                    token = input('Trello token:   ').strip()
                    continue
                if e.code == 429:
                    time.sleep(5); continue
                failed.append((name, f'HTTP {e.code}')); manifest[cat].pop(name, None); break
            except Exception as e:
                failed.append((name, str(e))); manifest[cat].pop(name, None); break
        if (i + 1) % 25 == 0:
            print(f'  {i + 1}/{len(jobs)}')
        time.sleep(0.1)   # be polite to Trello's rate limit

    json.dump(manifest, open(os.path.join(ROOT, 'icons', 'manifest.json'), 'w', encoding='utf-8'), indent=1)
    print(f'\nDone: {ok} saved, {len(failed)} failed')
    if any('CERTIFICATE_VERIFY_FAILED' in why for _, why in failed):
        print('\nCertificate errors: run   pip install truststore   then run this script again.')
    for n, why in failed:
        print(f'  - {n}: {why}')

if __name__ == '__main__':
    main()
