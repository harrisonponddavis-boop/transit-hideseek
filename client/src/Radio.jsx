import { useEffect, useState } from 'react';
import { speak, stopSpeaking, isVoiceOn, setVoiceOn } from './voice';

// 🔊 / 🔇 toggle for the spoken voices (shared everywhere via localStorage).
export function VoiceToggle({ className = '' }) {
  const [on, setOn] = useState(isVoiceOn);
  useEffect(() => {
    const sync = () => setOn(isVoiceOn());
    window.addEventListener('ths-voice', sync);
    return () => window.removeEventListener('ths-voice', sync);
  }, []);
  return (
    <button className={`voice-toggle ${className}`} title={on ? 'Mute voices' : 'Turn voices on'}
      onClick={(e) => { e.stopPropagation(); setVoiceOn(!on); }}>
      {on ? '🔊' : '🔇'}
    </button>
  );
}

// A character speaking to you from the side of the screen — used for the
// tutorial's dispatcher and for story-mode handlers chiming in mid-hunt.
// The line is read aloud in that character's voice (`voice` = cast key).
export function RadioBubble({ portrait, name, text, tone, voice, onNext, nextLabel, onSkip, children }) {
  useEffect(() => {
    if (text) speak(text, voice || (tone === 'spy' ? 'spy' : tone === 'grounded' ? 'grounded' : 'dispatch'));
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => stopSpeaking(), []);
  return (
    <div className={`radio ${tone || ''}`}>
      <div className="radio-portrait">{portrait}</div>
      <div className="radio-body">
        <div className="radio-name">{name}<VoiceToggle /></div>
        <div className="radio-text">{text}</div>
        {children}
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
