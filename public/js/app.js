import { CHAPITRES, CHAP, WAYPOINTS, couleurEtape } from './itinerary.js';
import { creerStore, LIMITE_OCTETS } from './store.js';
import { emailsAutorises, titreSite, sousTitre } from './config.js';
import { construireTrace, etapeDepuisGPX, traceEnGPX, projeter, paires, distKm } from './trace.js';
import { importerExport } from './import.js';
import { FORMATS, dpiEstime, genererPDF, listeHD } from './book.js';

/* ───────────────────────── utilitaires ───────────────────────── */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const couleur = c => c?.type === 'etape' ? couleurEtape(c.n) : '#2a6f8f';
const icone = c => c.type === 'etape' ? c.n : (c.type === 'avant' ? '⛴' : '🏁');
const dateObj = d => d ? new Date(d.length === 10 ? d + 'T12:00:00' : d) : null;
const fmtJour = (d, long = true) => d ? dateObj(d).toLocaleDateString('fr-FR', long ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'short' }) : '';
const fmtHeure = d => d && d.length > 10 ? dateObj(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
const fmtNb = n => Number(n).toLocaleString('fr-FR');
const fmtMo = o => (o / 1024 / 1024).toLocaleString('fr-FR', { maximumFractionDigits: o > 100 * 1024 * 1024 ? 0 : 1 }) + ' Mo';
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignoré */ } };
function toast(msg, ms = 3200) { const t = $('#toast'); t.textContent = msg; t.classList.add('visible'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('visible'), ms); }
function telecharger(blob, nom) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nom; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000); }
const debounce = (fn, ms) => { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); }; };

document.title = titreSite;
document.querySelectorAll('[data-titre]').forEach(e => e.textContent = titreSite);
document.querySelectorAll('[data-sous-titre]').forEach(e => e.textContent = sousTitre);

/* ───────────────────────── état ───────────────────────── */
let store, index = { chapitres: {}, photos: {}, usage: { bytes: 0, count: 0 } }, trace = null;
let chapSel = null;
let map = null, couches = {}, marqueurs = new Map();
const cacheProj = new Map();

const photosDe = id => Object.entries(index.photos).filter(([, p]) => !p.retiree && p.chapitre === id).sort((a, b) => String(a[1].date).localeCompare(String(b[1].date)));
const ordreChap = Object.fromEntries(CHAPITRES.map((c, i) => [c.id, i]));
const toutesPhotos = () => Object.entries(index.photos).filter(([, p]) => !p.retiree && CHAP[p.chapitre])
  .sort((a, b) => (ordreChap[a[1].chapitre] - ordreChap[b[1].chapitre]) || String(a[1].date).localeCompare(String(b[1].date)));

/* ───────────────────────── démarrage ───────────────────────── */
async function demarrer() {
  try { store = await creerStore(); }
  catch (e) { $('#ecranConnexion').hidden = false; $('#msgConnexion').textContent = 'Impossible de charger Firebase : ' + e.message; return; }
  let ecoute = null;
  store.onUser(async u => {
    if (!u) { $('#ecranConnexion').hidden = false; $('#app').hidden = true; return; }
    if (store.mode === 'firebase' && !emailsAutorises.map(e => e.toLowerCase()).includes(u.email)) {
      await store.deconnexion();
      $('#msgConnexion').textContent = `Le compte ${u.email} n’est pas autorisé sur ce site.`;
      return;
    }
    $('#ecranConnexion').hidden = true; $('#app').hidden = false;
    const av = $('#btnCompte');
    if (u.photo) av.style.backgroundImage = `url("${u.photo}")`; else av.textContent = (u.nom || '?')[0].toUpperCase();
    av.title = store.mode === 'firebase' ? `${u.nom} – se déconnecter` : 'Aperçu local';
    if (store.mode === 'apercu') bandeau('Mode aperçu : Firebase n’est pas encore configuré, rien n’est enregistré en ligne. Tu peux importer un export de la trieuse dans ⚙ Gérer pour prévisualiser le site.');
    initCarte();
    trace = await store.lireTrace().catch(() => null);
    chapSel = CHAP[location.hash.slice(1)] ? location.hash.slice(1) : null;
    ecoute?.();
    let premier = true;
    ecoute = store.ecouterIndex(idx => {
      index = idx;
      rendreTout(premier); premier = false;
      if ($('#dlgLivre').open) majLivreCompteurs();
      if ($('#dlgGerer').open) rendreGerer(true);
    }, err => bandeau('Accès aux données refusé : vérifie les règles Firestore (' + err.message + ')'));
  });
}
function bandeau(txt) { const b = $('#bandeau'); b.textContent = txt; b.hidden = !txt; }
$('#btnConnexion').onclick = () => store.connexion().catch(e => { $('#msgConnexion').textContent = 'Connexion impossible : ' + e.message; });
$('#btnCompte').onclick = () => { if (store.mode === 'firebase' && confirm('Se déconnecter ?')) store.deconnexion(); };

function rendreTout(ajuster) {
  rendreChapitres();
  rendreCarte(ajuster);
  rendreProfil();
  const focus = document.activeElement;
  if (!(focus && $('#panneau').contains(focus) && focus.matches('textarea,input'))) rendrePanneau();
  rendreJaugeMini();
}

function choisir(id, { ajuster = true } = {}) {
  chapSel = id && CHAP[id] ? id : null;
  history.replaceState(null, '', chapSel ? '#' + chapSel : location.pathname + location.search);
  rendreChapitres(); rendreCarte(ajuster); rendreProfil(); rendrePanneau();
  $('#panneau').scrollTop = 0;
  if (window.innerWidth <= 860) $('#chapitres .chap.actif')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
}

/* ───────────────────────── liste des chapitres ───────────────────────── */
function rendreChapitres() {
  const ligne = c => {
    const n = photosDe(c.id).length, info = index.chapitres[c.id] || {}, et = trace?.etapes?.[c.id];
    const meta = [info.date ? fmtJour(info.date, false) : '', n ? `${n} photo${n > 1 ? 's' : ''}` : '', et?.km ? `${fmtNb(et.km)} km` : ''].filter(Boolean).join(' · ');
    return `<div class="chap ${chapSel === c.id ? 'actif' : ''} ${n ? '' : 'vide'}" data-id="${c.id}" style="--c:${couleur(c)}">
      <div class="pastille">${icone(c)}</div>
      <div><div class="t"><span class="long">${esc(c.titre)}</span><span class="court">${esc(c.type === 'etape' ? 'Étape ' + c.n : c.type === 'avant' ? 'Avant' : 'Après')}</span></div><div class="s">${esc(c.de ? `${c.de} → ${c.a}` : c.sous)}</div>${meta ? `<div class="m">${esc(meta)}</div>` : ''}</div></div>`;
  };
  $('#chapitres').innerHTML =
    `<button class="btn chap-tout ${chapSel ? '' : 'actif'}" data-id="">🗺 Vue d’ensemble</button>` +
    ligne(CHAP.avant) + `<div class="chap-sep">Le GR20 · 13 étapes</div>` +
    CHAPITRES.filter(c => c.type === 'etape').map(ligne).join('') + `<div class="chap-sep">Ensuite</div>` + ligne(CHAP.apres);
}
$('#chapitres').addEventListener('click', e => { const el = e.target.closest('[data-id]'); if (el) choisir(el.dataset.id || null); });

