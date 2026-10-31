// Import d'un export de la trieuse (ZIP contenant data.json + photos + miniatures)
import { chapitreDepuisExport } from './itinerary.js';
import { idPhoto, LIMITE_OCTETS } from './store.js';

export async function importerExport(store, index, fichier, log, progression) {
  log('Ouverture du fichier…');
  const zip = await window.JSZip.loadAsync(fichier);
  const fj = zip.file('data.json');
  if (!fj) throw new Error('data.json introuvable : ce fichier est-il bien un export de la trieuse ?');
  const data = JSON.parse(await fj.async('string'));

  const versChap = {};
  for (const ch of data.chapitres || []) {
    const c = chapitreDepuisExport(ch);
    if (!c) continue;
    versChap[ch.dossier] = c;
    const actuel = index.chapitres[c] || {}, maj = {};
    if (ch.date && actuel.date !== ch.date) maj.date = ch.date;
    if (ch.carnet && !actuel.carnet) maj.carnet = ch.carnet;     // le carnet modifié sur le site reste prioritaire
    if (Object.keys(maj).length) await store.majChapitre(c, maj);
  }

  const st = { ajoutees: 0, majs: 0, identiques: 0, retirees: 0, ignorees: 0, erreurs: 0 };
  const vus = new Set();
  let octets = index.usage.bytes || 0;
  const photos = data.photos || [];
  for (let i = 0; i < photos.length; i++) {
    const p = photos[i];
    progression?.(i / photos.length);
    const chap = versChap[p.chapitre];
    if (!chap) { st.ignorees++; continue; }
    // identifiant stable (et unique si deux fichiers ont le même nom)
    let id = idPhoto(p.original || p.fichier), n = 2;
    while ((vus.has(id) || (index.photos[id] && index.photos[id].original && p.original && index.photos[id].original !== p.original)) && n < 50) id = idPhoto(p.original || p.fichier) + '-' + n++;
    vus.add(id);
    const ex = index.photos[id];
    if (ex?.retiree) { st.retirees++; continue; }
    const meta = { chapitre: chap, date: p.date || null, lat: p.lat ?? null, lng: p.lng ?? null, src: p.source_lieu || null, appareil: p.appareil || '', original: p.original || '' };
    if (ex) {
      const maj = {};
      for (const k of ['chapitre', 'date', 'lat', 'lng', 'src']) if ((ex[k] ?? null) !== meta[k]) maj[k] = meta[k];
      if (p.legende && !ex.legende) maj.legende = p.legende;
      if (Object.keys(maj).length) { await store.majPhoto(id, maj); st.majs++; } else st.identiques++;
      continue;
    }
    try {
      const fPhoto = zip.file(p.fichier), fMini = zip.file(p.miniature);
      if (!fPhoto) throw new Error('fichier manquant ' + p.fichier);
      const blobPhoto = new Blob([await fPhoto.async('arraybuffer')], { type: 'image/jpeg' });
      const blobMini = fMini ? new Blob([await fMini.async('arraybuffer')], { type: 'image/jpeg' }) : blobPhoto;
      const estimation = (blobPhoto.size + blobMini.size) * 4 / 3;
      if (octets + estimation > LIMITE_OCTETS * 0.98) { log('⚠ Espace gratuit presque plein : import arrêté.'); break; }
      octets += await store.ajouterPhoto(id, { ...meta, legende: p.legende || '', livre: false }, blobMini, blobPhoto);
      st.ajoutees++;
      log(`+ ${p.original || p.fichier}`);
    } catch (e) { st.erreurs++; log(`✕ ${p.fichier} : ${e.message}`); }
  }
  progression?.(1);
  const absentes = Object.entries(index.photos).filter(([id, p]) => !p.retiree && !vus.has(id)).map(([id]) => id);
  return { st, absentes };
}
