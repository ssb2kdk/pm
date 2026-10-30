src=open('utility/index.src.html',encoding='utf-8').read()
calc=open('utility/calc.js',encoding='utf-8').read()
extra=open('utility/extra.js',encoding='utf-8').read()
bill=open('utility/bill.js',encoding='utf-8').read()+'\n'+open('utility/billui.js',encoding='utf-8').read()
assert '/*__CALC__*/' in src and '/*__EXTRA__*/' in src and '/*__BILL__*/' in src
out=src.replace('/*__CALC__*/', calc).replace('/*__EXTRA__*/', extra).replace('/*__BILL__*/', bill)
open('utility/index.html','w',encoding='utf-8').write(out)
print('built', len(out))
