import json
d=json.load(open(r'C:\Users\hp\AppData\Local\Temp\opencode\fs_latest.json'))
script=d['allInOne']
lines=script.splitlines()
out=[]
for ln in lines:
    s=ln.strip()
    if s.startswith('#'):
        continue
    if s=='':
        continue
    # strip trailing comments
    if ' #' in ln and 'source={' not in ln:
        ln = ln.split(' #',1)[0].rstrip()
        if ln.strip()=='':
            continue
    # remove trailing comment after source={
    if 'source={' in ln:
        ln = ln.split('source={',1)[0] + 'source={'
    out.append(ln)
# add semicolons
res=[]
for ln in out:
    s=ln.rstrip()
    if s.endswith('{') or s.endswith('}') or s.endswith(';') or s=='' :
        res.append(s)
    else:
        res.append(s+';')
clean='\n'.join(res)
open(r'C:\Users\hp\AppData\Local\Temp\opencode\clean.rsc','w',encoding='utf-8').write(clean)
print(clean)
