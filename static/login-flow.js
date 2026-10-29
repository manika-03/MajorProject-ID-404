/* Presentation-only journey: no account lookup, credentials or biometric calls. */
'use strict';
class VoiceLoginFlow {
  constructor(){this.phase='identifier';this.identifier='';}
  prompt(intro=false){
    if(this.phase==='fingerprint')return 'This is the proposed fingerprint step. Verification would use your device’s fingerprint sensor. It is not connected yet. Say continue to open the website, or try again.';
    if(this.phase==='confirm')return `I heard ${this.identifier}. Is that right? Say yes or no.`;
    return (intro ? 'Welcome to the CareVoice login. ' : '')+'After the tone, say your email address or login ID. Once confirmed, the planned fingerprint step would verify your fingerprint using your device’s sensor and sign you in to your account.';
  }
  receive(text){
    const value=typeof text==='string' ? text.trim().replace(/\s+/g,' ') : '';
    const command=value.toLowerCase().replace(/[^a-z ]/g,' ').replace(/\s+/g,' ').trim();
    if(/^(?:please )?(?:continue|proceed|enter|go on)(?: as| with| to)?(?: a| the)? guest(?: demo)?(?: please)?$/.test(command) || ['continue','continue please','continue to website','continue to the website','open carevoice','open the website','guest','guest demo','use guest','skip login'].includes(command))return {action:'guest'};
    if(['stop','cancel','done','done thank you','goodbye'].includes(command))return {action:'stop'};
    if(['repeat','repeat please','help'].includes(command))return {text:this.prompt()};
    if(['try again','start again','change my id','change id'].includes(command)){
      this.identifier='';this.phase='identifier';return {text:this.prompt()};
    }
    if(this.phase==='confirm'){
      if(/^(?:yes|correct|that is right|that s right|right)(?: please| thank you)?$/.test(command))this.phase='fingerprint';
      else if(/^(?:no|no thanks|incorrect|that is wrong|that s wrong)$/.test(command)){this.identifier='';this.phase='identifier';}
      else return {text:'Say yes to confirm your ID, or no to try again.'};
      return {text:this.prompt()};
    }
    if(this.phase==='fingerprint')return {text:this.prompt()};
    if(value.length<2 || value.length>120 || /[\x00-\x1f]/.test(value))return {text:'Please say your email or login ID again.'};
    this.identifier=value;this.phase='confirm';return {text:this.prompt()};
  }
  clear(){this.phase='identifier';this.identifier='';}
}
if(typeof module!=='undefined' && module.exports)module.exports={VoiceLoginFlow};
else window.VoiceLoginFlow=VoiceLoginFlow;
