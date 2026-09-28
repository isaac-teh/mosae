#!/usr/bin/env python3
"""Small, metered Lyria music generation spike. Keys are read from local env files, never logged."""
import base64, json, os, time
from pathlib import Path
import urllib.request, urllib.error

ROOT=Path(__file__).resolve().parents[2]
OUT=Path(__file__).parent/'out'
OUT.mkdir(exist_ok=True)
for envfile in (Path('/Users/isaacteh/Projects/Triiz/mosae/.env'),Path('/Users/isaacteh/Projects/Triiz/mosae/services/api/.env')):
    if envfile.exists():
        for line in envfile.read_text().splitlines():
            if line.strip() and not line.lstrip().startswith('#') and '=' in line:
                k,v=line.split('=',1); os.environ.setdefault(k.strip(),v.strip().strip('"\''))
key=os.environ.get('GEMINI_API_KEY')
if not key: raise SystemExit('GEMINI_API_KEY missing')

# published Lyria 3.5 pricing: $0.08 per full-song request. Hard cap enforced before every call.
PRICE=0.08; CAP=3.00
runs=[
 ('tender',80,'A tender, reflective instrumental score for a family travel memory film: gentle piano and warm strings, intimate, no vocals, no lyrics, approximately 30 seconds.'),
 ('reflective',110,'A reflective, wistful instrumental score for a family travel memory film: soft acoustic guitar, piano, spacious and warm, no vocals, no lyrics, approximately 30 seconds.'),
 ('playful',128,'A playful instrumental score for a family travel memory film: light plucked strings and hand percussion, curious and joyful, no vocals, no lyrics, approximately 30 seconds.'),
 ('energetic',110,'An energetic instrumental score for a family travel memory film: driving acoustic percussion and bright guitar, uplifting, no vocals, no lyrics, approximately 30 seconds.'),
 ('celebratory',80,'A celebratory instrumental score for a family travel memory film: joyful strings, piano and gentle drums, heartfelt finale, no vocals, no lyrics, approximately 30 seconds.'),
 ('tempo_80',80,'Instrumental family travel memory film score, steady 80 BPM, acoustic piano and warm strings, no vocals, no lyrics.'),
 ('tempo_110',110,'Instrumental family travel memory film score, steady 110 BPM, acoustic guitar and light percussion, no vocals, no lyrics.'),
 ('tempo_128',128,'Instrumental family travel memory film score, steady 128 BPM, upbeat piano and acoustic percussion, no vocals, no lyrics.'),
 ('two_minute',None,'A continuous approximately two-minute instrumental score for a tender family travel memory film, gentle piano and warm acoustic strings, no vocals, no lyrics. Keep a consistent musical key, tempo and instrumentation from beginning to end; avoid abrupt ending or a new song section at 30 seconds.'),
]
ledger=[]
for name,bpm,prompt in runs:
    if (len(ledger)+1)*PRICE>CAP: raise SystemExit('CAP reached')
    started=time.monotonic()
    try:
        req=urllib.request.Request('https://generativelanguage.googleapis.com/v1beta/interactions',data=json.dumps({'model':'lyria-3.5','input':prompt}).encode(),headers={'Content-Type':'application/json','x-goog-api-key':key},method='POST')
        with urllib.request.urlopen(req,timeout=300) as response: result=json.load(response)
        elapsed=time.monotonic()-started
        blocks=[c for step in result.get('steps',[]) for c in step.get('content',[])]
        audio=next((c for c in blocks if c.get('type')=='audio'),None)
        if not audio: raise RuntimeError('response had no audio block')
        raw=base64.b64decode(audio['data'])
        (OUT/f'{name}.mp3').write_bytes(raw)
        lyrics='\n'.join(c.get('text','') for c in blocks if c.get('type')=='text') or None
        row={'name':name,'requested_bpm':bpm,'seconds':elapsed,'estimated_cost_usd':PRICE,'bytes':len(raw),'output_text':lyrics}
        ledger.append(row)
        print(json.dumps(row))
    except Exception as e:
        print(json.dumps({'name':name,'error':str(e),'seconds':time.monotonic()-started}))
        break
(OUT/'ledger.json').write_text(json.dumps(ledger,indent=2))
