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
  const hasQ = (s, pred) => (s.feed || []).some((f) => f.kind === 'question' && pred(f));

  const list = [
    { text: "Dispatch here — welcome aboard, rookie. Somewhere out there one person is hiding within 500 metres of a station. Your whole job is to work out which station, get there, and tag them. First, drag the picture to look around — you're really standing here.",
      done: (s, u) => u.looked },
    { text: 'Good eyes. Everything you do runs through your field phone. Tap the glowing Phone button to open it.',
      target: () => ['phone'], done: (s, u) => u.phoneOpen },
    { text: "Open Maps. Every glowing circle is a place the hider could still be — that's your search area. We're going to shrink it down to one spot.",
      target: (s, u) => (!u.phoneOpen ? ['phone'] : ['app-maps']),
      done: (s, u) => u.app === 'maps' },
    { text: "Here's the trick: you buy facts with coins, and you earn coins by riding and walking. Start cheap and wide. Open Texts and send a Radar 5km — one question that splits the whole map in half.",
      target: (s, u) => phoneThen(u, 'texts', 'chip-radar5'),
      done: (s) => hasQ(s, (f) => f.type === 'radar') },
    { text: "See that — a whole half of the map just greyed out. The hider can't be there anymore. Now get a direction: ask Compass N/S. Stack answers on top of each other and the possible area keeps shrinking.",
      target: (s, u) => phoneThen(u, 'texts', 'chip-cns'),
      done: (s) => hasQ(s, (f) => f.type === 'compass') },
    { text: `That's the real game — deduce, don't guess. Your answers now lean one way: toward ${tName}. Before you set off, start the Thermometer. It remembers where you're standing so you can tell if you're getting closer.`,
      target: (s, u) => phoneThen(u, 'texts', 'chip-thermo-start'),
      done: (s) => !!s.thermoStart },
    { text: `Now go to them. Put the phone away and tap the glowing stop to catch the ${ride} toward ${tName}.`,
      target: (s, u) => (u.phoneOpen ? ['phone-close'] : ['board']),
      done: (s, u) => u.busScene || !!s.aboard },
    { text: bus ? 'Here comes your bus — hop on.' : `Pick a platform whose line runs to ${tName}, then board when it pulls in.`,
      target: (s, u) => (u.phoneOpen ? ['phone-close'] : ['board-line', 'platform', 'board']),
      done: (s) => !!s.aboard },
    { text: `Rolling — and riding is paying you coins as you go. Tell the driver your stop: get off at ${tName}.`,
      alt: (s) => !s.aboard && s.seekerStation !== T ? `Not quite — board again and ride to ${tName}.` : null,
      target: (s, u) => (s.aboard ? [`stop-${T}`] : u.phoneOpen ? ['phone-close'] : ['board-line', 'platform', 'board']),
      done: (s) => s.seekerStation === T && !s.aboard },
    { text: "You made it. Now read that Thermometer — WARMER means you closed the distance, and it greys out the entire colder half of the map. Open Texts and read it.",
      target: (s, u) => phoneThen(u, 'texts', 'chip-thermo-read'),
      done: (s) => hasQ(s, (f) => f.type === 'thermometer') },
    { text: "Warmer — you're on the money. Lock it in: ask “Your home station?”. A YES means they're hiding within 500m of right where you're standing.",
      target: (s, u) => phoneThen(u, 'texts', 'chip-right'),
      done: (s) => !!s.stationConfirmed },
    { text: "Confirmed — this is the endgame, and there's no more map-wide help: you hunt on foot now. Put the phone away, tap the little map to walk toward their exact spot, then hit Drop pin. Get in range and they're yours.",
      target: (s, u) => (u.phoneOpen ? ['phone-close'] : ['eg-map', 'drop']),
      done: (s) => s.phase === 'ended' },
    { text: "That's a catch — textbook. Here's the whole game in one breath: ask cheap questions to shrink the map, ride to the area, confirm the station, then close in on foot and pin them. That's everything there is. You're ready — go hunt, and bring a friend.",
      finish: true },
  ];

  // Teach the one Photo right before confirming, when the server has it enabled.
  if (state.photoAvailable) {
    const i = list.findIndex((st) => st.text.startsWith('Warmer'));
    list.splice(i, 0, {
      text: "One last tool before you commit: your single Photo. Ask for it in Texts — it's a real Street View picture of the hider's exact spot. Study it; in a moment it's the clue that lands your pin.",
      target: (s, u) => phoneThen(u, 'texts', 'chip-photo'),
      done: (s) => !!s.photoUsed,
    });
  }
  return list;
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
