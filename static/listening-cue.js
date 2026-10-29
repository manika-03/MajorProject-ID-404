/* Unlock audio on the user's tap, then sound the cue only when recognition starts. */
'use strict';
class ListeningCue {
  constructor({Context, Audio, schedule=(callback,delay)=>setTimeout(callback,delay), unschedule=timer=>clearTimeout(timer)}) {
    Object.assign(this,{Context,Audio,schedule,unschedule});
    this.context=null;this.fallback=null;this.nodes=[];this.timer=null;this.finish=null;this.generation=0;
  }
  prime() {
    // Must run synchronously in the microphone click handler, before any fetch/await.
    if(this.Context) {
      try {
        if(!this.context || this.context.state==='closed')this.context=new this.Context();
        const resume=this.context.resume();if(resume && resume.catch)resume.catch(()=>{});
        return;
      }catch{/* Older browsers can use the bundled sound file. */}
    }
    if(!this.Audio)return;
    try {
      if(!this.fallback)this.fallback=new this.Audio('/static/listen-cue.wav');
      this.fallback.volume=0;
      const primed=this.fallback.play();
      Promise.resolve(primed).then(()=>{this.fallback.pause();this.fallback.currentTime=0;this.fallback.volume=.85;}).catch(()=>{});
    }catch{/* play() reports an explicit failure when listening starts. */}
  }
  cancel() {
    this.generation++;
    for(const node of this.nodes){try{node.stop();node.disconnect();}catch{/* Already stopped. */}}
    this.nodes=[];
    if(this.fallback){this.fallback.pause();this.fallback.onended=null;this.fallback.onerror=null;}
    if(this.timer!==null)this.unschedule(this.timer);this.timer=null;
    if(this.finish){const finish=this.finish;this.finish=null;finish(false);}
  }
  play() {
    this.cancel();const generation=this.generation;
    return new Promise(resolve=>{
      let settled=false;
      const finish=success=>{if(settled)return;settled=true;if(this.timer!==null)this.unschedule(this.timer);this.timer=null;if(this.finish===finish)this.finish=null;resolve(success);};
      this.finish=finish;
      if(this.context && this.context.state==='running') {
        try {
          const start=this.context.currentTime;
          [740,990].forEach((frequency,index)=>{
            const oscillator=this.context.createOscillator(),gain=this.context.createGain(),at=start+index*.16;
            oscillator.type='sine';oscillator.frequency.value=frequency;
            gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(.35,at+.015);gain.gain.setValueAtTime(.35,at+.085);gain.gain.linearRampToValueAtTime(0,at+.14);
            oscillator.connect(gain);gain.connect(this.context.destination);this.nodes.push(oscillator);
            if(index===1)oscillator.onended=()=>{if(generation===this.generation)finish(true);};
            oscillator.start(at);oscillator.stop(at+.145);
          });
          this.timer=this.schedule(()=>finish(false),1500);
          return;
        }catch{this.cancel();return finish(false);}
      }
      if(!this.fallback)return finish(false);
      try {
        this.fallback.volume=.85;this.fallback.currentTime=0;
        this.fallback.onended=()=>finish(generation===this.generation);
        this.fallback.onerror=()=>finish(false);
        this.timer=this.schedule(()=>finish(false),1500);
        Promise.resolve(this.fallback.play()).catch(()=>finish(false));
      }catch{finish(false);}
    });
  }
}
if(typeof module!=='undefined' && module.exports)module.exports={ListeningCue};
else window.ListeningCue=ListeningCue;
