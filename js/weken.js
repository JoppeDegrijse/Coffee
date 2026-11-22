// Coffee! – datumlogica: weken uit bestandsnamen, huidig lesuur, vorige les in een reeks, zwemritme.

const MAANDEN = {
  januari: 0, jan: 0, februari: 1, feb: 1, maart: 2, mrt: 2, april: 3, apr: 3, mei: 4,
  juni: 5, jun: 5, juli: 6, jul: 6, augustus: 7, aug: 7, september: 8, sep: 8, sept: 8,
  oktober: 9, okt: 9, november: 10, nov: 10, december: 11, dec: 11
};
const DAG_MS = 24 * 60 * 60 * 1000;

export function middernacht(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
export function maandagVan(d) {
  const x = middernacht(d);
  const dag = (x.getDay() + 6) % 7;          // maandag = 0
  x.setDate(x.getDate() - dag);
  return x;
}
export function plusDagen(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
export function isoDatum(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
export function vanIso(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }

// "Week 16 november" → maandag van die week (het jaar wordt gekozen dichtst bij 'nu')
export function weekUitNaam(naam, nu = new Date()) {
  const m = naam.toLowerCase().match(/week\s+(\d{1,2})\s+([a-z]+)/);
  if (!m || !(m[2] in MAANDEN)) return null;
  const dag = parseInt(m[1], 10), maand = MAANDEN[m[2]];
  let beste = null;
  for (const jaar of [nu.getFullYear() - 1, nu.getFullYear(), nu.getFullYear() + 1]) {
    const d = new Date(jaar, maand, dag);
    if (d.getMonth() !== maand) continue;     // ongeldige datum
    if (!beste || Math.abs(d - nu) < Math.abs(beste - nu)) beste = d;
  }
  if (!beste) return null;
  // valt de datum in het weekend, dan bedoel je de week die erop volgt
  if (beste.getDay() === 0) return plusDagen(beste, 1);
  if (beste.getDay() === 6) return plusDagen(beste, 2);
  return maandagVan(beste);
}

export function weekVoorDatum(weken, datum) {
  const ma = maandagVan(datum).getTime();
  return weken.find(w => w.maandag.getTime() === ma) || null;
}

export function minutenVan(d) { return d.getHours() * 60 + d.getMinutes(); }
export function tijdTekst(min) {
  if (min == null) return "";
  return String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0");
}

// Zoekt het huidige en volgende blok van een dag op een bepaald tijdstip
export function huidigBlok(dag, nuMin) {
  if (!dag) return { huidig: null, volgende: null };
  const rijen = dag.rijen.filter(r => r.start != null);
  const huidig = rijen.find(r => nuMin >= r.start && nuMin < r.eind) || null;
  const volgende = rijen.find(r => r.start > nuMin && r !== huidig) || null;
  return { huidig, volgende };
}

// ---------- Vorige les in dezelfde reeks ----------
export function vakSleutel(vak) { return (vak || "").toLowerCase().replace(/[\s.]/g, ""); }

// "VLL kern 7 dag 14" → "vll kern", "WK2, blok 2 les 11" → "wk", "thema 3 les 11: …" → "thema"
export function reeksSleutel(onderwerp) {
  const t = (onderwerp || "").toLowerCase();
  const m = t.match(/^(.*?)\d/);
  if (!m) return null;
  const s = m[1].replace(/[^a-zà-ÿ ]/g, " ").replace(/\s+/g, " ").trim();
  return s.length >= 2 ? s : null;
}

const NIETSZEGGEND = /^(idem|vervolg\b|zie\b)/i;

// lessen = [{ datum, rij }] gesorteerd op tijd; zoekt de vorige les vóór 'huidige'
export function vorigeLes(lessen, huidige) {
  const vak = vakSleutel(huidige.rij.vak);
  if (!vak) return null;
  const tijdstip = huidige.datum.getTime() + (huidige.rij.start || 0) * 60000;
  const eerder = lessen.filter(l =>
    vakSleutel(l.rij.vak) === vak &&
    l.datum.getTime() + (l.rij.start || 0) * 60000 < tijdstip &&
    l.rij.onderwerp && !NIETSZEGGEND.test(l.rij.onderwerp)
  );
  if (!eerder.length) return null;
  const reeks = reeksSleutel(huidige.rij.onderwerp);
  if (reeks) {
    const zelfdeReeks = eerder.filter(l => reeksSleutel(l.rij.onderwerp) === reeks);
    if (zelfdeReeks.length) return { ...zelfdeReeks[zelfdeReeks.length - 1], zelfdeReeks: true };
  }
  return { ...eerder[eerder.length - 1], zelfdeReeks: false };
}

// ---------- Zwemritme (½ P) ----------
// referentie = iso-datum van een week waarin je meegaat zwemmen
export function isZwemweek(referentie, datum) {
  if (!referentie) return null;
  const verschil = Math.round((maandagVan(datum) - maandagVan(vanIso(referentie))) / (7 * DAG_MS));
  return Math.abs(verschil) % 2 === 0;
}
