import { readFile } from "node:fs/promises";

const htmlPath = process.argv[2];
if (!htmlPath) throw new Error("usage: test-playable <html>");
const html = await readFile(htmlPath, "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (!script) throw new Error("embedded game script not found");

let simTime=0,raf=null;
const timers=[];
const classes=()=>{const values=new Set();return{add:v=>values.add(v),remove:v=>values.delete(v),contains:v=>values.has(v)}};
const gradient={addColorStop(){}};
const ctx=new Proxy({}, {get(target,key){if(key==="createRadialGradient"||key==="createLinearGradient")return()=>gradient;if(key in target)return target[key];return()=>{}},set(target,key,value){target[key]=value;return true}});
const elements={},windowListeners={};
for(const id of ["loading","endCard","endBg","endIcon","endTitle","endButton","cta","toast"])elements[id]={id,classList:classes(),style:{},addEventListener(type,fn){this[type]=fn}};
elements.game={id:"game",getContext:()=>ctx,getBoundingClientRect:()=>({left:0,top:0,width:360,height:640}),addEventListener(type,fn){this[type]=fn}};

globalThis.window=globalThis;globalThis.parent={};globalThis.addEventListener=(type,fn)=>{windowListeners[type]=fn};globalThis.document={getElementById:id=>elements[id]};globalThis.performance={now:()=>simTime};
globalThis.requestAnimationFrame=fn=>{raf=fn;return 1};globalThis.setTimeout=(fn,delay)=>{timers.push({at:simTime+delay,fn,done:false});return timers.length};
globalThis.Image=class{constructor(){this.width=126;this.height=160}set src(v){this._src=v;queueMicrotask(()=>this.onload?.())}get src(){return this._src}};
const audioInstances=[];globalThis.Audio=class{constructor(src){this.src=src;this.loop=false;this.volume=1;this.muted=false;audioInstances.push(this)}play(){return Promise.resolve()}};

new Function(script)();for(let i=0;i<5;i++)await Promise.resolve();
const game=window.__PLAYABLE__;if(!game)throw new Error("game did not initialize");
if(typeof windowListeners.message!=="function")throw new Error("mute message protocol missing");
windowListeners.message({source:{},data:{type:"playable:set-muted",muted:true}});
if(game.audio.muted!==true)throw new Error("untrusted mute message changed state");
windowListeners.message({source:parent,data:{type:"playable:set-muted",muted:false}});
if(game.audio.muted!==false)throw new Error("valid unmute message not applied");
const tick=ms=>{simTime+=ms;for(const timer of timers.filter(t=>!t.done&&t.at<=simTime)){timer.done=true;timer.fn()}const frame=raf;raf=null;frame?.(simTime)};
const click=t=>elements.game.pointerdown({clientX:t.x,clientY:t.y,preventDefault(){}});
const availablePair=()=>{const groups=new Map();for(const t of game.tiles.filter(t=>t.state==="board"&&t.selectable)){const list=groups.get(t.key)||[];list.push(t);groups.set(t.key,list)}return [...groups.values()].find(v=>v.length>=2)};

if(game.mode==="top_rack"&&(game.score!==240||game.rack.length!==0))throw new Error("top_rack: rack must be empty initially");
if(game.mode==="top_rack"&&game.tiles.some(t=>t.state==="board"&&(!t.selectable||(t.alpha??1)<1)))throw new Error("top_rack: every board tile must be opaque and selectable");
if(game.mode==="top_rack"){
  const distinct=[];for(const t of game.tiles.filter(t=>t.state==="board")){if(!distinct.some(v=>v.key===t.key))distinct.push(t);if(distinct.length===4)break}
  for(const t of distinct){click(t);tick(360)}tick(350);
  if(game.rack.length||distinct.some(t=>t.state!=="board"||t.x!==t.homeX||t.y!==t.homeY))throw new Error("top_rack: full unmatched rack did not restore tiles");
}
if(game.mode!=="top_rack"){
  const live=game.tiles.filter(t=>t.state==="board"&&t.selectable),a=live[0],b=live.find(t=>t.key!==a.key);click(a);click(b);tick(500);
  if(game.score!==0||game.matches!==0)throw new Error(`${game.mode}: mismatch changed progress`);
}
while(game.matches<4){
  const pair=availablePair();if(!pair)throw new Error(`${game.mode}: no available pair at match ${game.matches}`);
  click(pair[0]);if(game.mode==="top_rack")tick(360);click(pair[1]);tick(game.mode==="top_rack"?700:500);
}
const expectedScores={center_collision:2000,top_rack:1360,gravity_fill:2000,perspective_3d:1632};
if(game.score!==expectedScores[game.mode])throw new Error(`${game.mode}: unexpected final score ${game.score}`);
if(game.mode==="perspective_3d"&&(!game.cavities.length||!game.tiles.some(t=>t.state==="board"&&t.layer>0)))throw new Error("perspective_3d: lower layer was not revealed");
tick(1000);if(!elements.endCard.classList.contains("show"))throw new Error(`${game.mode}: end card not visible`);
if(game.interactions<8)throw new Error(`${game.mode}: interactions were not recorded`);
windowListeners.message({source:parent,data:{type:"playable:set-muted",muted:true}});
if(!game.audio.muted||audioInstances.some(audio=>!audio.muted))throw new Error("runtime did not mute every audio instance");
windowListeners.message({source:parent,data:{type:"playable:set-muted",muted:"yes"}});
if(!game.audio.muted)throw new Error("malformed mute message changed state");
console.log("PASS");
