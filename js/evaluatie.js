// Coffee! – evaluatie: leerlingen, groepen, toetsen en punten.
//
// leerling = { id, naam, groepen: ["klas", "taal", "rekenen"], gewijzigd, verwijderd? }
// toets    = { id, titel, vak: "taal"|"wiskunde"|"wero", datum: "YYYY-MM-DD", groep,
//              onderdelen: [{ id, naam, max }], scores: { leerlingId: { onderdeelId: getal | "afw" | "vrij" } },
//              gewijzigd, verwijderd? }

export const GROEPEN = { klas: "Klasgroep", taal: "Taalgroep", rekenen: "Rekengroep" };
export const VAKKEN = {
  taal: { naam: "Taal", groep: "taal" },
  wiskunde: { naam: "Wiskunde", groep: "rekenen" },
  wero: { naam: "WO", groep: "klas" }
};

const nieuwId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const opNaam = (a, b) => a.naam.localeCompare(b.naam, "nl", { sensitivity: "base" });

export function nieuweLeerling(naam, groepen = ["klas"]) {
  return { id: nieuwId(), naam: naam.trim(), groepen: [...groepen], gewijzigd: Date.now() };
}

export function nieuweToets({ titel, vak, datum, groep, onderdelen }) {
  return {
    id: nieuwId(), titel: titel.trim(), vak, datum, groep: groep || VAKKEN[vak].groep,
    onderdelen: (onderdelen && onderdelen.length ? onderdelen : [{ naam: "Totaal", max: 20 }])
      .map(o => ({ id: o.id || nieuwId(), naam: (o.naam || "").trim() || "Totaal", max: Number(o.max) || 0 })),
    scores: {}, gewijzigd: Date.now()
  };
}

export const leerlingen = (g) => (g.leerlingen || []).filter(l => !l.verwijderd).sort(opNaam);
export const toetsen = (g) => (g.toetsen || []).filter(t => !t.verwijderd).sort((a, b) => b.datum.localeCompare(a.datum) || b.gewijzigd - a.gewijzigd);
export const maxVan = (toets) => toets.onderdelen.reduce((s, o) => s + (Number(o.max) || 0), 0);

// Leerlingen in het rooster van een toets: de groep + wie al een score heeft (bv. intussen van groep veranderd)
export function leerlingenVanToets(g, toets) {
  return leerlingen(g).filter(l => l.groepen.includes(toets.groep) || (toets.scores[l.id] && Object.keys(toets.scores[l.id]).length));
}

// Invoer uit een cel → getal, "afw", "vrij", null (leeg) of undefined (ongeldig)
export function leesScore(tekst) {
  const t = String(tekst == null ? "" : tekst).trim().toLowerCase();
  if (!t) return null;
  if (/^(a|af|afw|afwezig|ziek)$/.test(t)) return "afw";
  if (/^(v|vr|vrij|vrijgesteld|x)$/.test(t)) return "vrij";
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
export function toonScore(w) {
  if (w == null) return "";
  if (w === "afw") return "afw";
  if (w === "vrij") return "vrij";
  return String(w).replace(".", ",");
}

// Resultaat van één leerling: { totaal, max, procent, status }
// status: "volledig" | "onvolledig" | "afw" | "vrij" | "leeg"
export function resultaat(toets, leerlingId) {
  const s = toets.scores[leerlingId] || {};
  let totaal = 0, max = 0, ingevuld = 0, afw = 0, vrij = 0;
  for (const o of toets.onderdelen) {
    const w = s[o.id];
    if (w === "afw") afw++;
    else if (w === "vrij") vrij++;
    else if (typeof w === "number") { totaal += w; max += Number(o.max) || 0; ingevuld++; }
  }
  const n = toets.onderdelen.length;
  if (!ingevuld && !afw && !vrij) return { totaal: null, max: maxVan(toets), procent: null, status: "leeg" };
  if (!ingevuld) return { totaal: null, max: maxVan(toets), procent: null, status: afw ? "afw" : "vrij" };
  // vrijgestelde onderdelen tellen niet mee in het maximum
  const status = ingevuld + vrij === n ? "volledig" : "onvolledig";
  return { totaal: rond(totaal), max: rond(max), procent: max ? Math.round(totaal / max * 100) : null, status };
}
const rond = (x) => Math.round(x * 100) / 100;

export function statistiek(g, toets) {
  const ll = leerlingenVanToets(g, toets);
  const res = ll.map(l => resultaat(toets, l.id));
  const metProcent = res.filter(r => r.procent != null);
  const perOnderdeel = toets.onderdelen.map(o => {
    const w = ll.map(l => (toets.scores[l.id] || {})[o.id]).filter(x => typeof x === "number");
    return w.length ? rond(w.reduce((a, b) => a + b, 0) / w.length) : null;
  });
  return {
    aantal: ll.length,
    ingevuld: res.filter(r => r.status !== "leeg").length,
    gemiddelde: metProcent.length ? Math.round(metProcent.reduce((a, r) => a + r.procent, 0) / metProcent.length) : null,
    perOnderdeel
  };
}

// Per vak de toetsen van één leerling (oudste eerst)
export function overzichtLeerling(g, leerlingId) {
  const uit = {};
  for (const vak of Object.keys(VAKKEN)) {
    const rijen = toetsen(g).filter(t => t.vak === vak && (t.scores[leerlingId] && Object.keys(t.scores[leerlingId]).length))
      .map(t => ({ toets: t, res: resultaat(t, leerlingId) })).reverse();
    const pr = rijen.map(r => r.res.procent).filter(p => p != null);
    uit[vak] = { rijen, gemiddelde: pr.length ? Math.round(pr.reduce((a, b) => a + b, 0) / pr.length) : null };
  }
  return uit;
}

// Tabel om te plakken in Sheets/Docs/Excel (tab-gescheiden)
export function alsTabel(g, toets) {
  const kop = ["Leerling", ...toets.onderdelen.map(o => o.naam + " (/" + toonScore(o.max) + ")"), "Totaal (/" + toonScore(maxVan(toets)) + ")", "%"];
  const rijen = leerlingenVanToets(g, toets).map(l => {
    const s = toets.scores[l.id] || {};
    const r = resultaat(toets, l.id);
    return [l.naam, ...toets.onderdelen.map(o => toonScore(s[o.id])), r.totaal == null ? (r.status === "leeg" ? "" : r.status) : toonScore(r.totaal), r.procent == null ? "" : r.procent + "%"];
  });
  return [kop, ...rijen].map(r => r.join("\t")).join("\n");
}
