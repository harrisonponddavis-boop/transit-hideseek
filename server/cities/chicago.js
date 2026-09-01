// Chicago — a slice of the CTA 'L' across the Loop and out the main branches.
// Real transfer stations are shared between lines so the graph is connected.
// Coordinates are approximate; good enough for gameplay, not navigation.

module.exports = {
  id: 'chicago',
  name: 'Chicago',
  center: [41.880, -87.680],
  zoom: 11,
  startStation: 'CLARKLAKE',
  stations: {
    // Loop hubs
    CLARKLAKE: { id: 'CLARKLAKE', name: 'Clark/Lake',        lat: 41.8856, lng: -87.6306 },
    LAKE:      { id: 'LAKE',      name: 'Lake (State)',      lat: 41.8843, lng: -87.6278 },
    ROOSEVELT: { id: 'ROOSEVELT', name: 'Roosevelt',         lat: 41.8674, lng: -87.6270 },
    // Red Line
    HOWARD:    { id: 'HOWARD',    name: 'Howard',            lat: 42.0190, lng: -87.6729 },
    WILSON:    { id: 'WILSON',    name: 'Wilson',            lat: 41.9647, lng: -87.6577 },
    FULLERTON: { id: 'FULLERTON', name: 'Fullerton',         lat: 41.9254, lng: -87.6531 },
    CLARKDIV:  { id: 'CLARKDIV',  name: 'Clark/Division',    lat: 41.9039, lng: -87.6319 },
    CERMAK:    { id: 'CERMAK',    name: 'Cermak–Chinatown',  lat: 41.8531, lng: -87.6310 },
    SOX35:     { id: 'SOX35',     name: 'Sox–35th',          lat: 41.8312, lng: -87.6303 },
    DANRYAN95: { id: 'DANRYAN95', name: '95th/Dan Ryan',     lat: 41.7224, lng: -87.6244 },
    // Blue Line
    OHARE:     { id: 'OHARE',     name: "O'Hare",            lat: 41.9786, lng: -87.9047 },
    JEFFPARK:  { id: 'JEFFPARK',  name: 'Jefferson Park',    lat: 41.9706, lng: -87.7615 },
    LOGAN:     { id: 'LOGAN',     name: 'Logan Square',      lat: 41.9296, lng: -87.7088 },
    DAMENBLUE: { id: 'DAMENBLUE', name: 'Damen (Blue)',      lat: 41.9094, lng: -87.6770 },
    DIVISION:  { id: 'DIVISION',  name: 'Division',          lat: 41.9032, lng: -87.6664 },
    UICHALSTED:{ id: 'UICHALSTED',name: 'UIC–Halsted',       lat: 41.8757, lng: -87.6497 },
    FORESTPK:  { id: 'FORESTPK',  name: 'Forest Park',       lat: 41.8741, lng: -87.8174 },
    // Brown Line
    KIMBALL:   { id: 'KIMBALL',   name: 'Kimball',           lat: 41.9679, lng: -87.7132 },
    WESTERNBR: { id: 'WESTERNBR', name: 'Western (Brown)',   lat: 41.9665, lng: -87.6884 },
    BELMONT:   { id: 'BELMONT',   name: 'Belmont',           lat: 41.9396, lng: -87.6532 },
    ARMITAGE:  { id: 'ARMITAGE',  name: 'Armitage',          lat: 41.9176, lng: -87.6527 },
    // Green Line
    HARLEM:    { id: 'HARLEM',    name: 'Harlem/Lake',       lat: 41.8869, lng: -87.8033 },
    ASHLANDGR: { id: 'ASHLANDGR', name: 'Ashland (Green)',   lat: 41.8856, lng: -87.6663 },
    BRONZE35:  { id: 'BRONZE35',  name: '35th–Bronzeville',  lat: 41.8316, lng: -87.6258 },
    GARFIELD:  { id: 'GARFIELD',  name: 'Garfield',          lat: 41.7948, lng: -87.6182 },
    COTTAGE:   { id: 'COTTAGE',   name: 'Cottage Grove',     lat: 41.7800, lng: -87.6056 },
    // Orange Line
    MIDWAY:    { id: 'MIDWAY',    name: 'Midway',            lat: 41.7866, lng: -87.7376 },
    WESTERNOR: { id: 'WESTERNOR', name: 'Western (Orange)',  lat: 41.8048, lng: -87.6843 },
  },
  lines: [
    { id: 'RED', name: 'Red Line', color: '#c60c30',
      stops: ['HOWARD', 'WILSON', 'FULLERTON', 'CLARKDIV', 'LAKE', 'ROOSEVELT', 'CERMAK', 'SOX35', 'DANRYAN95'],
      hops: [10, 6, 4, 4, 3, 4, 4, 8] },
    { id: 'BLUE', name: 'Blue Line', color: '#00a1de',
      stops: ['OHARE', 'JEFFPARK', 'LOGAN', 'DAMENBLUE', 'DIVISION', 'CLARKLAKE', 'UICHALSTED', 'FORESTPK'],
      hops: [9, 7, 4, 3, 5, 3, 12] },
    { id: 'BROWN', name: 'Brown Line', color: '#62361b',
      stops: ['KIMBALL', 'WESTERNBR', 'BELMONT', 'FULLERTON', 'ARMITAGE', 'CLARKLAKE'],
      hops: [3, 5, 3, 3, 6] },
    { id: 'GREEN', name: 'Green Line', color: '#009b3a',
      stops: ['HARLEM', 'ASHLANDGR', 'CLARKLAKE', 'ROOSEVELT', 'BRONZE35', 'GARFIELD', 'COTTAGE'],
      hops: [11, 5, 4, 4, 4, 3] },
    { id: 'ORANGE', name: 'Orange Line', color: '#f9461c',
      stops: ['MIDWAY', 'WESTERNOR', 'ROOSEVELT', 'CLARKLAKE'],
      hops: [6, 8, 3] },
  ],
  // Each station's real district, for the "same district?" region question.
  stationRegions: {
    CLARKLAKE: 'LOOP', LAKE: 'LOOP', ROOSEVELT: 'LOOP',
    FULLERTON: 'LPK', CLARKDIV: 'LPK', ARMITAGE: 'LPK',
    HOWARD: 'LKV', WILSON: 'LKV', BELMONT: 'LKV',
    OHARE: 'WP', JEFFPARK: 'WP', LOGAN: 'WP', DAMENBLUE: 'WP', DIVISION: 'WP',
    FORESTPK: 'WP', KIMBALL: 'WP', WESTERNBR: 'WP', HARLEM: 'WP',
    CERMAK: 'PIL', UICHALSTED: 'PIL', ASHLANDGR: 'PIL', WESTERNOR: 'PIL',
    SOX35: 'BRZ', BRONZE35: 'BRZ',
    DANRYAN95: 'HP', GARFIELD: 'HP', COTTAGE: 'HP', MIDWAY: 'HP',
  },
  pois: [
    { id: 'ORD', category: 'airport', name: "O'Hare Int'l",   lat: 41.9786, lng: -87.9047 },
    { id: 'MDW', category: 'airport', name: 'Midway Int’l',   lat: 41.7866, lng: -87.7376 },
    { id: 'LOOP', category: 'district', name: 'The Loop',          lat: 41.883, lng: -87.629 },
    { id: 'LPK',  category: 'district', name: 'Lincoln Park',       lat: 41.921, lng: -87.650 },
    { id: 'LKV',  category: 'district', name: 'Lakeview',           lat: 41.943, lng: -87.654 },
    { id: 'WP',   category: 'district', name: 'Wicker Park',        lat: 41.908, lng: -87.677 },
    { id: 'PIL',  category: 'district', name: 'Pilsen',             lat: 41.857, lng: -87.656 },
    { id: 'HP',   category: 'district', name: 'Hyde Park',          lat: 41.794, lng: -87.590 },
    { id: 'BRZ',  category: 'district', name: 'Bronzeville',        lat: 41.831, lng: -87.620 },
  ],
};
