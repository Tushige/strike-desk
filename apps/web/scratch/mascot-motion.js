import '@fontsource-variable/lexend';
import '@fontsource-variable/unbounded';

const studies = [
  { id: 'ticker', title: 'LED ticker', duration: 12, description: 'A calm smile becomes dollar signs, then a pair of mint arrows travels up the display. Long pauses let the illustration breathe.', note: 'My pick for the landing page.', sequence: ['Smile · 4s', 'Dollars · 3s', 'Arrows · 3s', 'Rest · 2s'] },
  { id: 'arcade', title: 'Arcade eyes', duration: 10, description: 'The symbols roll into place like an arcade display. The dollar signs give one small pop before the arrows climb through.', note: 'More energy, with the same steady body.', sequence: ['Smile · 3s', 'Dollars · 3s', 'Arrows · 3s', 'Rest · 1s'] },
  { id: 'companion', title: 'Curious companion', duration: 14, description: 'A glance, a little wink, then the money daydream. A soft antenna light accompanies the rising arrows before RoboPup settles back.', note: 'The most character, with a longer rest.', sequence: ['Smile · 5s', 'Dollars · 3s', 'Arrows · 3s', 'Rest · 3s'] },
];

function eye(side) {
  const placement = side === 'left' ? 'translate(514 366) rotate(-14)' : 'translate(636 340) rotate(-14) scale(.79 .92)';
  return `<g transform="${placement}"><g class="eye ${side}">
    <g class="expression smile"><path d="M-32 12 C-28-26 23-30 32 12"/></g>
    <g class="expression dollars"><text x="0" y="26" text-anchor="middle">$</text></g>
    <g class="expression arrows"><g class="arrow-scroll"><path d="M0 29V-28M-23-5 0-28 23-5"/></g></g>
  </g></g>`;
}

document.getElementById('studies').innerHTML = studies.map(study => `
<section id="${study.id}" class="motion-study" style="--loop:${study.duration}s" data-expression="auto">
  <div class="study-copy"><h2>${study.title}</h2><p>${study.description}</p><p class="recommendation">${study.note}</p>
    <ol class="sequence" aria-label="${study.duration}-second loop">${study.sequence.map(step => `<li>${step}</li>`).join('')}</ol>
    <p class="duration">${study.duration}-second repeating loop</p>
    <div class="expressions" role="group" aria-label="${study.title} expression"><button data-expression="auto" aria-pressed="true">Auto</button><button data-expression="smile" aria-pressed="false">Smile</button><button data-expression="dollars" aria-pressed="false">Dollars</button><button data-expression="arrows" aria-pressed="false">Arrows</button></div>
  </div>
  <div class="preview"><figure class="motion-scene" role="img" aria-label="${study.title}: purple RoboPup beside the market bell, with animated LED eyes">
    <img src="./assets/robopup-blank-display.png" width="1254" height="1254" alt="" ${study.id !== 'ticker' ? 'loading="lazy"' : ''}>
    <svg class="led-overlay" viewBox="0 0 1254 1254" aria-hidden="true"><defs><clipPath id="eyes-${study.id}"><path d="M452 336 667 282 676 365 459 423Z"/></clipPath><radialGradient id="light-${study.id}"><stop stop-color="#fff2ac" stop-opacity=".75"/><stop offset="1" stop-color="#ffd447" stop-opacity="0"/></radialGradient></defs>
      <g clip-path="url(#eyes-${study.id})">${eye('left')}${eye('right')}</g>
      <g class="antenna-light" fill="url(#light-${study.id})"><circle cx="338" cy="160" r="45"/><circle cx="649" cy="120" r="43"/></g>
    </svg>
  </figure><div class="preview-caption"><span>RoboPup / ${study.title}</span><span class="playback-label">Playing</span></div></div>
</section>`).join('');

const sections = [...document.querySelectorAll('.motion-study')];
let paused = false;
const visible = new Set(sections);
function syncPlayback() {
  for (const section of sections) {
    const shouldPause = paused || document.hidden || !visible.has(section);
    section.classList.toggle('is-paused', shouldPause);
    section.querySelector('.playback-label').textContent = section.dataset.expression !== 'auto' ? 'Expression preview' : shouldPause ? 'Paused' : 'Playing';
  }
}
const observer = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (entry.isIntersecting) visible.add(entry.target); else visible.delete(entry.target);
  }
  syncPlayback();
}, { threshold: .1 });
sections.forEach(section => observer.observe(section));
document.addEventListener('visibilitychange', syncPlayback);
document.getElementById('pause').addEventListener('click', event => {
  paused = !paused;
  event.currentTarget.setAttribute('aria-pressed', String(paused));
  event.currentTarget.textContent = paused ? 'Resume all' : 'Pause all';
  syncPlayback();
});
document.getElementById('replay').addEventListener('click', () => {
  for (const section of sections) {
    section.dataset.expression = 'auto';
    for (const button of section.querySelectorAll('[data-expression]')) button.setAttribute('aria-pressed', String(button.dataset.expression === 'auto'));
    for (const animation of section.getAnimations({ subtree: true })) animation.currentTime = 0;
  }
  syncPlayback();
});
document.getElementById('mobile').addEventListener('click', event => {
  const on = document.body.classList.toggle('mobile-preview');
  event.currentTarget.setAttribute('aria-pressed', String(on));
});
for (const section of sections) {
  section.querySelector('.expressions').addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    section.dataset.expression = button.dataset.expression;
    for (const choice of section.querySelectorAll('[data-expression]')) choice.setAttribute('aria-pressed', String(choice === button));
    for (const animation of section.getAnimations({ subtree: true })) animation.currentTime = 0;
    syncPlayback();
  });
}
