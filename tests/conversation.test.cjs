const {test}=require('node:test');
const assert=require('node:assert/strict');
const {VoiceConversation}=require('../static/conversation.js');
const {VoicePlayback}=require('../static/voice-playback.js');
const {ListeningCue}=require('../static/listening-cue.js');
const vm=require('node:vm');
const fs=require('node:fs');

function controller(){
  let nextId=0, calls=0;const timers=new Map();
  const c=new VoiceConversation({listen:()=>calls++,schedule:callback=>{timers.set(++nextId,callback);return nextId;},unschedule:id=>timers.delete(id)});
  return {c,timers,calls:()=>calls,tick:()=>{const entries=[...timers.values()];timers.clear();entries.forEach(f=>f());}};
}
test('the first microphone tap gives guidance before any listening can start',()=>{
  const {c,tick,calls}=controller();c.start({intro:true});tick();assert.equal(c.state,'onboarding');assert.equal(calls(),0);
  c.replyStarted();tick();assert.equal(calls(),0);c.replyFinished();tick();assert.equal(calls(),1);
});
test('stopping during the welcome speech never opens the microphone afterwards',()=>{
  const {c,tick,calls}=controller();c.start({intro:true});c.replyStarted();c.stop();c.replyFinished();tick();assert.equal(calls(),0);assert.equal(c.active,false);
});
test('the welcome instructions run once across restarts and reset with a new page controller',()=>{
  const {c}=controller();c.start({intro:true});assert.equal(c.takeIntroduction(),true);
  c.stop();c.start({intro:true});assert.equal(c.takeIntroduction(),false);
  c.stop('error');c.start({intro:true});assert.equal(c.takeIntroduction(),false);
  assert.equal(controller().c.takeIntroduction(),true);
});
test('browser timer functions keep their native receiver when listening resumes',()=>{
  const timers=[];
  const sandbox={module:{exports:{}},setTimeout:function(callback){'use strict';assert.equal(this,undefined);timers.push(callback);return timers.length;},clearTimeout:function(){'use strict';assert.equal(this,undefined);}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../static/conversation.js'),'utf8'),sandbox);
  const BrowserConversation=sandbox.module.exports.VoiceConversation;let calls=0;
  const c=new BrowserConversation({listen:()=>calls++});c.start();timers[0]();assert.equal(calls,1);c.replyFinished();c.stop();
});
test('a conversation reopens listening only after the spoken reply completes',()=>{
  const {c,tick,calls}=controller();c.start();tick();assert.equal(calls(),1);
  c.listeningStarted();c.heard();c.listeningEnded();tick();assert.equal(calls(),1);
  c.replyStarted();c.listeningEnded();tick();assert.equal(calls(),1);
  c.replyFinished();tick();assert.equal(calls(),2);
});
test('ending a conversation cancels pending listening and late callbacks',()=>{
  const {c,tick,calls}=controller();c.start();c.stop();tick();c.replyFinished();c.listeningEnded();tick();assert.equal(calls(),0);assert.equal(c.active,false);
});
test('three silent turns pause, and a new conversation resets the silence count',()=>{
  const {c,tick}=controller();c.start();tick();c.listeningStarted();c.silence();c.silence();c.silence();assert.equal(c.active,false);assert.equal(c.state,'paused');c.start();assert.equal(c.silenceCount,0);
});
test('a recognized turn resets silence and microphone start failure pauses safely',()=>{
  const {c}=controller();c.start();c.silence();c.heard();assert.equal(c.silenceCount,0);
  const timers=[];const broken=new VoiceConversation({listen:()=>{throw Error('no microphone');},schedule:cb=>{timers.push(cb);return 0;},unschedule:()=>{}});broken.start();timers[0]();assert.equal(broken.active,false);assert.equal(broken.state,'error');
});
function playback(extra={}){
  const spoken=[];
  const speech={cancel(){},speak(u){spoken.push(u);}};
  const p=new VoicePlayback({speech,utterance:class{constructor(text){this.text=text;}},audio:class{},fetcher:async()=>({ok:false,json:async()=>({error:'Service unavailable'})}),urls:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},...extra});
  return {p,spoken};
}
test('device playback resolves only when speech ends',async()=>{
  const {p,spoken}=playback();let started=false;const playing=p.play('Hello',{onstart:()=>started=true});assert.equal(spoken.length,1);spoken[0].onstart();assert.equal(started,true);spoken[0].onend();assert.equal(await playing,true);
});
test('stop settles an outstanding speech promise, even without a browser cancel event',async()=>{
  const {p}=playback();const playing=p.play('Hello');p.cancel();assert.equal(await playing,false);
});
test('ElevenLabs failure falls back to device speech without blocking the conversation',async()=>{
  const {p,spoken}=playback();const playing=p.play('Hello',{provider:'elevenlabs'});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(spoken.length,1);spoken[0].onend();assert.equal(await playing,true);
});
test('a cancelled cloud request cannot start speech when its result arrives late',async()=>{
  let complete;const response=new Promise(resolve=>{complete=resolve;});const {p,spoken}=playback({fetcher:()=>response});const playing=p.play('Hello',{provider:'elevenlabs'});await new Promise(resolve=>setImmediate(resolve));p.cancel();complete({ok:false,json:async()=>({error:'Unavailable'})});await new Promise(resolve=>setImmediate(resolve));assert.equal(await playing,false);assert.equal(spoken.length,0);
});
function cueContext(){
  const nodes=[],timers=new Map();let nextId=0;
  class Context{
    constructor(){this.state='suspended';this.currentTime=10;this.destination={};}
    resume(){this.state='running';return Promise.resolve();}
    createOscillator(){const node={frequency:{},connect(){},disconnect(){},start(at){this.started=at;},stop(at){this.stopped=at;}};nodes.push(node);return node;}
    createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){}},connect(){}};}
  }
  const cue=new ListeningCue({Context,schedule:fn=>{timers.set(++nextId,fn);return nextId;},unschedule:id=>timers.delete(id)});
  return {cue,nodes,timers};
}
test('the listening cue unlocks on a tap and produces two distinct audible notes',async()=>{
  const {cue,nodes,timers}=cueContext();cue.prime();assert.equal(nodes.length,0);
  const sounding=cue.play();assert.deepEqual(nodes.map(node=>node.frequency.value),[740,990]);
  assert.equal(nodes[1].started>nodes[0].stopped,true);nodes[1].onended();
  assert.equal(await sounding,true);assert.equal(timers.size,0);
});
test('stopping cancels an unfinished tone and a blocked tone reports failure',async()=>{
  const {cue,nodes}=cueContext();cue.prime();const sounding=cue.play();cue.cancel();
  nodes[1].onended();assert.equal(await sounding,false);
  const blocked=new ListeningCue({});assert.equal(await blocked.play(),false);
});
