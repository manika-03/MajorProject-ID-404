/* Cancellable output: optional server-generated MP3, with a device-voice fallback. */
'use strict';
class VoicePlayback {
  constructor({speech, utterance, audio, fetcher, urls, onError=()=>{}}) {
    Object.assign(this,{speech,utterance,audio,fetcher,urls,onError});
    this.generation=0; this.finish=null; this.controller=null; this.player=null; this.objectUrl=null;
  }
  cancel() {
    this.generation++;
    if(this.controller) { this.controller.abort(); this.controller=null; }
    if(this.player) { this.player.pause(); this.player.onended=null; this.player.onerror=null; this.player=null; }
    if(this.speech) this.speech.cancel();
    if(this.objectUrl) { this.urls.revokeObjectURL(this.objectUrl); this.objectUrl=null; }
    if(this.finish) { const finish=this.finish; this.finish=null; finish(false); }
  }
  async play(text,{provider='browser',voice=null,rate=.95,onstart=()=>{}}={}) {
    this.cancel(); const generation=this.generation;
    return new Promise(resolve=>{
      let settled=false, fallbackUsed=false, startTimer=null, playbackTimer=null;
      const finish=(success)=>{
        if(settled) return; settled=true;
        clearTimeout(startTimer);clearTimeout(playbackTimer);
        if(this.finish===finish) this.finish=null;
        if(this.objectUrl) { this.urls.revokeObjectURL(this.objectUrl); this.objectUrl=null; }
        this.player=null; resolve(success);
      };
      this.finish=finish;
      const device=()=>{
        if(generation!==this.generation) return finish(false);
        if(!this.speech || !this.utterance) { this.onError('Device speech is unavailable. Please use the text reply.'); return finish(false); }
        try {
          const u=new this.utterance(text); u.lang='en-IN'; u.rate=rate; if(voice) u.voice=voice;
          startTimer=setTimeout(()=>{this.onError('The device voice did not start. Try a different voice or browser.');finish(false);},6000);
          u.onstart=()=>{
            clearTimeout(startTimer);
            if(generation===this.generation){
              onstart();
              playbackTimer=setTimeout(()=>{this.speech.cancel();finish(false);},Math.min(240000,Math.max(30000,text.length*140/rate)));
            }
          };
          u.onend=()=>finish(generation===this.generation);
          u.onerror=e=>{ if(!['canceled','interrupted'].includes(e.error)) this.onError('Speech playback was unavailable. Try another device voice in Accessibility.'); finish(false); };
          this.speech.speak(u);
        } catch { this.onError('Speech playback could not start. Your reply is displayed on screen.'); finish(false); }
      };
      const fallback=(message)=>{
        if(generation!==this.generation)return finish(false);
        if(fallbackUsed)return;
        fallbackUsed=true;
        if(this.player){this.player.pause();this.player.onended=null;this.player.onerror=null;this.player=null;}
        if(this.objectUrl){this.urls.revokeObjectURL(this.objectUrl);this.objectUrl=null;}
        this.onError(message);device();
      };
      if(provider!=='elevenlabs') { device(); return; }
      const controller=new AbortController(); this.controller=controller;
      const timeout=setTimeout(()=>controller.abort(),15000);
      Promise.resolve().then(()=>this.fetcher('/api/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text}),signal:controller.signal}))
        .then(async response=>{
          if(!response.ok) { const data=await response.json(); throw new Error(data.error || 'ElevenLabs could not generate this reply.'); }
          const blob=await response.blob();
          if(generation!==this.generation) return finish(false);
          this.objectUrl=this.urls.createObjectURL(blob);
          const player=new this.audio(this.objectUrl); this.player=player;
          player.playbackRate=rate; player.onplaying=()=>{if(generation===this.generation) onstart();};
          player.onended=()=>finish(generation===this.generation);
          player.onerror=()=>fallback('Audio playback failed. Trying the device voice.');
          await player.play();
        }).catch(error=>{
          if(generation!==this.generation) return finish(false);
          fallback(`${error.name==='AbortError' ? 'The voice service took too long.' : error.message} Using the device voice.`);
        }).finally(()=>{clearTimeout(timeout); if(this.controller===controller) this.controller=null;});
    });
  }
}
if(typeof module!=='undefined' && module.exports) module.exports={VoicePlayback};
else window.VoicePlayback=VoicePlayback;
