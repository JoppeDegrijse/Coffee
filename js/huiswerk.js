// Coffee! – huiswerk bijhouden: wie heeft zijn huistaak ingediend?
//
// Standaard: huistaak taal op maandag (taalgroep), huistaak rekenen op donderdag (rekengroep),
// enkel in weken waarvoor een weekagenda bestaat (vakanties vallen zo vanzelf weg).
// Een standaard huistaak wordt pas bewaard als je er iets aan verandert.
//
// huistaak = { id, vak: "taal"|"rekenen", datum: "YYYY-MM-DD", titel, weggevallen?, extra?,
//              status: { leerlingId: "in" | "laat" }, gewijzigd, verwijderd? }
// Geen status = nog niet ingediend (rood).

import * as W from "./weken.js";
import * as E from "./evaluatie.js";

export const HW_VAKKEN = {
  taal: { naam: "Taal", groep: "taal", weekdag: 0 },
  rekenen: { naam: "Rekenen", groep: "rekenen", weekdag: 3 }
};
export const TOESTANDEN = {
  open: { naam: "Nog niet ingediend", teken: "" },
  in: { naam: "Ingediend", teken: "✓" },
  laat: { naam: "Te laat", teken: "L" }
};
const VOLGENDE = { open: "in", in: "laat", laat: "open" };

export const standaardId = (vak, iso) => "hw|" + vak + "|" + iso;
const nieuwId = () => "hw|x|" + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

const bewaarde = (g, vak) => (g.huiswerk || []).filter(x => x.vak === vak && !x.verwijderd);

// Alle kolommen van een vak, oudste eerst.
// maandagen: ISO-datums van de maandagen waarvoor een weekagenda bestaat
export function kolommen(g, vak, { maandagen = [], vanaf, tot, metWeggevallen = false } = {}) {
  const info = HW_VAKKEN[vak];
  const opgeslagen = new Map(bewaarde(g, vak).map(x => [x.id, x]));
  const uit = new Map();
  for (const m of maandagen) {
    const datum = W.isoDatum(W.plusDagen(W.vanIso(m), info.weekdag));
    if ((vanaf && datum < vanaf) || (tot && datum > tot)) continue;
    const id = standaardId(vak, datum);
    uit.set(id, opgeslagen.get(id) || { id, vak, datum, titel: "", status: {} });
  }
  // bewaarde huistaken: extra's en standaard huistaken waarvoor (nog) geen weekagenda gevonden is
  for (const x of opgeslagen.values()) {
    if (uit.has(x.id)) continue;
    if (!x.extra && (vanaf && x.datum < vanaf)) continue;
    if (!x.extra && !Object.keys(x.status || {}).length && !x.titel) continue;
    uit.set(x.id, x);
  }
  return [...uit.values()]
    .filter(x => metWeggevallen || !x.weggevallen)
    .sort((a, b) => a.datum.localeCompare(b.datum) || (a.extra ? 1 : 0) - (b.extra ? 1 : 0));
}

export const toestand = (hw, leerlingId) => (hw.status && hw.status[leerlingId]) || "open";
export const volgendeToestand = (t) => VOLGENDE[t] || "in";

// Eén huistaak in het gegevensobject opzoeken of aanmaken (voor standaard huistaken)
export function haal(g, kolom) {
  g.huiswerk = g.huiswerk || [];
  let x = g.huiswerk.find(y => y.id === kolom.id);
  if (!x) { x = { id: kolom.id, vak: kolom.vak, datum: kolom.datum, titel: kolom.titel || "", status: {}, gewijzigd: Date.now() }; g.huiswerk.push(x); }
  if (x.verwijderd) { delete x.verwijderd; x.status = {}; }
  x.status = x.status || {};
  return x;
}

export function zetToestand(g, kolom, leerlingId, t) {
  const x = haal(g, kolom);
  if (t === "open") delete x.status[leerlingId]; else x.status[leerlingId] = t;
  x.gewijzigd = Date.now();
}
export function iedereenIngediend(g, kolom, leerlingIds) {
  const x = haal(g, kolom);
  for (const id of leerlingIds) if (!x.status[id]) x.status[id] = "in";
  x.gewijzigd = Date.now();
}
export function pasAan(g, kolom, velden) {
  const x = haal(g, kolom);
  Object.assign(x, velden);
  x.gewijzigd = Date.now();
}
export function verwijderExtra(g, kolom) {
  const x = (g.huiswerk || []).find(y => y.id === kolom.id);
  if (x) { Object.keys(x).forEach(k => { if (!["id", "vak", "datum"].includes(k)) delete x[k]; }); x.verwijderd = true; x.gewijzigd = Date.now(); }
}
export function nieuweExtra(vak, datum, titel) {
  return { id: nieuwId(), vak, datum, titel: (titel || "").trim(), extra: true, status: {}, gewijzigd: Date.now() };
}

export const kolomTitel = (k) => k.titel || (k.extra ? "Extra huistaak" : "Huistaak " + HW_VAKKEN[k.vak].naam.toLowerCase());

// Leerlingen in het rooster: de groep + wie al een status heeft in een getoonde kolom
export function leerlingenVan(g, vak, kols) {
  const groep = HW_VAKKEN[vak].groep;
  return E.leerlingen(g).filter(l => l.groepen.includes(groep) || kols.some(k => k.status && k.status[l.id]));
}

// Telling per leerling over de getoonde kolommen
export function telling(kols, leerlingId) {
  const t = { open: 0, in: 0, laat: 0 };
  for (const k of kols) t[toestand(k, leerlingId)]++;
  return t;
}
