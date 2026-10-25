const WS=require('ws'),{spawn}=require('child_process'),vm=require('vm'),fs=require('fs');
const NP='/home/claude/.npm-global/lib/node_modules/@mermaid-js/mermaid-cli/node_modules';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let pass=0,fail=0;
const ok=(c,n)=>{c?pass++:fail++;console.log((c?'PASS ':'FAIL ')+n)};
function startServer(port,env={}){const p=spawn('node',['server.js'],{cwd:__dirname,env:{...process.env,PORT:port,NODE_PATH:NP,...env}});p.out='';p.stdout.on('data',d=>p.out+=d);p.stderr.on('data',d=>p.out+=d);return p}
function client(port,origin){return new Promise((res,rej)=>{const w=new WS('ws://127.0.0.1:'+port,origin===undefined?{}:{origin});w.msgs=[];w.on('message',d=>w.msgs.push(JSON.parse(d)));w.on('open',()=>res(w));w.on('error',rej);w.on('unexpected-response',(rq,rs)=>rej(new Error('HTTP '+rs.statusCode)))})}
const snd=(w,o)=>w.send(JSON.stringify(o));
const wait=async(w,f,ms=2000)=>{const t=Date.now();while(Date.now()-t<ms){const m=w.msgs.find(f);if(m)return m;await sleep(20)}return null};
(async()=>{
 const sv=startServer(3999);await sleep(800);
 // health + http
 const h=await (await fetch('http://127.0.0.1:3999/health')).json();ok(h.ok===true,'HTTP /health responds');
 // 1/2 create + join from two independent connections
 const A=await client(3999),B=await client(3999);
 snd(A,{t:'create',name:'GHOST#1'});const ja=await wait(A,m=>m.t==='joined');ok(ja&&ja.isHost&&/^[A-Z2-9]{5}$/.test(ja.room),'A creates room '+(ja&&ja.room));
 snd(B,{t:'join',name:'Bob#123456',room:ja.room.toLowerCase()});const jb=await wait(B,m=>m.t==='joined');ok(jb&&!jb.isHost&&jb.players.length===2,'B joins with lowercase code, sees 2 players');
 ok(jb.id!==ja.id,'player IDs unique');
 ok(!!(await wait(A,m=>m.t==='playerList'&&m.players.length===2)),'A is told about B');
 // 3/4 start, state sync, weapon switch
 snd(B,{t:'ready',v:true});await sleep(100);snd(A,{t:'start',mapId:3,mode:'pvp'});
 ok(!!(await wait(A,m=>m.t==='startMatch'))&&!!(await wait(B,m=>m.t==='startMatch'&&m.mapId===3)),'match starts for both (map 3, pvp)');
 snd(A,{t:'state',x:1,y:0,z:2,yaw:.5,pitch:0,weapon:'ak12',moving:true});
 const sa=await wait(B,m=>m.t==='state'&&m.id===ja.id);ok(sa&&sa.x===1&&sa.z===2&&sa.weapon==='ak12','B sees A move + weapon ak12');
 snd(B,{t:'state',x:3,y:0,z:4,yaw:0,pitch:0,weapon:'sg'});const sb=await wait(A,m=>m.t==='state'&&m.id===jb.id);ok(sb&&sb.weapon==='sg','A sees B weapon switch to sg');
 // combat
 snd(A,{t:'hit',targetId:jb.id,weapon:'ak12',dmg:26});const hp=await wait(B,m=>m.t==='health'&&m.id===jb.id);ok(hp&&hp.hp===74,'PvP hit reduces B health to 74');
 // 6 disconnect + reconnect
 B.close();const pl=await wait(A,m=>m.t==='playerLeft'&&m.id===jb.id);ok(!!pl,'A notified when B disconnects');
 const B2=await client(3999);snd(B2,{t:'join',name:'Bob#123456',room:ja.room});const e0=await wait(B2,m=>m.t==='error');ok(e0&&e0.code==='MATCH_STARTED','rejoin during running match gives clear error '+(e0&&e0.code));
 // 7 invalid codes
 const C=await client(3999);snd(C,{t:'join',name:'C',room:'ZZZZZ'});const e1=await wait(C,m=>m.t==='error');ok(e1&&e1.code==='ROOM_NOT_FOUND'&&e1.msg==='Room not found.','nonexistent room -> ROOM_NOT_FOUND');
 snd(C,{t:'join',name:'C',room:'AB'});await sleep(100);const e2=C.msgs.filter(m=>m.t==='error')[1];ok(e2&&e2.code==='INVALID_CODE','malformed code -> INVALID_CODE');
 // full room
 const D=await client(3999);snd(D,{t:'create',name:'D'});const jd=await wait(D,m=>m.t==='joined');const ex=[];
 for(let i=0;i<8;i++){const x=await client(3999);snd(x,{t:'join',name:'p'+i,room:jd.room});ex.push(x)}
 await sleep(400);ok(ex.some(x=>x.msgs.some(m=>m.code==='ROOM_FULL')),'9th player gets ROOM_FULL');
 // origins
 const sv2=startServer(3998,{ALLOWED_ORIGINS:'https://game.example'});await sleep(700);
 let rej=null;try{await client(3998,'null')}catch(e){rej=e.message}ok(rej==='HTTP 401','origin "null" rejected when allow-list set ('+rej+')');
 ok(/REJECTED.*origin=null/.test(sv2.out),'server logs the rejected origin');
 const okc=await client(3998,'https://game.example');ok(!!okc,'allowed origin accepted');okc.close();sv2.kill();
 const sv3=startServer(3997,{ALLOWED_ORIGINS:'https://game.example',ALLOW_NULL_ORIGIN:'1'});await sleep(700);
 const nc=await client(3997,'null');ok(!!nc,'ALLOW_NULL_ORIGIN=1 lets local-file pages in');nc.close();sv3.kill();
await sleep(300);console.log('LOGLEN',sv.out.length);console.log(sv.out.slice(0,600));ok(/room [A-Z0-9]{5} created by/.test(sv.out)&&/rejected ROOM_NOT_FOUND/.test(sv.out),'server logs room creation + rejected requests');
 // ---- client networking code (real functions from the HTML, real ws/fetch, stubbed game globals) ----
 const src=fs.readFileSync(__dirname+'/facility7_multiplayer_ready_diag_html_임시_.html','utf8');
 const a=src.indexOf('function mpNormUrl'),b=src.indexOf('let mpRespawnPending');
 const code='let mpPingTimer=null;'+src.slice(a,b);
 const mk=()=>{const log=[];const ctx={WebSocket:WS,fetch,AbortController,performance,console:{log(){},error(){},warn(){}},setTimeout,clearTimeout,setInterval,clearInterval,
  location:{protocol:'file:',origin:'null'},document:{body:null},state:'menu',SC:{mp:()=>'mp',mpRoom:()=>'room'},show:x=>log.push('show:'+x),$:()=>({classList:{add(){},remove(){}}}),$t:k=>k,$x:k=>k,
  I18N:{xq:x=>x},PF:{tag:()=>'123456'},mp:{ws:null,url:'',name:'',id:null,room:null,host:false,ready:false,inMatch:false,connecting:false,err:'',playersList:[],ping:null,find:''},
  mpPrune(){},clearRemotePlayers(){},clearGhostEnemies(){},mpErrTxt:x=>x,MPP:new Map(),MPE:new Map(),msg(){},toMenu(){}};vm.createContext(ctx);vm.runInContext(code,ctx);return ctx};
 const wf=async(f,ms)=>{const t=Date.now();while(Date.now()-t<ms){if(f())return true;await sleep(50)}return false};
 let c=mk();c.mpCreateRoom('wss://127.0.0.1:3999x','x');ok(true,'(bad url smoke)');
 c=mk();c.mpJoinRoom('ws://127.0.0.1:3999','n','AB');ok(/ROOM JOIN FAILED/.test(c.mp.err),'client: short code -> "'+c.mp.err+'"');
 c=mk();c.mpCreateRoom('ws://127.0.0.1:3999','GHOST');ok(await wf(()=>c.mp.room,5000),'client: create room works through real functions, room='+c.mp.room);const rc=c.mp.room;
 let c2=mk();c2.mpJoinRoom('ws://127.0.0.1:3999','Bob',rc.toLowerCase()+' ');ok(await wf(()=>c2.mp.room===rc,5000),'client B joins A\'s room via real functions');
 c2=mk();c2.mpJoinRoom('ws://127.0.0.1:3999','Bob','QQQQQ');ok(await wf(()=>/ROOM JOIN FAILED/.test(c2.mp.err),4000)&&/Room not found/.test(c2.mp.err),'client: invalid code shows "'+c2.mp.err+'"');
 // unreachable server + cold start recovery (server comes up during the retry window)
 let c3=mk();c3.mpCreateRoom('ws://127.0.0.1:3996','Cold');await sleep(300);const sv4=startServer(3996);
 ok(await wf(()=>c3.mp.room,9000),'cold start: client retried and recovered once server came up');sv4.kill();
 let c4=mk();c4.mpCreateRoom('ws://127.0.0.1:3995','Dead');ok(await wf(()=>/CONNECTION FAILED/.test(c4.mp.err),12000),'dead server -> visible "'+String(c4.mp.err).slice(0,90)+'…"');
 // origin rejection surfaced to user
 const sv5=startServer(3994,{ALLOWED_ORIGINS:'https://x.example'});await sleep(700);let c5=mk();c5.mpCreateRoom('ws://127.0.0.1:3994','Orig');
 ok(await wf(()=>/CONNECTION FAILED/.test(c5.mp.err),12000)&&/1006/.test(c5.mp.err),'origin rejection surfaced with close code: '+String(c5.mp.err).slice(0,60)+'…');sv5.kill();
 sv.kill();console.log(`\n${pass} passed, ${fail} failed`);process.exit(fail?1:0)})().catch(e=>{console.error('HARNESS ERROR',e);process.exit(2)});
