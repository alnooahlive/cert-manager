p=r'D:\Dropbox\mikrotik\project\coolify project\apps\ssl mikrotik\src\scripts.ts'
s=open(p,encoding='utf-8').read()
i=s.find('const raw = `')
j=s.find('`;', i)
raw=s[i+13:j]
print('template literal length:', len(raw))
print('backticks in raw:', raw.count(chr(96)))
dollar_brace = raw.count('${')
print('dollar-brace count:', dollar_brace)
print('first 80:', repr(raw[:80]))
print('last 50:', repr(raw[-50:]))
