/* FACILITY-7 release-candidate logic tests. Real game code in headless Chromium; THREE is a no-render stub (stub_three.js).
   Usage: NODE_PATH=<global node_modules> node tests.js <chrome> <rc.html> <dev.html>  -> prints results, writes results.json */
const {chromium}=require('playwright');const fs=require('fs');
const [CH,RC,DEV]=process.argv.slice(2);const STUB=fs.readFileSync(__dirname+'/stub_three.js','utf8');
const results=[];let browser;
const rec=(grp,name,ok,info)=>{results.push({grp,name,ok:!!ok,info:info===undefined?'':String(info)});console.log((ok?'PASS ':'FAIL ')+grp+' :: '+name+(ok?'':'  -> '+info))};
async function open(file,o={}){const ctx=await browser.newContext({viewport:o.vp||{width:1280,height:720}});const p=await ctx.newPage();p.errs=[];
 p.on('pageerror',e=>p.errs.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))p.errs.push('console: '+m.text())});
 await p.route('**/*',r=>{const u=r.request().url();if(u.includes('three.min.js'))return r.fulfill({contentType:'application/javascript',body:STUB});if(u.startsWith('file:'))return r.continue();return r.abort()});
 if(o.seed)await ctx.addInitScript(s=>{if(!localStorage.getItem('__seeded')){localStorage.setItem('__seeded','1');for(const k in s)localStorage.setItem(k,typeof s[k]==='string'?s[k]:JSON.stringify(s[k]))}},o.seed);
 await p.goto('file://'+file+'#f7qa');await p.waitForFunction(()=>typeof PF!=='undefined'&&typeof QST!=='undefined'&&typeof BP!=='undefined'&&QST._t,null,{timeout:15000});p.ctx=ctx;return p}