/* ───────────────────────── carte ───────────────────────── */
function fondsIGN() {
  const wmts = (layer, fmt, base = 'https://data.geopf.fr/wmts?') => `${base}SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=${fmt}`;
  // si l'IGN refuse une tuile, on la remplace par celle d'OpenStreetMap (évite les trous dans la carte)
  const osm = c => `https://tile.openstreetmap.org/${c.z}/${c.x}/${c.y}.png`;
  const planIGN = c => wmts('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png').replace('{z}', c.z).replace('{x}', c.x).replace('{y}', c.y);
  const repli = (couche, ...secours) => { secours.push(osm); return couche.on('tileerror', e => {
    const n = +(e.tile.dataset.repli || 0);
    if (n >= secours.length) return;
    e.tile.dataset.repli = n + 1;
    e.tile.src = secours[n](e.coords);
  }); };
  return {
    plan: repli(L.tileLayer(wmts('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png'), { maxZoom: 19, attribution: '© IGN © OpenStreetMap' })),
    // TOP 25 quand on zoome ; Plan IGN en vue éloignée (la mer y est bleue, pas de carrés blancs)
    scan: L.layerGroup([
      repli(L.tileLayer(wmts('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png'), { maxZoom: 10, attribution: '© IGN' })),
      repli(L.tileLayer(wmts('GEOGRAPHICALGRIDSYSTEMS.MAPS', 'image/jpeg', 'https://data.geopf.fr/private/wmts?apikey=ign_scan_ws&'), { minZoom: 11, maxZoom: 18, maxNativeZoom: 16, attribution: '© IGN – SCAN 25' }), planIGN),
    ]),
    ortho: repli(L.tileLayer(wmts('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg'), { maxZoom: 19, attribution: '© IGN' })),
    topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '© OpenTopoMap © contributeurs OpenStreetMap' }),
  };
}
function initCarte() {
  if (map) return;
  map = L.map('carte', { zoomSnap: 0.5 }).setView([42.15, 9.05], 9);
  const f = fondsIGN();
  f.scan.addTo(map);
  couches.trace = L.layerGroup().addTo(map);
  couches.nuits = L.layerGroup().addTo(map);
  couches.photos = L.layerGroup().addTo(map);
  couches.curseur = L.layerGroup().addTo(map);
  L.control.layers({ 'Plan IGN': f.plan, 'Carte IGN TOP 25': f.scan, 'Photo aérienne IGN': f.ortho, 'OpenTopoMap': f.topo },
    { 'Tracé': couches.trace, 'Lieux de nuit': couches.nuits, 'Photos': couches.photos }).addTo(map);
  L.control.scale({ imperial: false }).addTo(map);
  map.on('click', e => {
    if (!placementLieu) return;
    const k = placementLieu; finPlacement();
    store.majLieu(k, { lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) }).then(() => {
      if (confirm(`${WAYPOINTS[k].nom} est placé.\n\nReconstruire le tracé maintenant pour en tenir compte ?`)) { ouvrirGerer(); lancerTrace(); }
      else toast('Lieu enregistré : pense à reconstruire le tracé dans ⚙ Gérer');
    }).catch(err => toast('Erreur : ' + err.message));
  });
  new ResizeObserver(() => { map.invalidateSize(); rendreProfil(); }).observe($('#carte'));
}

// Parties d'une étape : tracé réel s'il existe, sinon lignes droites provisoires entre les lieux
function partiesEtape(id) {
  const e = trace?.etapes?.[id];
  if (e?.parts?.length) return e.parts.map(p => ({ h: !!p.h, pts: paires(p.pts), provisoire: false }));
  const c = CHAP[id];
  return (c.segments || []).map(s => {
    const k = s.gr || s.hors;
    const pts = k.map(x => trace?.lieux?.[x] || WAYPOINTS[x]).filter((w, i) => w && !(WAYPOINTS[k[i]].optionnel && !trace?.lieux?.[k[i]])).map(w => [w.lat, w.lng]);
    return { h: !!s.hors, pts, provisoire: true };
  });
}

function rendreCarte(ajuster) {
  if (!map) return;
  couches.trace.clearLayers(); couches.nuits.clearLayers(); couches.photos.clearLayers(); marqueurs.clear();
  const bornes = L.latLngBounds([]);
  const etapes = CHAPITRES.filter(c => c.type === 'etape');
  for (const c of etapes) {
    const sel = chapSel === c.id, attenue = chapSel && !sel, col = couleur(c);
    const parts = partiesEtape(c.id);
    for (const p of parts) {
      if (p.pts.length < 2) continue;
      L.polyline(p.pts, { color: col, weight: sel ? 6 : 4, opacity: attenue ? 0.35 : 0.95, dashArray: (p.h || p.provisoire) ? '7 7' : null, lineCap: 'round', interactive: false }).addTo(couches.trace);
      L.polyline(p.pts, { color: '#000', opacity: 0, weight: 18 })
        .bindTooltip(`<b>${esc(c.titre)}</b><br>${esc(c.de)} → ${esc(c.a)}${p.h ? '<br><i>trajet hors GR20</i>' : ''}`, { sticky: true })
        .on('click', () => choisir(c.id)).addTo(couches.trace);
      if (!chapSel || sel) p.pts.forEach(q => bornes.extend(q));
    }
    const last = parts.at(-1)?.pts.at(-1);
    if (last) {
      L.marker(last, { icon: L.divIcon({ className: 'num-etape', html: `<span style="color:${col}">${c.n}</span>` }) })
        .bindTooltip(`Nuit ${c.n} : ${esc(c.a)}`).on('click', () => choisir(c.id)).addTo(couches.nuits);
      if (c.n === 1) {
        const d = parts[0].pts[0];
        L.circleMarker(d, { radius: 6, color: col, weight: 3, fillColor: '#fff', fillOpacity: 1 }).bindTooltip('Départ : Calenzana').addTo(couches.nuits);
      }
    }
  }
  // photos
  for (const [id, p] of toutesPhotos()) {
    if (p.lat == null) continue;
    if (chapSel && p.chapitre !== chapSel) continue;
    const c = CHAP[p.chapitre];
    const m = L.circleMarker([p.lat, p.lng], { radius: chapSel ? 6.5 : 4.5, color: '#fff', weight: 1.5, fillColor: couleur(c), fillOpacity: 0.95 });
    const tt = document.createElement('div'); tt.innerHTML = `<img alt=""><div>${esc(fmtHeure(p.date))}${p.legende ? ' · ' + esc(p.legende) : ''}</div>`;
    m.bindTooltip(tt, { className: 'tt-photo', direction: 'top', offset: [0, -6] });
    m.on('tooltipopen', async () => { const img = tt.querySelector('img'); if (!img.src) img.src = await store.urlMiniature(id) || ''; });
    m.on('click', () => ouvrirVision(id));
    m.addTo(couches.photos); marqueurs.set(id, m);
    if (chapSel) bornes.extend([p.lat, p.lng]);
  }
  if (ajuster && bornes.isValid()) map.fitBounds(bornes, { padding: [30, 30], maxZoom: 15 });
}

