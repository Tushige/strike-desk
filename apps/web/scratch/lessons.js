import '@fontsource-variable/lexend';
import '@fontsource-variable/unbounded';
import { finalWords } from '../src/screens/words.ts';

const titles=['Reading the news','Choosing a target','Time value'];
const controllers=[];
const ease='cubic-bezier(.16,1,.3,1)';
let duration=8000;
function createSlider(band) {
  const kind=band.classList.contains('reel')?'reel':band.classList.contains('conveyor')?'conveyor':'stack';
  const group=band.querySelector('.lesson-slides');
  const template=group.firstElementChild;
  const slides=finalWords.lessons.map((lesson,index)=>{
    const slide=index===0?template:template.cloneNode(true);
    slide.querySelector('.lesson-number').textContent=String(index+1).padStart(2,'0');
    slide.querySelector('h4').textContent=titles[index];slide.querySelector('p').textContent=lesson;
    slide.classList.toggle('is-current',index===0);slide.setAttribute('aria-hidden',String(index!==0));slide.setAttribute('aria-label',`Lesson ${index+1} of 3`);slide.setAttribute('aria-roledescription','slide');
    if(index!==0) group.append(slide);return slide;
  });
  const selectors=slides.map((_,index)=>{const button=document.createElement('button');button.textContent=String(index+1).padStart(2,'0');button.setAttribute('aria-label',`Show lesson ${index+1}: ${titles[index]}`);button.setAttribute('aria-pressed',String(index===0));band.querySelector('.lesson-select').append(button);button.addEventListener('click',()=>show(index,true));return button;});
  let current=0,paused=false,hover=false,focus=false,visible=false,remaining=duration,started=0,timer=null,motions=[];
  const progress=band.querySelector('.timer-track span').animate([{transform:'scaleX(0)'},{transform:'scaleX(1)'}],{duration,fill:'both'});progress.pause();
  function stop(){if(timer!==null){clearTimeout(timer);timer=null;remaining=Math.max(0,remaining-(performance.now()-started));}progress.pause();}
  function sync(){stop();const held=paused||hover||focus||!visible||document.hidden;
    band.querySelector('.reading-state').textContent=paused?'Paused':hover||focus?'Reading paused':`Auto · ${duration/1000}s`;
    if(held)return;started=performance.now();progress.play();timer=setTimeout(()=>{timer=null;show((current+1)%3,false);},remaining);
  }
  function show(index,manual){stop();motions.forEach(m=>m.cancel());motions=[];
    const old=slides[current],incoming=slides[index],direction=index===(current+2)%3?-1:1;
    slides.forEach((slide,i)=>{slide.classList.toggle('is-current',i===index);slide.setAttribute('aria-hidden',String(i!==index));});
    if(index!==current){
      let out,enter;
      if(kind==='reel'){out=`translateY(${-direction*28}px)`;enter=`translateY(${direction*36}px)`;}
      else if(kind==='conveyor'){out=`translateX(${-direction*65}%)`;enter=`translateX(${direction*65}%)`;}
      else {out='translateY(-28px) rotate(-3deg)';enter='translateY(10px) scale(.97)';}
      motions.push(old.animate([{visibility:'visible',opacity:1,transform:'none'},{visibility:'visible',opacity:0,transform:out}],{duration:240,easing:'ease-in'}));
      motions.push(incoming.animate([{opacity:0,transform:enter},{opacity:1,transform:'none'}],{duration:460,easing:ease}));
    }
    current=index;selectors.forEach((button,i)=>button.setAttribute('aria-pressed',String(i===current)));
    band.querySelector('.peek-title').textContent=titles[(current+1)%3];band.querySelector('.peek-number').textContent=String((current+1)%3+1).padStart(2,'0');
    remaining=duration;progress.currentTime=0;sync();
    if(manual)document.querySelector('.preview-status').textContent=`${kind==='reel'?'News reel':kind==='conveyor'?'Ticket conveyor':'Stacked slips'} · ${current+1} of 3. ${finalWords.lessons[current]}`;
  }
  band.querySelector('[data-action=previous]').addEventListener('click',()=>show((current+2)%3,true));
  band.querySelector('[data-action=next]').addEventListener('click',()=>show((current+1)%3,true));
  band.querySelector('[data-action=pause]').addEventListener('click',event=>{paused=!paused;event.currentTarget.textContent=paused?'Resume':'Pause';event.currentTarget.setAttribute('aria-label',paused?'Resume rotation':'Pause rotation');sync();});
  band.addEventListener('mouseenter',()=>{hover=true;sync();});band.addEventListener('mouseleave',()=>{hover=false;sync();});
  band.addEventListener('focusin',()=>{focus=true;sync();});band.addEventListener('focusout',event=>{if(!band.contains(event.relatedTarget)){focus=false;sync();}});
  const observer=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;sync();},{threshold:.25});observer.observe(band);
  const visibility=()=>sync();document.addEventListener('visibilitychange',visibility);
  return {speed(){stop();remaining=duration;progress.effect.updateTiming({duration});progress.currentTime=0;sync();},destroy(){stop();observer.disconnect();document.removeEventListener('visibilitychange',visibility);progress.cancel();motions.forEach(m=>m.cancel());}};
}
document.querySelectorAll('.lesson-band').forEach(band=>controllers.push(createSlider(band)));
document.getElementById('mobile').addEventListener('click',event=>{const on=document.body.classList.toggle('mobile-preview');event.currentTarget.setAttribute('aria-pressed',String(on));});
document.getElementById('speed').addEventListener('change',event=>{duration=Number(event.currentTarget.value);controllers.forEach(controller=>controller.speed());});
document.querySelectorAll('.sample-play').forEach(button=>button.addEventListener('click',()=>{document.querySelector('.preview-status').textContent='Preview only. The live Play again button starts a new game.';}));
window.addEventListener('pagehide',()=>controllers.forEach(controller=>controller.destroy()),{once:true});
