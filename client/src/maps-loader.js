// Load the Google Maps JS API once, on demand. Returns google.maps.
let promise = null;

export function loadGoogleMaps(key) {
  // Need StreetViewPanorama specifically available, not just the namespace
  if (window.google?.maps?.StreetViewPanorama) return Promise.resolve(window.google.maps);
  if (promise) return promise;
  promise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    // classic (non-async) load so the global constructors exist on onload
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&v=weekly`;
    s.async = true;
    s.onload = () => {
      if (window.google?.maps?.StreetViewPanorama) resolve(window.google.maps);
      else { promise = null; reject(new Error('maps-unavailable')); }
    };
    s.onerror = () => { promise = null; reject(new Error('maps-load-failed')); };
    document.head.appendChild(s);
  });
  return promise;
}
