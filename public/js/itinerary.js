// Itinéraire réel du GR20 (nord → sud, juillet 2019)
// Les coordonnées sont approximatives : elles servent à retrouver le lieu exact
// dans OpenStreetMap (recherche par nom dans un rayon de quelques km).

export const WAYPOINTS = {
  calenzana:  { nom: 'Calenzana',                    lat: 42.5085, lng: 8.8550, re: /^calenzana$/i },
  ortu:       { nom: "Refuge d'Ortu di u Piobbu",    lat: 42.4660, lng: 8.9120, re: /ortu di u piobbu|piobbu/i },
  carrozzu:   { nom: 'Refuge de Carrozzu',           lat: 42.4380, lng: 8.9500, re: /car+oz+u/i },
  ascu:       { nom: "Station d'Ascu Stagnu",        lat: 42.4040, lng: 8.9180, re: /ascu stagnu|asco stagnu|haut.?asco/i },
  tighjettu:  { nom: 'Refuge de Tighjettu',          lat: 42.3600, lng: 8.9050, re: /tigh?j?i?ettu/i },
  ballone:    { nom: 'Bergerie de Ballone',          lat: 42.3529, lng: 8.9078, re: /ballone|u vallone/i },
  ciottulu:   { nom: 'Refuge de Ciottulu di i Mori', lat: 42.3230, lng: 8.8930, re: /ciottulu/i },
  vergio:     { nom: 'Castel di Vergio',             lat: 42.2925, lng: 8.8710, re: /castel.{0,6}vergio/i },
  manganu:    { nom: 'Refuge de Manganu',            lat: 42.2120, lng: 8.9480, re: /manganu/i },
  petrapiana: { nom: 'Refuge de Petra Piana',        lat: 42.1930, lng: 9.0240, re: /petra ?piana/i },
  onda:       { nom: "Refuge de l'Onda",             lat: 42.1630, lng: 9.0600, re: /onda/i },
  vizzavona:  { nom: 'Vizzavona',                    lat: 42.1253, lng: 9.1307, re: /^(gare de )?vizzavona$/i },
  tattone:    { nom: 'Gîte Chez Pierrot (Tattone)',  lat: 42.1570, lng: 9.1450, re: /chez pierrot|tattone/i, horsGR: true },
  capannelle: { nom: "Refuge d'E Capannelle",        lat: 42.0170, lng: 9.1580, re: /capannelle/i },
  verde:      { nom: 'Bocca di Verde',               lat: 41.9710, lng: 9.1880, re: /bocca di verde|col de verde|san petru di verde/i },
  prati:      { nom: 'Refuge de Prati',              lat: 41.9400, lng: 9.2120, re: /refuge de prati|^prati$/i },
  usciolu:    { nom: "Refuge d'Usciolu",             lat: 41.8930, lng: 9.2110, re: /usciolu/i },
  croci:      { nom: 'Bergeries des Croci',          lat: 41.8800, lng: 9.2050, re: /croci/i },
  asinau:     { nom: "Refuge d'Asinau",              lat: 41.8150, lng: 9.2320, re: /asinau/i },
  pargulu:    { nom: 'Bocca di u Pargulu',           lat: 41.8000, lng: 9.2400, re: /pargulu/i, optionnel: true },
  bavella:    { nom: 'Col de Bavella',               lat: 41.7955, lng: 9.2265, re: /bavella/i },
  paliri:     { nom: "Refuge d'I Paliri",            lat: 41.7550, lng: 9.2770, re: /paliri/i },
  conca:      { nom: 'Conca',                        lat: 41.7330, lng: 9.3430, re: /^conca$/i },
};

// Chapitres du site, dans l'ordre du voyage.
// segments : 'gr' = suivre les sentiers du GR20 ; 'hors' = trajet hors GR (tracé en pointillés)
export const CHAPITRES = [
  { id: 'avant', type: 'avant', titre: 'Avant le GR20', sous: 'Le voyage jusqu’à Calenzana' },
  { id: 'e1',  n: 1,  de: 'Calenzana', a: "Refuge d'Ortu di u Piobbu", segments: [{ gr: ['calenzana', 'ortu'] }] },
  { id: 'e2',  n: 2,  de: "Ortu di u Piobbu", a: 'Refuge de Carrozzu', segments: [{ gr: ['ortu', 'carrozzu'] }] },
  { id: 'e3',  n: 3,  de: 'Carrozzu', a: "Station d'Ascu Stagnu", segments: [{ gr: ['carrozzu', 'ascu'] }] },
  { id: 'e4',  n: 4,  de: 'Ascu Stagnu', a: 'Bergerie de Ballone', segments: [{ gr: ['ascu', 'tighjettu', 'ballone'] }] },
  { id: 'e5',  n: 5,  de: 'Ballone', a: 'Castel di Vergio', segments: [{ gr: ['ballone', 'ciottulu', 'vergio'] }] },
  { id: 'e6',  n: 6,  de: 'Castel di Vergio', a: 'Refuge de Manganu', segments: [{ gr: ['vergio', 'manganu'] }] },
  { id: 'e7',  n: 7,  de: 'Manganu', a: 'Refuge de Petra Piana', segments: [{ gr: ['manganu', 'petrapiana'] }] },
  { id: 'e8',  n: 8,  de: 'Petra Piana', a: 'Gîte Chez Pierrot (Tattone)', note: 'Nuit dans un vrai lit, hors du GR20',
    segments: [{ gr: ['petrapiana', 'onda', 'vizzavona'] }, { hors: ['vizzavona', 'tattone'] }] },
  { id: 'e9',  n: 9,  de: 'Tattone', a: "Refuge d'E Capannelle",
    segments: [{ hors: ['tattone', 'vizzavona'] }, { gr: ['vizzavona', 'capannelle'] }] },
  { id: 'e10', n: 10, de: 'E Capannelle', a: 'Refuge de Prati', segments: [{ gr: ['capannelle', 'verde', 'prati'] }] },
  { id: 'e11', n: 11, de: 'Prati', a: 'Bergeries des Croci', segments: [{ gr: ['prati', 'usciolu', 'croci'] }] },
  { id: 'e12', n: 12, de: 'Croci', a: 'Auberge du col de Bavella', note: 'Variante alpine par les aiguilles de Bavella',
    segments: [{ gr: ['croci', 'asinau', 'pargulu', 'bavella'], alpine: true }] },
  { id: 'e13', n: 13, de: 'Col de Bavella', a: 'Conca', segments: [{ gr: ['bavella', 'paliri', 'conca'] }] },
  { id: 'apres', type: 'apres', titre: 'Après le GR20', sous: 'Le retour' },
];
CHAPITRES.forEach(c => { if (!c.type) c.type = 'etape'; if (!c.titre) c.titre = `Étape ${c.n}`; });

export const CHAP = Object.fromEntries(CHAPITRES.map(c => [c.id, c]));

// Associe un dossier d'export de la trieuse ("05-etape-5", "00-avant"…) à un chapitre
export function chapitreDepuisExport(ch) {
  if (ch.itineraire && CHAP[ch.itineraire]) return ch.itineraire;
  if (ch.type === 'avant') return 'avant';
  if (ch.type === 'apres') return 'apres';
  if (ch.type === 'etape' && ch.numero && CHAP['e' + ch.numero]) return 'e' + ch.numero;
  return null;
}

// Dégradé nord (vert maquis) → sud (ocre de Bavella)
export function couleurEtape(n) {
  const t = (n - 1) / 12;
  const a = [47, 110, 84], b = [196, 98, 45];
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `rgb(${c.join(',')})`;
}
