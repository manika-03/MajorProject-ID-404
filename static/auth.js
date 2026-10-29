'use strict';
let mode='login';
const el=id=>document.getElementById(id);
function setMode(next, focus=false) {
  mode=next; const registering=mode==='register';
  el('tab-login').setAttribute('aria-selected',String(!registering)); el('tab-register').setAttribute('aria-selected',String(registering));
  el('tab-login').tabIndex=registering ? -1 : 0; el('tab-register').tabIndex=registering ? 0 : -1;
  el('name-field').hidden=!registering; el('account-name').required=registering;
  el('password-hint').hidden=!registering;
  el('account-password').autocomplete=registering ? 'new-password' : 'current-password';
  el('account-password').minLength=registering ? 8 : 1;
  el('auth-title').textContent=registering ? 'Make yourself at home.' : 'Good to have you here.';
  el('auth-description').textContent=registering ? 'Create your own space for reminders and care.' : 'Sign in to your personal workspace.';
  el('auth-submit').querySelector('span').textContent=registering ? 'Create my account' : 'Sign in';
  el('auth-switch-copy').firstChild.textContent=registering ? 'Already have an account? ' : 'New to CareVoice? ';
  el('auth-switch').textContent=registering ? 'Sign in' : 'Create an account'; el('auth-error').textContent='';
  if (focus) el(registering ? 'account-name' : 'account-email').focus();
}
el('tab-login').addEventListener('click',()=>setMode('login'));
el('tab-register').addEventListener('click',()=>setMode('register'));
el('auth-switch').addEventListener('click',()=>setMode(mode==='login' ? 'register' : 'login',true));
document.querySelector('.auth-tabs').addEventListener('keydown',e=>{
  if (['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) {
    e.preventDefault(); setMode(e.key==='Home' ? 'login' : e.key==='End' ? 'register' : mode==='login' ? 'register' : 'login');
    el(mode==='login' ? 'tab-login' : 'tab-register').focus();
  }
});
el('password-toggle').addEventListener('click',()=>{
  const showing=el('account-password').type==='password'; el('account-password').type=showing ? 'text' : 'password';
  el('password-toggle').setAttribute('aria-pressed',String(showing)); el('password-toggle').setAttribute('aria-label',showing ? 'Hide password' : 'Show password');
});
el('auth-form').addEventListener('submit',async e=>{
  e.preventDefault(); el('auth-submit').disabled=true; el('auth-error').textContent='';
  try {
    const response=await fetch(`/api/auth/${mode}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:el('account-name').value,email:el('account-email').value,password:el('account-password').value})});
    const data=await response.json(); if(!response.ok) throw new Error(data.error || 'Could not complete sign in.');
    el('account-password').value=''; window.location.assign('/');
  } catch(error) { el('auth-error').textContent=error.message || 'Could not connect. Please check the Python server and try again.'; }
  finally { el('auth-submit').disabled=false; }
});
