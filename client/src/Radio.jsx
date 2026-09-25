import { useEffect, useState } from 'react';

// A character speaking to you from the side of the screen — used for the
// tutorial's dispatcher and for story-mode handlers chiming in mid-hunt.
export function RadioBubble({ portrait, name, text, tone, onNext, nextLabel, onSkip }) {
  return (
    <div className={`radio ${tone || ''}`}>
      <div className="radio-portrait">{portrait}</div>
      <div className="radio-body">
        <div className="radio-name">{name}</div>
        <div className="radio-text">{text}</div>
        {(onNext || onSkip) && (
          <div className="radio-actions">
            {onSkip && <button className="ghost small" onClick={onSkip}>Skip</button>}
            {onNext && <button className="small" onClick={onNext}>{nextLabel || 'Next ▸'}</button>}
          </div>
        )}
      </div>
    </div>
  );
}

// A transient radio line that fades itself out after a few seconds. Keyed by
// `id` so a new message replaces the old one and restarts the timer.
export function RadioFlash({ id, portrait, name, text, tone, seconds = 6 }) {
  const [shown, setShown] = useState(true);
  useEffect(() => {
    setShown(true);
    const t = setTimeout(() => setShown(false), seconds * 1000);
    return () => clearTimeout(t);
  }, [id, seconds]);
  if (!shown || !text) return null;
  return (
    <div className="radio-flash">
      <RadioBubble portrait={portrait} name={name} text={text} tone={tone} />
    </div>
  );
}