/* ───────────────────────── profil altimétrique ───────────────────────── */
function projection(id, p) {
  const k = `${id}|${p.lat}|${p.lng}|${trace?.construit}|${trace?.modifie}`;
  if (!cacheProj.has(k)) cacheProj.set(k, projeter(trace?.etapes?.[p.chapitre], p.lat, p.lng));
  return cacheProj.get(k);
}
function pointA(id, km) {
  const ligne = (trace?.etapes?.[id]?.parts || []).filter(p => !p.h).flatMap(p => paires(p.pts));
  let cum = 0;
  for (let i = 1; i < ligne.length; i++) {
    const l = distKm(ligne[i - 1], ligne[i]);
    if (cum + l >= km) { const t = l ? (km - cum) / l : 0; return [ligne[i - 1][0] + (ligne[i][0] - ligne[i - 1][0]) * t, ligne[i - 1][1] + (ligne[i][1] - ligne[i - 1][1]) * t]; }
    cum += l;
  }
  return ligne.at(-1);
}
function donneesProfil() {
  if (!trace?.etapes) return null;
  const ids = chapSel ? (CHAP[chapSel].type === 'etape' ? [chapSel] : []) : CHAPITRES.filter(c => c.type === 'etape').map(c => c.id);
  let offset = 0; const segs = [], photos = [];
  for (const id of ids) {
    const e = trace.etapes[id]; if (!e?.prof?.length) continue;
    const pr = paires(e.prof), long = pr.at(-1)[0];
    segs.push({ id, x0: offset, x1: offset + long, pr: pr.map(([d, z]) => [offset + d, z]) });
    for (const [pid, p] of photosDe(id)) {
      if (p.lat == null) continue;
      const pj = projection(pid, p); if (!pj) continue;
      const j = pr.findIndex(q => q[0] >= pj.km), z = j > 0 ? pr[j - 1][1] + (pr[j][1] - pr[j - 1][1]) * ((pj.km - pr[j - 1][0]) / (pr[j][0] - pr[j - 1][0] || 1)) : pr[Math.max(j, 0)][1];
      photos.push({ id: pid, x: offset + pj.km, z, etape: id, km: pj.km });
    }
    offset += long;
  }
  return segs.length ? { segs, photos, total: offset } : null;
}
function rendreProfil() {
  const el = $('#profil'); if (!el || $('#app').hidden) return;
  const d = donneesProfil();
  if (!d) {
    const c = chapSel && CHAP[chapSel];
    el.innerHTML = `<div class="vide-profil">${c && c.type !== 'etape' ? 'Pas de profil pour ce chapitre.' : 'Le profil altimétrique apparaîtra une fois le tracé construit (⚙ Gérer → Tracé).'}</div>`;
    return;
  }
  const W = el.clientWidth, H = el.clientHeight, ml = 44, mr = 12, mt = 16, mb = 20;
  const zs = d.segs.flatMap(s => s.pr.map(q => q[1]));
  let zmin = Math.floor(Math.min(...zs) / 100) * 100, zmax = Math.ceil(Math.max(...zs) / 100) * 100; if (zmax - zmin < 200) zmax = zmin + 200;
  const X = x => ml + (x / d.total) * (W - ml - mr), Y = z => mt + (1 - (z - zmin) / (zmax - zmin)) * (H - mt - mb);
  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  for (const z of [zmin, (zmin + zmax) / 2, zmax]) svg += `<line class="grille" x1="${ml}" x2="${W - mr}" y1="${Y(z)}" y2="${Y(z)}"/><text class="axe" x="${ml - 6}" y="${Y(z) + 3.5}" text-anchor="end">${fmtNb(Math.round(z))} m</text>`;
  const pasX = d.total > 60 ? 20 : d.total > 20 ? 5 : d.total > 8 ? 2 : 1;
  for (let x = pasX; x < d.total; x += pasX) svg += `<text class="axe" x="${X(x)}" y="${H - 5}" text-anchor="middle">${x} km</text>`;
  for (const s of d.segs) {
    const c = CHAP[s.id], col = couleur(c);
    const line = s.pr.map(q => `${X(q[0]).toFixed(1)},${Y(q[1]).toFixed(1)}`).join(' L');
    svg += `<path d="M${X(s.x0)},${Y(zmin)} L${line} L${X(s.x1)},${Y(zmin)} Z" fill="${col}" fill-opacity=".22"/><path d="M${line}" fill="none" stroke="${col}" stroke-width="1.8"/>`;
    if (!chapSel) {
      svg += `<line class="grille" x1="${X(s.x0)}" x2="${X(s.x0)}" y1="${mt}" y2="${H - mb}" stroke-dasharray="2 3"/>`;
      if (X(s.x1) - X(s.x0) > 16) svg += `<text class="axe" x="${(X(s.x0) + X(s.x1)) / 2}" y="${mt - 4}" text-anchor="middle" style="fill:${col};font-weight:600">${c.n}</text>`;
    }
  }
  for (const p of d.photos) svg += `<circle class="photo" data-id="${p.id}" cx="${X(p.x)}" cy="${Y(p.z)}" r="4" fill="var(--ocre)" stroke="#fff" stroke-width="1.5"><title>${esc(fmtHeure(index.photos[p.id]?.date))}</title></circle>`;
  svg += `<line class="curseur" id="profCurseur" y1="${mt}" y2="${H - mb}" x1="-10" x2="-10"/></svg><div class="bulle" id="profBulle" hidden></div>`;
  el.innerHTML = svg;
  const svgEl = el.querySelector('svg');
  const versX = ev => { const r = svgEl.getBoundingClientRect(); return Math.max(0, Math.min(d.total, ((ev.clientX - r.left) * (W / r.width) - ml) / (W - ml - mr) * d.total)); };
  const segA = x => d.segs.find(s => x >= s.x0 && x <= s.x1) || d.segs.at(-1);
  svgEl.onmousemove = ev => {
    const x = versX(ev), s = segA(x);
    const j = s.pr.findIndex(q => q[0] >= x), z = s.pr[Math.max(0, j)][1];
    const cur = el.querySelector('#profCurseur'); cur.setAttribute('x1', X(x)); cur.setAttribute('x2', X(x));
    const b = el.querySelector('#profBulle'); b.hidden = false; b.style.left = (X(x) / W * 100) + '%';
    b.textContent = `${chapSel ? '' : 'Étape ' + CHAP[s.id].n + ' · '}km ${(x - s.x0).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} · ${fmtNb(Math.round(z))} m`;
    const pos = pointA(s.id, x - s.x0);
    couches.curseur.clearLayers();
    if (pos) L.circleMarker(pos, { radius: 7, color: '#fff', weight: 2, fillColor: '#232826', fillOpacity: 1, interactive: false }).addTo(couches.curseur);
  };
  svgEl.onmouseleave = () => { couches.curseur.clearLayers(); const b = el.querySelector('#profBulle'); if (b) b.hidden = true; };
  svgEl.onclick = ev => {
    const pt = ev.target.closest('circle.photo');
    if (pt) return ouvrirVision(pt.dataset.id);
    if (!chapSel) choisir(segA(versX(ev)).id);
  };
}

