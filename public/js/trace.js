// Construction du tracé réel à partir d'OpenStreetMap, profils altimétriques (IGN), import/export GPX.
import { WAYPOINTS, CHAPITRES } from './itinerary.js';

const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const BBOX = '41.55,8.65,42.65,9.45';
const R = 6371;

export function distKm(a, b) {
  const toR = Math.PI / 180, dLat = (b[0] - a[0]) * toR, dLng = (b[1] - a[1]) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function overpass(requete, log) {
  let derniere;
  for (const url of OVERPASS) {
    try {
      log?.(`… OpenStreetMap (${new URL(url).host})`);
      const r = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: requete }) });
      if (r.ok) return await r.json();
      derniere = new Error('HTTP ' + r.status);
    } catch (e) { derniere = e; }
  }
  throw new Error('OpenStreetMap ne répond pas pour le moment (' + (derniere?.message || '') + '). Réessaie dans quelques minutes.');
}

/* ───────────── petite file de priorité pour Dijkstra ───────────── */
class Tas {
  a = [];
  push(n, p) { const a = this.a; a.push([p, n]); let i = a.length - 1; while (i > 0) { const j = (i - 1) >> 1; if (a[j][0] <= a[i][0]) break; [a[i], a[j]] = [a[j], a[i]]; i = j; } }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; } }
    return top;
  }
  get size() { return this.a.length; }
}

/* ───────────── simplification (Douglas-Peucker) ───────────── */
function simplifier(pts, tolM = 6) {
  if (pts.length < 3) return pts;
  const lat0 = pts[0][0] * Math.PI / 180, kx = 111320 * Math.cos(lat0), ky = 110540;
  const xy = pts.map(p => [p[1] * kx, p[0] * ky]);
  const garde = new Uint8Array(pts.length); garde[0] = garde[pts.length - 1] = 1;
  const pile = [[0, pts.length - 1]];
  while (pile.length) {
    const [i, j] = pile.pop(); let dmax = 0, k = -1;
    const [x1, y1] = xy[i], [x2, y2] = xy[j], dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy;
    for (let m = i + 1; m < j; m++) {
      const [x, y] = xy[m];
      let t = L2 ? ((x - x1) * dx + (y - y1) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
      if (d > dmax) { dmax = d; k = m; }
    }
    if (dmax > tolM) { garde[k] = 1; pile.push([i, k], [k, j]); }
  }
  return pts.filter((_, i) => garde[i]);
}

/* ───────────── altitudes : IGN (Géoplateforme), sinon Open-Meteo ───────────── */
async function lotIGN(sl) {
  const url = 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json?resource=ign_rgealti_world&zonly=true'
    + '&lon=' + sl.map(p => p[1].toFixed(5)).join('%7C') + '&lat=' + sl.map(p => p[0].toFixed(5)).join('%7C');
  const r = await fetch(url);
  if (!r.ok) throw new Error('IGN HTTP ' + r.status);
  const j = await r.json();
  return j.elevations.map(e => (typeof e === 'object' ? e.z : e));
}
async function lotOpenMeteo(sl) {
  const url = 'https://api.open-meteo.com/v1/elevation?latitude=' + sl.map(p => p[0].toFixed(5)).join(',') + '&longitude=' + sl.map(p => p[1].toFixed(5)).join(',');
  const r = await fetch(url);
  if (!r.ok) throw new Error('Open-Meteo HTTP ' + r.status);
  return (await r.json()).elevation;
}
const pause = ms => new Promise(ok => setTimeout(ok, ms));
async function essayer(fn, sl, n) {
  let err;
  for (let t = 0; t < n; t++) {
    try { return await fn(sl); } catch (e) { err = e; await pause(1000 * (t + 1)); }
  }
  throw err;
}
async function altitudes(pts, log) {
  const out = [];
  for (let i = 0; i < pts.length; i += 100) {
    const sl = pts.slice(i, i + 100);
    let z;
    try { z = await essayer(lotIGN, sl, 4); }
    catch (e1) {
      log?.(`   (IGN : ${e1.message} → service de secours Open-Meteo)`);
      try { z = await essayer(lotOpenMeteo, sl, 3); }
      catch (e2) { throw new Error(`altitudes indisponibles (IGN : ${e1.message}, Open-Meteo : ${e2.message})`); }
    }
    out.push(...z);
    log?.(`… altitudes ${Math.min(i + 100, pts.length)} / ${pts.length}`);
    await pause(250);   // ménage le service : pas plus de 4 demandes par seconde
  }
  for (let i = 0; i < out.length; i++) if (!(out[i] > -1000)) out[i] = i ? out[i - 1] : 0;
  return out;
}

// Rééchantillonne une ligne tous les ~pasKm et renvoie [[lat,lng,dKm]]
function reechantillonner(pts, pasKm) {
  const out = [[pts[0][0], pts[0][1], 0]]; let d = 0, prochain = pasKm;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], l = distKm(a, b);
    while (d + l >= prochain && l > 0) {
      const t = (prochain - d) / l;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, prochain]);
      prochain += pasKm;
    }
    d += l;
  }
  const last = pts[pts.length - 1];
  if (d - out[out.length - 1][2] > pasKm / 4) out.push([last[0], last[1], d]);
  return out;
}

