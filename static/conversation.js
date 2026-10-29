/* A small turn-taking controller shared by the page and deterministic tests. */
'use strict';
class VoiceConversation {
  constructor({listen, onState=()=>{}, schedule=(callback,delay)=>setTimeout(callback,delay), unschedule=timer=>clearTimeout(timer)}) {
    this.listen=listen; this.onState=onState; this.schedule=schedule; this.unschedule=unschedule;
    this.active=false; this.state='idle'; this.generation=0; this.silenceCount=0; this.timer=null;
    this.introductionPlayed=false;
  }
  transition(state) { this.state=state; this.onState(state,this.active); }
  clearTimer() { if (this.timer!==null) this.unschedule(this.timer); this.timer=null; }
  start({intro=false}={}) { this.stop(); this.active=true; this.silenceCount=0; if(intro)this.transition('onboarding');else this.queueListening(0); }
  // Kept in page memory: stop/start retains this; reloading creates a fresh controller.
  takeIntroduction() { if(this.introductionPlayed)return false; this.introductionPlayed=true; return true; }
  queueListening(delay=450) {
    if (!this.active) return;
    this.clearTimer(); const generation=this.generation; this.transition('waiting');
    this.timer=this.schedule(()=>{
      this.timer=null;
      if (!this.active || this.generation!==generation) return;
      this.transition('starting');
      try { this.listen(); } catch { this.stop('error'); }
    },delay);
  }
  listeningStarted() { if (this.active) this.transition('listening'); }
  heard() { this.silenceCount=0; this.clearTimer(); if(this.active) this.transition('thinking'); }
  replyStarted() { if(this.active) this.transition('speaking'); }
  replyFinished() { if(this.active) this.queueListening(); }
  listeningEnded() { if(this.active && ['listening','starting'].includes(this.state)) this.queueListening(); }
  silence() { this.silenceCount++; if(this.silenceCount>=3) this.stop('paused'); }
  stop(state='idle') { this.active=false; this.generation++; this.clearTimer(); this.transition(state); }
}
if (typeof module!=='undefined' && module.exports) module.exports={VoiceConversation};
else window.VoiceConversation=VoiceConversation;