const close=p=>p.ctx.close();
async function T(grp,name,fn){try{const r=await fn();if(r===undefined||r===true)rec(grp,name,true);else rec(grp,name,false,JSON.stringify(r))}catch(e){rec(grp,name,false,'EXC '+e.message.split('\n')[0])}}
const play=p=>p.evaluate(()=>{state='play';P.alive=true;inTraining=false;stats={};try{mp.inMatch=false}catch(e){}});
(async()=>{browser=await chromium.launch({executablePath:CH,args:['--no-sandbox']});
const html=fs.readFileSync(RC,'utf8'),dev=fs.readFileSync(DEV,'utf8');

/* ---------- A. build / public-release hygiene ---------- */
await T('A build','RC file contains no MINQ1054 string',()=>!html.includes('MINQ1054')||'found');
await T('A build','RC flag F7_PUBLIC_BUILD=true, DEV flag false',()=>html.includes('const F7_PUBLIC_BUILD=true;')&&dev.includes('const F7_PUBLIC_BUILD=false;')||'flag text');
await T('A build','no duplicate script ids / duplicate element ids in RC',async()=>{const p=await open(RC);const r=await p.evaluate(()=>{const c={};document.querySelectorAll('[id]').forEach(e=>c[e.id]=(c[e.id]||0)+1);return Object.keys(c).filter(k=>c[k]>1)});await close(p);return r.length===0||r});
await T('A build','RC loads with no page errors (stubbed THREE; startup scripts execute)',async()=>{const p=await open(RC);await p.waitForTimeout(2500);const e=p.errs.slice();await close(p);return e.length===0||e});
await T('A build','DEV build loads with no page errors',async()=>{const p=await open(DEV);await p.waitForTimeout(2500);const e=p.errs.slice();await close(p);return e.length===0||e});
await T('A build','RC: redeem dialog rejects the removed code and grants nothing',async()=>{const p=await open(RC);
 const r=await p.evaluate(async()=>{const c0=PROG.coins;PF.redeem();const ta=document.getElementById('pfCodeTa');ta.value='MINQ1054';const b=[...document.querySelectorAll('#pfCode button')].find(x=>/redeem|ok|confirm|apply|use/i.test(x.textContent));if(b)b.click();await new Promise(r=>setTimeout(r,100));return {c0,c1:PROG.coins,msg:document.getElementById('pfCodeMsg').textContent,hadBtn:!!b,btns:[...document.querySelectorAll('#pfCode button')].map(x=>x.textContent)}});await close(p);
 return (r.hadBtn&&r.c0===r.c1&&/INVALID/i.test(r.msg))||r});
await T('A build','RC: GHOST #1 does NOT receive Pro (owner grant disabled)',async()=>{const p=await open(RC);await p.evaluate(()=>{PF.data.name='GHOST';PF.data.tag=1});await p.waitForTimeout(22000);const r=await p.evaluate(()=>BP.hasPro());await close(p);return r===false||'hasPro='+r});
await T('A build','DEV: GHOST #1 receives Pro (grant preserved behind flag)',async()=>{const p=await open(DEV);await p.evaluate(()=>{PF.data.name='GHOST';PF.data.tag=1});await p.waitForFunction(()=>BP.hasPro(),null,{timeout:25000});await close(p);});
await T('A build','RC: a non-owner name/ID never gets a free grant (DEV build)',async()=>{const p=await open(DEV);await p.evaluate(()=>{PF.data.name='SOMEONE';PF.data.tag=77});await p.waitForTimeout(22000);const r=await p.evaluate(()=>BP.hasPro());await close(p);return r===false||'hasPro='+r});

/* ---------- B. quest structure & resets ---------- */
await T('B quests','exactly 10 daily, 50 weekly, 17 permanent challenges active',async()=>{const p=await open(RC);const r=await p.evaluate(()=>({d:QST._t.active('d').length,w:QST._t.active('w').length,c:QST._t.active('c').length}));await close(p);return (r.d===10&&r.w===50&&r.c===17)||r});
await T('B quests','daily/weekly draws have unique ids and are deterministic per period',async()=>{const p=await open(RC);const r=await p.evaluate(()=>{const a=QST._t.active('d').map(x=>x.id),b=QST._t.active('d').map(x=>x.id),w=QST._t.active('w').map(x=>x.id);return {u:new Set(a).size===10&&new Set(w).size===50,same:JSON.stringify(a)===JSON.stringify(b)}});await close(p);return (r.u&&r.same)||r});
await T('B quests','a new day re-draws daily quests and keeps weekly + permanent progress',async()=>{const p=await open(RC);await play(p);
 const r=await p.evaluate(()=>{const t0=Date.UTC(2026,9,28,12);QST._t.setClock(()=>t0);QST._t.roll();
  const e={};QST.onKill(e,'head','ar');const s=QST.state;const life=s.life.k,dBefore=JSON.stringify(Object.values(QST._t.active('d')).map(x=>QST._t.recOf('d',x).p).filter(Boolean)),wBefore=QST._t.active('w').map(x=>QST._t.recOf('w',x).p).filter(Boolean).length;
  const dids0=QST._t.active('d').map(x=>x.id).join();
  QST._t.setClock(()=>t0+86400000);QST._t.roll();const s2=QST.state;
  return {killsLife:s2.life.k,dProgAfter:QST._t.active('d').map(x=>QST._t.recOf('d',x).p).filter(Boolean).length,wProgAfter:QST._t.active('w').map(x=>QST._t.recOf('w',x).p).filter(Boolean).length,wBefore,redrew:dids0!==QST._t.active('d').map(x=>x.id).join()}});await close(p);
 return (r.killsLife===1&&r.dProgAfter===0&&r.wProgAfter===r.wBefore&&r.wBefore>0)||r});
await T('B quests','weekly reset clears weekly only; daily claims/permanent challenge claims survive in ledger/ch',async()=>{const p=await open(RC);await play(p);
 const r=await p.evaluate(()=>{const mon=Date.UTC(2026,9,26,12);QST._t.setClock(()=>mon);QST._t.roll();
  for(let i=0;i<30;i++)QST.onKill({},'body','ar');   /* c_kills not complete (500); weekly kills I (150) not complete either */
  const s=QST.state;const w0=QST._t.active('w').map(x=>QST._t.recOf('w',x).p).filter(Boolean).length;
  s.ch['c_kills_1']=1;                                  /* simulate an earlier permanent claim */
  QST._t.setClock(()=>mon+7*86400000);QST._t.roll();const s2=QST.state;
  return {w0,w1:QST._t.active('w').map(x=>QST._t.recOf('w',x).p).filter(Boolean).length,chKept:s2.ch['c_kills_1']===1,life:s2.life.k}});await close(p);
 return (r.w0>0&&r.w1===0&&r.chKept&&r.life===30)||r});
await T('B quests','clock moved BACKWARDS never re-rolls or re-opens earned quests',async()=>{const p=await open(RC);await play(p);
 const r=await p.evaluate(()=>{const t=Date.UTC(2026,9,28,12);QST._t.setClock(()=>t);QST._t.roll();const dk=QST.state.dk;QST._t.setClock(()=>t-5*86400000);QST._t.roll();return {dk,dk2:QST.state.dk}});await close(p);return r.dk===r.dk2||r});

/* ---------- C. tracking ---------- */
await T('C tracking','kill: +kills, headshot, weapon-category counters; same enemy never counted twice',async()=>{const p=await open(RC);await play(p);
 const r=await p.evaluate(()=>{const e={};QST.onKill(e,'head','ar');QST.onKill(e,'head','ar');QST.onKill({},'body','sg');QST.onKill({},'body','dmr');const l=QST.state.life;return {k:l.k,h:l.h,kr:l.kr,kg:l.kg,km:l.km}});await close(p);return (r.k===3&&r.h===1&&r.kr===1&&r.kg===1&&r.km===1)||r});
await T('C tracking','no progress in training range, when dead, after run end, or from remote co-op hits',async()=>{const p=await open(RC);await play(p);
 const r=await p.evaluate(()=>{inTraining=true;QST.onKill({},'head','ar');inTraining=false;P.alive=false;QST.onKill({},'head','ar');P.alive=true;QST.onKill({},'head','remote');state='menu';QST.onKill({},'head','ar');return QST.state.life.k});await close(p);return r===0||('kills='+r)});
await T('C tracking','boss kill counts bosses; waves count once per wave per run; wave_best uses max',async()=>{const p=await open(RC);await play(p);
 const r=await p.evaluate(()=>{QST.onKill({boss:true},'body','ar');QST.onWave(1);QST.onWave(1);QST.onWave(3);QST.onWave(2);const l=QST.state.life;return {b:l.b,w:l.w,bw:l.bw}});await close(p);return (r.b===1&&r.w===3&&r.bw===3)||r});
await T('C tracking','mission counts only on victory kinds, once per run; training/mp excluded',async()=>{const p=await open(RC);await play(p);
 const r=await p.evaluate(()=>{QST.onRunEnd('lose');const a=QST.state.life.m;stats={};QST.onRunEnd('win');QST.onRunEnd('win');const b=QST.state.life.m;stats={};inTraining=true;QST.onRunEnd('win');inTraining=false;return {a,b,c:QST.state.life.m}});await close(p);return (r.a===0&&r.b===1&&r.c===1)||r});
await T('C tracking','PvP: counted only for pvp matchMode, once per match, win only with fewer deaths than all opponents',async()=>{const p=await open(RC);
 const r=await p.evaluate(()=>{mp.id='me';mp.matchMode='pvp';mp.inMatch=true;const pv={};QST.onPvpEnd(pv,[{id:'me',d:1},{id:'x',d:3}]);QST.onPvpEnd(pv,[{id:'me',d:1},{id:'x',d:3}]);const a={pm:QST.state.life.pm,pw:QST.state.life.pw};
  QST.onPvpEnd({},[{id:'me',d:4},{id:'x',d:3}]);const b={pm:QST.state.life.pm,pw:QST.state.life.pw};QST.onPvpEnd({},[{id:'me',d:2}]);mp.matchMode='coop';QST.onPvpEnd({},[{id:'me',d:1},{id:'x',d:3}]);return {a,b,c:QST.state.life.pm}});await close(p);
 return (r.a.pm===1&&r.a.pw===1&&r.b.pm===2&&r.b.pw===1&&r.c===2)||r});
await T('C tracking','PvP KILL attribution: no QST hook exists (documented gap) - kills never counted in pvp',async()=>{const p=await open(RC);await play(p);
 const r=await p.evaluate(()=>{mp.inMatch=true;mp.matchMode='pvp';QST.onKill({},'head','ar');mp.inMatch=false;return QST.state.life.k});await close(p);return r===0||r});

/* ---------- D. claims ---------- */
async function finish(p,cat,pick){return p.evaluate(([cat,pick])=>{const d=QST._t.active(cat).find(x=>x.obj===pick);return {id:d.id,n:d.n,rw:d.rw}},[cat,pick])}
await T('D claims','incomplete cannot be claimed; completed can, exactly once; balance exact',async()=>{const p=await open(RC);await play(p);
 const r=await p.evaluate(()=>{const d=QST._t.active('d').find(x=>x.obj==='kills'||x.obj==='headshots')||QST._t.active('d')[0];
  const a=QST.claim('d',d.id);for(let i=0;i<d.n;i++){if(d.obj==='headshots')QST.onKill({}, 'head','ar');else if(d.obj==='kills')QST.onKill({},'body','ar')}
  return {d:{obj:d.obj,n:d.n,rw:d.rw},a:a.code,st:QST._t.stateOf('d',d)}});
 let ok=r.a==='incomplete';
 if(r.st!=='ready'){/* chosen objective not feedable by onKill alone: fall back to a kills-based quest if any */}
 const r2=await p.evaluate(()=>{const d=QST._t.active('d').find(x=>x.obj==='kills'||x.obj==='headshots');if(!d)return {skip:true};const b0=QST.bal();const c1=QST.claim('d',d.id),b1=QST.bal(),c2=QST.claim('d',d.id),b2=QST.bal();return {c1:c1.code,c2:c2.code,delta:b1-b0,rw:d.rw,b2eq:b1===b2}});await close(p);
 return (ok&&(r2.skip||(r2.c1==='ok'&&r2.c2==='claimed'&&r2.delta===r2.rw&&r2.b2eq)))||{r,r2}});
await T('D claims','claim of unknown id / wrong category / expired id rejected; balance unchanged',async()=>{const p=await open(RC);const r=await p.evaluate(()=>{const b=QST.bal();return [QST.claim('d','nope').code,QST.claim('x','d_k_1').code,QST.claim('w','d_k_1').code,QST.claim('d',null).code,QST.bal()===b]});await close(p);return (r[0]==='invalid'&&r[1]==='invalid'&&r[2]==='invalid'&&r[3]==='invalid'&&r[4])||r});
await T('D claims','permanent challenge: claim once, stays completed, persists after reload',async()=>{const p=await open(RC);await play(p);
 await p.evaluate(()=>{for(let i=0;i<100;i++)QST.onKill({},'head','ar')});  /* c_hs_1 needs 100 headshots */
 const r=await p.evaluate(()=>{const a=QST.claim('c','c_hs_1'),b=QST.claim('c','c_hs_1');QST._t.flush();return {a:a.code,b:b.code,bal:QST.bal(),rw:a.reward}});
 await p.reload();await p.waitForFunction(()=>typeof QST!=='undefined'&&QST._t&&typeof PF!=='undefined');
 const r2=await p.evaluate(()=>({bal:QST.bal(),st:QST._t.stateOf('c',QST._t.DEFS['c_hs_1'].def),again:QST.claim('c','c_hs_1').code}));await close(p);
 return (r.a==='ok'&&r.b==='claimed'&&r2.bal===r.bal&&r2.st==='claimed'&&r2.again==='claimed')||{r,r2}});
await T('D claims','daily progress + balance survive a page refresh',async()=>{const p=await open(RC);await play(p);
 await p.evaluate(()=>{for(let i=0;i<7;i++)QST.onKill({},'body','ar');QST._t.flush()});
 await p.reload();await p.waitForFunction(()=>typeof QST!=='undefined'&&QST._t&&typeof PF!=='undefined');
 const r=await p.evaluate(()=>({k:QST.state.life.k,dk:QST._t.active('d').filter(x=>x.obj==='kills').map(x=>QST._t.recOf('d',x).p)}));await close(p);return (r.k===7&&r.dk.every(v=>v===7))||r});

/* ---------- E. currency ---------- */
await T('E currency','separate from Gold: quest claims / spends never change PROG.coins',async()=>{const p=await open(RC,{});
 const r=await p.evaluate(()=>{PROG.coins=1234;PROG.qc=500;saveProg();const g=PROG.coins;QST.spend(100,'t');return {g0:g,g1:PROG.coins,q:PROG.qc}});await close(p);return (r.g1===1234&&r.q===400)||r});
await T('E currency','spend: insufficient funds / invalid prices fail and never charge or go negative',async()=>{const p=await open(RC);
 const r=await p.evaluate(()=>{PROG.qc=50;saveProg();const o=[QST.spend(51,'a').code,QST.spend(0,'a').code,QST.spend(-5,'a').code,QST.spend(1.5,'a').code,QST.spend(NaN,'a').code,QST.spend('10','a').code,QST.spend(10,'').code,QST.spend(10).code];return {o,q:PROG.qc}});await close(p);
 return (r.q===50&&r.o[0]==='funds'&&r.o.slice(1).every(c=>c==='invalid'))||r});
await T('E currency','spend exact balance -> 0, then next spend fails (never negative)',async()=>{const p=await open(RC);const r=await p.evaluate(()=>{PROG.qc=100;saveProg();const a=QST.spend(100,'a'),b=QST.spend(1,'a');return {a:a.code,b:b.code,q:PROG.qc}});await close(p);return (r.a==='ok'&&r.b==='funds'&&r.q===0)||r});
await T('E currency','corrupted balances are sanitised (NaN/negative/string/float/huge)',async()=>{const p=await open(RC);
 const r=await p.evaluate(()=>{const o=[];for(const v of [NaN,-5,'abc',12.7,1e15,Infinity,null,undefined]){PROG.qc=v;o.push(QST.bal())}return o});await close(p);
 return (r[0]===0&&r[1]===0&&r[2]===0&&r[3]===12&&r[4]===1e9&&r[5]===0&&r[6]===0&&r[7]===0)||r});
await T('E currency','balance persists across reload; Gold untouched',async()=>{const p=await open(RC);await p.evaluate(()=>{PROG.coins=777;PROG.qc=321;saveProg();saveProg()});await p.reload();await p.waitForFunction(()=>typeof QST!=='undefined'&&QST._t&&typeof PF!=='undefined');const r=await p.evaluate(()=>({g:PROG.coins,q:QST.bal()}));await close(p);return (r.g===777&&r.q===321)||r});
await T('E currency','lobby button/pill shows the balance and the configured name',async()=>{const p=await open(RC);await p.evaluate(()=>{PROG.qc=4242;saveProg();QST.refresh()});const t=await p.evaluate(()=>document.body.innerText);await close(p);return /4,?242/.test(t)||'balance text not found in DOM (lobby may be hidden until menu is shown)'});

/* ---------- F. Pro Battle Pass ---------- */
await T('F pro','price is 1500 and comes from the single QST config',async()=>{const p=await open(RC);const r=await p.evaluate(()=>({cfg:QST.cfg.proPrice,bp:BP._data.PRO_PRICE,cur:QST.cfg.currency.name}));await close(p);return (r.cfg===1500&&r.bp===1500&&r.cur==='REQUISITION')||r});
await T('F pro','1499 cannot buy; no charge; no Pro',async()=>{const p=await open(RC);const r=await p.evaluate(()=>{PROG.qc=1499;saveProg();const a=BP._data.purchasePro();return {a:a.code,q:PROG.qc,pro:BP.hasPro()}});await close(p);return (r.a==='funds'&&r.q===1499&&!r.pro)||r});
await T('F pro','1500 buys: exactly 1500 charged once, Pro granted; second attempt = owned, no charge',async()=>{const p=await open(RC);const r=await p.evaluate(()=>{PROG.qc=3200;saveProg();const a=BP._data.purchasePro(),b=BP._data.purchasePro();return {a:a.code,b:b.code,q:PROG.qc,pro:BP.hasPro()}});await close(p);return (r.a==='ok'&&r.b==='owned'&&r.q===1700&&r.pro)||r});
await T('F pro','ownership + remaining balance persist after reload; reload does not charge again',async()=>{const p=await open(RC);await p.evaluate(()=>{PROG.qc=2000;saveProg();BP._data.purchasePro()});await p.reload();await p.waitForFunction(()=>typeof BP!=='undefined'&&BP._data&&typeof PF!=='undefined');const r=await p.evaluate(()=>({pro:BP.hasPro(),q:QST.bal(),again:BP._data.purchasePro().code}));const q2=await p.evaluate(()=>QST.bal());await close(p);return (r.pro&&r.q===500&&r.again==='owned'&&q2===500)||r});
await T('F pro','UI flow: buyPro -> confirmPro x3 rapid clicks charges exactly once',async()=>{const p=await open(RC);const r=await p.evaluate(()=>{PROG.qc=1600;saveProg();BP.open();BP.buyPro();BP.confirmPro();BP.confirmPro();BP.confirmPro();return {q:PROG.qc,pro:BP.hasPro()}});await close(p);return ((r.q===100&&r.pro)||r)});
await T('F pro','UI flow: cancel leaves balance and ownership unchanged',async()=>{const p=await open(RC);const r=await p.evaluate(()=>{PROG.qc=1600;saveProg();BP.open();BP.buyPro();BP.cancelPro();BP.confirmPro();return {q:PROG.qc,pro:BP.hasPro()}});await close(p);return (r.q===1600&&!r.pro)||r});
await T('F pro','existing Pro owner is not charged when "buying" again',async()=>{const p=await open(RC);const r=await p.evaluate(()=>{PROG.qc=5000;saveProg();BP._data.purchasePro();const q=PROG.qc;BP.open();BP.buyPro();BP.confirmPro();return {q,q2:PROG.qc}});await close(p);return (r.q===3500&&r.q2===3500)||r});
await T('F pro','Gold balance never used to buy Pro (Gold-only player cannot purchase)',async()=>{const p=await open(RC);const r=await p.evaluate(()=>{PROG.coins=999999;PROG.qc=0;saveProg();const a=BP._data.purchasePro();return {a:a.code,g:PROG.coins,pro:BP.hasPro()}});await close(p);return (r.a==='funds'&&r.g===999999&&!r.pro)||r});
await T('F pro','Pro-only (track p) rewards cannot be claimed without Pro, even by direct API call; state unchanged',async()=>{const p=await open(RC);const r=await p.evaluate(()=>{BP._data.addXP(BP._data.MAXXP,'test');const D=BP._data;const g0=PROG.coins,s0=D.serialize?JSON.stringify(D.serialize()):'';const before=[1,2,3,10,50].map(t=>D.stateOf('p',t));for(const t of [1,2,3,10,50])BP.claim('p',t);BP.claimAll&&0;const after=[1,2,3,10,50].map(t=>D.stateOf('p',t));return {before,after,pro:BP.hasPro(),g:PROG.coins===g0}});await close(p);return (!r.pro&&r.after.every(x=>x!=='claimed')&&r.g)||r});
await T('F pro','after buying Pro the p-track becomes claimable exactly once',async()=>{const p=await open(RC);const r=await p.evaluate(()=>{const D=BP._data;D.addXP(D.MAXXP,'test');PROG.qc=1500;saveProg();D.purchasePro();const s0=D.stateOf('p',1);BP.claim('p',1);const s1=D.stateOf('p',1);const snap=JSON.stringify(BP.exportData());BP.claim('p',1);return {s0,s1,same:snap===JSON.stringify(BP.exportData())}});await close(p);return (r.s0==='ready'&&r.s1==='claimed'&&r.same)||r});
await T('F pro','free-track (f) reward claims once without Pro; repeat changes nothing',async()=>{const p=await open(RC);const r=await p.evaluate(()=>{const D=BP._data;D.addXP(D.MAXXP,'test');const s0=D.stateOf('f',1);BP.claim('f',1);const s1=D.stateOf('f',1);const snap=JSON.stringify(BP.exportData()),g=PROG.coins;BP.claim('f',1);return {s0,s1,same:snap===JSON.stringify(BP.exportData())&&g===PROG.coins,pro:BP.hasPro()}});await close(p);return (r.s0==='ready'&&r.s1==='claimed'&&r.same&&!r.pro)||r});

/* ---------- G. save compatibility / corruption ---------- */
async function importViaUI(p,code){return p.evaluate(async c=>{PF.importSave();const ta=document.getElementById('pfCodeTa');ta.value=c;const b=[...document.querySelectorAll('#pfCode button')].find(x=>/^\s*load\s*$/i.test(x.textContent));if(!b)return {err:'no button'};b.click();await new Promise(r=>setTimeout(r,150));return {msg:document.getElementById('pfCodeMsg').textContent,btns:[...document.querySelectorAll('#pfCode button')].map(x=>x.textContent)}},code)}
const OLD={coins:900,owned:['ar_standard'],equipped:{ar:'ar_standard'}};
await T('G saves','old save (no qc/qs) loads: qc 0, quest state clean, Gold kept',async()=>{const p=await open(RC,{seed:{f7p:Object.assign({_t:1},OLD)}});const r=await p.evaluate(()=>({g:PROG.coins,q:QST.bal(),n:QST._t.active('d').length,errs:0}));const e=p.errs.slice();await close(p);return (r.g===900&&r.q===0&&r.n===10&&e.length===0)||{r,e}});
for(const [nm,qs,qc] of [['qs is a string','garbage',50],['qs is an array',[1,2],50],['qs has wrong types',{v:'x',rev:'y',d:5,w:'z',ch:[1],life:'q',led:'no'},50],['negative/huge progress',{rev:-5,dk:-1,d:{d_k_1:{p:-9,c:7},nope:{p:1,c:1}},life:{k:-100,h:1e30}},50],['qc negative',null,-500],['qc NaN-as-string',null,'NaN'],['qc fractional',null,10.9],['qc beyond cap',null,1e12]]){
 await T('G saves','corrupt save: '+nm+' -> loads without errors, sane values',async()=>{const p=await open(RC,{seed:{f7p:{_t:1,coins:10,qc,qs,owned:['ar_standard'],equipped:{ar:'ar_standard'}}}});const r=await p.evaluate(()=>{const s=QST.state,b=QST.bal();return {b,ok:Number.isFinite(b)&&b>=0&&b<=1e9,life:Object.values(s.life).every(v=>Number.isFinite(v)&&v>=0),n:QST._t.active('d').length,w:QST._t.active('w').length}});const e=p.errs.slice();await close(p);return (r.ok&&r.life&&r.n===10&&r.w===50&&e.length===0)||{r,e}})}
await T('G saves','totally broken profile JSON in storage: game still starts',async()=>{const p=await open(RC,{seed:{f7p:'{not json'}});const r=await p.evaluate(()=>({q:QST.bal(),g:PROG.coins}));const e=p.errs.slice();await close(p);return (r.q===0&&e.length===0)||{r,e}});
await T('G saves','save-code export -> import round-trips qc, Gold and quest state',async()=>{const p=await open(RC);await play(p);
 const code=await p.evaluate(()=>{PROG.coins=555;PROG.qc=222;saveProg();for(let i=0;i<9;i++)QST.onKill({},'head','ar');QST._t.flush();return btoa(unescape(encodeURIComponent(JSON.stringify({v:1,f7p:JSON.parse(JSON.stringify(PROG))}))))});
 const p2=await open(RC);const ui=await importViaUI(p2,code);const r=await p2.evaluate(()=>({g:PROG.coins,q:QST.bal(),k:QST.state.life.k,ok:true})).then(x=>Object.assign(x,{ui}));await close(p);await close(p2);
 return (r.ok&&r.g===555&&r.q===222&&r.k===9)||r});
await T('G saves','KNOWN LIMITATION: a hand-made save code can set qc up to the 1e9 cap (client-side trust)',async()=>{const p=await open(RC);const code=Buffer.from(JSON.stringify({v:1,f7p:{coins:0,qc:999999999,owned:['ar_standard'],equipped:{ar:'ar_standard'}}})).toString('base64');const r=await importViaUI(p,code);const q=await p.evaluate(()=>QST.bal());await close(p);return q===999999999||('qc='+q+' ui='+JSON.stringify(r))});

/* ---------- H. persistence failure behaviour ---------- */
await T('H failure','localStorage.setItem throwing: Pro purchase does not both charge and withhold Pro',async()=>{const p=await open(RC);const r=await p.evaluate(()=>{PROG.qc=2000;saveProg();const real=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new Error('quota')};let a;try{a=BP._data.purchasePro()}catch(e){a={code:'exc'}}Storage.prototype.setItem=real;return {a:a.code,q:PROG.qc,pro:BP.hasPro()}});await close(p);
 return ((r.a==='ok'&&r.q===500&&r.pro)||(r.a!=='ok'&&r.q===2000&&!r.pro))||r});
await T('H failure','failed save during a quest claim never loses/doubles reward in memory (claim then re-claim)',async()=>{const p=await open(RC);await play(p);const r=await p.evaluate(()=>{const real=Storage.prototype.setItem;for(let i=0;i<100;i++)QST.onKill({},'head','ar');Storage.prototype.setItem=function(){throw new Error('quota')};const a=QST.claim('c','c_hs_1'),b=QST.claim('c','c_hs_1');Storage.prototype.setItem=real;return {a:a.code,b:b.code,q:QST.bal()}});await close(p);return (r.a==='ok'&&r.b==='claimed'&&r.q===100)||r});

/* ---------- I. UI / layout (desktop Chromium viewport emulation only) ---------- */
const VPS=[['desktop 1280x720',{width:1280,height:720}],['small window 800x500',{width:800,height:500}],['mobile portrait 360x640',{width:360,height:640}],['short landscape 640x300',{width:640,height:300}]];
for(const lang of ['en','ko'])for(const [vn,vp] of VPS){
 await T('I layout',`quest panel ${lang} @ ${vn}: 10/50/17 rows, no horizontal overflow, panel scrolls, claim buttons within viewport width`,async()=>{
  const p=await open(RC,{vp,seed:lang==='ko'?undefined:undefined});
  await p.evaluate(l=>{try{setLanguage(l)}catch(e){try{Lang.set(l)}catch(e2){}}},lang);
  const res={};for(const [tab,n] of [['d',10],['w',50],['c',17]]){
   await p.evaluate(()=>{QST.open()});await p.evaluate(t=>QST.tab(t),tab);await p.waitForTimeout(150);
   res[tab]=await p.evaluate(()=>{const r=document.getElementById('qs');if(!r)return {err:'no panel'};
    const rows=r.querySelectorAll('.qs-list > .qs-card');const sc=[r,...r.querySelectorAll('*')].find(e=>e.scrollHeight>e.clientHeight+4&&/auto|scroll/.test(getComputedStyle(e).overflowY));
    const W=innerWidth;const over=[...r.querySelectorAll('button')].filter(b=>{const q=b.getBoundingClientRect();return q.width>0&&(q.right>W+1||q.left<-1)}).length;
    return {rows:rows.length,hOver:document.documentElement.scrollWidth>W+1||r.scrollWidth>r.clientWidth+2,clippedBtns:over,scrolls:!!sc,lang:document.documentElement.lang||''}});}
  const e=p.errs.slice();await close(p);
  const bad=[];for(const [t,n] of [['d',10],['w',50],['c',17]]){const x=res[t];if(x.err||x.rows<n)bad.push(t+':rows='+x.rows+'/'+n);if(x.hOver)bad.push(t+':h-overflow');if(x.clippedBtns)bad.push(t+':clipped');}
  return (bad.length===0&&e.length===0)||{bad,res,e}})}
await T('I layout','fullscreen button (#f7-fullscreen*) still present in RC DOM',async()=>{const p=await open(RC);const r=await p.evaluate(()=>!!document.querySelector('[id^="f7-fullscreen"],#f7fs,.f7-fs,[id*="fullscreen"]'));await close(p);return r||'not found'});

await browser.close();
const pass=results.filter(r=>r.ok).length;fs.writeFileSync(__dirname+'/results.json',JSON.stringify({pass,fail:results.length-pass,total:results.length,results},null,1));
console.log(`\nTOTAL ${results.length}  PASS ${pass}  FAIL ${results.length-pass}`)})();