/* ───────────────────────── panneau ───────────────────────── */
let observateur = null;
function vignettes(liste, conteneur) {
  observateur?.disconnect();
  observateur = new IntersectionObserver(es => es.forEach(async e => {
    if (!e.isIntersecting) return; observateur.unobserve(e.target);
    const img = e.target.querySelector('img'); img.src = await store.urlMiniature(e.target.dataset.id) || '';
  }), { root: $('#panneau'), rootMargin: '300px' });
  conteneur.querySelectorAll('.vignette').forEach(v => observateur.observe(v));
}
function rendrePanneau() {
  const el = $('#panneau');
  if (!chapSel) return rendreVueEnsemble(el);
  const c = CHAP[chapSel], info = index.chapitres[c.id] || {}, et = trace?.etapes?.[c.id], liste = photosDe(c.id);
  const i = CHAPITRES.indexOf(c), prec = CHAPITRES[i - 1], suiv = CHAPITRES[i + 1];
  el.innerHTML = `
    <div class="pan-tete" style="--c:${couleur(c)}">
      <div class="sur">${esc(c.titre)}${info.date ? ' · ' + esc(fmtJour(info.date)) : ''}</div>
      <h2>${esc(c.de ? `${c.de} → ${c.a}` : c.titre)}</h2>
      ${c.type !== 'etape' ? `<div class="trajet muted">${esc(c.sous)}</div>` : ''}
      ${c.note ? `<div class="note">${esc(c.note)}</div>` : ''}
      <div class="chiffres">
        ${et?.km ? `<div><b>${fmtNb(et.km)} km</b><span>distance${et.source === 'GPX' ? ' (GPX)' : ''}</span></div>` : ''}
        ${et?.dplus ? `<div><b>+${fmtNb(et.dplus)} m</b><span>montée</span></div><div><b>−${fmtNb(et.dmoins)} m</b><span>descente</span></div>` : ''}
        <div><b>${liste.length}</b><span>photo${liste.length > 1 ? 's' : ''}</span></div>
      </div>
      <div class="pan-nav">
        ${prec ? `<button class="btn" data-aller="${prec.id}">← ${esc(prec.type === 'etape' ? 'Étape ' + prec.n : prec.titre)}</button>` : ''}
        ${suiv ? `<button class="btn" data-aller="${suiv.id}">${esc(suiv.type === 'etape' ? 'Étape ' + suiv.n : suiv.titre)} →</button>` : ''}
        ${liste.length ? `<button class="btn primaire" id="diapoChap">▶ Diaporama</button>` : ''}
      </div>
    </div>
    <div class="pan-bloc">
      <h3>✍ Carnet <span class="etat-sauve" id="etatCarnet"></span></h3>
      <textarea class="carnet" id="carnet" placeholder="Les souvenirs de cette journée : la météo, les rencontres, le repas au refuge, les galères…">${esc(info.carnet)}</textarea>
    </div>
    <div class="pan-bloc">
      <h3>📷 Photos</h3>
      ${liste.length ? `<div class="galerie">${liste.map(([id, p]) => `<button class="vignette" data-id="${id}" title="${esc(p.legende || '')}"><img alt="">${p.livre ? '<span class="livre">📖</span>' : ''}<span class="heure">${esc(fmtHeure(p.date))}</span></button>`).join('')}</div>`
        : `<p class="vide-msg">Pas encore de photos pour ce chapitre. Elles arriveront avec le prochain export de la trieuse.</p>`}
    </div>`;
  el.querySelectorAll('[data-aller]').forEach(b => b.onclick = () => choisir(b.dataset.aller));
  $('#diapoChap') && ($('#diapoChap').onclick = () => lancerDiapo(c.id));
  const sauver = debounce(async v => { try { await store.majChapitre(c.id, { carnet: v }); $('#etatCarnet').textContent = 'Enregistré ✓'; } catch (e) { $('#etatCarnet').textContent = 'Erreur : ' + e.message; } }, 900);
  $('#carnet').oninput = e => { $('#etatCarnet').textContent = 'Enregistrement…'; sauver(e.target.value); };
  $('#carnet').onblur = () => setTimeout(() => { if (!$('#panneau').contains(document.activeElement)) rendreChapitres(); }, 1200);
  const gal = el.querySelector('.galerie');
  if (gal) {
    vignettes(null, gal);
    gal.onclick = e => { const v = e.target.closest('.vignette'); if (v) ouvrirVision(v.dataset.id, liste.map(x => x[0])); };
    gal.onmouseover = e => { const v = e.target.closest('.vignette'); marqueurs.forEach((m, id) => m.setStyle({ radius: v && id === v.dataset.id ? 11 : 6.5, weight: v && id === v.dataset.id ? 3 : 1.5 })); };
    gal.onmouseleave = () => marqueurs.forEach(m => m.setStyle({ radius: 6.5, weight: 1.5 }));
  }
}
function rendreVueEnsemble(el) {
  const etapes = CHAPITRES.filter(c => c.type === 'etape');
  const km = etapes.reduce((s, c) => s + (trace?.etapes?.[c.id]?.km || 0), 0);
  const dplus = etapes.reduce((s, c) => s + (trace?.etapes?.[c.id]?.dplus || 0), 0);
  const nb = toutesPhotos().length;
  const d1 = index.chapitres.e1?.date, d13 = index.chapitres.e13?.date;
  const unePar = CHAPITRES.map(c => { const l = photosDe(c.id); return l.length ? [c, (l.find(x => x[1].livre) || l[Math.floor(l.length / 2)])[0]] : null; }).filter(Boolean);
  el.innerHTML = `
    <div class="pan-tete">
      <div class="sur">Vue d’ensemble</div>
      <h2>${esc(titreSite)}</h2>
      <div class="trajet">${esc(sousTitre)}</div>
      <div class="chiffres">
        <div><b>13</b><span>étapes</span></div>
        ${km ? `<div><b>${fmtNb(Math.round(km))} km</b><span>sur le GR20</span></div>` : ''}
        ${dplus ? `<div><b>+${fmtNb(dplus)} m</b><span>de dénivelé</span></div>` : ''}
        <div><b>${nb}</b><span>photos</span></div>
      </div>
      ${d1 && d13 ? `<p class="muted" style="margin:10px 0 0">Du ${esc(fmtJour(d1))} au ${esc(fmtJour(d13))}</p>` : ''}
      <div class="pan-nav">${nb ? '<button class="btn primaire" id="diapoTout">▶ Revivre tout le voyage</button>' : ''}</div>
    </div>
    <div class="pan-bloc">
      <h3>Une photo par étape</h3>
      ${unePar.length ? `<div class="apercu-grille">${unePar.map(([c, id]) => `<button class="vignette" data-id="${id}" data-chap="${c.id}"><img alt=""><span class="heure">${esc(c.type === 'etape' ? 'Étape ' + c.n : c.titre)}</span></button>`).join('')}</div>`
        : `<p class="vide-msg">Aucune photo pour l’instant. Importe l’export de la trieuse dans <b>⚙ Gérer</b>.</p>`}
    </div>
    <div class="pan-bloc muted petit">Clique sur une étape (sur la carte, le profil ou dans la liste) pour voir ses photos et son carnet.
      ${trace ? '' : '<br><br>Le tracé affiché est provisoire (lignes droites) : construis le vrai tracé dans ⚙ Gérer → Tracé.'}</div>`;
  $('#diapoTout') && ($('#diapoTout').onclick = () => lancerDiapo(null));
  const g = el.querySelector('.apercu-grille');
  if (g) { vignettes(null, g); g.onclick = e => { const v = e.target.closest('.vignette'); if (v) choisir(v.dataset.chap); }; }
}

/* ───────────────────────── jauge ───────────────────────── */
function infosEspace() {
  const u = index.usage || { bytes: 0, count: 0 };
  const moy = u.count ? u.bytes / u.count : 700 * 1024;
  const pct = Math.min(100, u.bytes / LIMITE_OCTETS * 100);
  return { ...u, pct, reste: Math.max(0, Math.floor((LIMITE_OCTETS - u.bytes) / moy)), moy };
}
function rendreJaugeMini() {
  const j = infosEspace(), el = $('#jaugeMini');
  el.style.setProperty('--p', j.pct.toFixed(1) + '%');
  el.querySelector('b').textContent = Math.round(j.pct) + ' %';
  el.classList.toggle('alerte', j.pct >= 80);
  el.title = `${fmtMo(j.bytes)} utilisés sur 1 Go · encore ~${fmtNb(j.reste)} photos`;
}
$('#jaugeMini').onclick = () => ouvrirGerer();