function denivele(eles) {
  let up = 0, down = 0, ref = eles[0];
  for (const e of eles) { const d = e - ref; if (d > 8) { up += d; ref = e; } else if (d < -8) { down -= d; ref = e; } }
  return { dplus: Math.round(up), dmoins: Math.round(down) };
}

// Calcule le profil d'une étape à partir de ses parties sur le GR (les trajets hors GR sont exclus)
async function profilEtape(parts, log, elesConnues) {
  const ligne = parts.filter(p => !p.h).flatMap(p => paires(p.pts));
  if (ligne.length < 2) return { prof: [], km: 0, dplus: 0, dmoins: 0 };
  let long = 0; for (let i = 1; i < ligne.length; i++) long += distKm(ligne[i - 1], ligne[i]);
  const pas = Math.max(0.08, long / 400);
  const ech = reechantillonner(ligne, pas);
  let eles;
  if (elesConnues) eles = ech.map(p => elesConnues(p));
  else {
    try { eles = await altitudes(ech, log); }
    catch (e) { return { prof: [], km: +long.toFixed(1), dplus: 0, dmoins: 0, erreurProfil: e.message }; }   // la distance reste connue
  }
  const prof = []; ech.forEach((p, i) => prof.push(+p[2].toFixed(3), Math.round(eles[i])));
  return { prof, km: +long.toFixed(1), ...denivele(eles) };
}

export const paires = flat => { const o = []; for (let i = 0; i < flat.length; i += 2) o.push([flat[i], flat[i + 1]]); return o; };
const aplatir = pts => pts.flatMap(p => [+p[0].toFixed(5), +p[1].toFixed(5)]);

