// Tokyo — the JR Yamanote loop plus a few crossing lines (hand-curated, like
// the others). Shared interchange stations keep the graph connected; the
// Yamanote line closes back on itself as a loop.
// Coordinates are approximate; good enough for gameplay, not navigation.

module.exports = {
  id: 'tokyo',
  name: 'Tokyo',
  center: [35.685, 139.740],
  zoom: 12,
  startStation: 'TOKYO',
  stations: {
    // Yamanote loop
    TOKYO:    { id: 'TOKYO',    name: 'Tokyo',         lat: 35.6812, lng: 139.7671 },
    KANDA:    { id: 'KANDA',    name: 'Kanda',         lat: 35.6918, lng: 139.7710 },
    AKIHABARA:{ id: 'AKIHABARA',name: 'Akihabara',     lat: 35.6984, lng: 139.7731 },
    UENO:     { id: 'UENO',     name: 'Ueno',          lat: 35.7141, lng: 139.7774 },
    NIPPORI:  { id: 'NIPPORI',  name: 'Nippori',       lat: 35.7279, lng: 139.7707 },
    IKEBUKURO:{ id: 'IKEBUKURO',name: 'Ikebukuro',     lat: 35.7295, lng: 139.7109 },
    SHINJUKU: { id: 'SHINJUKU', name: 'Shinjuku',      lat: 35.6896, lng: 139.7006 },
    HARAJUKU: { id: 'HARAJUKU', name: 'Harajuku',      lat: 35.6702, lng: 139.7027 },
    SHIBUYA:  { id: 'SHIBUYA',  name: 'Shibuya',       lat: 35.6580, lng: 139.7016 },
    SHINAGAWA:{ id: 'SHINAGAWA',name: 'Shinagawa',     lat: 35.6285, lng: 139.7387 },
    HAMAMATSU:{ id: 'HAMAMATSU',name: 'Hamamatsuchō',  lat: 35.6553, lng: 139.7570 },
    SHIMBASHI:{ id: 'SHIMBASHI',name: 'Shimbashi',     lat: 35.6665, lng: 139.7583 },
    // Chuo line (cuts across the loop, then west)
    OCHANOMIZU:{ id: 'OCHANOMIZU',name: 'Ochanomizu',  lat: 35.6993, lng: 139.7649 },
    YOTSUYA:  { id: 'YOTSUYA',  name: 'Yotsuya',       lat: 35.6862, lng: 139.7305 },
    NAKANO:   { id: 'NAKANO',   name: 'Nakano',        lat: 35.7056, lng: 139.6657 },
    KICHIJOJI:{ id: 'KICHIJOJI',name: 'Kichijōji',     lat: 35.7030, lng: 139.5800 },
    // Ginza metro line (Asakusa ↔ Shibuya)
    ASAKUSA:  { id: 'ASAKUSA',  name: 'Asakusa',       lat: 35.7148, lng: 139.7967 },
    GINZA:    { id: 'GINZA',    name: 'Ginza',         lat: 35.6717, lng: 139.7640 },
    ROPPONGI: { id: 'ROPPONGI', name: 'Roppongi',      lat: 35.6627, lng: 139.7314 },
    // Odaiba / bay branch
    TOYOSU:   { id: 'TOYOSU',   name: 'Toyosu',        lat: 35.6547, lng: 139.7967 },
    ODAIBA:   { id: 'ODAIBA',   name: 'Odaiba',        lat: 35.6300, lng: 139.7796 },
  },
  lines: [
    { id: 'YAMANOTE', name: 'JR Yamanote Line', color: '#9acd32',
      stops: ['TOKYO', 'KANDA', 'AKIHABARA', 'UENO', 'NIPPORI', 'IKEBUKURO', 'SHINJUKU',
              'HARAJUKU', 'SHIBUYA', 'SHINAGAWA', 'HAMAMATSU', 'SHIMBASHI', 'TOKYO'],
      hops: [2, 2, 4, 3, 8, 7, 4, 2, 6, 5, 3, 3] },
    { id: 'CHUO', name: 'JR Chūō Line', color: '#f15a22',
      stops: ['TOKYO', 'OCHANOMIZU', 'YOTSUYA', 'SHINJUKU', 'NAKANO', 'KICHIJOJI'],
      hops: [4, 4, 5, 5, 9] },
    { id: 'GINZA', name: 'Ginza Line (Metro)', color: '#ff9500',
      stops: ['ASAKUSA', 'UENO', 'GINZA', 'SHIMBASHI', 'ROPPONGI', 'SHIBUYA'],
      hops: [5, 6, 3, 5, 6] },
    { id: 'YURIKAMOME', name: 'Yurikamome (bay)', color: '#0089a7',
      stops: ['SHIMBASHI', 'TOYOSU', 'ODAIBA'],
      hops: [8, 6] },
  ],
  // Each station's real ward, for the "same ward?" region question.
  stationRegions: {
    TOKYO: 'CHIYODA', KANDA: 'CHIYODA', AKIHABARA: 'CHIYODA', OCHANOMIZU: 'CHIYODA',
    UENO: 'TAITO', NIPPORI: 'TAITO', ASAKUSA: 'TAITO',
    IKEBUKURO: 'TOSHIMA',
    SHINJUKU: 'SHINJUKUW', YOTSUYA: 'SHINJUKUW', NAKANO: 'SHINJUKUW', KICHIJOJI: 'SHINJUKUW',
    HARAJUKU: 'SHIBUYAW', SHIBUYA: 'SHIBUYAW',
    SHINAGAWA: 'MINATO', HAMAMATSU: 'MINATO', SHIMBASHI: 'MINATO', GINZA: 'MINATO',
    ROPPONGI: 'MINATO', TOYOSU: 'MINATO', ODAIBA: 'MINATO',
  },
  pois: [
    { id: 'HND', category: 'airport', name: 'Haneda', lat: 35.5494, lng: 139.7798 },
    { id: 'NRT', category: 'airport', name: 'Narita', lat: 35.7720, lng: 140.3929 },
    { id: 'CHIYODA', category: 'ward', name: 'Chiyoda', lat: 35.694, lng: 139.753 },
    { id: 'MINATO',  category: 'ward', name: 'Minato',  lat: 35.658, lng: 139.751 },
    { id: 'SHINJUKUW',category: 'ward', name: 'Shinjuku', lat: 35.694, lng: 139.703 },
    { id: 'SHIBUYAW', category: 'ward', name: 'Shibuya',  lat: 35.664, lng: 139.698 },
    { id: 'TOSHIMA',  category: 'ward', name: 'Toshima',  lat: 35.726, lng: 139.717 },
    { id: 'TAITO',    category: 'ward', name: 'Taitō',    lat: 35.713, lng: 139.780 },
  ],
};
