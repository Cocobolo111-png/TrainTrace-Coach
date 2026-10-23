"""Read only reviewed Action metadata; preserve summaries only for unchanged sources."""
import hashlib
import json
import re
import sys
from pathlib import Path
from zipfile import ZipFile

source, target = map(Path, sys.argv[1:3])
previous = {c['id']: c for c in json.loads(target.read_text())} if target.exists() else {}
cards = []
with ZipFile(source) as archive:
    for name in archive.namelist():
        if '/10_Actions/' not in name or not name.endswith('.md'):
            continue
        text = archive.read(name).decode('utf-8-sig')
        front = text.split('---', 2)[1]
        field = lambda key: re.search(r'^' + key + r': (.+)$', front, re.M)[1].strip()
        if field('type') != 'action' or field('status') != 'reviewed':
            raise ValueError('Only reviewed Action cards may be imported')
        sources = re.findall(r'- video: (TS\d+)\s+start: ([\d:]+)\s+end: ([\d:]+)', front)
        if not sources:
            raise ValueError('Missing video evidence')
        try:
            readable = name.encode('cp437').decode('utf8')
        except (UnicodeError, LookupError):
            readable = name
        card = {'id': field('id'), 'title': field('title'), 'type': 'action', 'status': 'reviewed',
                'sourceFile': readable.split('/10_Actions/', 1)[1],
                'sha256': hashlib.sha256(archive.read(name)).hexdigest(),
                'sources': [{'video': v, 'start': a, 'end': b} for v, a, b in sources]}
        old = previous.get(card['id'])
        if old and old['sha256'] == card['sha256'] and 'guidance' in old:
            card['guidance'] = old['guidance']
        cards.append(card)
if len(cards) != 30 or len({c['id'] for c in cards}) != len(cards):
    raise ValueError('Unexpected Action index; review source before updating')
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(sorted(cards, key=lambda c: c['id']), ensure_ascii=False, indent=2) + '\n')
print(f'{len(cards)} reviewed Action cards parsed; non-Action material excluded')