/* ───────────── construction complète depuis OpenStreetMap ───────────── */
export async function construireTrace(log, forces = {}) {
  log('1/4 · Téléchargement des sentiers du GR20 (peut prendre 1 minute)…');
  const j = await overpass(
    `[out:json][timeout:180];relation["route"="hiking"]["name"~"GR ?20",i](${BBOX})->.r;(.r;rel(r.r);)->.all;.all out body;way(r.all);out body;>;out skel qt;`, log);
  const noeuds = new Map(), voies = [], rels = [];
  for (const e of j.elements) {
    if (e.type === 'node') noeuds.set(e.id, [e.lat, e.lon]);
    else if (e.type === 'way') voies.push(e);
    else if (e.type === 'relation') rels.push(e);
  }
  if (!voies.length) throw new Error('Aucun sentier GR20 trouvé dans OpenStreetMap.');

  // Classement des voies : tracé principal / variante / variante alpine
  const variante = (nom, role, tags) =>
    /varia|alterna|alpin|liaison|acc[eè]s|bretelle|raccourci|excursion/i.test(nom) ||
    /altern|excursion|approach|connection/i.test(role || '') || tags.state === 'alternate';
  const classe = new Map();
  for (const r of rels) {
    const nom = r.tags?.name || '';
    for (const m of r.members || []) {
      if (m.type !== 'way') continue;
      const c = classe.get(m.ref) || { principal: false, alpine: false };
      const v = variante(nom, m.role, r.tags || {});
      if (!v) c.principal = true;
      if (v && /alpin|bavella/i.test(nom + ' ' + (m.role || ''))) c.alpine = true;
      classe.set(m.ref, c);
    }
  }
  const nbAlpine = [...classe.values()].filter(c => c.alpine).length;

  // Graphe
  const adj = new Map();
  const lien = (a, b, d, c) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push([b, d, c]); };
  for (const w of voies) {
    const c = classe.get(w.id) || { principal: false, alpine: false };
    for (let i = 1; i < (w.nodes || []).length; i++) {
      const a = w.nodes[i - 1], b = w.nodes[i], pa = noeuds.get(a), pb = noeuds.get(b);
      if (!pa || !pb) continue;
      const d = distKm(pa, pb); lien(a, b, d, c); lien(b, a, d, c);
    }
  }
  log(`   ${voies.length} tronçons, ${adj.size} points de passage${nbAlpine ? `, variante alpine repérée (${nbAlpine} tronçons)` : ''}.`);

  log('2/4 · Recherche des refuges et des lieux d’étape…');
  const motifs = 'calenzana|piobbu|carozzu|carrozzu|ascu|asco|tigh|ballone|vallone|ciottulu|vergio|manganu|petra piana|onda|vizzavona|pierrot|tattone|capannelle|verde|prati|usciolu|croci|asinau|pargulu|bavella|paliri|conca';
  let lieux = [];
  try {
    const jl = await overpass(`[out:json][timeout:60];(nwr["name"~"${motifs}",i]["tourism"](${BBOX});nwr["name"~"${motifs}",i]["place"](${BBOX});nwr["name"~"${motifs}",i]["railway"="station"](${BBOX});nwr["name"~"${motifs}",i]["natural"~"saddle|peak"](${BBOX});nwr["name"~"${motifs}",i]["mountain_pass"](${BBOX}););out center tags;`, log);
    lieux = jl.elements.map(e => ({ nom: e.tags?.name || '', lat: e.lat ?? e.center?.lat, lng: e.lon ?? e.center?.lon })).filter(l => l.lat);
  } catch (e) { log('   (recherche par nom impossible, positions approximatives utilisées)'); }

  const precis = {}, avert = [];
  for (const [k, w] of Object.entries(WAYPOINTS)) {
    if (forces[k]) { precis[k] = { lat: forces[k].lat, lng: forces[k].lng, nomOSM: 'placé à la main' }; continue; }
    const cands = lieux.filter(l => w.re.test(l.nom)).map(l => ({ ...l, d: distKm([w.lat, w.lng], [l.lat, l.lng]) })).filter(l => l.d < 8).sort((a, b) => a.d - b.d);
    if (cands.length) precis[k] = { lat: cands[0].lat, lng: cands[0].lng, nomOSM: cands[0].nom };
    else if (!w.optionnel) { precis[k] = { lat: w.lat, lng: w.lng }; avert.push(`${w.nom} : position approximative`); }
  }

  // Point du graphe le plus proche
  const coords = [...adj.keys()].map(id => [id, noeuds.get(id)]);
  const accrocher = p => { let best = null, bd = Infinity; for (const [id, c] of coords) { const d = distKm([p.lat, p.lng], c); if (d < bd) { bd = d; best = id; } } return { id: best, d: bd }; };

  function chemin(depart, arrivee, alpine) {
    const cout = (d, c) => alpine ? (c.alpine ? d * 0.3 : (c.principal ? d : d * 1.6)) : (c.alpine ? d * 3 : (c.principal ? d : d * 1.6));
    const dist = new Map([[depart, 0]]), prec = new Map(), tas = new Tas(); tas.push(depart, 0);
    while (tas.size) {
      const [dd, n] = tas.pop();
      if (n === arrivee) break;
      if (dd > (dist.get(n) ?? Infinity)) continue;
      for (const [m, d, c] of adj.get(n) || []) {
        const nd = dd + cout(d, c);
        if (nd < (dist.get(m) ?? Infinity)) { dist.set(m, nd); prec.set(m, n); tas.push(m, nd); }
      }
    }
    if (!dist.has(arrivee)) return null;
    const ids = [arrivee]; while (ids[0] !== depart) ids.unshift(prec.get(ids[0]));
    return ids.map(id => noeuds.get(id));
  }

  log('3/4 · Calcul de l’itinéraire étape par étape…');
  const etapes = {};
  for (const ch of CHAPITRES.filter(c => c.segments)) {
    const parts = [];
    for (const seg of ch.segments) {
      if (seg.hors) {
        const a = precis[seg.hors[0]], b = precis[seg.hors[1]];
        parts.push({ h: 1, pts: aplatir([[a.lat, a.lng], [b.lat, b.lng]]) });
        continue;
      }
      const wps = seg.gr.filter(k => precis[k]);
      let pts = [];
      for (let i = 1; i < wps.length; i++) {
        const A = accrocher(precis[wps[i - 1]]), B = accrocher(precis[wps[i]]);
        if (A.d > 2) avert.push(`${ch.titre} : ${WAYPOINTS[wps[i - 1]].nom} est à ${A.d.toFixed(1)} km du sentier`);
        let c = chemin(A.id, B.id, !!seg.alpine);
        if (!c) {
          avert.push(`${ch.titre} : pas de sentier continu entre ${WAYPOINTS[wps[i - 1]].nom} et ${WAYPOINTS[wps[i]].nom} (ligne droite provisoire)`);
          c = [[precis[wps[i - 1]].lat, precis[wps[i - 1]].lng], [precis[wps[i]].lat, precis[wps[i]].lng]];
        }
        pts = pts.concat(i > 1 ? c.slice(1) : c);
      }
      parts.push({ h: 0, pts: aplatir(simplifier(pts)) });
    }
    etapes[ch.id] = { parts };
    log(`   ${ch.titre} ✓`);
  }
  if (!nbAlpine && !precis.pargulu) avert.push('Étape 12 : la variante alpine n’a pas été identifiée dans OpenStreetMap ; vérifie le tracé ou importe un GPX.');

  log('4/4 · Altitudes (service IGN)…');
  for (const [id, e] of Object.entries(etapes)) {
    log(`   Profil ${id.replace('e', 'étape ')}…`);
    Object.assign(e, await profilEtape(e.parts, log));
    if (e.erreurProfil) { avert.push(`Profil de ${id.replace('e', 'l’étape ')} manquant : ${e.erreurProfil}`); log('   ✕ ' + e.erreurProfil); delete e.erreurProfil; }
  }
  log('Terminé.');
  return { version: 1, construit: new Date().toISOString(), source: 'OpenStreetMap', etapes, lieux: precis, avertissements: avert };
}