/* ───────────────────────── visionneuse ───────────────────────── */
const vis = { liste: [], i: 0 };
function ouvrirVision(id, liste) {
  vis.liste = liste || (chapSel ? photosDe(chapSel) : toutesPhotos()).map(x => x[0]);
  if (!vis.liste.includes(id)) vis.liste = toutesPhotos().map(x => x[0]);
  vis.i = Math.max(0, vis.liste.indexOf(id));
  $('#vision').hidden = false;
  afficherVision();
}
async function afficherVision() {
  const id = vis.liste[vis.i], p = index.photos[id];
  if (!p || p.retiree) return fermerVision();
  const c = CHAP[p.chapitre];
  $('#vision').style.setProperty('--c', couleur(c));
  $('#visChap').textContent = c.type === 'etape' ? `${c.titre} · ${c.de} → ${c.a}` : c.titre;
  $('#visDate').textContent = p.date ? `${fmtJour(p.date)} à ${fmtHeure(p.date)}` : '';
  const leg = $('#visLegende'); if (document.activeElement !== leg) leg.value = p.legende || '';
  $('#visLivre').textContent = p.livre ? '📖 Dans le livre ✓' : '📖 Ajouter au livre';
  $('#visLivre').classList.toggle('actif', !!p.livre);
  $('#visCarte').disabled = p.lat == null;
  $('#visMeta').innerHTML = [`Photo ${vis.i + 1} / ${vis.liste.length}`, p.appareil ? esc(p.appareil) : '',
    p.lat != null ? (p.src === 'gps' ? 'Position GPS de la photo' : 'Position placée à la main') : 'Lieu inconnu',
    p.original ? `Original (pleine résolution) : <code>${esc(p.original)}</code>` : ''].filter(Boolean).join('<br>');
  const img = $('#visImg');
  img.src = await store.urlMiniature(id) || '';
  const url = await store.urlPhoto(id, p);
  if (vis.liste[vis.i] === id) img.src = url;
  // préchargement de la suivante
  const n = vis.liste[vis.i + 1]; if (n && index.photos[n]) store.urlPhoto(n, index.photos[n]).then(u => { new Image().src = u; }).catch(() => {});
}
function fermerVision() { $('#vision').hidden = true; $('#visImg').removeAttribute('src'); }
function visionAller(d) { const j = vis.i + d; if (j >= 0 && j < vis.liste.length) { vis.i = j; afficherVision(); } }
$('#visPrec').onclick = () => visionAller(-1);
$('#visSuiv').onclick = () => visionAller(1);
$('#visFermer').onclick = fermerVision;
const sauverLegende = debounce((id, v) => store.majPhoto(id, { legende: v }).catch(e => toast('Erreur : ' + e.message)), 800);
$('#visLegende').oninput = e => sauverLegende(vis.liste[vis.i], e.target.value);
$('#visLivre').onclick = async () => { const id = vis.liste[vis.i], p = index.photos[id]; await store.majPhoto(id, { livre: !p.livre }); toast(!p.livre ? 'Ajoutée au livre photo' : 'Retirée du livre photo'); };
$('#visCarte').onclick = () => {
  const id = vis.liste[vis.i], p = index.photos[id]; fermerVision();
  if (chapSel !== p.chapitre) choisir(p.chapitre, { ajuster: false });
  map.setView([p.lat, p.lng], 15); setTimeout(() => marqueurs.get(id)?.openTooltip(), 400);
};
$('#visTelecharger').onclick = async () => {
  const id = vis.liste[vis.i], p = index.photos[id];
  const r = await fetch(await store.urlPhoto(id, p));
  telecharger(await r.blob(), (p.original || id).split(/[\\/]/).pop().replace(/\.[^.]+$/, '') + '-web.jpg');
};
$('#visRetirer').onclick = async () => {
  const id = vis.liste[vis.i], p = index.photos[id];
  if (!confirm('Retirer cette photo du site ?\n\nElle est supprimée de Firebase (l’original sur ton ordinateur n’est pas touché) et ne reviendra pas lors des prochains imports.')) return;
  await store.retirerPhoto(id, p);
  vis.liste.splice(vis.i, 1);
  toast('Photo retirée');
  if (!vis.liste.length) fermerVision(); else { vis.i = Math.min(vis.i, vis.liste.length - 1); afficherVision(); }
};

