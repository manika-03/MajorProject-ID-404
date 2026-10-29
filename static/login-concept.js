'use strict';
const loginEl=id=>document.getElementById(id);
const LoginRecognition=window.SpeechRecognition || window.webkitSpeechRecognition;
const loginFlow=new VoiceLoginFlow();
let loginRecognition=null,loginListening=false,loginStarting=false,loginHandled=false,loginSilenceCounted=false;
let loginStartTimer,loginListenTimer,introSpoken=false,enteringGuest=false;
const loginPreferences=(()=>{try{return JSON.parse(localStorage.getItem('carevoice.preferences')) || {};}catch{return {};}})();
const loginCue=new ListeningCue({Context:window.AudioContext || window.webkitAudioContext,Audio:window.Audio});
// The sample identifier stays in this page's memory and is not sent to our API/TTS service.
const loginPlayback=new VoicePlayback({speech:window.speechSynthesis,utterance:window.SpeechSynthesisUtterance,audio:window.Audio,fetcher:window.fetch.bind(window),urls:window.URL,onError:showLoginError});
const loginConversation=new VoiceConversation({listen:startLoginRecognition,onState:updateLoginState});
function showLoginError(message){loginEl('login-error').textContent=message;loginEl('login-error').hidden=false;}
function clearLoginError(){loginEl('login-error').hidden=true;loginEl('login-error').textContent='';}
function updateLoginState(state,active){
  loginEl('login-microphone').setAttribute('aria-pressed',String(active));
  loginEl('login-microphone').setAttribute('aria-label',active ? 'Stop the voice login conversation.' : 'Start or resume the voice login concept.');
  loginEl('login-stage').classList.toggle('listening',active && state==='listening');
  if(state!=='speaking')loginEl('login-stage').classList.remove('speaking');
  const states={idle:'Microphone off',onboarding:'Let me guide you.',waiting:'Speak after the tone.',starting:'Getting the microphone ready.',listening:'I’m listening.',thinking:'Let me check what I heard.',speaking:'Preparing the spoken guidance.',paused:'Conversation paused',error:'Let’s try again.'};
  loginEl('login-status').textContent=states[state] || states.idle;
  loginEl('login-hint').textContent=active ? 'Tap the microphone to stop.' : 'Tap the microphone to begin.';
}
function renderLoginFlow(){
  const fingerprint=loginFlow.phase==='fingerprint';
  loginEl('fingerprint-concept').hidden=!fingerprint;
  loginEl('login-id-copy').textContent=loginFlow.identifier ? `Sample ID: ${loginFlow.identifier}` : 'A sample email or login ID.';
  for(const id of ['login-id-step','login-fingerprint-step'])loginEl(id).removeAttribute('aria-current');
  loginEl(fingerprint ? 'login-fingerprint-step' : 'login-id-step').setAttribute('aria-current','step');
}
function stopLogin(state='idle'){
  loginConversation.stop(state);clearTimeout(loginStartTimer);clearTimeout(loginListenTimer);
  if(loginRecognition)loginRecognition.abort();loginListening=false;loginStarting=false;
  loginCue.cancel();loginPlayback.cancel();loginEl('login-stage').classList.remove('speaking','listening');
}
async function speakLoginPrompt(text,{resume=true}={}){
  const generation=loginConversation.generation;
  loginConversation.replyStarted();if(loginRecognition && (loginListening || loginStarting))loginRecognition.abort();
  loginEl('login-prompt').textContent=text;loginEl('login-prompt').setAttribute('aria-live','off');
  const selected=(window.speechSynthesis?.getVoices() || []).find(voice=>voice.voiceURI===loginPreferences.voice);
  const success=await loginPlayback.play(text,{provider:'browser',voice:selected,rate:Number(loginPreferences.rate || .95),onstart:()=>{
    loginEl('login-stage').classList.add('speaking');loginEl('login-status').textContent='CareVoice is speaking.';
  }});
  if(generation!==loginConversation.generation)return;
  loginEl('login-stage').classList.remove('speaking');loginEl('login-prompt').setAttribute('aria-live','polite');
  if(loginConversation.active){if(success && resume)loginConversation.replyFinished();else stopLogin('error');}
  else updateLoginState(loginConversation.state,false);
}
async function loginProblem(message){
  stopLogin('error');showLoginError(message);await speakLoginPrompt(message,{resume:false});
}
function startLoginRecognition(){
  if(!loginRecognition || !loginConversation.active)return;
  if(loginListening || loginStarting){loginConversation.queueListening(500);return;}
  loginStarting=true;clearTimeout(loginStartTimer);
  loginStartTimer=setTimeout(()=>{
    if(loginStarting && loginConversation.active)loginProblem('The microphone has not opened. Allow microphone access if your browser asks, then tap the microphone again. You can also use the Continue to website button.');
  },15000);
  try{loginRecognition.start();}catch{loginStarting=false;loginProblem('The microphone could not start. Tap it to try again, or use the Continue to website button.');}
}
async function handleLoginSpeech(text){
  if(!loginConversation.active || enteringGuest)return;
  loginConversation.heard();const result=loginFlow.receive(text);renderLoginFlow();
  if(result.action==='guest'){await continueAsGuest();return;}
  if(result.action==='stop'){stopLogin();return;}
  await speakLoginPrompt(result.text);
}
if(LoginRecognition){
  loginRecognition=new LoginRecognition();loginRecognition.lang='en-IN';loginRecognition.continuous=false;loginRecognition.interimResults=false;
  loginRecognition.onstart=async()=>{
    clearTimeout(loginStartTimer);loginStarting=false;
    if(!loginConversation.active){loginRecognition.abort();return;}
    loginListening=true;loginHandled=false;loginSilenceCounted=false;loginConversation.listeningStarted();
    const generation=loginConversation.generation,sounded=await loginCue.play();
    if(generation!==loginConversation.generation || !loginListening)return;
    if(!sounded)showLoginError('The microphone is ready, but the tone could not play. Check your device volume and browser sound permissions.');
    loginListenTimer=setTimeout(()=>{if(loginListening)loginRecognition.stop();},20000);
  };
  loginRecognition.onresult=event=>{
    if(loginHandled || !loginConversation.active)return;loginHandled=true;
    handleLoginSpeech(event.results[0][0].transcript);
  };
  loginRecognition.onend=()=>{
    clearTimeout(loginStartTimer);clearTimeout(loginListenTimer);loginCue.cancel();loginListening=false;loginStarting=false;
    if(loginConversation.active && loginConversation.state==='listening' && !loginHandled && !loginSilenceCounted)loginConversation.silence();
    loginConversation.listeningEnded();
  };
  loginRecognition.onerror=event=>{
    if(event.error==='aborted')return;
    if(event.error==='no-speech'){
      if(!loginSilenceCounted){loginConversation.silence();loginSilenceCounted=true;}
      if(!loginConversation.active)speakLoginPrompt('I have paused because I did not hear you. Tap the microphone to try again, or use the Continue to website button.',{resume:false});
      return;
    }
    const messages={'not-allowed':'Allow microphone access in your browser, then tap the microphone to try again. You can also use the Continue to website button.','audio-capture':'I cannot find a microphone. Connect one, or use the Continue to website button.','network':'Voice recognition could not connect. Check your connection, then try again, or use the Continue to website button.'};
    loginProblem(messages[event.error] || 'Voice recognition is unavailable. Try Chrome, or use the Continue to website button.');
  };
}
loginEl('login-microphone').addEventListener('click',async()=>{
  if(enteringGuest)return;
  if(loginConversation.active){stopLogin();return;}
  loginCue.prime();clearLoginError();loginConversation.start({intro:true});
  if(!loginRecognition){await loginProblem('Voice recognition is unavailable in this browser. Please try Chrome, or use the Continue to website button.');return;}
  const text=loginFlow.prompt(!introSpoken);introSpoken=true;await speakLoginPrompt(text);
});
loginEl('login-stop').addEventListener('click',()=>stopLogin());
loginEl('login-repeat').addEventListener('click',()=>{
  if(enteringGuest || loginPlayback.finish)return;loginCue.prime();
  speakLoginPrompt(loginEl('login-prompt').textContent);
});
async function continueAsGuest(){
  if(enteringGuest)return;enteringGuest=true;stopLogin();loginFlow.clear();renderLoginFlow();
  loginEl('guest-continue').disabled=true;loginEl('login-status').textContent='Opening CareVoice…';clearLoginError();
  try{
    // Clear any previous signed-in session; a spoken identifier never selects a patient.
    const response=await fetch('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Error('The website could not be opened. Please check the local server and try again.');
    window.location.assign('/');
  }catch(error){enteringGuest=false;loginEl('guest-continue').disabled=false;await loginProblem(error.message);}
}
loginEl('guest-continue').addEventListener('click',continueAsGuest);
document.addEventListener('keydown',event=>{if(event.key==='Escape')stopLogin();});
window.addEventListener('beforeunload',()=>{stopLogin();loginFlow.clear();});
window.addEventListener('pagehide',()=>{stopLogin();loginFlow.clear();renderLoginFlow();loginEl('login-prompt').textContent='Tap the microphone to begin with a sample login ID.';});
document.body.classList.toggle('large-text',Boolean(loginPreferences.largeText));document.body.classList.toggle('high-contrast',Boolean(loginPreferences.contrast));
