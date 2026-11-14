import re
p=r'D:\Dropbox\mikrotik\project\coolify project\apps\ssl mikrotik\src\scripts.ts'
s=open(p,encoding='utf-8').read()
i=s.find('export function updateScript')
j=s.find('export function bootstrapScript')
block=s[i:j]
print('backticks in updateScript:', block.count('`'))
print('interpolations:', len(re.findall(r'\$\{', block)))
# check for any stray backticks inside
for idx,line in enumerate(block.splitlines()):
    if '`' in line and 'cleanScript' not in line and 'return' not in line:
        print('line with backtick:', idx+1, repr(line[:80]))