/* ───────────────────────── diaporama ───────────────────────── */
let dp = null, carteDiapo = null, marqueurDiapo = null;
function lancerDiapo(chapId) {
  const liste = chapId ? photosDe(chapId) : toutesPhotos();
  if (!liste.length) return toast('Pas de photo à montrer');
  const items = []; let dernier = null;
  for (const [id, p] of liste) { if (p.chapitre !== dernier) { items.push({ titre: p.chapitre }); dernier = p.chapitre; } items.push({ id }); }
  dp = { items, i: -1, pause: false, h: null, face: 'A' };
  $('#diapo').hidden = false;
  if (!carteDiapo) {
    carteDiapo = L.map('diapoCarte', { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false });
    fondsIGN().plan.addTo(carteDiapo);
    marqueurDiapo = L.circleMarker([42.1, 9.1], { radius: 7, color: '#fff', weight: 2, fillColor: '#c4622d', fillOpacity: 1 }).addTo(carteDiapo);
  }
  carteDiapo.eachLayer(l => { if (l instanceof L.Polyline) carteDiapo.removeLayer(l); });
  for (const c of CHAPITRES.filter(c => c.type === 'etape')) for (const p of partiesEtape(c.id)) if (p.pts.length > 1) L.polyline(p.pts, { color: couleur(c), weight: 3, dashArray: p.h ? '5 5' : null }).addTo(carteDiapo);
  carteDiapo.setView([42.15, 9.05], 8);
  setTimeout(() => carteDiapo.invalidateSize(), 50);
  diapoAller(1);
}
function fermerDiapo() { if (!dp) return; clearTimeout(dp.h); dp = null; $('#diapo').hidden = true; $('#diapoA').removeAttribute('src'); $('#diapoB').removeAttribute('src'); }
async function diapoAller(delta) {
  if (!dp) return;
  clearTimeout(dp.h);
  let i = dp.i + delta;
  if (delta < 0 && dp.items[i]?.titre) i--;           // en arrière : on saute les cartons
  if (i < 0) i = 0;
  if (i >= dp.items.length) { fermerDiapo(); toast('Fin du voyage 🏁'); return; }
  dp.i = i;
  const it = dp.items[i], duree = +$('#diapoVitesse').value;
  $('#diapoCompteur').textContent = `${dp.items.slice(0, i + 1).filter(x => x.id).length} / ${dp.items.filter(x => x.id).length}`;
  if (it.titre) {
    const c = CHAP[it.titre], info = index.chapitres[c.id] || {};
    const ex = (info.carnet || '').trim();
    $('#diapoTitre').innerHTML = `<div class="sur">${esc(info.date ? fmtJour(info.date) : '')}</div><h2>${esc(c.titre)}</h2><div class="trajet">${esc(c.de ? `${c.de} → ${c.a}` : c.sous)}</div>${ex ? `<div class="carnet-extrait">« ${esc(ex.length > 260 ? ex.slice(0, 260) + '…' : ex)} »</div>` : ''}`;
    $('#diapoTitre').hidden = false; $('#diapoLegende').innerHTML = '';
    const pts = partiesEtape(c.id).flatMap(p => p.pts);
    if (pts.length) carteDiapo.flyToBounds(pts, { padding: [16, 16], duration: 1.2 });
    else { const ph = photosDe(c.id).filter(x => x[1].lat != null).map(x => [x[1].lat, x[1].lng]); if (ph.length) carteDiapo.flyToBounds(ph, { padding: [20, 20], maxZoom: 12 }); }
    programmer(Math.max(3000, duree * 0.7));
  } else {
    const p = index.photos[it.id];
    const url = await store.urlPhoto(it.id, p);
    if (!dp || dp.i !== i) return;
    const sur = dp.face === 'A' ? $('#diapoB') : $('#diapoA'), sous = dp.face === 'A' ? $('#diapoA') : $('#diapoB');
    await new Promise(ok => { sur.onload = sur.onerror = ok; sur.src = url; });
    if (!dp || dp.i !== i) return;
    $('#diapoTitre').hidden = true;
    sur.classList.add('visible'); sous.classList.remove('visible'); dp.face = dp.face === 'A' ? 'B' : 'A';
    const c = CHAP[p.chapitre];
    $('#diapoLegende').innerHTML = `${esc(p.legende || '')}<small>${esc(c.titre)} · ${esc(fmtJour(p.date, false))} ${esc(fmtHeure(p.date))}</small>`;
    if (p.lat != null) { marqueurDiapo.setLatLng([p.lat, p.lng]); carteDiapo.flyTo([p.lat, p.lng], Math.max(carteDiapo.getZoom(), 12), { duration: 1 }); }
    const n = dp.items[i + 1] || dp.items[i + 2];
    if (n?.id) store.urlPhoto(n.id, index.photos[n.id]).then(u => { new Image().src = u; }).catch(() => {});
    programmer(duree);
  }
}
function programmer(ms) {
  const b = $('#diapoProg'); b.style.transition = 'none'; b.style.width = '0';
  if (dp.pause) return;
  requestAnimationFrame(() => { b.style.transition = `width ${ms}ms linear`; b.style.width = '100%'; });
  dp.h = setTimeout(() => diapoAller(1), ms);
}
$('#diapoSuiv').onclick = () => diapoAller(1);
$('#diapoPrec').onclick = () => diapoAller(-1);
$('#diapoFermer').onclick = fermerDiapo;
$('#diapoPause').onclick = () => { if (!dp) return; dp.pause = !dp.pause; $('#diapoPause').textContent = dp.pause ? '▶' : '⏸'; if (dp.pause) { clearTimeout(dp.h); $('#diapoProg').style.transition = 'none'; } else diapoAller(0); };
$('#btnDiapo').onclick = () => lancerDiapo(chapSel);

/* ───────────────────────── clavier ───────────────────────── */
document.addEventListener('keydown', e => {
  if (e.target.matches('input,textarea,select')) { if (e.key === 'Escape') e.target.blur(); return; }
  if (dp) {
    if (e.key === 'ArrowRight') diapoAller(1); else if (e.key === 'ArrowLeft') diapoAller(-1);
    else if (e.key === ' ') { e.preventDefault(); $('#diapoPause').click(); } else if (e.key === 'Escape') fermerDiapo();
    return;
  }
  if (!$('#vision').hidden) {
    if (e.key === 'ArrowRight') visionAller(1); else if (e.key === 'ArrowLeft') visionAller(-1);
    else if (e.key === 'Escape') fermerVision(); else if (e.key.toLowerCase() === 'l') $('#visLivre').click();
    return;
  }
  if (document.querySelector('dialog[open]')) return;
  const i = CHAPITRES.findIndex(c => c.id === chapSel);
  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); choisir(CHAPITRES[Math.min(i + 1, CHAPITRES.length - 1)].id); }
  if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); i > 0 ? choisir(CHAPITRES[i - 1].id) : choisir(null); }
  if (e.key === 'Escape') { if (placementLieu) { finPlacement(); toast('Placement annulé'); } else choisir(null); }
});

