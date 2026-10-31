// Accès aux données : Firebase (Firestore + connexion Google) ou mode aperçu local.
import { firebaseConfig } from './config.js';

export const LIMITE_OCTETS = 1024 ** 3;           // 1 Go gratuit Firestore
const TAILLE_MORCEAU = 900000;                     // < 1 Mo par document Firestore
const VERSION_FIREBASE = '10.12.2';

export const estConfigure = () => !!firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('A_REMPLIR');
export async function creerStore() {
  const s = estConfigure() ? new FirebaseStore() : new ApercuStore();
  await s.init();
  return s;
}

function normaliser(d) {
  d = d || {};
  return { chapitres: d.chapitres || {}, photos: d.photos || {}, usage: { bytes: d.usage?.bytes || 0, count: d.usage?.count || 0 } };
}
const blobEnBase64 = blob => new Promise((ok, ko) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(',')[1]);
  r.onerror = ko;
  r.readAsDataURL(blob);
});
function base64EnOctets(b64) {
  const bin = atob(b64); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

/* ─────────────────────────── Firebase ─────────────────────────── */
class FirebaseStore {
  mode = 'firebase';
  urls = new Map();

  async init() {
    const base = `https://www.gstatic.com/firebasejs/${VERSION_FIREBASE}/`;
    const [appM, authM, fs] = await Promise.all([
      import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')]);
    this.fs = fs; this.authM = authM;
    const app = appM.initializeApp(firebaseConfig);
    this.auth = authM.getAuth(app);
    try {
      this.db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager(), cacheSizeBytes: fs.CACHE_SIZE_UNLIMITED }) });
    } catch (e) { this.db = fs.getFirestore(app); }
    this.refIndex = fs.doc(this.db, 'site', 'index');
    this.refTrace = fs.doc(this.db, 'site', 'trace');
  }
  onUser(cb) { this.authM.onAuthStateChanged(this.auth, u => cb(u ? { nom: u.displayName || u.email, email: (u.email || '').toLowerCase(), photo: u.photoURL } : null)); }
  connexion() { return this.authM.signInWithPopup(this.auth, new this.authM.GoogleAuthProvider()); }
  deconnexion() { return this.authM.signOut(this.auth); }

  ecouterIndex(cb, erreur) {
    return this.fs.onSnapshot(this.refIndex, s => cb(normaliser(s.exists() ? s.data() : null)), erreur);
  }
  async _doc(ref) {
    try { const s = await this.fs.getDocFromCache(ref); if (s.exists()) return s; } catch (e) { /* pas en cache */ }
    return this.fs.getDoc(ref);
  }
  async _assurerIndex() {
    const s = await this.fs.getDoc(this.refIndex);
    if (!s.exists()) await this.fs.setDoc(this.refIndex, { chapitres: {}, photos: {}, usage: { bytes: 0, count: 0 } });
  }
  async _maj(paires) {
    const args = [];
    for (const [chemin, valeur] of paires) args.push(new this.fs.FieldPath(...chemin), valeur);
    await this.fs.updateDoc(this.refIndex, ...args);
  }

  async urlMiniature(id) {
    const s = await this._doc(this.fs.doc(this.db, 'miniatures', id));
    return s.exists() ? 'data:image/jpeg;base64,' + s.data().d : null;
  }
  async _base64Photo(id, morceaux) {
    const docs = await Promise.all(Array.from({ length: morceaux || 1 }, (_, i) => this._doc(this.fs.doc(this.db, 'photos', `${id}_${i}`))));
    return docs.map(d => d.data().d).join('');
  }
  async octetsPhoto(id, p) { return base64EnOctets(await this._base64Photo(id, p.chunks)); }
  async urlPhoto(id, p) {
    if (this.urls.has(id)) return this.urls.get(id);
    const url = URL.createObjectURL(new Blob([await this.octetsPhoto(id, p)], { type: 'image/jpeg' }));
    this.urls.set(id, url);
    return url;
  }

  async majPhoto(id, champs) { await this._maj(Object.entries(champs).map(([k, v]) => [['photos', id, k], v])); }
  async majChapitre(id, champs) {
    await this._assurerIndex();
    await this._maj(Object.entries(champs).map(([k, v]) => [['chapitres', id, k], v]));
  }

  async ajouterPhoto(id, meta, blobMini, blobPhoto) {
    await this._assurerIndex();
    const mini = await blobEnBase64(blobMini), full = await blobEnBase64(blobPhoto);
    const n = Math.ceil(full.length / TAILLE_MORCEAU);
    const batch = this.fs.writeBatch(this.db);
    batch.set(this.fs.doc(this.db, 'miniatures', id), { d: mini });
    for (let i = 0; i < n; i++) batch.set(this.fs.doc(this.db, 'photos', `${id}_${i}`), { d: full.slice(i * TAILLE_MORCEAU, (i + 1) * TAILLE_MORCEAU) });
    await batch.commit();
    const octets = mini.length + full.length + 300;
    await this._maj([[['photos', id], { ...meta, chunks: n, bytes: octets }],
      [['usage', 'bytes'], this.fs.increment(octets)], [['usage', 'count'], this.fs.increment(1)]]);
    return octets;
  }
  async retirerPhoto(id, p) {
    const batch = this.fs.writeBatch(this.db);
    batch.delete(this.fs.doc(this.db, 'miniatures', id));
    for (let i = 0; i < (p.chunks || 1); i++) batch.delete(this.fs.doc(this.db, 'photos', `${id}_${i}`));
    await batch.commit();
    await this._maj([[['photos', id], { retiree: true, original: p.original || '', chapitre: p.chapitre || '', date: p.date || null }],
      [['usage', 'bytes'], this.fs.increment(-(p.bytes || 0))], [['usage', 'count'], this.fs.increment(-1)]]);
    this.urls.delete(id);
  }
  async oublierRetrait(id) { await this._maj([[['photos', id], this.fs.deleteField()]]); }

  async lireTrace() {
    try { const s = await this.fs.getDoc(this.refTrace); return s.exists() ? s.data() : null; }
    catch (e) { const s = await this._doc(this.refTrace).catch(() => null); return s?.exists() ? s.data() : null; }
  }
  async enregistrerTrace(t) { await this.fs.setDoc(this.refTrace, t); }
}

