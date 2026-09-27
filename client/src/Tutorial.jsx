import { useEffect, useRef, useState } from 'react';
import { RadioBubble } from './Radio';
import { onUi } from './uiBus';

// A scripted first hunt guided by Dispatch (spoken aloud). There's no Next
// button: each step finishes itself the moment you do what it asks, watching
// both the game state (asked, boarded, rode, confirmed, caught) and the UI
// (looked around, opened the phone). The control you need glows, with an arrow.
//
// `target` returns data-tut keys to highlight — the first one on screen gets
// the arrow, so a step can walk you through several screens (phone → app → chip).
const phoneThen = (u, app, chip) => (!u.phoneOpen ? ['phone'] : u.app !== app ? ['app-' + app] : [chip]);

function steps(state, network) {
  const T = state.tutorialTarget;
  const tName = network?.stations?.[T]?.name || 'the next station';
  const bus = network?.vehicle === 'bus';
  const ride = bus ? 'bus' : 'train';
  return [
    { text: "Dispatch here — welcome aboard, rookie. You're standing at a real station in Street View. Drag the picture to look around.",
      done: (s, u) => u.looked },
    { text: 'Good. Everything runs through your field phone. Tap the glowing Phone button.',
      target: () => ['phone'], done: (s, u) => u.phoneOpen },
    { text: "Open Texts — that's how you question the hider, and they can't lie. Send a Radar 2km and see what they say.",
      target: (s, u) => phoneThen(u, 'texts', 'chip-radar2'),
      done: (s) => (s.feed || []).some((f) => f.kind === 'question') },
    { text: `Intel's in. Word is our target is holed up near ${tName}. You'll have to take the ${ride} there. Put the phone away and tap the glowing stop to board.`,
      target: (s, u) => (u.phoneOpen ? ['phone-close'] : ['board']),
      done: (s, u) => u.busScene || !!s.aboard },
    { text: bus ? 'Here comes a bus. Hop on.' : `Pick a platform with a line that runs to ${tName}, then board when it pulls in.`,
      target: (s, u) => (u.phoneOpen ? ['phone-close'] : ['board-line', 'platform', 'board']),
      done: (s) => !!s.aboard },
    { text: `You're rolling. Tell the driver your stop — get off at ${tName}.`,
      alt: (s) => !s.aboard && s.seekerStation !== T
        ? `Wrong stop — no matter. Board again and ride to ${tName}.` : null,
      target: (s, u) => (s.aboard ? [`stop-${T}`] : u.phoneOpen ? ['phone-close'] : ['board-line', 'platform', 'board']),
      done: (s) => s.seekerStation === T && !s.aboard },
    { text: `You're at ${tName}. Open Texts and ask “Your home station?” — a YES means this is where they're hiding.`,
      target: (s, u) => phoneThen(u, 'texts', 'chip-right'),
      done: (s) => !!s.stationConfirmed },
    { text: "Confirmed — you've found their station! Put the phone away. They're right around here: tap the little map to walk, then hit Drop pin to make the catch.",
      target: (s, u) => (u.phoneOpen ? ['phone-close'] : ['drop']),
      done: (s) => s.phase === 'ended' },
    { text: "That's a catch — nicely done. Ride, question, close in, tag: you've got the whole loop. Good hunting out there.",
      finish: true },
  ];
}

export default function Tutorial({ state, network, onFinish }) {
  const [step, setStep] = useState(0);
  const [ui, setUi] = useState({ looked: false, phoneOpen: false, app: 'home', busScene: false });
  const [arrow, setArrow] = useState(null);
  const glowRef = useRef([]);
  const scrolledRef = useRef(null);

  useEffect(() => onUi((type, d) => {
    if (type === 'look') setUi((u) => (u.looked ? u : { ...u, looked: true }));
    if (type === 'screen') setUi((u) => ({ ...u, ...d }));
  }), []);

  const STEPS = steps(state, network);

  // jump to just past the furthest milestone already reached, so doing things
  // ahead of the prompt (or out of order) never leaves you stuck on a step
  useEffect(() => {
    let target = step;
    for (let i = step; i < STEPS.length; i++) {
      if (STEPS[i].done && STEPS[i].done(state, ui)) target = i + 1;
    }
    target = Math.min(target, STEPS.length - 1);
    if (target > step) setStep(target);
  }, [state.feed?.length, state.stationConfirmed, state.phase, state.aboard, state.seekerStation, ui]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = STEPS[step];
  const keys = s.target ? s.target(state, ui) : [];
  const keyStr = keys.join('|');

  // glow the target controls and park a bouncing arrow on the first visible one
  useEffect(() => {
    const clear = () => { glowRef.current.forEach((el) => el.classList.remove('tut-glow')); glowRef.current = []; };
    const tick = () => {
      clear();
      let first = null;
      for (const k of keys) {
        const els = [...document.querySelectorAll(`[data-tut="${k}"]`)]
          .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
        if (!els.length) continue;
        els.forEach((el) => el.classList.add('tut-glow'));
        glowRef.current.push(...els);
        if (!first) first = els[0];
        break; // only the first screen's targets — later keys are fallbacks
      }
      if (!first) { setArrow(null); return; }
      // bring a target that's scrolled out of its panel into view (once)
      if (scrolledRef.current !== first) { scrolledRef.current = first; first.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
      const r = first.getBoundingClientRect();
      const below = r.top < 90; // no room above — point up from underneath
      setArrow({ x: r.left + r.width / 2, y: below ? r.bottom + 6 : r.top - 6, below });
    };
    tick();
    const id = setInterval(tick, 300);
    return () => { clearInterval(id); clear(); };
  }, [step, keyStr]); // eslint-disable-line react-hooks/exhaustive-deps

  const text = (s.alt && s.alt(state)) || s.text;
  return (
    <div className="tutorial-layer">
      <div className="tutorial-dispatch">
        <div className="tut-progress">Tutorial · {step + 1}/{STEPS.length}</div>
        <RadioBubble
          portrait="📻" name="Dispatch" text={text} voice="dispatch"
          onNext={s.finish ? onFinish : null}
          nextLabel="Finish ▸"
          onSkip={s.finish ? null : onFinish}
        />
      </div>
      {arrow && (
        <div className={`tut-arrow ${arrow.below ? 'below' : ''}`} style={{ left: arrow.x, top: arrow.y }}>
          {arrow.below ? '▲' : '▼'}
        </div>
      )}
    </div>
  );
}
