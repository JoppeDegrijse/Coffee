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

// Woordleestoets: zoveel mogelijk woorden lezen in één minuut; per leerling "goed" en "fout"
export const isWoordlezen = (t) => !!(t && t.soort === "woordlezen");
export const WOORD_ONDERDELEN = [{ id: "goed", naam: "Goed", max: 0 }, { id: "fout", naam: "Fout", max: 0 }];

export function nieuweToets({ titel, vak, datum, groep, onderdelen, soort }) {
  if (soort === "woordlezen") {
    return { id: nieuwId(), soort: "woordlezen", titel: titel.trim(), vak, datum, groep: groep || VAKKEN[vak].groep,
      onderdelen: WOORD_ONDERDELEN.map(o => ({ ...o })), scores: {}, gewijzigd: Date.now() };
  }
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
  if (isWoordlezen(toets)) { const w = woordResultaat(toets, leerlingId); return { totaal: w.goed, max: null, procent: null, status: w.status }; }
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

// ---------- Woordleestoets ----------
export function woordResultaat(toets, leerlingId) {
  const s = toets.scores[leerlingId] || {};
  const g = s.goed, f = s.fout;
  if (g === "afw" || f === "afw") return { goed: null, fout: null, gelezen: null, nauwkeurig: null, status: "afw" };
  if (g === "vrij" || f === "vrij") return { goed: null, fout: null, gelezen: null, nauwkeurig: null, status: "vrij" };
  if (typeof g !== "number") return { goed: null, fout: typeof f === "number" ? f : null, gelezen: null, nauwkeurig: null, status: typeof f === "number" ? "onvolledig" : "leeg" };
  const fout = typeof f === "number" ? f : 0;
  const gelezen = g + fout;
  return { goed: g, fout: typeof f === "number" ? f : null, gelezen, nauwkeurig: gelezen ? Math.round(g / gelezen * 100) : null,
    status: typeof f === "number" ? "volledig" : "onvolledig" };
}
const gem = (xs) => xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length * 10) / 10 : null;
// Gemiddelde van de groep (wie afwezig of vrijgesteld is, telt niet mee)
export function woordStatistiek(g, toets) {
  const ll = leerlingenVanToets(g, toets);
  const res = ll.map(l => woordResultaat(toets, l.id));
  const metGoed = res.filter(r => r.goed != null);
  const sp = spreiding(metGoed.map(r => r.goed));
  return {
    sd: sp.sd, variantie: sp.variantie, n: metGoed.length,
    aantal: ll.length,
    ingevuld: res.filter(r => r.status !== "leeg").length,
    goed: gem(metGoed.map(r => r.goed)),
    fout: gem(metGoed.filter(r => r.fout != null).map(r => r.fout)),
    gelezen: gem(metGoed.map(r => r.gelezen)),
    nauwkeurig: gem(metGoed.filter(r => r.nauwkeurig != null).map(r => r.nauwkeurig)),
    hoogste: metGoed.length ? Math.max(...metGoed.map(r => r.gelezen)) : null
  };
}
// Spreiding van de scores op één toets: variantie en standaardafwijking (steekproef, n − 1)
export function spreiding(xs) {
  const n = xs.length;
  if (n < 2) return { variantie: null, sd: null };
  const m = xs.reduce((a, b) => a + b, 0) / n;
  const variantie = xs.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1);
  return { variantie: Math.round(variantie * 10) / 10, sd: Math.round(Math.sqrt(variantie) * 10) / 10 };
}
// Vergelijking met het klasgemiddelde, uitgedrukt in standaardafwijkingen (z-score) van deze toets
export const MIN_VOOR_SD = 3;   // minder leerlingen met een score: geen niveau, enkel het verschil
export const VERGELIJK = {
  sterk: { naam: "Boven het gemiddelde", icoon: "▲", uitleg: "1 SD of meer boven het gemiddelde (z ≥ +1)" },
  goed: { naam: "Rond het gemiddelde", icoon: "●", uitleg: "minder dan 1 SD van het gemiddelde (−1 < z < +1)" },
  aandacht: { naam: "Onder het gemiddelde", icoon: "▼", uitleg: "1 tot 2 SD onder het gemiddelde (−2 < z ≤ −1)" },
  zorg: { naam: "Ver onder het gemiddelde", icoon: "!", uitleg: "2 SD of meer onder het gemiddelde (z ≤ −2)" }
};
export function vergelijk(goed, st) {
  if (goed == null || !st || st.goed == null) return null;
  const verschil = Math.round((goed - st.goed) * 10) / 10;
  if (!st.sd || (st.n || 0) < MIN_VOOR_SD) return { verschil, z: null, niveau: null };
  const z = Math.round((goed - st.goed) / st.sd * 100) / 100;
  const niveau = z >= 1 ? "sterk" : z > -1 ? "goed" : z > -2 ? "aandacht" : "zorg";
  return { verschil, z, niveau };
}
export const toonZ = (z) => { if (z == null) return ""; const t = Math.abs(z).toFixed(1); return (t === "0.0" ? "" : z > 0 ? "+" : "−") + t.replace(".", ","); };