/* ───────────── compléter uniquement les profils manquants ───────────── */
export async function completerProfils(trace, log) {
  const t = structuredClone(trace); let ok = 0, ko = 0;
  for (const [id, e] of Object.entries(t.etapes || {})) {
    const pl = e.parts.filter(p => !p.h).flatMap(p => paires(p.pts));
    let km = 0; for (let i = 1; i < pl.length; i++) km += distKm(pl[i - 1], pl[i]);
    e.km = +km.toFixed(1);                               // distance toujours recalculée
    if (e.prof?.length) continue;
    log(`Profil ${id.replace('e', 'étape ')}…`);
    const r = await profilEtape(e.parts, log);
    if (r.erreurProfil) { ko++; log('   ✕ ' + r.erreurProfil); continue; }
    Object.assign(e, r); ok++; log('   ✓');
  }
  t.avertissements = (t.avertissements || []).filter(a => !/^Profil de/.test(a));
  t.modifie = new Date().toISOString();
  return { trace: t, ok, ko };
}

/* ───────────── GPX ───────────── */
export async function etapeDepuisGPX(texte, log) {
  const xml = new DOMParser().parseFromString(texte, 'application/xml');
  const pts = [...xml.querySelectorAll('trkpt, rtept')].map(n => [+n.getAttribute('lat'), +n.getAttribute('lon'), n.querySelector('ele') ? +n.querySelector('ele').textContent : null]);
  if (pts.length < 2) throw new Error('Aucun point trouvé dans ce fichier GPX');
  const parts = [{ h: 0, pts: aplatir(simplifier(pts)) }];
  let elesConnues = null;
  if (pts.every(p => p[2] != null)) {
    // altitude du point GPX le plus proche
    elesConnues = q => { let b = 0, bd = Infinity; for (const p of pts) { const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2; if (d < bd) { bd = d; b = p[2]; } } return b; };
  }
  return { parts, ...(await profilEtape(parts, log, elesConnues)), source: 'GPX' };
}

export function traceEnGPX(trace) {
  const esc = s => String(s).replace(/[<&>]/g, c => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;' }[c]));
  const trk = CHAPITRES.filter(c => trace.etapes?.[c.id]).map(c => {
    const segs = trace.etapes[c.id].parts.filter(p => !p.h).map(p => '<trkseg>' + paires(p.pts).map(q => `<trkpt lat="${q[0]}" lon="${q[1]}"/>`).join('') + '</trkseg>').join('');
    return `<trk><name>${esc(c.titre + ' – ' + c.de + ' → ' + c.a)}</name>${segs}</trk>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Notre GR20" xmlns="http://www.topografix.com/GPX/1/1">\n${trk}\n</gpx>`;
}

/* ───────────── projection d'une photo sur le profil ───────────── */
export function projeter(etape, lat, lng) {
  if (!etape) return null;
  const ligne = etape.parts.filter(p => !p.h).flatMap(p => paires(p.pts));
  if (ligne.length < 2) return null;
  const kx = 111.32 * Math.cos(lat * Math.PI / 180), ky = 110.54;
  let best = { d: Infinity, km: 0 }, cum = 0;
  for (let i = 1; i < ligne.length; i++) {
    const a = ligne[i - 1], b = ligne[i];
    const ax = a[1] * kx, ay = a[0] * ky, bx = b[1] * kx, by = b[0] * ky, px = lng * kx, py = lat * ky;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy)), l = Math.sqrt(L2);
    if (d < best.d) best = { d, km: cum + t * l };
    cum += l;
  }
  return best.d < 1.5 ? best : null;   // à plus de 1,5 km du sentier : pas sur le profil
}
