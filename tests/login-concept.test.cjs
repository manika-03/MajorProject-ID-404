const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {VoiceLoginFlow}=require('../static/login-flow.js');
const {VoiceConversation}=require('../static/conversation.js');

test('a spoken identifier requires confirmation and never becomes an authenticated account',()=>{
  const flow=new VoiceLoginFlow();assert.match(flow.prompt(true),/Welcome to the CareVoice login/);assert.doesNotMatch(flow.prompt(true),/guest/i);
  assert.match(flow.receive('demo one').text,/I heard demo one/);assert.equal(flow.phase,'confirm');
  const result=flow.receive('Yes, please.');assert.equal(flow.phase,'fingerprint');
  assert.match(result.text,/not connected/);assert.equal(result.action,undefined);
  assert.match(flow.receive('scan my fingerprint').text,/not connected/);
});
test('correction clears the ID and repeating cannot advance the journey',()=>{
  const flow=new VoiceLoginFlow();flow.receive('demo one');flow.receive('repeat');assert.equal(flow.phase,'confirm');
  flow.receive('no');assert.equal(flow.phase,'identifier');assert.equal(flow.identifier,'');
  flow.receive('demo two');flow.receive('yes');flow.receive('try again');assert.equal(flow.identifier,'');assert.equal(flow.phase,'identifier');
});
test('guest access can be requested in every phase without verification',()=>{
  for(const phase of ['identifier','confirm','fingerprint'])for(const phrase of ['continue','continue to website','continue as guest','Continue as a guest, please.','skip login']){
    const flow=new VoiceLoginFlow();flow.phase=phase;assert.equal(flow.receive(phrase).action,'guest');
  }
});
test('invalid IDs are rejected and clearing a session discards its identifier',()=>{
  const flow=new VoiceLoginFlow();flow.receive('x'.repeat(121));assert.equal(flow.identifier,'');
  flow.receive('demo@example.test');flow.clear();assert.equal(flow.identifier,'');assert.equal(flow.phase,'identifier');
  assert.equal(flow.receive('Done, thank you.').action,'stop');
});

function page(){
  const nodes=new Map(),timers=new Map(),spoken=[],requests=[],navigations=[];let nextTimer=0,recognizer;
  function node(id){
    if(!nodes.has(id))nodes.set(id,{textContent:id==='login-prompt' ? 'Sample ID prompt' : '',hidden:false,disabled:false,attributes:{},events:{},
      classList:{toggle(){},add(){},remove(){}},setAttribute(key,value){this.attributes[key]=value;},removeAttribute(key){delete this.attributes[key];},addEventListener(key,fn){this.events[key]=fn;}});
    return nodes.get(id);
  }
  const schedule=fn=>{timers.set(++nextTimer,fn);return nextTimer;},unschedule=id=>timers.delete(id);
  class Conversation extends VoiceConversation{constructor(options){super({...options,schedule,unschedule});}}
  class Recognition{
    constructor(){recognizer=this;this.active=false;}
    start(){this.active=true;this.onstart();}
    abort(){if(this.active){this.active=false;this.onend();}}
    stop(){this.abort();}
  }
  class Playback{play(text,options){spoken.push(text);options.onstart();return Promise.resolve(true);}cancel(){}}
  const window={SpeechRecognition:Recognition,speechSynthesis:{getVoices:()=>[]},fetch:async(path,options)=>{requests.push({path,...options});return {ok:true};},location:{assign:path=>navigations.push(path)},addEventListener(){}};
  const document={getElementById:node,body:node('body'),addEventListener(){}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../static/login-concept.js'),'utf8'),{window,document,fetch:window.fetch,VoiceLoginFlow,VoiceConversation:Conversation,VoicePlayback:Playback,ListeningCue:class{prime(){}cancel(){}play(){return Promise.resolve(true);}},localStorage:{getItem:()=>null},setTimeout:schedule,clearTimeout:unschedule,AbortSignal});
  const settle=()=>new Promise(resolve=>setImmediate(resolve));
  async function listen(){const timer=[...timers.entries()][0];assert.ok(timer,'listening should have been scheduled');timers.delete(timer[0]);timer[1]();await settle();}
  async function say(text){recognizer.onresult({results:[[{transcript:text}]]});await settle();}
  return {node,spoken,requests,navigations,listen,say,settle,recognizer:()=>recognizer};
}
test('the page guides ID, confirmation and fingerprint explanation without sending the ID to an API',async()=>{
  const p=page();await p.node('login-microphone').events.click();assert.match(p.spoken[0],/Welcome/);
  await p.listen();await p.say('demo one');assert.match(p.spoken.at(-1),/I heard demo one/);
  await p.listen();await p.say('yes');assert.equal(p.node('fingerprint-concept').hidden,false);
  assert.match(p.spoken.at(-1),/not connected/);assert.equal(p.requests.length,0);assert.equal(p.navigations.length,0);
  await p.listen();await p.say('continue as guest');
  assert.equal(p.requests.length,1);assert.equal(p.requests[0].path,'/api/auth/logout');assert.equal(p.requests[0].body,'{}');
  assert.deepEqual(p.navigations,['/']);assert.equal(p.node('login-id-copy').textContent,'A sample email or login ID.');
});
test('stopping shuts down listening and restarting skips the long introduction',async()=>{
  const p=page();await p.node('login-microphone').events.click();await p.listen();
  await p.node('login-microphone').events.click();assert.equal(p.recognizer().active,false);
  await p.node('login-microphone').events.click();assert.doesNotMatch(p.spoken.at(-1),/Welcome/);
});