// Alle woordleestoetsen (oudste eerst) met per leerling het resultaat en de vergelijking met de klas
export function woordOverzicht(g, vak = null) {
  const ts = toetsen(g).filter(t => isWoordlezen(t) && (!vak || t.vak === vak)).reverse();
  const stats = ts.map(t => woordStatistiek(g, t));
  const ll = leerlingen(g).filter(l => ts.some(t => l.groepen.includes(t.groep) || (t.scores[l.id] && Object.keys(t.scores[l.id]).length)));
  const rijen = ll.map(l => {
    const cellen = ts.map((t, i) => {
      const inToets = l.groepen.includes(t.groep) || (t.scores[l.id] && Object.keys(t.scores[l.id]).length);
      if (!inToets) return null;
      const r = woordResultaat(t, l.id);
      return { ...r, vergelijking: vergelijk(r.goed, stats[i]) };
    });
    return { leerling: l, cellen, trend: trend(cellen.map(c => c && c.goed)) };
  });
  return { toetsen: ts, stats, rijen };
}

// Per vak de toetsen van één leerling (oudste eerst)
export function overzichtLeerling(g, leerlingId) {
  const uit = {};
  for (const vak of Object.keys(VAKKEN)) {
    const rijen = toetsen(g).filter(t => t.vak === vak && !isWoordlezen(t) && (t.scores[leerlingId] && Object.keys(t.scores[leerlingId]).length))
      .map(t => ({ toets: t, res: resultaat(t, leerlingId) })).reverse();
    const pr = rijen.map(r => r.res.procent).filter(p => p != null);
    uit[vak] = { rijen, gemiddelde: pr.length ? Math.round(pr.reduce((a, b) => a + b, 0) / pr.length) : null };
  }
  return uit;
}

// Tabel om te plakken in Sheets/Docs/Excel (tab-gescheiden)
export function alsTabel(g, toets) {
  if (isWoordlezen(toets)) {
    const st = woordStatistiek(g, toets);
    const rijen = leerlingenVanToets(g, toets).map(l => {
      const r = woordResultaat(toets, l.id);
      const v = vergelijk(r.goed, st);
      if (r.status === "afw" || r.status === "vrij") return [l.naam, r.status, "", "", "", "", ""];
      return [l.naam, toonScore(r.goed), toonScore(r.fout), toonScore(r.gelezen), r.nauwkeurig == null ? "" : r.nauwkeurig + "%",
        v ? (v.verschil > 0 ? "+" : "") + toonScore(v.verschil) : "", v && v.z != null ? toonZ(v.z) + (v.niveau ? " (" + VERGELIJK[v.niveau].naam.toLowerCase() + ")" : "") : ""];
    });
    const kop = ["Leerling", "Goed", "Fout", "Gelezen", "Juist", "Verschil met gemiddelde", "z-score"];
    const voet = ["Klasgemiddelde", toonScore(st.goed), toonScore(st.fout), toonScore(st.gelezen), st.nauwkeurig == null ? "" : st.nauwkeurig + "%", "SD " + toonScore(st.sd), ""];
    return [kop, ...rijen, voet].map(r => r.join("\t")).join("\n");
  }
  const kop = ["Leerling", ...toets.onderdelen.map(o => o.naam + " (/" + toonScore(o.max) + ")"), "Totaal (/" + toonScore(maxVan(toets)) + ")", "%"];
  const rijen = leerlingenVanToets(g, toets).map(l => {
    const s = toets.scores[l.id] || {};
    const r = resultaat(toets, l.id);
    return [l.naam, ...toets.onderdelen.map(o => toonScore(s[o.id])), r.totaal == null ? (r.status === "leeg" ? "" : r.status) : toonScore(r.totaal), r.procent == null ? "" : r.procent + "%"];
  });
  return [kop, ...rijen].map(r => r.join("\t")).join("\n");
}

// ---------- Resultaatniveaus ----------
export const STANDAARD_GRENZEN = { sterk: 80, goed: 65, aandacht: 50 };
export const NIVEAUS = {
  sterk: { naam: "Sterk", icoon: "★" },
  goed: { naam: "Goed", icoon: "✓" },
  aandacht: { naam: "Aandacht", icoon: "⚠" },
  zorg: { naam: "Zorg", icoon: "!" }
};
export function niveau(procent, grenzen = STANDAARD_GRENZEN) {
  if (procent == null) return null;
  if (procent >= grenzen.sterk) return "sterk";
  if (procent >= grenzen.goed) return "goed";
  if (procent >= grenzen.aandacht) return "aandacht";
  return "zorg";
}

// Trend: laatste resultaat tegenover het gemiddelde van de (hoogstens 3) vorige
export function trend(procenten) {
  const p = procenten.filter(x => x != null);
  if (p.length < 2) return null;
  const laatste = p[p.length - 1];
  const vorige = p.slice(-4, -1);
  const gem = vorige.reduce((a, b) => a + b, 0) / vorige.length;
  return laatste - gem >= 5 ? "op" : gem - laatste >= 5 ? "neer" : "gelijk";
}

// Klasoverzicht van één vak: leerlingen × toetsen (oudste toets links)
export function klasoverzicht(g, vak) {
  const ts = toetsen(g).filter(t => t.vak === vak && !isWoordlezen(t)).reverse();
  const groep = VAKKEN[vak].groep;
  const ll = leerlingen(g).filter(l => l.groepen.includes(groep) || ts.some(t => t.scores[l.id] && Object.keys(t.scores[l.id]).length));
  const rijen = ll.map(l => {
    const cellen = ts.map(t => {
      const inToets = l.groepen.includes(t.groep) || (t.scores[l.id] && Object.keys(t.scores[l.id]).length);
      return inToets ? resultaat(t, l.id) : null;
    });
    const pr = cellen.map(c => c && c.procent);
    const geldig = pr.filter(x => x != null);
    return { leerling: l, cellen, gemiddelde: geldig.length ? Math.round(geldig.reduce((a, b) => a + b, 0) / geldig.length) : null, trend: trend(pr) };
  });
  return { toetsen: ts, rijen };
}
