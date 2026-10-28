/* Minimal Proxy-based THREE stub. Lets the page's scripts execute so the QUEST / CURRENCY / BATTLE-PASS / PROFILE logic can be
   exercised in a real browser engine. It does NOT render anything: it proves nothing about real 3D gameplay. */
(function(){
 const handler={get(t,k){if(k===Symbol.toPrimitive)return()=>0;if(k==='then')return undefined;if(k==='length'||k==='name'||k==='prototype'||k==='caller'||k==='arguments')return mk();if(k in t)return t[k];return mk()},
  set(t,k,v){t[k]=v;return true},apply(){return mk()},construct(){return mk()}};
 function mk(){const f=function(){};f.toString=()=>'';return new Proxy(f,handler)}

 /* Minimal REAL Vector3 so positions/distances are meaningful in logic tests (everything else stays a no-op proxy). */
 class V3{constructor(x,y,z){this.x=+x||0;this.y=+y||0;this.z=+z||0}
  set(x,y,z){this.x=+x||0;this.y=+y||0;this.z=+z||0;return this} copy(v){return this.set(v.x,v.y,v.z)} clone(){return new V3(this.x,this.y,this.z)}
  add(v){this.x+=v.x;this.y+=v.y;this.z+=v.z;return this} sub(v){this.x-=v.x;this.y-=v.y;this.z-=v.z;return this}
  *[Symbol.iterator](){yield this.x;yield this.y;yield this.z}
  dot(v){return this.x*v.x+this.y*v.y+this.z*v.z} lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}
  multiplyScalar(k){this.x*=k;this.y*=k;this.z*=k;return this} divideScalar(k){return this.multiplyScalar(1/k)} addScaledVector(v,k){this.x+=v.x*k;this.y+=v.y*k;this.z+=v.z*k;return this}
  normalize(){return this.divideScalar(this.length()||1)} crossVectors(a,b){const x=a.y*b.z-a.z*b.y,y=a.z*b.x-a.x*b.z,z=a.x*b.y-a.y*b.x;return this.set(x,y,z)} distanceToSquared(v){return (this.x-v.x)**2+(this.y-v.y)**2+(this.z-v.z)**2}
  distanceTo(v){return Math.hypot(this.x-v.x,this.y-v.y,this.z-v.z)} length(){return Math.hypot(this.x,this.y,this.z)}}
 Object.setPrototypeOf(V3.prototype,new Proxy({},{get(t,k){if(typeof k==='symbol'||k==='then')return undefined;return function(){return this}}}));const V3p=V3;
 window.THREE=new Proxy({REVISION:'128',Vector3:V3p},{get(t,k){if(k in t)return t[k];return mk()}});
})();
