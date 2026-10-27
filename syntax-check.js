const fs=require('fs'),vm=require('vm');
for(const f of process.argv.slice(2)){
  const html=fs.readFileSync(f,'utf8');
  const re=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;let m,n=0,bad=0,chars=0;
  while((m=re.exec(html))){n++;chars+=m[1].length;try{new vm.Script(m[1],{filename:'inline-script-'+n})}catch(e){bad++;console.log('  SYNTAX ERROR in inline script #'+n+':',e.message)}}
  console.log((bad?'FAIL':'OK  ')+' '+f.split('/').pop()+': '+n+' inline script block(s), '+chars+' chars, '+bad+' syntax error(s)');
}
