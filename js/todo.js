// Coffee! – to-do's: model, samenvoegen tussen toestellen, vrije blokken om in te plannen.
//
// todo = { id, tekst, klaar, deadline: "YYYY-MM-DD" | null,
//          gepland: null | { datum: "YYYY-MM-DD", start, eind, soort: "perm"|"vrij"|"avond", titel },
//          aangemaakt, gewijzigd, verwijderd? }
// gegevens = { versie: 1, todos: [todo] }

import * as W from "./weken.js";

export const LEEG = () => ({ versie: 1, todos: [] });

function nieuwId() {
  return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
}

export function nieuweTodo(tekst, gepland = null) {
  const nu = Date.now();
  return { id: nieuwId(), tekst: tekst.trim(), klaar: false, deadline: null, gepland, aangemaakt: nu, gewijzigd: nu };
}

// Twee versies samenvoegen (bv. laptop en gsm): per to-do wint de laatst gewijzigde.
// Verwijderde to-do's blijven als "verwijderd" staan, zodat het verwijderen ook op het andere toestel doorkomt.
export function samenvoegen(a, b) {
  const per = new Map();
  for (const t of [...(a.todos || []), ...(b.todos || [])]) {
    const bestaand = per.get(t.id);
    if (!bestaand || (t.gewijzigd || 0) > (bestaand.gewijzigd || 0)) per.set(t.id, t);
  }
  return { ...a, ...b, versie: 1, todos: [...per.values()] };
}

// Verwijderde to-do's na 60 dagen echt opruimen
export function opruimen(gegevens, nu = Date.now()) {
  const grens = nu - 60 * 24 * 3600 * 1000;
  return { ...gegevens, todos: gegevens.todos.filter(t => !(t.verwijderd && (t.gewijzigd || 0) < grens)) };
}

export const slotSleutel = (s) => s.datum + "|" + s.start + "|" + s.soort;
const parseTijd = (t) => { const [u, m] = (t || "0:0").split(":").map(Number); return u * 60 + m; };

// Vrije blokken in de komende dagen.
// dagenPerDatum: Map("YYYY-MM-DD" → dag uit de parser), avond = { start: "19:30", eind: "21:00" } of null
export function vrijeBlokken(dagenPerDatum, vanaf, aantalDagen, { zwemweek = null, avond = null } = {}) {
  const uit = [];
  const nuMin = W.minutenVan(vanaf);
  for (let i = 0; i < aantalDagen; i++) {
    const datum = W.plusDagen(W.middernacht(vanaf), i);
    const iso = W.isoDatum(datum);
    const dag = dagenPerDatum.get(iso);
    const vandaag = i === 0;
    if (dag) {
      for (const rij of dag.rijen) {
        if (rij.start == null) continue;
        const isPerm = rij.soort === "perm" && !(rij.halfP && W.isZwemweek(zwemweek, datum) === true);
        if (!isPerm && rij.soort !== "vrij") continue;
        if (vandaag && rij.eind <= nuMin) continue;
        uit.push({ datum: iso, start: rij.start, eind: rij.eind, soort: rij.soort === "vrij" ? "vrij" : "perm",
                   titel: rij.soort === "vrij" ? "LO (vrij)" : rij.titel });
      }
    }
    // avondblok op schooldagen (maandag t.e.m. vrijdag)
    const weekdag = (datum.getDay() + 6) % 7;
    if (avond && weekdag < 5) {
      const s = parseTijd(avond.start), e = parseTijd(avond.eind);
      if (!(vandaag && e <= nuMin)) uit.push({ datum: iso, start: s, eind: e, soort: "avond", titel: "Avond" });
    }
  }
  return uit.sort((a, b) => a.datum.localeCompare(b.datum) || a.start - b.start);
}

// Is een gepland blok al voorbij?
export function isVoorbij(gepland, nu) {
  const iso = W.isoDatum(nu);
  return gepland.datum < iso || (gepland.datum === iso && gepland.eind <= W.minutenVan(nu));
}

// Indeling voor het to-do-scherm
export function groepeer(todos, nu) {
  const zichtbaar = todos.filter(t => !t.verwijderd);
  const open = zichtbaar.filter(t => !t.klaar);
  const gemist = open.filter(t => t.gepland && isVoorbij(t.gepland, nu));
  const teplannen = open.filter(t => !t.gepland).concat(gemist)
    .sort((a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999") || a.aangemaakt - b.aangemaakt);
  const perSlot = new Map();
  for (const t of open.filter(t => t.gepland && !isVoorbij(t.gepland, nu))) {
    const k = slotSleutel(t.gepland);
    if (!perSlot.has(k)) perSlot.set(k, { slot: t.gepland, items: [] });
    perSlot.get(k).items.push(t);
  }
  const gepland = [...perSlot.values()].sort((a, b) => a.slot.datum.localeCompare(b.slot.datum) || a.slot.start - b.slot.start);
  gepland.forEach(g => g.items.sort((a, b) => a.aangemaakt - b.aangemaakt));
  const klaar = zichtbaar.filter(t => t.klaar).sort((a, b) => b.gewijzigd - a.gewijzigd);
  return { teplannen, gemist, gepland, klaar };
}

// To-do's in één blok (voor het dashboard)
export function inBlok(todos, iso, start, soort) {
  return todos.filter(t => !t.verwijderd && t.gepland && t.gepland.datum === iso && t.gepland.start === start &&
                           (!soort || t.gepland.soort === soort));
}

export function aantalOpen(todos, nu) {
  const g = groepeer(todos, nu);
  return g.teplannen.length;
}
