import '@fontsource-variable/lexend';
import '@fontsource-variable/unbounded';
import { rankFor, finalWords } from '../src/screens/words.ts';
import { money, signedMoney } from '../src/screens/format.ts';

// All amounts below are deliberately fictional scratch data, expressed in dollars.
const scenarios = {
  profit: { changes:[-120000,280000,0,390000,193000], costs:[200000,300000,0,350000,400000] },
  loss: { changes:[-200000,75000,-160000,0,-120000], costs:[200000,180000,200000,0,160000] },
  flat: { changes:[0,0,0,0,0], costs:[0,0,0,0,0] },
  big: { changes:[-100000,500000,200000,1400000,600000], costs:[200000,400000,350000,750000,1000000] },
};
const companies = ['RoboPup UP','Fizzly DOWN','JetKicks UP','MoonMunch UP','PixelPals DOWN'];
const designs = [
  { id:'receipt', title:'Closing receipt', description:'A keepsake from the desk. A perforated split connects the final result to the five trades that made it.' },
  { id:'journal', title:'Trading journal', description:'Calm and useful. Scan the daily ledger, then inspect what you paid and what came back.' },
  { id:'journey', title:'Balance journey', description:'Show the shape of the run. A chart connects your actual end-of-day balances, with each day available below.' },
  { id:'scorecard', title:'Arcade scorecard', description:'The most playful finish. Give the rank room, then revisit the run through the ticket strip you chose.' },
];
let scenario = 'profit';
const selected = { receipt:3, journal:3, journey:3, scorecard:3 };
const currency = dollars => money(dollars*100);
const signed = dollars => dollars === 0 ? '$0' : signedMoney(dollars*100);
const tone = amount => amount > 0 ? 'positive' : amount < 0 ? 'negative' : 'neutral';
const short = dollars => dollars === 0 ? '$0' : `${dollars < 0 ? '−' : '+'}$${Math.abs(dollars)>=1000000 ? `${Math.abs(dollars)/1000000}M` : `${Math.abs(dollars)/1000}K`}`;
function run(){const sample=scenarios[scenario];const change=sample.changes.reduce((a,b)=>a+b,0);return {...sample,change,total:1000000+change,rank:rankFor((1000000+change)*100)};}
function balance(data){return `<div class="balance-block"><span class="caption balance-label">You finished with</span><div class="balance amount">${currency(data.total)}</div><p class="delta ${tone(data.change)}">${signed(data.change)} <span class="caption">${data.change===0?'change':'overall'}</span></p></div>`;}
function verdict(data){return `<h3 class="rank">${data.rank.title}</h3><p class="rank-blurb">${data.rank.blurb}</p>`;}
function footer(){return `<div class="footer-row"><button class="primary" data-preview-action>Play again</button><div class="market-code">Market number <strong>DEMO-ONLY</strong><br />A sample code for this design preview.</div></div><p class="preview-message" role="status"></p>`;}
function lessons(){return `<details class="lessons"><summary>Three things the desk taught you</summary><ul>${finalWords.lessons.map(text=>`<li>${text}</li>`).join('')}</ul></details>`;}
function rows(id,data){return `<div class="day-rows" role="group" aria-label="${id} day selection">${data.changes.map((change,i)=>`<button class="day-row" data-day="${i}" aria-pressed="${selected[id]===i}" aria-label="Review day ${i+1}, ${signed(change)}"><span>Day ${i+1}</span><span class="company">${data.costs[i]===0?'Sat out':companies[i]}</span><strong class="amount ${tone(change)}">${signed(change)}</strong></button>`).join('')}</div>`;}
function detail(id,data){const index=selected[id], cost=data.costs[index], change=data.changes[index]; return `<section class="trade-detail" aria-label="Selected day review"><h4>Day ${index+1} · ${cost===0?'No trade':companies[index]}</h4>${cost===0?'<p>You sat out. Trading result: $0.</p>':`<dl><div><dt>Cost / max loss</dt><dd class="amount">${currency(cost)}</dd></div><div><dt>Money returned</dt><dd class="amount">${currency(cost+change)}</dd></div><div><dt>Profit / loss</dt><dd class="amount ${tone(change)}">${signed(change)}</dd></div></dl>`}</section>`;}
function chart(data){let balance=1000000; const balances=[balance,...data.changes.map(change=>(balance+=change))]; const low=Math.min(...balances), high=Math.max(...balances); const pad=Math.max(100000,(high-low)*.15); const floor=low-pad, range=high-low+2*pad; const x=i=>20+i*152, y=value=>140-(value-floor)/range*120; return `<div class="chart-caption"><span>Start ${currency(1000000)}</span><span>End ${currency(data.total)}</span></div><svg viewBox="0 0 800 160" preserveAspectRatio="none" role="img" aria-label="End-of-day balance: ${balances.map((value,i)=>`${i===0?'Start':`day ${i}`}, ${currency(value)}`).join('; ')}"><line class="journey-baseline" x1="20" x2="780" y1="${y(1000000)}" y2="${y(1000000)}" /><polyline class="journey-path" vector-effect="non-scaling-stroke" points="${balances.map((value,i)=>`${x(i)},${y(value)}`).join(' ')}" />${balances.map((value,i)=>`<circle class="journey-point ${i===selected.journey+1?'selected':''}" cx="${x(i)}" cy="${y(value)}" r="4" vector-effect="non-scaling-stroke" />`).join('')}</svg>`;}
function content(id,data){
  if(id==='receipt')return `<div class="preview-header"><strong>Pupside</strong><span>Five days · Final bell</span></div><div class="receipt-body"><div class="receipt-verdict">${verdict(data)}${balance(data)}<div class="starting"><span class="caption">Starting money</span><span class="amount">$1,000,000</span></div></div><div class="receipt-ledger"><h4>Your five days</h4>${rows(id,data)}${detail(id,data)}</div></div>${lessons()}${footer()}`;
  if(id==='journal')return `<div class="journal-top"><div>${verdict(data)}</div>${balance(data)}</div><div class="journal-body">${rows(id,data)}${detail(id,data)}</div>${lessons()}${footer()}`;
  if(id==='journey')return `<div class="journey-top"><div>${verdict(data)}</div>${balance(data)}</div><div class="journey-chart">${chart(data)}<div class="journey-days" role="group" aria-label="Daily results">${data.changes.map((value,i)=>`<button data-day="${i}" aria-pressed="${selected[id]===i}"><span>Day ${i+1}</span><span class="amount ${tone(value)}">${short(value)}</span></button>`).join('')}</div></div>${detail(id,data)}${lessons()}${footer()}`;
  return `<div class="preview-header"><strong>Pupside</strong><span>All 5 days done</span></div><div class="scorecard-top">${verdict(data)}${balance(data)}</div><div class="scorecard-ticket-row" role="group" aria-label="Review your five tickets">${data.changes.map((value,i)=>`<button class="score-ticket" data-day="${i}" aria-pressed="${selected[id]===i}"><span class="day">Day ${i+1}</span><span class="amount ${tone(value)}">${short(value)}</span></button>`).join('')}</div>${detail(id,data)}${lessons()}${footer()}`;
}
function entrances(){document.querySelectorAll('.scene').forEach((scene,index)=>{const focal=scene.querySelector(index===2?'.journey-chart':index===0?'.receipt-verdict':'.rank');focal.animate(index===0?[{opacity:.4,transform:'translateY(-8px) rotate(-1deg)'},{opacity:1,transform:'none'}]:[{opacity:.45,transform:'translateY(8px)'},{opacity:1,transform:'none'}],{duration:index===0?500:380,easing:'cubic-bezier(.16,1,.3,1)'});});}
function render(){const data=run();document.querySelector('#studies').innerHTML=designs.map(design=>`<section class="study" id="${design.id}"><div class="study-heading"><h2>${design.title}</h2><p>${design.description}</p></div><div class="preview"><div class="scene ${design.id}" data-design="${design.id}">${content(design.id,data)}</div></div></section>`).join('');}
document.querySelector('#scenario').addEventListener('change',event=>{scenario=event.target.value;render();entrances();});
document.querySelector('#mobile').addEventListener('click',event=>{const enabled=document.querySelector('.workbench').classList.toggle('mobile-preview');event.currentTarget.setAttribute('aria-pressed',String(enabled));});
document.querySelector('#motion').addEventListener('click',entrances);
document.querySelector('#studies').addEventListener('click',event=>{
  const action=event.target.closest('[data-preview-action]'); if(action){action.closest('.scene').querySelector('.preview-message').textContent='Preview only. In the game, this starts a new five-day run.';return;}
  const button=event.target.closest('[data-day]');if(!button)return;const scene=button.closest('[data-design]');const id=scene.dataset.design;selected[id]=Number(button.dataset.day);
  scene.querySelectorAll('[data-day]').forEach(one=>one.setAttribute('aria-pressed',String(Number(one.dataset.day)===selected[id])));
  const old=scene.querySelector('.trade-detail');old.outerHTML=detail(id,run());scene.querySelector('.trade-detail').animate([{opacity:.4},{opacity:1}],{duration:180});
  if(id==='journey')scene.querySelectorAll('.journey-point').forEach((point,i)=>point.classList.toggle('selected',i===selected[id]+1));
});
render();
