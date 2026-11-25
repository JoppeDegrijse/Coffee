// Coffee! – doelen uit de leerlijn WO: zoeken, aanvinken, kopiëren, thema's en dekking.
//
// De leerlijn zelf (pdf van school, omgezet naar json) staat NIET in de code of de repo,
// enkel in je eigen Drive (map Coffee!, "Coffee! leerlijn WO.json") en als kopie op je toestel.
//
// leerlijn = { soort: "coffee-leerlijn", schooljaar, titel, leerlijnen: [
//   { id: "MM", naam, domeinen: [ { naam, vol, noot?, rubrieken: [ { naam, groep?, noot?, doelen: [
//     { nr, tekst, toelichting?, extra?, suggesties?: [ { bouw: ["OB"…], items: [ { t, s?: "methode"|"noot", n? } ] } ],
//       tussendoelen?: [ { nr, tekst, suggesties? } ] } ] } ] } ] } ] }
// thema = { id, naam, schooljaar, doelen: ["MM-3", "WTN-3a"…], gemaakt, gewijzigd, verwijderd? }

export const BOUWEN = ["OB", "MB", "BB"];
export const BOUW_NAAM = { OB: "onderbouw", MB: "middenbouw", BB: "bovenbouw" };

export function isLeerlijn(x) {
  return !!(x && x.soort === "coffee-leerlijn" && Array.isArray(x.leerlijnen) && x.leerlijnen.every(l => l.id && Array.isArray(l.domeinen)));
}

export const doelId = (leerlijnId, nr) => leerlijnId + "-" + nr;

