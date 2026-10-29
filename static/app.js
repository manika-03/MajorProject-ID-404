'use strict';
const $=id=>document.getElementById(id);
const speech=window.speechSynthesis;
const Recognition=window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition, listening=false, recognitionStarting=false, busy=false, voicesEnabled=false, outputBusy=false;
let turnHadSpeech=false, turnSilenceCounted=false, allVoices=[], elevenlabsAvailable=false;
let lastResponse=$('response-text').textContent, lastReminderData=[], reminderPolling=false, bootstrapFailed=false;
let toastTimer, microphoneTimer, microphoneStartTimer;
let guidance='Welcome to CareVoice. When you hear the tone, speak naturally and pause. I will reply aloud and listen again. Say help for guidance, repeat to hear an answer again, or done, thank you, to finish. Tap this microphone again to stop. How can I help you today?';
const preferences=(()=>{try{return JSON.parse(localStorage.getItem('carevoice.preferences')) || {};}catch{return {};}})();
const announcedReminders=new Set();
const playback=new VoicePlayback({speech,utterance:window.SpeechSynthesisUtterance,audio:window.Audio,fetcher:window.fetch.bind(window),urls:window.URL,onError:message=>toast(message)});
const conversation=new VoiceConversation({listen:beginRecognition,onState:updateConversationState});
const listeningCue=new ListeningCue({Context:window.AudioContext || window.webkitAudioContext,Audio:window.Audio});

