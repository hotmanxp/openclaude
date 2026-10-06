import sys,json
p=sys.argv[1]
txt=open(p,encoding='utf-8',errors='replace').read()
out=[]
for line in txt.splitlines():
    try: o=json.loads(line)
    except Exception: continue
    m=o.get('message') or {}
    if o.get('type')=='assistant' and isinstance(m,dict):
        for c in (m.get('content') or []):
            if isinstance(c,dict) and c.get('type')=='text' and c.get('text'):
                out.append(c['text'])
r = out[-1] if out else "(no final text yet)"
print(r[:14000])
