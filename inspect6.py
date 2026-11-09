p=r'D:\Dropbox\mikrotik\project\coolify project\apps\ssl mikrotik\src\scripts.ts'
s=open(p,encoding='utf-8').read()
i=s.find('return cleanScript(')
start = s.find('`', i)
end = s.find('`', start+1)
raw = s[start+1:end]
lines = raw.split('\n')
print('first line:', repr(lines[0]))
# simulate cleanScript on first line
ln = lines[0]
st = ln.strip()
print('stripped:', repr(st))
print('startsWith #:', st.startswith('#'))
print('includes source={:', 'source={' in ln)
print('includes  #:', ' #' in ln)
ln2 = ln.split(' #',1)[0].rstrip() if ' #' in ln and 'source={' not in ln else ln
print('after split:', repr(ln2))
t = ln2.rstrip()
print('t:', repr(t))
print('endsWith {:', t.endswith('{'))
