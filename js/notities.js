// Coffee! – notities voor de volgende les (bv. "afgewerkt tot oef. 7").
// notitie = { id: "vak|YYYY-MM-DD|start", vak, datum, start, tekst, gewijzigd, verwijderd? }
// Ze staan enkel in het gegevensbestand op je eigen Drive, niet in de weekagenda.

import * as W from "./weken.js";

export const notitieId = (vak, iso, start) => W.vakSleutel(vak) + "|" + iso + "|" + (start || 0);

const actief = (lijst) => (lijst || []).filter(n => !n.verwijderd && (n.tekst || "").trim());

// De notitie die bij deze les zelf geschreven werd
export function eigenNotitie(lijst, vak, iso, start) {
  const id = notitieId(vak, iso, start);
  return (lijst || []).find(n => n.id === id && !n.verwijderd) || null;
}

// De laatste notitie van hetzelfde vak, van vóór deze les
export function vorigeNotitie(lijst, vak, iso, start) {
  const sleutel = W.vakSleutel(vak);
  if (!sleutel) return null;
  const voor = (n) => n.datum < iso || (n.datum === iso && (n.start || 0) < (start || 0));
  return actief(lijst).filter(n => W.vakSleutel(n.vak) === sleutel && voor(n))
    .sort((a, b) => b.datum.localeCompare(a.datum) || (b.start || 0) - (a.start || 0))[0] || null;
}

// Notitie zetten (lege tekst = verwijderen) in een gegevensobject
export function zetNotitie(g, vak, iso, start, tekst) {
  g.notities = g.notities || [];
  const id = notitieId(vak, iso, start);
  const bestaand = g.notities.find(n => n.id === id);
  const leeg = !tekst.trim();
  const nieuw = { id, vak, datum: iso, start: start || 0, tekst: tekst.trim(), gewijzigd: Date.now(), ...(leeg ? { verwijderd: true } : {}) };
  if (bestaand) Object.keys(bestaand).forEach(k => delete bestaand[k]), Object.assign(bestaand, nieuw);
  else if (!leeg) g.notities.push(nieuw);
}
