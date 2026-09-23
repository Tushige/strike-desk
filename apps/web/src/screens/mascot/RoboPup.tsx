import { useEffect, useRef, useState } from 'react';
import poses from '../../assets/mascot/robopup-poses.png';
import './robopup.css';

type Pose = 'stamp' | 'bell' | 'receipt';
const ease = 'cubic-bezier(.16,1,.3,1)';

/** Decorative feedback only. Callers supply confirmed state; money and status stay in text. */
export function RoboPup({ pose, active = true }: { pose: Pose; active?: boolean }) {
  const root = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!ready || !active || document.visibilityState === 'hidden') return;
    const art = root.current?.querySelector('.robopup-art');
    if (!art?.animate) return;
    const motions: Animation[] = [];
    if (pose === 'stamp') {
      motions.push(art.animate([{ transform: 'none' }, { transform: 'translateY(4px) rotate(-5deg)', offset: .38 }, { transform: 'none' }], { duration: 550, easing: ease }));
      const stamp = root.current?.querySelector('.robopup-filed');
      if (stamp) motions.push(stamp.animate([{ opacity: 0, transform: 'rotate(-9deg) scale(1.3)' }, { opacity: 1, transform: 'rotate(-9deg) scale(1)' }], { duration: 240, delay: 180, fill: 'backwards', easing: ease }));
    } else if (pose === 'bell') {
      motions.push(art.animate([{ transform: 'none' }, { transform: 'rotate(4deg) translateY(3px)', offset: .3 }, { transform: 'rotate(-2deg)', offset: .6 }, { transform: 'none' }], { duration: 650, easing: ease }));
      root.current?.querySelectorAll('.robopup-ring').forEach((ring, index) => {
        motions.push(ring.animate([{ opacity: .7, transform: 'scale(.5)' }, { opacity: 0, transform: 'scale(2.3)' }], { duration: 550, delay: 150 + index * 90, easing: 'ease-out' }));
      });
    } else {
      motions.push(art.animate([{ opacity: 0, transform: 'translateY(8px) rotate(3deg)' }, { opacity: 1, transform: 'none' }], { duration: 650, easing: ease }));
    }
    return () => { motions.forEach(motion => { motion.cancel(); }); };
  }, [ready, active, pose]);

  return <span ref={root} className={`robopup robopup-${pose}`} aria-hidden="true">
    <span className="robopup-art"><img src={poses} alt="" draggable={false} onLoad={() => { setReady(true); }} /></span>
    {pose === 'stamp' && active && <span className="robopup-filed">FILED</span>}
    {pose === 'bell' && <><span className="robopup-ring" /><span className="robopup-ring" /></>}
  </span>;
}