function savePreferences(){try{localStorage.setItem('carevoice.preferences',JSON.stringify(preferences));}catch{/* Optional. */}}
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$('toast').hidden=true;},6500);}
async function api(path,options={}){
  const response=await fetch(path,{...options,headers:{'Content-Type':'application/json',...(options.headers || {})}});
  const data=await response.json();if(!response.ok)throw new Error(data.error || 'I could not complete that request. Please try again.');return data;
}
function setVoiceEnabled(enabled){
  voicesEnabled=Boolean(enabled && (speech || elevenlabsAvailable));
  $('conversation').setAttribute('aria-live',voicesEnabled ? 'off' : 'polite');
  if(!voicesEnabled){conversation.stop();if(recognition)recognition.abort();cancelSpeech();}
}
function cancelSpeech(){playback.cancel();outputBusy=false;$('assistant').classList.remove('speaking');}
async function speak(text,options={}){
  if(!voicesEnabled)return false;
  if(conversation.active){conversation.replyStarted();if(recognition && (listening || recognitionStarting))recognition.abort();}
  $('assistant').classList.remove('speaking');
  outputBusy=true;
  const playing=playback.play(text,{provider:preferences.provider==='elevenlabs' && elevenlabsAvailable ? 'elevenlabs' : 'browser',voice:allVoices.find(v=>v.voiceURI===preferences.voice),rate:Number(preferences.rate || .95),onstart:()=>{
    $('assistant').classList.add('speaking');$('listen-status').textContent='CareVoice is speaking';
    if(options.onstart)options.onstart();
  }});
  const generation=playback.generation;
  const success=await playing;
  if(generation!==playback.generation)return false;
  outputBusy=false;
  $('assistant').classList.remove('speaking');
  if(conversation.active && !busy && options.resume!==false){
    if(success){await deliverDueReminders();if(conversation.active)conversation.replyFinished();}
    else conversation.stop('error');
  }
  return success;
}
function showResponse(text,question){
  lastResponse=text;$('response-text').textContent=text;
  if(question){$('transcript').textContent=`You said: ${question}`;$('transcript').hidden=false;}
}
function addHistory(speaker,text){
  const item=document.createElement('p'),label=document.createElement('strong');label.textContent=speaker+': ';item.append(label,document.createTextNode(text));
  const host=$('conversation-history');host.append(item);while(host.children.length>30)host.firstElementChild.remove();
}
function updateConversationState(state,active){
  $('listen-button').setAttribute('aria-pressed',String(active));
  $('listen-button').setAttribute('aria-label',active ? 'End conversation and turn off the microphone.' : conversation.introductionPlayed ? 'Resume CareVoice. Speak after the tone.' : 'Start CareVoice. Hear spoken instructions, then ask a question.');
  $('assistant').classList.toggle('listening',active && state==='listening');
  if(state!=='speaking')$('assistant').classList.remove('speaking');
  const status={idle:'Ready when you are',onboarding:'Let me show you how it works',waiting:'Your turn',starting:'Getting ready to listen',listening:'I’m listening',thinking:'Let me help with that',speaking:'Preparing my spoken reply',paused:'Conversation paused',error:'Let’s try that again'};
  const detail={idle:conversation.introductionPlayed ? 'Tap the microphone to continue. Speak after the tone.' : 'Tap the microphone for spoken instructions.',onboarding:conversation.introductionPlayed ? 'Getting the microphone ready.' : 'Listen to the introduction. I’ll open the microphone afterwards.',waiting:'Speak after the tone.',starting:'If your browser asks for microphone access, choose Allow.',listening:'Speak naturally, then pause.',thinking:'I’ll answer aloud in a moment.',speaking:'I’ll listen again after my reply.',paused:'Tap the microphone whenever you’re ready.',error:'Tap the microphone to try again.'};
  $('listen-status').textContent=status[state] || status.idle;$('voice-detail').textContent=detail[state] || detail.idle;
}
function localCommand(text){
  const control=text.toLowerCase().replace(/[^a-z ]/g,' ').replace(/\s+/g,' ').trim();
  if(['speak slower','slower please','slow down'].includes(control)){
    preferences.rate=Math.max(.6,Number(preferences.rate || .95)-.1);applyPreferences();savePreferences();return 'I will speak more slowly. What would you like to know?';
  }
  if(['speak faster','faster please'].includes(control)){
    preferences.rate=Math.min(1.3,Number(preferences.rate || .95)+.1);applyPreferences();savePreferences();return 'I will speak a little faster. What would you like to know?';
  }
  return null;
}
async function ask(question){
  if(busy || !question.trim())return;
  conversation.heard();if(recognition && (listening || recognitionStarting))recognition.abort();
  cancelSpeech();busy=true;$('conversation').setAttribute('aria-busy','true');addHistory('You',question);
  const started=performance.now();let success=false,finished=false;
  try{
    const local=localCommand(question);
    const result=local ? {response:local} : await api('/api/chat',{method:'POST',body:JSON.stringify({message:question})});
    showResponse(result.response,question);addHistory('CareVoice',result.response);
    $('response-meta').dataset.processingMs=String(result.processing_ms || 0);$('response-meta').dataset.roundTripMs=String(Math.round(performance.now()-started));
    if(result.action==='stop'){stopEverything();finished=true;}
    else{
      if(result.action==='end_conversation'){finished=true;conversation.stop();if(recognition)recognition.abort();}
      success=await speak(result.response);
      if(finished){$('listen-status').textContent='Conversation ended';$('voice-detail').textContent='Microphone off. Tap the centre microphone to start again.';}
    }
    await pollReminders(false);
  }catch(error){
    showResponse(error.message,question);addHistory('CareVoice',error.message);conversation.stop('error');
    await speak('I could not connect to the healthcare assistant. Please try again in a moment.');
  }finally{
    busy=false;$('conversation').removeAttribute('aria-busy');
    if(conversation.active){
      if(success){await deliverDueReminders();if(conversation.active)conversation.replyFinished();}
      else conversation.stop('error');
    }else if(!finished && success){$('listen-status').textContent='Microphone off';}
  }
}
function stopEverything(){
  conversation.stop();if(recognition)recognition.abort();setVoiceEnabled(false);clearTimeout(microphoneTimer);clearTimeout(microphoneStartTimer);
  listening=false;recognitionStarting=false;listeningCue.cancel();
  $('listen-status').textContent='Conversation ended';$('voice-detail').textContent='Microphone off. Tap the centre microphone to start again.';
}
async function speakProblem(message){
  clearTimeout(microphoneStartTimer);conversation.stop('error');if(recognition)recognition.abort();showResponse(message);toast(message);
  await speak(message,{resume:false});
}
function beginRecognition(){
  if(!recognition || !conversation.active)return;
  if(listening || recognitionStarting){conversation.queueListening(500);return;}
  recognitionStarting=true;
  clearTimeout(microphoneStartTimer);
  microphoneStartTimer=setTimeout(()=>{
    if(recognitionStarting && conversation.active){recognitionStarting=false;speakProblem('The microphone has not opened yet. If your browser is asking for microphone access, choose Allow, then tap the centre microphone again.');}
  },15000);
  try{recognition.start();}catch{recognitionStarting=false;speakProblem('The microphone could not start. Tap the centre microphone to try again.');}
}
function initRecognition(){
  if(!Recognition)return;
  recognition=new Recognition();recognition.lang='en-IN';recognition.continuous=false;recognition.interimResults=false;
  recognition.onstart=async()=>{
    clearTimeout(microphoneStartTimer);
    recognitionStarting=false;if(!conversation.active){recognition.abort();return;}
    listening=true;turnHadSpeech=false;turnSilenceCounted=false;conversation.listeningStarted();
    const generation=conversation.generation;
    const sounded=await listeningCue.play();
    if(!conversation.active || generation!==conversation.generation || !listening)return;
    if(!sounded){$('voice-detail').textContent='The microphone is ready. The listening tone could not play; check your device volume.';toast('The listening tone could not play. Check device volume and browser sound permissions.');}
    microphoneTimer=setTimeout(()=>{if(listening)recognition.stop();},20000);
  };
  recognition.onend=()=>{
    clearTimeout(microphoneTimer);clearTimeout(microphoneStartTimer);listeningCue.cancel();listening=false;recognitionStarting=false;
    if(conversation.active && conversation.state==='listening' && !turnHadSpeech && !turnSilenceCounted)conversation.silence();
    if(conversation.active && conversation.state==='listening' && dueReminders().length){
      conversation.replyStarted();deliverDueReminders().then(()=>{if(conversation.active)conversation.replyFinished();});
    }else conversation.listeningEnded();
  };
  recognition.onresult=event=>{
    if(!conversation.active)return;turnHadSpeech=true;ask(event.results[0][0].transcript);
  };
  recognition.onerror=event=>{
    if(event.error==='aborted')return;
    if(event.error==='no-speech'){
      if(!turnSilenceCounted){conversation.silence();turnSilenceCounted=true;}
      if(!conversation.active)speak('I have paused because I did not hear you. Tap the centre microphone when you are ready.',{resume:false});
      return;
    }
    const messages={
      'not-allowed':'Microphone access is not allowed. Allow microphone access for CareVoice in your browser, then tap the centre microphone again.',
      'service-not-allowed':'Voice recognition is unavailable in this browser. Open CareVoice in Chrome, then tap the centre microphone again.',
      'audio-capture':'I cannot find a microphone. Please connect one, then tap the centre microphone again.',
      'network':'Voice recognition could not connect. Check your internet connection, then tap the centre microphone to try again.'
    };
    speakProblem(messages[event.error] || 'I could not hear that request. Tap the centre microphone to start again.');
  };
}
async function activateListening(){
  if(conversation.active){stopEverything();return;}if(busy)return;
  listeningCue.prime();
  cancelSpeech();conversation.start({intro:true});const generation=conversation.generation;
  await bootstrapReady;
  if(!conversation.active || generation!==conversation.generation)return;
  setVoiceEnabled(true);
  if(!voicesEnabled){conversation.stop('error');showResponse('Voice playback is unavailable in this browser. Please use a browser and device with working audio.');toast(lastResponse);return;}
  if(bootstrapFailed){await speakProblem('CareVoice could not load. Please restart the local application and try again.');return;}
  if(!recognition){await speakProblem('Voice recognition is unavailable in this browser. Please open CareVoice in Chrome, then tap the centre microphone.');return;}
  if(conversation.takeIntroduction()){
    showResponse(guidance);addHistory('CareVoice',guidance);
    const success=await speak(guidance);
    if(!success && conversation.active)conversation.stop('error');
  }else conversation.queueListening(0);
}
function renderBootstrap(data){
  guidance=data.guidance || guidance;
  elevenlabsAvailable=Boolean(data.voice && data.voice.elevenlabs_available);
  if(elevenlabsAvailable && !preferences.provider)preferences.provider='elevenlabs';
  if(!elevenlabsAvailable && preferences.provider==='elevenlabs')preferences.provider='browser';
  $('elevenlabs-option').disabled=!elevenlabsAvailable;$('elevenlabs-option').textContent=elevenlabsAvailable ? 'ElevenLabs · natural voice' : 'ElevenLabs · unavailable';
  $('voice-provider').value=preferences.provider || 'browser';
  $('voice-provider-status').textContent=elevenlabsAvailable ? 'ElevenLabs is ready. Reply text is sent to this service when selected; the device voice is the fallback.' : 'The device voice is available. ElevenLabs is not configured.';
  lastReminderData=data.reminders || [];
}
function dueReminders(){return lastReminderData.filter(row=>row.due && !announcedReminders.has(row.id));}
async function deliverDueReminders(){
  for(const row of dueReminders().slice(0,3)){
    if(!voicesEnabled)break;
    const success=await speak(`Reminder. ${row.label}. Say dismiss reminders to acknowledge this alert.`,{resume:false,onstart:()=>announcedReminders.add(row.id)});
    if(!success){announcedReminders.delete(row.id);break;}
  }
}
async function pollReminders(announce=true){
  if(reminderPolling)return;reminderPolling=true;
  try{
    const data=await api('/api/reminders');lastReminderData=data.reminders;
    if(announce && voicesEnabled && !busy && !outputBusy && !listening && !recognitionStarting && dueReminders().length){
      const active=conversation.active;
      if(active)conversation.replyStarted();
      await deliverDueReminders();if(active && conversation.active)conversation.replyFinished();
    }
  }catch{/* The next poll retries; never interrupt the patient with repeated network messages. */}
  finally{reminderPolling=false;}
}
function populateVoices(){
  if(!speech)return;allVoices=speech.getVoices();const select=$('voice-select');select.replaceChildren(new Option('Device default',''));
  allVoices.filter(v=>v.lang.startsWith('en')).forEach(v=>select.add(new Option(`${v.name} (${v.lang})`,v.voiceURI)));
  if([...select.options].some(o=>o.value===preferences.voice))select.value=preferences.voice;
}
function applyPreferences(){
  document.body.classList.toggle('high-contrast',Boolean(preferences.contrast));document.body.classList.toggle('large-text',Boolean(preferences.largeText));
  $('contrast-toggle').checked=Boolean(preferences.contrast);$('large-text').checked=Boolean(preferences.largeText);
  $('speech-rate').value=preferences.rate || .95;$('rate-label').value=`${Number(preferences.rate || .95).toFixed(2)}×`;
}
$('listen-button').addEventListener('click',activateListening);
$('stop-button').addEventListener('click',stopEverything);
$('repeat-button').addEventListener('click',()=>{if(busy || outputBusy || conversation.state==='onboarding')return;setVoiceEnabled(true);speak(lastResponse);});
$('settings-open').addEventListener('click',()=>{if(conversation.active || outputBusy)stopEverything();$('settings-dialog').showModal();});
$('settings-close').addEventListener('click',()=>$('settings-dialog').close());
$('speech-rate').addEventListener('input',e=>{preferences.rate=Number(e.target.value);applyPreferences();savePreferences();});
$('voice-provider').addEventListener('change',e=>{preferences.provider=e.target.value;savePreferences();});
$('voice-select').addEventListener('change',e=>{preferences.voice=e.target.value;savePreferences();});
$('large-text').addEventListener('change',e=>{preferences.largeText=e.target.checked;applyPreferences();savePreferences();});
$('contrast-toggle').addEventListener('change',e=>{preferences.contrast=e.target.checked;applyPreferences();savePreferences();});
$('test-voice').addEventListener('click',()=>{setVoiceEnabled(true);speak('Hello from CareVoice. Tap the central microphone whenever you are ready.');});
document.addEventListener('keydown',e=>{if(e.key==='Escape' && conversation.active)stopEverything();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)pollReminders();});
window.addEventListener('beforeunload',()=>{conversation.stop();cancelSpeech();listeningCue.cancel();if(recognition)recognition.abort();});
if($('logout-button'))$('logout-button').addEventListener('click',async()=>{stopEverything();try{await api('/api/auth/logout',{method:'POST',body:'{}'});window.location.assign('/');}catch{toast('Could not sign out. Please try again.');}});
applyPreferences();initRecognition();populateVoices();if(speech)speech.addEventListener('voiceschanged',populateVoices);
const bootstrapReady=api('/api/bootstrap').then(renderBootstrap).catch(()=>{bootstrapFailed=true;showResponse('CareVoice could not connect. Tap the microphone for spoken guidance.');});
setInterval(pollReminders,5000);
