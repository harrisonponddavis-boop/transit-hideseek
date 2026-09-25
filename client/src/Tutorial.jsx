import { useEffect, useState } from 'react';
import { RadioBubble } from './Radio';

// A scripted first hunt guided by Dispatch. Steps advance automatically off
// real game progress where we can see it (a question asked, the station
// confirmed, the catch made), with a Next button as a fallback for the
// look-around / open-the-phone steps we can't observe from server state.
const STEPS = [
  { text: "Dispatch here — welcome aboard. You're standing at a real station in Street View. Drag anywhere to look around, then tap Next." },
  { text: "Everything runs through your field phone. Tap the 📱 Phone button, bottom-right, to open it — then tap Next." },
  { text: "Open TEXTS — that's how you question the hider, and they can't lie. Ask a Radar now and watch it grey out part of the map.",
    done: (s) => (s.feed || []).some((f) => f.kind === 'question') },
  { text: "Every answer narrows the search. Now ask “Your home station?” — a YES means you're standing at the hider's station.",
    done: (s) => !!s.stationConfirmed },
  { text: "Confirmed! You've found their station, so you've dropped into the endgame. Close the phone to get back to the street." },
  { text: "Your target is hiding right here. Tap 📍 Drop Pin to make the catch.",
    done: (s) => s.phase === 'ended' },
  { text: "That's a catch — nicely done. You've got the whole loop now: ride, question, close in, tag. Good hunting out there.",
    finish: true },
];

export default function Tutorial({ state, onFinish }) {
  const [step, setStep] = useState(0);

  // Advance to just past the furthest milestone the player has already reached,
  // so doing things out of order (or ahead of the prompt) never gets you stuck.
  useEffect(() => {
    let target = step;
    for (let i = 0; i < STEPS.length; i++) {
      if (STEPS[i].done && STEPS[i].done(state)) target = Math.max(target, i + 1);
    }
    target = Math.min(target, STEPS.length - 1);
    if (target > step) setStep(target);
  }, [state.feed?.length, state.stationConfirmed, state.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = STEPS[step];
  return (
    <div className="tutorial-layer">
      <div className="tutorial-dispatch">
        <div className="tut-progress">Tutorial · {step + 1}/{STEPS.length}</div>
        <RadioBubble
          portrait="📻" name="Dispatch" text={s.text}
          onNext={s.finish ? onFinish : () => setStep((n) => Math.min(n + 1, STEPS.length - 1))}
          nextLabel={s.finish ? 'Finish ▸' : 'Next ▸'}
          onSkip={s.finish ? null : onFinish}
        />
      </div>
    </div>
  );
}