/* ─────────────────────────── Aperçu local ───────────────────────────
   Sans configuration Firebase : rien n'est enregistré en ligne.
   Charge demo/data.json s'il existe (tests), sinon part de zéro ;
   un export de la trieuse peut être importé pour prévisualiser.        */
class ApercuStore {
  mode = 'apercu';
  idx = normaliser();
  fichiers = new Map();    // id -> {mini: url, photo: url|Blob}
  ecouteurs = [];
  CLE = 'gr20-site-apercu';

  async init() {
    try {
      const r = await fetch('demo/data.json');
      if (r.ok) {
        const { chapitreDepuisExport } = await import('./itinerary.js');
        const d = await r.json();
        const chap = {};
        for (const c of d.chapitres) { const id = chapitreDepuisExport(c); if (id) { chap[c.dossier] = id; this.idx.chapitres[id] = { date: c.date, carnet: c.carnet || '' }; } }
        for (const p of d.photos) {
          const c = chap[p.chapitre]; if (!c) continue;
          const id = idPhoto(p.original || p.fichier);
          this.idx.photos[id] = { chapitre: c, date: p.date, lat: p.lat, lng: p.lng, src: p.source_lieu, legende: p.legende || '', appareil: p.appareil || '', original: p.original || '', chunks: 1, bytes: 700000 };
          this.fichiers.set(id, { mini: 'demo/' + p.miniature, photo: 'demo/' + p.fichier });
        }
      }
    } catch (e) { /* pas de démo */ }
    try {
      const m = JSON.parse(localStorage.getItem(this.CLE) || '{}');
      for (const [id, v] of Object.entries(m.photos || {})) if (this.idx.photos[id]) Object.assign(this.idx.photos[id], v);
      for (const [id, v] of Object.entries(m.chapitres || {})) this.idx.chapitres[id] = { ...(this.idx.chapitres[id] || {}), ...v };
      this.traceLocale = m.trace || null;
    } catch (e) { /* stockage indisponible */ }
    this._recalcul();
  }
  _recalcul() {
    const vis = Object.values(this.idx.photos).filter(p => !p.retiree);
    this.idx.usage = { count: vis.length, bytes: vis.reduce((s, p) => s + (p.bytes || 0), 0) };
  }
  _memo(fn) {
    try { const m = JSON.parse(localStorage.getItem(this.CLE) || '{}'); fn(m); localStorage.setItem(this.CLE, JSON.stringify(m)); } catch (e) { /* ignoré */ }
  }
  _emettre() { this._recalcul(); const copie = structuredClone(this.idx); this.ecouteurs.forEach(cb => cb(copie)); }

  onUser(cb) { cb({ nom: 'Aperçu local', email: '', photo: null, apercu: true }); }
  connexion() {} deconnexion() {}
  ecouterIndex(cb) { this.ecouteurs.push(cb); cb(structuredClone(this.idx)); return () => {}; }

  async urlMiniature(id) { return this.fichiers.get(id)?.mini || null; }
  async urlPhoto(id) { return this.fichiers.get(id)?.photo || null; }
  async octetsPhoto(id) { const r = await fetch(await this.urlPhoto(id)); return new Uint8Array(await r.arrayBuffer()); }

  async majPhoto(id, champs) {
    Object.assign(this.idx.photos[id] ||= {}, champs);
    this._memo(m => { (m.photos ||= {})[id] = { ...(m.photos[id] || {}), ...champs }; });
    this._emettre();
  }
  async majChapitre(id, champs) {
    Object.assign(this.idx.chapitres[id] ||= {}, champs);
    this._memo(m => { (m.chapitres ||= {})[id] = { ...(m.chapitres[id] || {}), ...champs }; });
    this._emettre();
  }
  async ajouterPhoto(id, meta, blobMini, blobPhoto) {
    const octets = Math.round((blobMini.size + blobPhoto.size) * 4 / 3) + 300;
    this.idx.photos[id] = { ...meta, chunks: 1, bytes: octets };
    this.fichiers.set(id, { mini: URL.createObjectURL(blobMini), photo: URL.createObjectURL(blobPhoto) });
    this._emettre();
    return octets;
  }
  async retirerPhoto(id, p) {
    this.idx.photos[id] = { retiree: true, original: p.original || '', chapitre: p.chapitre || '', date: p.date || null };
    this._memo(m => { (m.photos ||= {})[id] = { retiree: true }; });
    this._emettre();
  }
  async oublierRetrait(id) { delete this.idx.photos[id]; this._memo(m => { if (m.photos) delete m.photos[id]; }); this._emettre(); }
  async lireTrace() { return this.traceLocale; }
  async enregistrerTrace(t) { this.traceLocale = t; this._memo(m => { m.trace = t; }); }
}

// Identifiant stable d'une photo : le nom du fichier original (sans extension)
export function idPhoto(chemin) {
  const base = String(chemin || '').split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
  return base.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'photo';
}