// Zoeknormalisatie: kleine letters, zonder accenten en leestekens
export function normaal(t) {
  return (t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[“”‘’"'`´]/g, "").replace(/\s+/g, " ").trim();
}
export function zoektermen(zoek) { return normaal(zoek).split(" ").filter(w => w.length > 0); }

// Eenvoudige Nederlandse stam, zodat "magneet" ook "magneten" vindt en "kaarten" ook "kaart"
export function stam(w) {
  let s = w;
  if (s.length > 5 && s.endsWith("en")) s = s.slice(0, -2);
  else if (s.length > 4 && s.endsWith("s")) s = s.slice(0, -1);
  s = s.replace(/([aeou])\1([^aeiou])$/, "$1$2");
  return s;
}
export const bevat = (tekst, w) => tekst.includes(w) || (w.length > 3 && tekst.includes(stam(w)));

// Platte index: alle selecteerbare doelen (hoofd- en tussendoelen) met hun plaats
export function index(leerlijn) {
  const uit = new Map();
  if (!leerlijn) return uit;
  for (const ll of leerlijn.leerlijnen) {
    ll.domeinen.forEach((dm, di) => dm.rubrieken.forEach((r, ri) => r.doelen.forEach((d, i) => {
      const plaats = { leerlijn: ll, domein: dm, rubriek: r, volgorde: [leerlijn.leerlijnen.indexOf(ll), di, ri, i] };
      if (d.nr) uit.set(doelId(ll.id, d.nr), { id: doelId(ll.id, d.nr), nr: d.nr, tekst: d.tekst, soort: "hoofddoel", doel: d, ...plaats });
      (d.tussendoelen || []).forEach((t, ti) => uit.set(doelId(ll.id, t.nr),
        { id: doelId(ll.id, t.nr), nr: t.nr, tekst: t.tekst, soort: "tussendoel", hoofd: d, doel: t, ...plaats, volgorde: [...plaats.volgorde, ti + 1] }));
    })));
  }
  return uit;
}

// Suggestieblokken die bij een bouw horen (lege bouw in de pdf = voor iedereen)
export function suggestiesVoor(houder, bouw) {
  return (houder.suggesties || []).filter(s => !bouw || !s.bouw.length || s.bouw.includes(bouw));
}

const itemsTekst = (houder, bouw) => suggestiesVoor(houder, bouw).flatMap(s => s.items.map(i => i.t)).join(" ");

// Zoekt in hoofddoel, toelichting, tussendoelen en (de zichtbare) suggesties. Alle woorden moeten voorkomen.
// Geeft per hoofddoel: null (geen treffer) of { doel: bool, tussen: Set(nr), sug: bool }
export function zoekInDoel(d, termen, bouw) {
  if (!termen.length) return { doel: false, tussen: new Set(), sug: false, alles: true };
  const eigen = normaal((d.nr || "") + " " + d.tekst + " " + (d.toelichting || ""));
  const sug = normaal(itemsTekst(d, bouw));
  const tussen = (d.tussendoelen || []).map(t => ({ nr: t.nr, tekst: normaal(t.nr + " " + t.tekst), sug: normaal(itemsTekst(t, bouw)) }));
  const alles = [eigen, sug, ...tussen.flatMap(t => [t.tekst, t.sug])].join(" ");
  if (!termen.every(w => bevat(alles, w))) return null;
  const treft = (t) => termen.some(w => bevat(t, w));
  return {
    doel: treft(eigen),
    sug: treft(sug),
    tussen: new Set(tussen.filter(t => treft(t.tekst) || treft(t.sug)).map(t => t.nr)),
    tussenSug: new Set(tussen.filter(t => treft(t.sug)).map(t => t.nr))
  };
}

// ---------- Thema's ----------
const nieuwId = () => "th|" + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
export function nieuwThema(naam, schooljaar, doelen = []) {
  return { id: nieuwId(), naam: naam.trim(), schooljaar: schooljaar || "", doelen: [...doelen], gemaakt: Date.now(), gewijzigd: Date.now() };
}
export const themas = (g, schooljaar) => (g.themas || []).filter(t => !t.verwijderd && (!schooljaar || t.schooljaar === schooljaar))
  .sort((a, b) => (b.gemaakt || 0) - (a.gemaakt || 0));

export function wisselDoel(thema, id, aan) {
  const set = new Set(thema.doelen || []);
  if (aan === undefined) aan = !set.has(id);
  if (aan) set.add(id); else set.delete(id);
  thema.doelen = [...set];
  thema.gewijzigd = Date.now();
}

// In welke thema's (van dit schooljaar) zit elk doel?
export function dekking(g, schooljaar) {
  const uit = new Map();
  for (const t of themas(g, schooljaar)) for (const id of t.doelen || []) {
    if (!uit.has(id)) uit.set(id, []);
    uit.get(id).push(t);
  }
  return uit;
}

// Is een hoofddoel behandeld? (zelf of via een van zijn tussendoelen)
export function hoofddoelBehandeld(leerlijnId, d, dek) {
  if (d.nr && dek.has(doelId(leerlijnId, d.nr))) return true;
  return (d.tussendoelen || []).some(t => dek.has(doelId(leerlijnId, t.nr)));
}

export function dekkingPerDomein(leerlijn, dek) {
  return leerlijn.leerlijnen.flatMap(ll => ll.domeinen.map(dm => {
    const doelen = dm.rubrieken.flatMap(r => r.doelen).filter(d => d.nr || (d.tussendoelen || []).length);
    return { leerlijn: ll, domein: dm, totaal: doelen.length, behandeld: doelen.filter(d => hoofddoelBehandeld(ll.id, d, dek)).length };
  }));
}

// ---------- Kopiëren ----------
// Gesorteerd volgens de leerlijn, gegroepeerd per leerlijn – domein – rubriek
export function geselecteerd(idx, ids) {
  return [...ids].map(id => idx.get(id)).filter(Boolean).sort((a, b) => {
    for (let i = 0; i < Math.max(a.volgorde.length, b.volgorde.length); i++) {
      const x = a.volgorde[i] ?? 0, y = b.volgorde[i] ?? 0;
      if (x !== y) return x - y;
    }
    return 0;
  });
}

export function kopieerTekst(idx, ids, { titel } = {}) {
  const lijst = geselecteerd(idx, ids);
  const tekst = [], html = [];
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  if (titel) { tekst.push(titel, ""); html.push("<p><b>" + esc(titel) + "</b></p>"); }
  let groep = null, open = false;
  for (const x of lijst) {
    const kop = x.leerlijn.naam + " – " + x.domein.naam + (x.rubriek.naam ? " – " + (x.rubriek.groep ? x.rubriek.groep + " – " : "") + x.rubriek.naam : "");
    if (kop !== groep) {
      if (open) html.push("</ul>");
      if (groep !== null) tekst.push("");
      tekst.push(kop); html.push("<p><b>" + esc(kop) + "</b></p><ul>");
      groep = kop; open = true;
    }
    const regels = x.tekst.split("\n");
    const inspring = x.soort === "tussendoel" && ids.has(doelId(x.leerlijn.id, x.hoofd.nr)) ? "    " : "";
    tekst.push(inspring + x.nr + "  " + regels[0], ...regels.slice(1).map(r => inspring + "      " + r));
    html.push("<li" + (inspring ? ' style="margin-left:24px"' : "") + "><b>" + esc(x.nr) + "</b> " + regels.map(esc).join("<br>") + "</li>");
  }
  if (open) html.push("</ul>");
  return { tekst: tekst.join("\n"), html: html.join("") };
}
