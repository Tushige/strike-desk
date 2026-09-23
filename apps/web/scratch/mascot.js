import '@fontsource-variable/lexend';
import '@fontsource-variable/unbounded';

const animations = new Map();
const ease = 'cubic-bezier(.16,1,.3,1)';
function play(id) {
  const section = document.getElementById(id);
  for (const animation of animations.get(id) ?? []) animation.cancel();
  const running=[];
  const animate=(selector,frames,options)=>{const element=section.querySelector(selector); if(element) running.push(element.animate(frames,options));};
  if(id==='acceptance') {
    animate('.pup',[{transform:'translateY(0) rotate(0)'},{transform:'translateY(5px) rotate(-5deg)',offset:.38},{transform:'translateY(0) rotate(0)'}],{duration:550,easing:ease});
    animate('.ink-stamp',[{opacity:0,transform:'rotate(-9deg) scale(1.35)'},{opacity:1,transform:'rotate(-9deg) scale(1)'}],{duration:240,delay:180,fill:'backwards',easing:ease});
    animate('.confirmation strong',[{opacity:.2},{opacity:1}],{duration:240,delay:170,fill:'backwards'});
  } else if(id==='bell') {
    animate('.pup',[{transform:'rotate(0)'},{transform:'rotate(4deg) translateY(3px)',offset:.3},{transform:'rotate(-2deg)',offset:.6},{transform:'rotate(0)'}],{duration:650,easing:ease});
    for(const [index,selector] of ['.ring-one','.ring-two'].entries()) animate(selector,[{opacity:.7,transform:'scale(.5)'},{opacity:0,transform:'scale(2.3)'}],{duration:550,delay:150+index*90,easing:'ease-out'});
    animate('.bell-result',[{opacity:.2,transform:'translateY(6px)'},{opacity:1,transform:'none'}],{duration:400,delay:200,fill:'backwards',easing:ease});
    animate('.mini-ticket',[{opacity:0,transform:'rotate(-8deg) translateY(5px)'},{opacity:1,transform:'rotate(-3deg)'}],{duration:380,delay:400,fill:'backwards',easing:ease});
  } else {
    animate('.pup',[{opacity:0,transform:'translateY(9px) rotate(3deg)'},{opacity:1,transform:'none'}],{duration:650,easing:ease});
    animate('.summary-title h3',[{opacity:.3,transform:'translateY(5px)'},{opacity:1,transform:'none'}],{duration:400,easing:ease});
    animate('.journey-line',[{clipPath:'inset(0 100% 0 0)'},{clipPath:'inset(0)'}],{duration:1000,delay:160,fill:'backwards',easing:'ease-in-out'});
    animate('.chart-dots',[{opacity:0},{opacity:1}],{duration:200,delay:950,fill:'backwards'});
  }
  animations.set(id,running);
}
document.querySelectorAll('[data-replay]').forEach(button=>button.addEventListener('click',()=>{play(button.dataset.replay);document.getElementById('preview-status').textContent=`Replaying ${document.querySelector(`#${button.dataset.replay} h2`).textContent}.`;}));
document.getElementById('replay').addEventListener('click',()=>['acceptance','bell','summary'].forEach(play));
document.getElementById('mobile').addEventListener('click',event=>{const on=document.body.classList.toggle('mobile-preview');event.currentTarget.setAttribute('aria-pressed',String(on));});
document.getElementById('outcome').addEventListener('click',event=>{
  const panel=document.querySelector('.bell-panel');const loss=panel.classList.toggle('is-loss');
  panel.querySelector('.day-profit').textContent=loss?'−$6,240':'+$6,200';
  panel.querySelector('.explanation').textContent=loss?'Fizzly finished above your target. Your tickets expired with no payout. Your loss was the $6,240 you spent.':'Fizzly finished below your target. Your tickets paid $12,440 at the bell, including the $6,240 you spent.';
  event.currentTarget.textContent=loss?'Show a winning day':'Show a losing day';event.currentTarget.setAttribute('aria-pressed',String(loss));play('bell');
});
const observer=new IntersectionObserver(entries=>{for(const entry of entries) if(entry.isIntersecting){play(entry.target.id);observer.unobserve(entry.target);}},{threshold:.25});
document.querySelectorAll('.mascot-study').forEach(section=>observer.observe(section));
window.addEventListener('pagehide',()=>{observer.disconnect();for(const list of animations.values()) for(const animation of list) animation.cancel();},{once:true});
