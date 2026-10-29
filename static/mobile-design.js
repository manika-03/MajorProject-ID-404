'use strict';
for(const [id,className] of [['design-contrast','design-contrast'],['design-size','design-large']]){
  document.getElementById(id).addEventListener('click',event=>{
    const active=document.body.classList.toggle(className);
    event.currentTarget.setAttribute('aria-pressed',String(active));
  });
}
