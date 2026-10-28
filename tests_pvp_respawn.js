/* PvP opponent-respawn tests (logic level: real mpHandle / mpApplyRemoteState code, stubbed THREE, NO socket, NO server). */
const {chromium}=require('playwright');const fs=require('fs');
const [CH,FILE]=process.argv.slice(2);const STUB=fs.readFileSync(__dirname+'/stub_three.js','utf8');const res=[];
const rec=(n,ok,i)=>{res.push(ok);console.log((ok?'PASS ':'FAIL ')+n+(ok?'':'  -> '+JSON.stringify(i)))};
(async()=>{const b=await chromium.launch({executablePath:CH,args:['--no-sandbox']});
async function T(n,body){let c;try{c=await b.newContext();const p=await c.newPage();p.errs=[];p.on('pageerror',e=>p.errs.push(e.message));
 await p.route('**/*',r=>{const u=r.request().url();if(u.includes('three.min.js'))return r.fulfill({contentType:'application/javascript',body:STUB});if(u.startsWith('file:'))return r.continue();return r.abort()});
 await p.goto('file://'+FILE+'#f7qa');await p.waitForFunction(()=>typeof mpHandle==='function'&&typeof PF!=='undefined');
 const r=await p.evaluate(`(()=>{mpSend=()=>{};mp.id='me';mp.host=false;mp.room='R';mp.playersList=[{id:'me'},{id:'op'}];mpBeginMatch(0,'pvp');
  const state=(o)=>mpApplyRemoteState(Object.assign({t:'state',id:'op',x:5,y:0,z:5,yaw:0,hp:100},o||{}));state();const rp=()=>MPP.get('op');
  const out={};${body};return out})()`);
 const ok=r.ok===true;rec(n,ok&&p.errs.length===0,Object.assign({},r,{errs:p.errs.slice(0,2)}))}catch(e){rec(n,false,e.message.split('\n')[0])}finally{if(c)await c.close()}}
await T('opponent dies -> hidden and one death counted',`mpHandle({t:'death',id:'op'});out.ok=!rp().g.visible&&mp.pv.d.op===1`);
await T('respawn message WITH coordinates re-shows opponent at that spot, death flag cleared',`mpHandle({t:'death',id:'op'});mpHandle({t:'respawn',id:'op',x:9,y:0,z:-3});out.ok=rp().g.visible===true&&rp().hp===100&&mp.pv.down.op===0&&rp().tx===9`);
await T('respawn message WITHOUT coordinates still re-shows opponent (was the failure)',`mpHandle({t:'death',id:'op'});mpHandle({t:'respawn',id:'op'});out.ok=rp().g.visible===true&&rp().hp===100&&mp.pv.down.op===0`);
await T('respawn message lost entirely: state hp>0 after 2.5 s re-shows opponent and re-arms death counting',`mpHandle({t:'death',id:'op'});rp().deadAt=performance.now()-3000;state({hp:100,x:7,z:7});out.ok=rp().g.visible===true&&mp.pv.down.op===0`);
await T('late pre-death state packet (<2.5 s after death) does NOT resurrect',`mpHandle({t:'death',id:'op'});state({hp:100});out.ok=rp().g.visible===false&&mp.pv.down.op===1`);
await T('dead opponent whose state still reports hp<=0 stays hidden even after 10 s',`mpHandle({t:'death',id:'op'});rp().deadAt=performance.now()-10000;state({hp:0});out.ok=rp().g.visible===false`);
await T('second death after a fallback respawn is counted exactly once (no inflation)',`mpHandle({t:'death',id:'op'});rp().deadAt=performance.now()-3000;state({hp:100});mpHandle({t:'death',id:'op'});mpHandle({t:'death',id:'op'});out.ok=mp.pv.d.op===2`);
await T('no resurrection after the match is over',`mpHandle({t:'death',id:'op'});rp().deadAt=performance.now()-3000;mp.pv.over=1;state({hp:100});out.ok=rp().g.visible===false`);
await T('opponent that was never dead is unaffected by state updates (no spurious resets)',`state({hp:100});mp.pv.down.op=1;state({hp:100});out.ok=mp.pv.down.op===1&&!!rp().g.visible`);
await T('health message (alive:false) hides; later respawn shows',`mpHandle({t:'health',id:'op',hp:0,alive:false});const h=rp().g.visible===false;mpHandle({t:'respawn',id:'op',x:1,y:0,z:1});out.ok=h&&rp().g.visible===true`);
await b.close();console.log(`TOTAL ${res.length} PASS ${res.filter(Boolean).length} FAIL ${res.filter(x=>!x).length}`)})();
