// Livre photo : génération d'un PDF prêt à imprimer + liste pour la version haute définition (trieuse).
import { CHAPITRES, couleurEtape } from './itinerary.js';
import { paires } from './trace.js';

export const FORMATS = {
  carre: { nom: 'Carré 21 × 21 cm', w: 210, h: 210 },
  a4l:   { nom: 'A4 paysage (29,7 × 21 cm)', w: 297, h: 210 },
  a4p:   { nom: 'A4 portrait (21 × 29,7 cm)', w: 210, h: 297 },
};

// Résolution obtenue pour une photo de 2000 px occupant toute la largeur utile
export function dpiEstime(format, parPage) {
  const f = FORMATS[format], larg = (parPage === 2 && f.w > f.h ? f.w / 2 : f.w) - 24;
  return Math.round(2000 / (larg / 25.4));
}

// Polices standard PDF : on remplace les caractères hors Latin-1
const txt = s => String(s || '').replace(/[’‘]/g, "'").replace(/[“”«»]/g, '"').replace(/→/g, '>').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/[^\x00-\xFF]/g, '');
const fmtDate = d => d ? new Date(d.length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '';
const rgb = s => s.match(/\d+/g).map(Number);

async function dimensions(octets) {
  const bmp = await createImageBitmap(new Blob([octets], { type: 'image/jpeg' }));
  const d = { w: bmp.width, h: bmp.height }; bmp.close?.(); return d;
}

export async function genererPDF({ store, index, trace, format, parPage, legendes, pagesEtape, titre, sousTitre, progression }) {
  const { jsPDF } = window.jspdf;
  const F = FORMATS[format], W = F.w, H = F.h, M = 12;
  const doc = new jsPDF({ unit: 'mm', format: [W, H], orientation: W > H ? 'landscape' : 'portrait', compress: true });
  const chapitres = CHAPITRES.map(c => ({ c, photos: Object.entries(index.photos).filter(([, p]) => !p.retiree && p.livre && p.chapitre === c.id).sort((a, b) => String(a[1].date).localeCompare(String(b[1].date))) })).filter(x => x.photos.length);
  const total = chapitres.reduce((s, x) => s + x.photos.length, 0);
  if (!total) throw new Error('Aucune photo n’est sélectionnée pour le livre.');
  let fait = 0, premiere = true;
  const nouvellePage = () => { if (!premiere) doc.addPage([W, H], W > H ? 'landscape' : 'portrait'); premiere = false; };
  const cache = new Map();
  const charger = async (id, p) => {
    if (!cache.has(id)) { const o = await store.octetsPhoto(id, p); cache.set(id, { o, ...(await dimensions(o)) }); }
    return cache.get(id);
  };
  const placer = async (id, p, x, y, w, h) => {
    const im = await charger(id, p);
    const s = Math.min(w / im.w, h / im.h), iw = im.w * s, ih = im.h * s;
    doc.addImage(im.o, 'JPEG', x + (w - iw) / 2, y + (h - ih) / 2, iw, ih, id, 'NONE');
    return { x: x + (w - iw) / 2, y: y + (h - ih) / 2, w: iw, h: ih };
  };

  // Couverture
  nouvellePage();
  const [cid, cp] = chapitres[0].photos[0];
  doc.setFillColor(28, 31, 30); doc.rect(0, 0, W, H, 'F');
  const im = await charger(cid, cp), s = Math.max(W / im.w, H * 0.72 / im.h);
  doc.addImage(im.o, 'JPEG', (W - im.w * s) / 2, 0, im.w * s, im.h * s, cid, 'NONE');
  doc.setFillColor(28, 31, 30); doc.rect(0, H * 0.72, W, H * 0.28, 'F');
  doc.setTextColor(245, 241, 232); doc.setFont('helvetica', 'bold'); doc.setFontSize(Math.min(W, H) / 5.5);
  doc.text(txt(titre), M + 4, H * 0.72 + H * 0.12);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(13);
  doc.text(txt(sousTitre), M + 4, H * 0.72 + H * 0.19);

  for (const { c, photos } of chapitres) {
    const info = index.chapitres[c.id] || {}, et = trace?.etapes?.[c.id];
    const couleur = c.type === 'etape' ? rgb(couleurEtape(c.n)) : [42, 111, 143];
    if (pagesEtape) {
      nouvellePage();
      doc.setFillColor(245, 241, 232); doc.rect(0, 0, W, H, 'F');
      doc.setFillColor(...couleur); doc.rect(0, 0, 6, H, 'F');
      doc.setTextColor(...couleur); doc.setFont('helvetica', 'bold'); doc.setFontSize(34);
      doc.text(txt(c.titre), M + 6, M + 22);
      doc.setTextColor(40, 44, 43); doc.setFontSize(15); doc.setFont('helvetica', 'normal');
      let y = M + 32;
      if (c.de) { doc.text(txt(`${c.de}  >  ${c.a}`), M + 6, y); y += 8; }
      doc.setFontSize(11); doc.setTextColor(110, 110, 105);
      const ligneInfo = [fmtDate(info.date), et?.km ? `${et.km} km` : '', et?.dplus ? `+${et.dplus} m / -${et.dmoins} m` : ''].filter(Boolean).join('   ·   ');
      if (ligneInfo) { doc.text(txt(ligneInfo), M + 6, y); y += 7; }
      if (c.note) { doc.setFont('helvetica', 'italic'); doc.text(txt(c.note), M + 6, y); doc.setFont('helvetica', 'normal'); y += 7; }
      // silhouette du tracé + profil
      if (et?.parts?.length) {
        const pts = et.parts.flatMap(p => paires(p.pts));
        const boxW = (W - 2 * M - 6) * 0.42, boxH = H * 0.32, bx = W - M - boxW, by = M + 8;
        const lats = pts.map(p => p[0]), lngs = pts.map(p => p[1]);
        const k = Math.cos(lats[0] * Math.PI / 180);
        const [minX, maxX, minY, maxY] = [Math.min(...lngs) * k, Math.max(...lngs) * k, Math.min(...lats), Math.max(...lats)];
        const sc = Math.min(boxW / (maxX - minX || 1), boxH / (maxY - minY || 1));
        doc.setDrawColor(...couleur); doc.setLineWidth(1.1);
        for (const part of et.parts) {
          const q = paires(part.pts).map(p => [bx + (p[1] * k - minX) * sc, by + (maxY - p[0]) * sc]);
          if (part.h) doc.setLineDashPattern([1.5, 1.5], 0); else doc.setLineDashPattern([], 0);
          for (let i = 1; i < q.length; i++) doc.line(q[i - 1][0], q[i - 1][1], q[i][0], q[i][1]);
        }
        doc.setLineDashPattern([], 0);
        if (et.prof?.length > 4) {
          const pr = paires(et.prof), dmax = pr[pr.length - 1][0], emin = Math.min(...pr.map(p => p[1])), emax = Math.max(...pr.map(p => p[1]));
          const pw = W - 2 * M - 6, ph = H * 0.13, px = M + 6, py = H - M - ph;
          doc.setFillColor(...couleur.map(v => Math.round(v + (255 - v) * 0.7)));
          const poly = pr.map(p => [px + p[0] / dmax * pw, py + ph - (p[1] - emin) / (emax - emin || 1) * ph]);
          const lignes = []; for (let i = 1; i < poly.length; i++) lignes.push([poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]]);
          lignes.push([0, py + ph - poly[poly.length - 1][1]], [px - poly[poly.length - 1][0], 0], [0, poly[0][1] - (py + ph)]);
          doc.lines(lignes, poly[0][0], poly[0][1], [1, 1], 'F', true);
          doc.setFontSize(8); doc.setTextColor(110, 110, 105);
          doc.text(`${Math.round(emax)} m`, px, py - 1.5); doc.text(`${Math.round(emin)} m`, px, py + ph + 4);
          doc.text(`${dmax.toFixed(1)} km`, px + pw, py + ph + 4, { align: 'right' });
        }
      }
      if (info.carnet) {
        doc.setFontSize(11.5); doc.setTextColor(40, 44, 43);
        const largeur = et?.parts?.length ? (W - 2 * M - 6) * 0.54 : W - 2 * M - 6;
        const lignes = doc.splitTextToSize(txt(info.carnet), largeur);
        const maxL = Math.floor((H * (et?.prof?.length ? 0.6 : 0.8) - y) / 5.6);
        doc.text(lignes.slice(0, Math.max(maxL, 3)), M + 6, y + 6, { lineHeightFactor: 1.45 });
      }
    }
    // pages photos
    for (let i = 0; i < photos.length;) {
      nouvellePage();
      doc.setFillColor(255, 255, 255); doc.rect(0, 0, W, H, 'F');
      const lot = photos.slice(i, i + parPage); i += lot.length;
      const legH = legendes ? 9 : 0;
      const cotes = W >= H; // deux photos côte à côte sur un format paysage/carré, empilées en portrait
      const zones = lot.length === 1 ? [[M, M, W - 2 * M, H - 2 * M - legH]]
        : cotes ? [[M, M, (W - 3 * M) / 2, H - 2 * M - legH], [W / 2 + M / 2, M, (W - 3 * M) / 2, H - 2 * M - legH]]
          : [[M, M, W - 2 * M, (H - 3 * M) / 2 - legH], [M, H / 2 + M / 2, W - 2 * M, (H - 3 * M) / 2 - legH]];
      for (let z = 0; z < lot.length; z++) {
        const [id, p] = lot[z], [x, y, w, h] = zones[z];
        const r = await placer(id, p, x, y, w, h);
        if (legendes) {
          doc.setFontSize(9); doc.setTextColor(90, 90, 85);
          const l = [p.legende, p.date ? new Date(p.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) : ''].filter(Boolean).join(' · ');
          doc.text(txt(l), r.x, r.y + r.h + 5, { maxWidth: r.w });
        }
        progression?.(++fait / total);
      }
    }
  }
  return doc.output('blob');
}

// Liste pour la trieuse : mêmes photos, dans le même ordre, à refaire en pleine résolution
export function listeHD(index, options) {
  return {
    type: 'livre-gr20', version: 1, genere: new Date().toISOString(), ...options,
    chapitres: CHAPITRES.map(c => ({
      id: c.id, titre: c.titre, de: c.de || '', a: c.a || '', date: index.chapitres[c.id]?.date || null, carnet: index.chapitres[c.id]?.carnet || '',
      photos: Object.values(index.photos).filter(p => !p.retiree && p.livre && p.chapitre === c.id).sort((a, b) => String(a.date).localeCompare(String(b.date)))
        .map(p => ({ original: p.original, legende: p.legende || '', date: p.date })),
    })).filter(c => c.photos.length),
  };
}
