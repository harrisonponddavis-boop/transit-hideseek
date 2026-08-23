import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps } from './maps-loader';
import { isPointPossible } from './solver';
import { streetViewUrl } from './socket';

// Interactive Street View for the endgame. Walking in here moves the seeker
// (option A): "Drop pin here" walks to the spot and guesses; "Done" walks
// there and closes. A live warning fires if you wander into a ruled-out area,
// and the hider's photo can sit beside the view for comparison.
export default function StreetViewPanel({ embedKey, center, photo, network, feed, zoneR, onClose, onGuess, onDone }) {
  const elRef = useRef(null);
  const panoRef = useRef(null);
  const [pos, setPos] = useState(center);
  const [error, setError] = useState(false);
  const [showPhoto, setShowPhoto] = useState(!!photo);

  useEffect(() => {
    let cancelled = false;
    window.gm_authFailure = () => { if (!cancelled) setError(true); };
    loadGoogleMaps(embedKey).then((maps) => {
      if (cancelled || !elRef.current) return;
      const pano = new maps.StreetViewPanorama(elRef.current, {
        position: { lat: center.lat, lng: center.lng },
        pov: { heading: 0, pitch: 0 },
        addressControl: false, fullscreenControl: false, motionTracking: false,
        enableCloseButton: false,
      });
      panoRef.current = pano;
      pano.addListener('position_changed', () => {
        const p = pano.getPosition();
        if (p) setPos({ lat: p.lat(), lng: p.lng() });
      });
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [embedKey, center.lat, center.lng]);

  const possible = network ? isPointPossible(network, feed, zoneR, pos) : true;

  if (error) {
    return (
      <div className="sv-overlay">
        <div className="sv-frame">
          <div className="sv-bar">
            <span>In-app Street View needs the Maps JavaScript API enabled on your key.</span>
            <button className="small" onClick={onClose}>Close ✕</button>
          </div>
          <div className="sv-fallback">
            <a className="upload-btn" href={streetViewUrl(center.lat, center.lng)} target="_blank" rel="noreferrer">
              Open Street View in a new tab ↗
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sv-overlay">
      <div className="sv-frame">
        <div className="sv-bar">
          <span>Street View — walk to find the hider, then drop your pin</span>
          <div className="sv-actions">
            {photo && (
              <button className="small ghost" onClick={() => setShowPhoto((v) => !v)}>
                {showPhoto ? 'Hide photo' : 'Show photo'}
              </button>
            )}
            <button className="small" onClick={() => onGuess(pos)}>Drop pin here</button>
            <button className="small ghost" onClick={() => onDone(pos)}>Done (walk here)</button>
            <button className="small ghost" onClick={onClose}>Cancel</button>
          </div>
        </div>
        <div className="sv-body">
          <div className="sv-pano-wrap">
            <div ref={elRef} className="sv-pano" />
            {!possible && (
              <div className="sv-warning">⚠ Your answers have ruled out this area — the hider can’t be here</div>
            )}
          </div>
          {showPhoto && photo && (
            <div className="sv-photo">
              <div className="sv-photo-label">Hider’s photo</div>
              <img src={photo} alt="hider's street view" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