/* ───────────────────────── livre photo ───────────────────────── */
const optsLivre = () => ({ format: 'carre', parPage: 1, legendes: true, pagesEtape: true, ...lsGet('gr20-livre', {}) });
function ouvrirLivre() {
  const o = optsLivre(), dlg = $('#dlgLivre');
  const chaps = CHAPITRES.map(c => [c, photosDe(c.id)]).filter(x => x[1].length);
  dlg.innerHTML = `
    <div class="fen-tete"><h2>📖 Livre photo</h2><span class="muted" id="livreCompte"></span><button class="fermer" data-fermer>✕</button></div>
    <div class="fen-corps">
      <div class="options-livre">
        <label class="champ"><span>Format</span><select id="lvFormat">${Object.entries(FORMATS).map(([k, f]) => `<option value="${k}" ${o.format === k ? 'selected' : ''}>${f.nom}</option>`).join('')}</select></label>
        <label class="champ"><span>Mise en page</span><select id="lvPar"><option value="1" ${o.parPage == 1 ? 'selected' : ''}>1 photo par page</option><option value="2" ${o.parPage == 2 ? 'selected' : ''}>2 photos par page</option></select></label>
        <label class="champ"><span>Contenu</span>
          <label><input type="checkbox" id="lvLeg" ${o.legendes ? 'checked' : ''}> Légendes et dates</label><br>
          <label><input type="checkbox" id="lvEtape" ${o.pagesEtape ? 'checked' : ''}> Une page d’ouverture par étape (tracé, profil, carnet)</label></label>
      </div>
      <p class="qualite" id="lvQualite"></p>
      <p class="muted petit">Clique sur les photos pour les ajouter au livre ou les en retirer. Vous pouvez préparer le livre à deux : chaque choix est enregistré pour vous deux.</p>
      ${chaps.map(([c, l]) => `<div class="livre-chap" data-chap="${c.id}"><h4 style="color:${couleur(c)}">${esc(c.titre)} <span class="muted">${esc(c.de ? c.de + ' → ' + c.a : '')}</span>
          <button class="btn petit" data-tout="${c.id}" style="margin-left:auto">Tout</button><button class="btn petit" data-rien="${c.id}">Aucune</button></h4>
        <div class="livre-grille">${l.map(([id, p]) => `<button class="vignette ${p.livre ? 'choisie' : ''}" data-id="${id}"><img alt=""><span class="coche">✓</span></button>`).join('')}</div></div>`).join('') || '<p class="vide-msg">Aucune photo sur le site pour l’instant.</p>'}
      <div class="ligne-actions" style="position:sticky;bottom:0;background:var(--carte);padding:12px 0 2px;border-top:1px solid var(--trait)">
        <button class="btn primaire" id="lvPDF">Générer le PDF</button>
        <button class="btn" id="lvHD" title="Pour imprimer en très grand format à partir des originaux">Liste pour la version haute définition</button>
        <span class="muted petit" id="lvEtat"></span>
      </div>
      <div class="barre-prog" id="lvBarre" hidden><i></i></div>
    </div>`;
  const majOpts = () => { lsSet('gr20-livre', { format: $('#lvFormat').value, parPage: +$('#lvPar').value, legendes: $('#lvLeg').checked, pagesEtape: $('#lvEtape').checked }); majLivreCompteurs(); };
  ['#lvFormat', '#lvPar', '#lvLeg', '#lvEtape'].forEach(s => $(s).onchange = majOpts);
  dlg.querySelector('[data-fermer]').onclick = () => dlg.close();
  const obs = new IntersectionObserver(es => es.forEach(async e => { if (!e.isIntersecting) return; obs.unobserve(e.target); e.target.querySelector('img').src = await store.urlMiniature(e.target.dataset.id) || ''; }), { root: dlg, rootMargin: '300px' });
  dlg.querySelectorAll('.vignette').forEach(v => obs.observe(v));
  dlg.onclick = async e => {
    const v = e.target.closest('.livre-grille .vignette');
    if (v) { const on = !v.classList.contains('choisie'); v.classList.toggle('choisie', on); await store.majPhoto(v.dataset.id, { livre: on }); return; }
    const t = e.target.closest('[data-tout],[data-rien]');
    if (t) {
      const on = !!t.dataset.tout, id = t.dataset.tout || t.dataset.rien;
      for (const [pid, p] of photosDe(id)) if (!!p.livre !== on) { dlg.querySelector(`.vignette[data-id="${CSS.escape(pid)}"]`)?.classList.toggle('choisie', on); await store.majPhoto(pid, { livre: on }); }
    }
  };
  $('#lvPDF').onclick = async () => {
    const opt = optsLivre();
    $('#lvPDF').disabled = true; $('#lvBarre').hidden = false; $('#lvEtat').textContent = 'Préparation du livre…';
    try {
      const blob = await genererPDF({ store, index, trace, format: opt.format, parPage: +opt.parPage, legendes: opt.legendes, pagesEtape: opt.pagesEtape, titre: titreSite, sousTitre,
        progression: f => { $('#lvBarre i').style.width = (f * 100) + '%'; $('#lvEtat').textContent = `Mise en page… ${Math.round(f * 100)} %`; } });
      telecharger(blob, `livre-gr20-${opt.format}.pdf`);
      $('#lvEtat').textContent = `PDF prêt (${fmtMo(blob.size)}).`;
    } catch (e) { $('#lvEtat').textContent = 'Erreur : ' + e.message; }
    $('#lvPDF').disabled = false; setTimeout(() => { $('#lvBarre').hidden = true; }, 1500);
  };
  $('#lvHD').onclick = () => {
    const l = listeHD(index, optsLivre());
    if (!l.chapitres.length) return toast('Aucune photo sélectionnée pour le livre');
    telecharger(new Blob([JSON.stringify(l, null, 1)], { type: 'application/json' }), 'livre-gr20-hd.json');
    toast('Ouvre ce fichier dans la trieuse (bouton « Livre HD ») pour obtenir les originaux dans l’ordre du livre.', 7000);
  };
  majLivreCompteurs();
  dlg.showModal();
}
function majLivreCompteurs() {
  const n = Object.values(index.photos).filter(p => !p.retiree && p.livre).length, o = optsLivre();
  const el = $('#livreCompte'); if (!el) return;
  el.textContent = `${n} photo${n > 1 ? 's' : ''} sélectionnée${n > 1 ? 's' : ''}`;
  const dpi = dpiEstime(o.format, +o.parPage);
  $('#lvQualite').innerHTML = `Qualité d’impression avec les photos du site (2000 px) : <b>~${dpi} dpi</b> — ${dpi >= 240 ? 'très bien pour ce format.' : dpi >= 170 ? 'correct ; pour un rendu parfait, utilise la version haute définition.' : 'un peu juste ; préfère la version haute définition (originaux).'}`;
  $('#lvPDF').disabled = !n;
}
$('#btnLivre').onclick = ouvrirLivre;

/* ───────────────────────── gérer ───────────────────────── */
let placementLieu = null;
function finPlacement() { placementLieu = null; $('#carte').style.cursor = ''; bandeau(store.mode === 'apercu' ? 'Mode aperçu : rien n’est enregistré en ligne.' : ''); }
let importEnCours = false;
function ouvrirGerer() { rendreGerer(false); $('#dlgGerer').showModal(); }
function rendreGerer(majSeule) {
  const dlg = $('#dlgGerer'), j = infosEspace();
  const retirees = Object.entries(index.photos).filter(([, p]) => p.retiree);
  const htmlEspace = `<div class="jauge ${j.pct >= 80 ? 'alerte' : ''}"><i style="width:${j.pct.toFixed(1)}%"></i></div>
    <b>${fmtMo(j.bytes)}</b> utilisés sur 1 Go (${j.pct.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %) · ${fmtNb(j.count)} photos ·
    place pour encore <b>~${fmtNb(j.reste)} photos</b> <span class="muted">(${fmtMo(j.moy)} en moyenne par photo)</span>${j.pct >= 80 ? '<br><b style="color:var(--ocre)">⚠ L’espace gratuit se remplit : fais le tri dans les photos les moins importantes.</b>' : ''}`;
  if (majSeule && dlg.querySelector('#gEspace')) {
    dlg.querySelector('#gEspace').innerHTML = htmlEspace;
    dlg.querySelector('#gRetirees').innerHTML = htmlRetirees(retirees);
    return;
  }
  dlg.innerHTML = `
    <div class="fen-tete"><h2>⚙ Gérer le site</h2><button class="fermer" data-fermer>✕</button></div>
    <div class="fen-corps">
      <div class="fen-section"><h3>Espace de stockage (Firebase gratuit)</h3><div id="gEspace">${htmlEspace}</div></div>
      <div class="fen-section"><h3>Importer un export de la trieuse</h3>
        <p class="muted">Choisis le fichier <code>gr20-selection-….zip</code>. Les nouvelles photos sont ajoutées, celles déjà présentes sont mises à jour (étape, lieu), et les photos retirées du site ne reviennent pas.</p>
        <div class="ligne-actions"><label class="btn primaire">📦 Choisir le ZIP<input type="file" id="gZip" accept=".zip" hidden></label><span id="gImportEtat" class="muted"></span></div>
        <div class="barre-prog" id="gBarre" hidden><i></i></div>
        <div class="journal" id="gJournal" hidden></div>
        <div id="gAbsentes"></div>
      </div>
      <div class="fen-section"><h3>Tracé du GR20</h3>
        <p>${trace ? `Construit le ${esc(new Date(trace.construit).toLocaleString('fr-FR'))} depuis ${esc(trace.source)}${trace.modifie ? ` · modifié le ${esc(new Date(trace.modifie).toLocaleString('fr-FR'))}` : ''}.` : 'Pas encore de tracé : la carte affiche des lignes droites provisoires entre les lieux de nuit.'}</p>
        ${trace?.avertissements?.length ? `<details><summary class="muted">${trace.avertissements.length} remarque(s)</summary><ul class="petit">${trace.avertissements.map(a => `<li>${esc(a)}</li>`).join('')}</ul></details>` : ''}
        <div class="ligne-actions" style="margin-top:8px">
          <button class="btn primaire" id="gTrace">${trace ? '↻ Reconstruire' : 'Construire'} le tracé (OpenStreetMap + altitudes IGN)</button>
          ${trace ? '<button class="btn" id="gGPX">⬇ Télécharger le tracé (GPX)</button>' : ''}
        </div>
        <p class="muted petit" style="margin:10px 0 4px">Une étape n’est pas juste ? Remplace-la par un fichier GPX (Visorando, Komoot…) :</p>
        <div class="ligne-actions"><select id="gEtapeGPX">${CHAPITRES.filter(c => c.type === 'etape').map(c => `<option value="${c.id}">${esc(c.titre)} · ${esc(c.de)} → ${esc(c.a)}</option>`).join('')}</select>
          <label class="btn">Choisir un GPX<input type="file" id="gFichierGPX" accept=".gpx,application/gpx+xml" hidden></label></div>
        <p class="muted petit" style="margin:12px 0 4px">Un lieu de nuit est mal placé ? Place-le toi-même sur la carte, puis reconstruis le tracé :</p>
        <div class="ligne-actions"><select id="gLieu">${Object.entries(WAYPOINTS).map(([k, w]) => `<option value="${k}">${esc(w.nom)}${index.lieux?.[k] ? ' (placé à la main ✓)' : ''}</option>`).join('')}</select>
          <button class="btn" id="gPlacer">📍 Placer sur la carte</button></div>
        <div class="journal" id="gTraceJournal" hidden></div>
      </div>
      <div class="fen-section"><h3>Photos retirées</h3><div id="gRetirees">${htmlRetirees(retirees)}</div></div>
      <div class="fen-section"><h3>Sauvegarde</h3>
        <p class="muted">Les textes (carnets, légendes, choix du livre) sont dans Firebase. Une copie de sécurité ne coûte rien :</p>
        <button class="btn" id="gSauve">⬇ Télécharger les textes et réglages (JSON)</button></div>
    </div>`;
  dlg.querySelector('[data-fermer]').onclick = () => { if (!importEnCours) dlg.close(); };
  $('#gZip').onchange = e => { if (e.target.files[0]) lancerImport(e.target.files[0]); e.target.value = ''; };
  $('#gTrace').onclick = lancerTrace;
  $('#gPlacer').onclick = () => {
    const k = $('#gLieu').value, p = index.lieux?.[k] || trace?.lieux?.[k] || WAYPOINTS[k];
    $('#dlgGerer').close();
    placementLieu = k;
    $('#carte').style.cursor = 'crosshair';
    bandeau(`📍 Clique sur la carte à l’emplacement exact de « ${WAYPOINTS[k].nom} » (zoome si besoin). Échap pour annuler.`);
    map.setView([p.lat, p.lng], 15);
  };
  $('#gGPX') && ($('#gGPX').onclick = () => telecharger(new Blob([traceEnGPX(trace)], { type: 'application/gpx+xml' }), 'gr20-notre-trace.gpx'));
  $('#gFichierGPX').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const id = $('#gEtapeGPX').value, jr = $('#gTraceJournal'); jr.hidden = false; jr.textContent = `Lecture de ${f.name}…\n`;
    try {
      const et = await etapeDepuisGPX(await f.text(), m => { jr.textContent += m + '\n'; });
      trace = trace ? structuredClone(trace) : { version: 1, construit: new Date().toISOString(), source: 'GPX', etapes: {}, avertissements: [] };
      trace.etapes[id] = et; trace.modifie = new Date().toISOString();
      await store.enregistrerTrace(trace);
      jr.textContent += `✓ ${CHAP[id].titre} remplacée (${et.km} km, +${et.dplus} m).\n`;
      rendreTout(false);
    } catch (err) { jr.textContent += '✕ ' + err.message + '\n'; }
  };
  $('#gSauve').onclick = () => telecharger(new Blob([JSON.stringify({ exporte: new Date().toISOString(), chapitres: index.chapitres, photos: index.photos }, null, 1)], { type: 'application/json' }), `gr20-site-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`);
  dlg.querySelector('#gRetirees').onclick = async e => {
    const b = e.target.closest('[data-retour]'); if (!b) return;
    await store.oublierRetrait(b.dataset.retour); toast('Elle reviendra au prochain import si elle est dans la sélection');
  };
}
function htmlRetirees(l) {
  if (!l.length) return '<p class="muted">Aucune.</p>';
  return `<p class="muted petit">Ces photos ne reviendront pas lors des imports. « Autoriser le retour » permet de les réimporter.</p><div class="liste-retirees">${l.map(([id, p]) => `<div><span>${esc((p.original || id).split(/[\\/]/).pop())}</span><span class="muted">${esc(CHAP[p.chapitre]?.titre || '')}</span><button class="btn petit" data-retour="${id}">Autoriser le retour</button></div>`).join('')}</div>`;
}
async function lancerImport(f) {
  importEnCours = true;
  const jr = $('#gJournal'), barre = $('#gBarre'), etat = $('#gImportEtat');
  jr.hidden = false; jr.textContent = ''; barre.hidden = false; $('#gAbsentes').innerHTML = '';
  const log = m => { jr.textContent += m + '\n'; jr.scrollTop = jr.scrollHeight; };
  try {
    const { st, absentes } = await importerExport(store, structuredClone(index), f, log, x => { barre.querySelector('i').style.width = (x * 100) + '%'; etat.textContent = `${Math.round(x * 100)} %`; });
    etat.textContent = '';
    log(`\nTerminé : ${st.ajoutees} ajoutée(s), ${st.majs} mise(s) à jour, ${st.identiques} déjà à jour, ${st.retirees} ignorée(s) car retirée(s)${st.ignorees ? `, ${st.ignorees} hors chapitre` : ''}${st.erreurs ? `, ${st.erreurs} erreur(s)` : ''}.`);
    toast(`Import terminé : ${st.ajoutees} nouvelle(s) photo(s)`);
    if (absentes.length) {
      $('#gAbsentes').innerHTML = `<div class="qualite" style="margin-top:10px">${absentes.length} photo(s) du site ne sont pas dans cet export (tu as peut-être retiré leur étoile dans la trieuse).
        <div class="ligne-actions" style="margin-top:8px"><button class="btn danger" id="gRetirerAbs">Les retirer du site</button><button class="btn" id="gGarderAbs">Les garder</button></div></div>`;
      $('#gGarderAbs').onclick = () => { $('#gAbsentes').innerHTML = ''; };
      $('#gRetirerAbs').onclick = async () => {
        $('#gRetirerAbs').disabled = true;
        for (const id of absentes) { const p = index.photos[id]; if (p && !p.retiree) await store.retirerPhoto(id, p); }
        $('#gAbsentes').innerHTML = `<p class="muted">${absentes.length} photo(s) retirée(s).</p>`;
      };
    }
  } catch (e) { log('✕ ' + e.message); etat.textContent = 'Échec'; }
  importEnCours = false;
  setTimeout(() => { barre.hidden = true; }, 1200);
}
async function lancerTrace() {
  const b = $('#gTrace'), jr = $('#gTraceJournal');
  b.disabled = true; jr.hidden = false; jr.textContent = '';
  const log = m => { jr.textContent += m + '\n'; jr.scrollTop = jr.scrollHeight; };
  try {
    const t = await construireTrace(log, index.lieux || {});
    const taille = JSON.stringify(t).length;
    if (taille > 950000) throw new Error('Tracé trop volumineux pour Firestore (' + fmtMo(taille) + ')');
    await store.enregistrerTrace(t);
    trace = t; cacheProj.clear();
    log(`✓ Tracé enregistré (${fmtNb(Math.round(Object.values(t.etapes).reduce((s, e) => s + (e.km || 0), 0)))} km).`);
    rendreTout(true);
    setTimeout(() => rendreGerer(false), 1500);
  } catch (e) { log('✕ ' + e.message); b.disabled = false; }
}
$('#btnGerer').onclick = ouvrirGerer;

demarrer();
