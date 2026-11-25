// Coffee! – de app: dashboard "Nu", weekoverzicht en instellingen.
import * as G from "./google.js";
import * as W from "./weken.js";
import * as B from "./bewerken.js";
import * as T from "./todo.js";
import * as D from "./gegevens.js";
import * as E from "./evaluatie.js";
import * as N from "./notities.js";
import * as H from "./huiswerk.js";
import * as L from "./doelen.js";

// ---------- Instellingen (in deze browser) ----------
const INST_SLEUTEL = "coffee_instellingen";
const STANDAARD_PAD = "Klimop / SCHOOLJAAR 26 - 27 / AGENDA / JOPPE";

function laadInstellingen() {
  let inst = {};
  try { inst = JSON.parse(localStorage.getItem(INST_SLEUTEL) || "{}"); } catch (e) { /* leeg */ }
  // overnemen van de testpagina
  if (!inst.clientId && localStorage.getItem("lkd_client_id")) inst.clientId = localStorage.getItem("lkd_client_id");
  if (!inst.map) { try { inst.map = JSON.parse(localStorage.getItem("coffee_agendamap") || "null"); } catch (e) { /* leeg */ } }
  return inst;
}
function bewaarInstellingen() { localStorage.setItem(INST_SLEUTEL, JSON.stringify(staat.inst)); }

// ---------- Thema: auto (volgt toestel), licht of donker ----------
const THEMA_VOLGORDE = ["auto", "licht", "donker"];
const THEMA_INFO = { auto: ["🌓", "Thema volgt je toestel"], licht: ["☀️", "Licht thema (latte)"], donker: ["🌙", "Donker thema (espresso)"] };
function pasThemaToe() {
  const t = staat.inst.thema || "auto";
  if (t === "auto") document.documentElement.removeAttribute("data-thema");
  else document.documentElement.setAttribute("data-thema", t);
  const donker = t === "donker" || (t === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", donker ? "#120d0a" : "#2b1d14");
}
function volgendThema() {
  const i = THEMA_VOLGORDE.indexOf(staat.inst.thema || "auto");
  staat.inst.thema = THEMA_VOLGORDE[(i + 1) % THEMA_VOLGORDE.length];
  bewaarInstellingen(); pasThemaToe(); toon();
}

// ---------- Toestand ----------
const staat = {
  inst: laadInstellingen(),
  gebruiker: null,
  weken: [],              // [{ bestand, maandag }] oplopend
  cache: new Map(),       // bestand.id → Promise<dagen>
  testtijd: null,         // Date of null
  weergave: "nu",
  weekIndex: null,        // gekozen week in het weekoverzicht
  fout: null
};
const nu = () => staat.testtijd ? new Date(staat.testtijd) : new Date();

// ---------- Kleine hulpjes ----------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "html") throw new Error("geen html");
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.appendChild(typeof kid === "string" || typeof kid === "number" ? document.createTextNode(String(kid)) : kid);
  }
  return el;
}
const $ = (id) => document.getElementById(id);
const DAGNAAM = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"];
const weekdagVan = (d) => (d.getDay() + 6) % 7;
const datumTekst = (d, opties = { weekday: "long", day: "numeric", month: "long" }) => d.toLocaleDateString("nl-BE", opties);

function linkLabel(url) {
  try {
    const u = new URL(url);
    if (/docs\.google\.com|drive\.google\.com/.test(u.hostname)) return "Drive-bestand";
    if (/prowise/.test(u.hostname)) return "Prowise";
    if (/youtu/.test(u.hostname)) return "YouTube";
    return u.hostname.replace(/^www\./, "");
  } catch (e) { return "link"; }
}

function linkIcoon(url) {
  if (/docs\.google\.com\/document/.test(url)) return "📄";
  if (/docs\.google\.com\/spreadsheets/.test(url)) return "📊";
  if (/docs\.google\.com\/presentation/.test(url)) return "📽️";
  if (/docs\.google\.com\/forms/.test(url)) return "📝";
  if (/drive\.google\.com\/drive\/.*folders/.test(url)) return "📁";
  if (/drive\.google\.com/.test(url)) return "📎";
  if (/youtu/.test(url)) return "▶️";
  if (/prowise/.test(url)) return "🖥️";
  return "🔗";
}
function linkKnop(url, label) {
  return h("a", { class: "linkchip", href: url, target: "_blank", rel: "noopener", title: url },
    h("span", { class: "icoon" }, linkIcoon(url)), h("span", {}, label));
}

// Tekst met klikbare links (als knopjes)
function metLinks(tekst) {
  const delen = [];
  const re = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|https?:\/\/[^\s)]+/g;
  let laatste = 0, m;
  while ((m = re.exec(tekst))) {
    if (m.index > laatste) delen.push(tekst.slice(laatste, m.index));
    const url = m[1] != null ? m[2] : m[0];
    delen.push(linkKnop(url, m[1] != null ? m[1] : linkLabel(url)));
    laatste = m.index + m[0].length;
  }
  if (laatste < tekst.length) delen.push(tekst.slice(laatste));
  return delen;
}

// ---------- Gegevens ----------
async function laadWeken() {
  const bestanden = await G.agendaBestanden(staat.inst.map.id);
  const n = nu();
  staat.weken = bestanden
    .map(b => ({ bestand: b, maandag: W.weekUitNaam(b.name, n) }))
    .filter(w => w.maandag)
    .sort((a, b) => a.maandag - b.maandag || (a.bestand.mimeType === G.DOC_TYPE ? 1 : -1));
  // bij dubbele weken (Word + Google Docs) de Google Docs-versie houden
  staat.weken = staat.weken.filter((w, i, lijst) => !(lijst[i + 1] && lijst[i + 1].maandag.getTime() === w.maandag.getTime()));
  staat.sjabloon = bestanden.find(b => /sjabloon/i.test(b.name) && b.mimeType === G.DOC_TYPE && b.mapId === staat.inst.map.id)
    || bestanden.find(b => /sjabloon/i.test(b.name) && b.mimeType === G.DOC_TYPE) || null;
}

// ---------- Sluimerstand ----------
// Is je Google-sleutel verlopen, dan opent Coffee! meteen met de laatst geladen gegevens van deze en volgende week
// (enkel op dit toestel, gewist bij afmelden). Je eerste klik vernieuwt de verbinding op de achtergrond.
const SLUIMER = "coffee_sluimer";
function sluimerLezen() { try { return JSON.parse(localStorage.getItem(SLUIMER) || "null"); } catch (e) { return null; } }
function sluimerBewaren(week, dagen) {
  const huidig = W.weekVoorDatum(staat.weken, nu());
  const i = staat.weken.indexOf(huidig);
  const relevant = new Set([staat.weken[i], staat.weken[i + 1]].filter(Boolean).map(w => w.bestand.id));
  if (!relevant.has(week.bestand.id)) return;
  const oud = sluimerLezen() || {};
  const bewaard = {};
  for (const [id, d] of Object.entries(oud.dagen || {})) if (relevant.has(id)) bewaard[id] = d;
  bewaard[week.bestand.id] = JSON.parse(JSON.stringify(dagen, (k, v) => (k === "week" || k === "idemVan") ? undefined : v));
  const uit = { gebruiker: staat.gebruiker, weken: staat.weken.map(w => ({ bestand: w.bestand, maandag: W.isoDatum(w.maandag) })), sjabloon: staat.sjabloon, dagen: bewaard };
  try { localStorage.setItem(SLUIMER, JSON.stringify(uit)); } catch (e) { /* vol: dan zonder sluimerstand */ }
}
function sluimerStart() {
  const sl = sluimerLezen();
  if (!sl || !sl.gebruiker || !sl.weken) return false;
  staat.gebruiker = sl.gebruiker;
  staat.weken = sl.weken.map(w => ({ bestand: w.bestand, maandag: W.vanIso(w.maandag) }));
  staat.sjabloon = sl.sjabloon || null;
  for (const w of staat.weken) {
    const dagen = sl.dagen && sl.dagen[w.bestand.id];
    if (dagen) staat.cache.set(w.bestand.id, Promise.resolve(annoteer(w, dagen)));
  }
  staat.slaapt = true;
  return true;
}
// Na het vernieuwen van de sleutel: alles opnieuw ophalen
async function wakker() {
  if (!staat.slaapt) return;
  staat.slaapt = false;
  staat.cache.clear();
  try { await D.laad(); if (staat.inst.map) await laadWeken(); } catch (e) { console.warn(e); }
  toon();
}
function annoteer(week, dagen) {
  dagen.forEach((d, i) => d.rijen.forEach((r, j) => { r.plaats = { dagIndex: i, rijIndex: j }; r.week = week; r.dagTitel = d.titel;
    r.datum = d.weekdag >= 0 ? W.plusDagen(week.maandag, d.weekdag) : null; }));
  return dagen;
}

function dagenVan(week) {
  if (!week) return Promise.resolve([]);
  if (!staat.cache.has(week.bestand.id)) {
    const p = G.leesWeekBestand(week.bestand)
      .then(dagen => {
        try { sluimerBewaren(week, dagen); } catch (e) { /* niet erg */ }
        dagen.forEach((d, i) => d.rijen.forEach((r, j) => { r.plaats = { dagIndex: i, rijIndex: j }; r.week = week; r.dagTitel = d.titel;
          r.datum = d.weekdag >= 0 ? W.plusDagen(week.maandag, d.weekdag) : null; }));
        return dagen;
      })
      .catch(e => { staat.cache.delete(week.bestand.id); throw e; });
    staat.cache.set(week.bestand.id, p);
  }
  return staat.cache.get(week.bestand.id);
}

// Alle lessen van de gegeven weken, met datum, chronologisch
async function lessenUit(weken) {
  const uit = [];
  const resultaten = await Promise.allSettled(weken.map(dagenVan));
  resultaten.forEach((r, i) => {
    if (r.status !== "fulfilled") return;
    for (const dag of r.value) {
      if (dag.weekdag < 0) continue;
      const datum = W.plusDagen(weken[i].maandag, dag.weekdag);
      for (const rij of dag.rijen) if (rij.soort === "les") uit.push({ datum, rij, week: weken[i] });
    }
  });
  return uit.sort((a, b) => a.datum - b.datum || (a.rij.start || 0) - (b.rij.start || 0));
}

function wekenRond(week, terug) {
  const i = staat.weken.indexOf(week);
  return i < 0 ? [] : staat.weken.slice(Math.max(0, i - terug), i + 1);
}

// ---------- Weergave: onderdelen ----------
function vakLabel(vak) { return vak ? h("span", { class: "vak" }, vak) : h("span", { class: "vak open" }, "+"); }

// Afkortingen voluit in zinnen (WO, SOVA, CREA en LO blijven afgekort)
const VAKNAMEN = { t: "taal", funct: "functionele taal", funcw: "functionele wiskunde", go: "godsdienst",
                   p: "permanentie", proj: "project", w: "wiskunde" };
function vakVoluit(vak) { return VAKNAMEN[W.vakSleutel(vak)] || vak; }

// Label vooraan een rij: vak, P / ½ P, LO of niets
function rijLabel(rij) {
  if (rij.soort === "les") return vakLabel(rij.vak);
  if (rij.soort === "perm") return h("span", { class: "vak perm" }, rij.halfP ? "½ P" : "P");
  if (rij.soort === "vrij") return vakLabel("LO");
  return h("span", { class: "vak leeg" }, "");
}
const rijKlasse = (rij) => rij.soort + (rij.bewaking ? " bewaking" : "");

function chips(rij) {
  return h("div", { class: "chips" },
    rij.groen.map(t => h("span", { class: "chip groen", title: "Therapie / afwezig" }, "🟢 " + t.replace(/^\(|\)$/g, ""))),
    rij.rood.map(t => h("span", { class: "chip rood" }, "❗ " + t))
  );
}

function regelsWeergave(rij) {
  const wrap = h("div", { class: "regels" });
  const gekleurd = rij.groen.concat(rij.rood).filter(Boolean);
  for (const r of rij.regels || []) {
    let t = (r.md != null ? r.md : r.tekst).replace(/\s+/g, " ").trim();
    if (/^Lesonderwerp:/i.test(t)) continue;                  // staat al in de titel
    // therapie en herinneringen staan al als label bovenaan: niet herhalen
    let rest = t;
    for (const g of gekleurd) rest = rest.replace(g, "");
    if (rest !== t) {
      if (!rest.replace(/[\s\-–:,.()!]/g, "")) continue;
      t = rest.replace(/[\s\-–:,]+$/, "").trim();
    }
    if (!t) { wrap.appendChild(h("div", { class: "witruimte" })); continue; }
    const kleur = "";
    const kop = t.match(/^(Doelen|Verloop):\s*(.*)$/i);
    if (kop) { wrap.appendChild(h("div", { class: "kop" + kleur }, h("strong", {}, kop[1] + ":"), " ", ...metLinks(kop[2]))); continue; }
    if (/^(Inl|Kern|Slot)\b\.?$/i.test(t)) { wrap.appendChild(h("div", { class: "fase" }, t)); continue; }
    if (r.niveau >= 0) {
      wrap.appendChild(h("div", { class: "punt" + kleur, style: "--niveau:" + r.niveau }, ...metLinks(t)));
    } else {
      wrap.appendChild(h("div", { class: "tekst" + kleur }, ...metLinks(t)));
    }
  }
  return wrap;
}

function materiaalWeergave(rij) {
  const items = rij.materiaal.filter(m => m && m !== "•");
  const losseLinks = rij.links.filter(l => !items.some(m => m.includes(l)));
  if (!items.length && !losseLinks.length) return null;
  return h("div", { class: "materiaal" },
    h("h4", {}, "🎒 Materiaal"),
    items.length ? h("ul", {}, items.map(m => h("li", {}, ...metLinks(m)))) : null,
    losseLinks.length ? h("div", { class: "knoppen" },
      losseLinks.map(l => linkKnop(l, linkLabel(l)))) : null
  );
}

// IDEM-les: toon de inhoud van de vorige les van hetzelfde vak (zonder de gekleurde regels van die dag)
function weergaveRij(rij) {
  const bron = rij.idem && rij.idemVan;
  if (!bron) return rij;
  return {
    ...rij,
    onderwerp: bron.rij.onderwerp,
    doelen: bron.rij.doelen,
    regels: bron.rij.regels.filter(r => !r.kleur),
    materiaal: rij.materiaalIdem ? bron.rij.materiaal : rij.materiaal,
    links: [...new Set(rij.materiaalIdem ? bron.rij.links : rij.links.concat(bron.rij.links))]
  };
}

function lesTitel(rij) {
  const t = weergaveRij(rij);
  return t.onderwerp ? t.onderwerp + (rij.idem && rij.idemVan ? " (idem)" : "") : "Nog in te vullen";
}

function lesKaart(rij, opties = {}) {
  const kanBewerken = !opties.voorbeeld && !opties.geenBewerkKnop && rij.bron && rij.week && rij.week.bestand.mimeType === G.DOC_TYPE;
  const t = opties.voorbeeld ? rij : weergaveRij(rij);
  const idemChip = !opties.voorbeeld && rij.idem
    ? h("span", { class: "chip idem" }, rij.idemVan
        ? "↺ IDEM, zoals " + datumTekst(rij.idemVan.datum, { weekday: "short", day: "numeric", month: "short" })
        : "↺ IDEM, vorige les niet gevonden")
    : null;
  return h("article", { class: "kaart les" + (opties.groot ? " groot" : "") },
    h("header", {},
      h("div", { class: "tijd" }, rij.uur),
      vakLabel(rij.vak),
      h("h3", { class: t.onderwerp ? "" : "open" }, t.onderwerp || "Nog in te vullen"),
      kanBewerken ? h("button", { class: "knop klein secundair bewerk", onclick: (e) => { e.stopPropagation(); openBewerker(rij); } }, "✏️ Bewerken") : null
    ),
    h("div", { class: "chips" }, idemChip, chips(t).childNodes.length ? [...chips(t).childNodes] : null),
    h("div", { class: "lesinhoud" }, regelsWeergave(t), materiaalWeergave(t))
  );
}

// IDEM-lessen koppelen aan de vorige les van hetzelfde vak
async function koppelIdem(week) {
  if (!week) return;
  const lessen = await lessenUit(wekenRond(week, 4));
  for (const l of lessen) {
    if (l.rij.idem && !l.rij.idemVan) { const v = W.vorigeLes(lessen, l); if (v) l.rij.idemVan = v; }
  }
}

function blokKaart(rij, datum, opties = {}) {
  let extra = null;
  if (rij.soort === "vrij") {
    extra = h("div", {}, h("p", { class: "nadruk" }, "Je bent vrij en hoeft niet op school te zijn."),
      todoBlok({ datum: W.isoDatum(datum), start: rij.start, eind: rij.eind, soort: "vrij", titel: "LO (vrij)" }));
  } else if (rij.soort === "perm") {
    let zwem = null;
    if (rij.halfP) {
      const z = W.isZwemweek(staat.inst.zwemweek, datum);
      zwem = z === null
        ? h("p", { class: "klein" }, "½ P: stel bij Instellingen in welke week je meegaat zwemmen.")
        : h("p", { class: "nadruk" }, z ? "🏊 Deze week ga je mee zwemmen." : "☕ Deze week heb je permanentie.");
    }
    const echtePerm = !rij.halfP || W.isZwemweek(staat.inst.zwemweek, datum) === false;
    extra = h("div", {}, zwem,
      echtePerm ? todoBlok({ datum: W.isoDatum(datum), start: rij.start, eind: rij.eind, soort: "perm", titel: rij.titel }) : null);
  }
  return h("article", { class: "kaart blok " + rijKlasse(rij) + (opties.groot ? " groot" : "") },
    h("header", {},
      h("div", { class: "tijd" }, rij.uur),
      rij.soort === "blok" ? null : rijLabel(rij),
      h("h3", {}, rij.soort === "vrij" ? "Vrij" : rij.titel)
    ),
    chips(rij),
    rij.regels.length ? regelsWeergave(rij) : null,
    extra
  );
}

const hoofdletter = (t) => t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
// Een les of blok groot bekijken (alleen lezen), met een knop om te bewerken
function openLesVenster(rij, datum) {
  const sluit = () => { venster.sluit(); document.removeEventListener("keydown", opEscape); };
  const opEscape = (e) => { if (e.key === "Escape" && document.querySelectorAll(".venster").length === 1) sluit(); };
  document.addEventListener("keydown", opEscape);
  const kanBewerken = rij.soort === "les" && rij.bron && rij.week && rij.week.bestand.mimeType === G.DOC_TYPE;
  const kaart = rijKaart(rij, datum, { groot: true, geenBewerkKnop: true });
  const nt = lesNotities(rij, datum);
  const inhoud = kaart.querySelector(".lesinhoud");
  if (nt && inhoud) inhoud.before(nt);
  const dagNaam = datumTekst(datum, { weekday: "long", day: "numeric", month: "long" });
  const venster = sluitbaarVenster([
    h("header", { class: "venster-kop" },
      h("div", {}, h("h2", {}, rij.soort === "les" ? hoofdletter(vakVoluit(rij.vak)) || "Les" : rij.soort === "vrij" ? "Vrij" : rij.titel),
        h("div", { class: "klein" }, dagNaam.charAt(0).toUpperCase() + dagNaam.slice(1) + ", " + rij.uur)),
      h("div", { class: "knoppen" },
        h("button", { class: "knop secundair", onclick: sluit }, "Sluiten"),
        kanBewerken ? h("button", { class: "knop", onclick: () => { sluit(); openBewerker(rij); } }, "✏️ Bewerken") : null)),
    kaart
  ], { lezen: true });
  venster.element.addEventListener("click", (e) => { if (e.target === venster.element) sluit(); });
  setTimeout(() => { const k = venster.element.querySelector(".venster-kop .knop:last-child"); if (k) k.focus(); }, 0);
}

function rijKaart(rij, datum, opties) { return rij.soort === "les" ? lesKaart(rij, opties) : blokKaart(rij, datum, opties); }

function dagLijst(dag, datum, nuMin, opties = {}) {
  const lijst = h("div", { class: "daglijst" });
  for (const rij of dag.rijen) {
    const bezig = nuMin != null && rij.start != null && nuMin >= rij.start && nuMin < rij.eind;
    const voorbij = nuMin != null && rij.eind != null && nuMin >= rij.eind;
    const titel = rij.soort === "les" ? lesTitel(rij) : rij.soort === "vrij" ? "Vrij" : rij.titel;
    if (opties.compact) {
      // weekoverzicht: een klik opent de les groot in een venster
      lijst.appendChild(h("button", { type: "button", class: "rij compact " + rijKlasse(rij) + (bezig ? " bezig" : "") + (voorbij ? " voorbij" : ""),
        onclick: () => openLesVenster(rij, datum) },
        h("span", { class: "tijd" }, W.tijdTekst(rij.start)),
        rijLabel(rij),
        h("span", { class: "titel" + (rij.soort === "les" && !weergaveRij(rij).onderwerp ? " open" : "") }, titel),
        rij.groen.length ? h("span", { class: "stip groen", title: rij.groen.join(", ") }, "●") : null,
        rij.rood.length ? h("span", { class: "stip rood", title: rij.rood.join(", ") }, "●") : null));
      continue;
    }
    const det = h("details", { class: "rij " + rijKlasse(rij) + (bezig ? " bezig" : "") + (voorbij ? " voorbij" : "") },
      h("summary", {},
        h("span", { class: "tijd" }, W.tijdTekst(rij.start)),
        rijLabel(rij),
        h("span", { class: "titel" }, titel),
        rij.groen.length ? h("span", { class: "stip groen", title: rij.groen.join(", ") }, "●") : null,
        rij.rood.length ? h("span", { class: "stip rood", title: rij.rood.join(", ") }, "●") : null
      ),
      rijKaart(rij, datum)
    );
    lijst.appendChild(det);
  }
  return lijst;
}

function grootMetNotitie(rij, datum) {
  const kaart = rijKaart(rij, datum, { groot: true });
  const nt = lesNotities(rij, datum);
  const inhoud = kaart.querySelector(".lesinhoud");
  if (nt && inhoud) inhoud.before(nt);
  return kaart;
}

// ---------- Weergave: Nu ----------
async function toonNu(doel) {
  const n = nu();
  const week = W.weekVoorDatum(staat.weken, n);
  const kop = h("div", { class: "nu-kop" },
    h("h2", {}, datumTekst(n)),
    h("div", { class: "klok" }, W.tijdTekst(W.minutenVan(n)))
  );
  doel.replaceChildren(kop);

  if (!week) {
    doel.appendChild(h("div", { class: "kaart" },
      h("h3", {}, "Geen weekdocument voor deze week"),
      h("p", {}, "Ik vond geen document \"Week …\" voor de week van " + datumTekst(W.maandagVan(n), { day: "numeric", month: "long" }) + " in je agendamap."),
      volgendeSchooldagKnop(n)));
    if (weekdagVan(n) >= 5) { doel.appendChild(todoVandaagKaart()); doel.appendChild(vrijeTijdKaart(n, "Weekend ☕")); }
    return;
  }

  doel.appendChild(h("p", { class: "laden" }, "Je agenda wordt geladen…"));
  const dagen = await dagenVan(week);
  await koppelIdem(week);
  doel.querySelector(".laden").remove();
  const dag = dagen.find(d => d.weekdag === weekdagVan(n));
  const nuMin = W.minutenVan(n);

  if (!dag || !dag.rijen.length) {
    doel.appendChild(todoVandaagKaart());
    doel.appendChild(vrijeTijdKaart(n, weekdagVan(n) >= 5 ? "Weekend ☕" : "Geen lessen vandaag ☕"));
    await toonVolgendeSchooldag(doel, n);
    return;
  }

  const { huidig, volgende } = W.huidigBlok(dag, nuMin);
  const eerste = dag.rijen.find(r => r.start != null);
  const laatste = [...dag.rijen].reverse().find(r => r.eind != null);

  // Indeling: op pc links de les, rechts de dag als tijdlijn + to-do's; op gsm alles onder elkaar
  const links = h("div", { class: "nu-links" }), rechts = h("aside", { class: "nu-rechts", "aria-label": "Je dag" });
  doel.appendChild(h("div", { class: "nu-raster" }, links, rechts));

  // herinneringen van vandaag
  const vandaagRood = dag.rijen.flatMap(r => r.rood.map(t => ({ t, rij: r })));
  if (vandaagRood.length) {
    links.appendChild(h("div", { class: "kaart herinneringen" },
      h("h4", {}, "❗ Niet vergeten vandaag"),
      h("ul", {}, vandaagRood.map(x => h("li", {}, h("span", { class: "tijd" }, W.tijdTekst(x.rij.start)), " ", x.t)))));
  }

  const eersteLes = dag.rijen.find(r => r.soort === "les" && r.start != null);
  const landing = landingVoorDag(dag, n);
  if (landing && nuMin < landing.eind) {
    const bezig = nuMin >= landing.start;
    links.appendChild(h("div", { class: "kaart landing" },
      h("h4", {}, "🌅 Zachte landing " + (bezig ? "· nog " + (landing.eind - nuMin) + " min" : W.tijdTekst(landing.start) + "–" + W.tijdTekst(landing.eind)) + (landing.wie ? " · " + landing.wie : "")),
      todoBlok(landing)));
  }
  if (eersteLes && nuMin < eersteLes.start) { const ak = afdrukKaart(dag, n); if (ak) links.appendChild(ak); }
  const tv = todoVandaagKaart();
  tv.classList.add("nu-todo");
  rechts.appendChild(tv);
  rechts.appendChild(h("section", { class: "kaart nu-tijdlijn" }, h("h3", {}, "Vandaag"), dagTijdlijn(dag, n, nuMin),
    h("p", { class: "klein" }, h("a", { href: week.bestand.webViewLink || "#", target: "_blank", rel: "noopener" }, "Weekagenda openen in Google Docs ↗"))));
  const hoofd = h("section", { class: "hoofd" });
  links.appendChild(hoofd);

  if (huidig) {
    hoofd.appendChild(h("div", { class: "label-boven" }, "Nu bezig, nog " + (huidig.eind - nuMin) + " min"));
    const kaart = rijKaart(huidig, n, { groot: true });
    // voortgangsbalk: hoe ver het lesuur al gevorderd is
    const procent = Math.max(0, Math.min(100, Math.round((nuMin - huidig.start) / Math.max(1, huidig.eind - huidig.start) * 100)));
    const kop = kaart.querySelector("header");
    if (kop) kop.after(h("div", { class: "voortgang", role: "progressbar", "aria-valuenow": procent, "aria-valuemin": 0, "aria-valuemax": 100,
      "aria-label": "Verloop van dit lesuur" }, h("span", { style: "width:" + procent + "%" })));
    const notities = lesNotities(huidig, n, { invoer: true });
    if (notities) kaart.querySelector(".lesinhoud").before(notities);
    hoofd.appendChild(kaart);
    if (huidig.soort === "les" && !huidig.idem) {
      const vorigeVak = h("div", { class: "vorige" }, h("p", { class: "klein" }, "Vorige les zoeken…"));
      hoofd.appendChild(vorigeVak);
      toonVorigeLes(vorigeVak, week, { datum: W.middernacht(n), rij: huidig });
    }
    // speeltijd of middagpauze: de volgende les al groot tonen
    if (huidig.soort === "blok" && volgende) {
      hoofd.appendChild(h("div", { class: "label-boven" }, "Hierna om " + W.tijdTekst(volgende.start)));
      hoofd.appendChild(grootMetNotitie(volgende, n));
      if (volgende.soort === "les" && !volgende.idem) {
        const vorigeVak = h("div", { class: "vorige" });
        hoofd.appendChild(vorigeVak);
        toonVorigeLes(vorigeVak, week, { datum: W.middernacht(n), rij: volgende });
      }
    }
  } else if (eerste && nuMin < eerste.start) {
    hoofd.appendChild(h("div", { class: "label-boven" }, "Straks om " + W.tijdTekst(eerste.start)));
    hoofd.appendChild(grootMetNotitie(eerste, n));
    if (eerste.soort === "les" && !eerste.idem) {
      const vorigeVak = h("div", { class: "vorige" });
      hoofd.appendChild(vorigeVak);
      toonVorigeLes(vorigeVak, week, { datum: W.middernacht(n), rij: eerste });
    }
  } else if (laatste && nuMin >= laatste.eind) {
    hoofd.appendChild(vrijeTijdKaart(n, "De lesdag zit erop 🎉"));
  }

  if (volgende && volgende !== eerste && !(huidig && huidig.soort === "blok")) {
    hoofd.appendChild(h("div", { class: "label-boven" }, "Daarna om " + W.tijdTekst(volgende.start)));
    const kort = h("details", { class: "rij " + rijKlasse(volgende) },
      h("summary", {}, h("span", { class: "tijd" }, W.tijdTekst(volgende.start)),
        rijLabel(volgende),
        h("span", { class: "titel" }, volgende.soort === "les" ? lesTitel(volgende) : volgende.soort === "vrij" ? "Vrij" : volgende.titel)),
      rijKaart(volgende, n));
    hoofd.appendChild(kort);
    const nt = lesNotities(volgende, n);
    if (nt) hoofd.appendChild(nt);
  }

  if (laatste && nuMin >= laatste.eind) await toonVolgendeSchooldag(links, n);
}

// De dag als smalle tijdlijn: voorbije uren gedimd, het lopende uur met voortgang, een streepje voor "nu"
function dagTijdlijn(dag, datum, nuMin) {
  const lijst = h("ol", { class: "tijdlijn" });
  let streepGezet = false;
  const streep = () => h("li", { class: "nu-streep", "aria-label": "Nu, " + W.tijdTekst(nuMin) }, h("span", {}, W.tijdTekst(nuMin)));
  const l = landingVoorDag(dag, datum);
  if (l && !dag.rijen.some(r => /zachte\s*landing/i.test((r.titel || "") + " " + (r.onderwerp || "")))) {
    const bezig = nuMin >= l.start && nuMin < l.eind, voorbij = nuMin >= l.eind;
    if (nuMin < l.start) { lijst.appendChild(streep()); streepGezet = true; }
    const knop = landingKnop(l);
    knop.classList.toggle("voorbij", voorbij); knop.classList.toggle("bezig", bezig);
    lijst.appendChild(h("li", { class: "tijdlijn-item" + (bezig ? " bezig" : "") + (voorbij ? " voorbij" : "") }, knop));
    if (bezig) streepGezet = true;
  }
  for (const rij of dag.rijen) {
    if (rij.start == null) continue;
    const bezig = nuMin >= rij.start && nuMin < rij.eind;
    const voorbij = nuMin >= rij.eind;
    if (!streepGezet && !bezig && nuMin < rij.start) { lijst.appendChild(streep()); streepGezet = true; }
    const titel = rij.soort === "les" ? lesTitel(rij) : rij.soort === "vrij" ? "Vrij" : rij.titel;
    const procent = bezig ? Math.round((nuMin - rij.start) / Math.max(1, rij.eind - rij.start) * 100) : 0;
    lijst.appendChild(h("li", { class: "tijdlijn-item" + (bezig ? " bezig" : "") + (voorbij ? " voorbij" : "") },
      h("button", { type: "button", class: "rij compact " + rijKlasse(rij) + (bezig ? " bezig" : "") + (voorbij ? " voorbij" : ""),
        "aria-current": bezig ? "time" : null, onclick: () => openLesVenster(rij, datum) },
        h("span", { class: "tijd" }, W.tijdTekst(rij.start)),
        rijLabel(rij),
        h("span", { class: "titel" + (rij.soort === "les" && !weergaveRij(rij).onderwerp ? " open" : "") }, titel),
        rij.groen.length ? h("span", { class: "stip groen", title: rij.groen.join(", ") }, "●") : null,
        rij.rood.length ? h("span", { class: "stip rood", title: rij.rood.join(", ") }, "●") : null),
      bezig ? h("span", { class: "tijdlijn-voortgang", "aria-hidden": "true" }, h("span", { style: "width:" + procent + "%" })) : null));
    if (bezig) streepGezet = true;
  }
  if (!streepGezet && dag.rijen.length) lijst.appendChild(streep());
  return lijst;
}

async function toonVorigeLes(vak, week, huidige) {
  try {
    const lessen = await lessenUit(wekenRond(week, 4));
    const vorige = W.vorigeLes(lessen, huidige);
    vak.replaceChildren();
    if (!vorige) { vak.appendChild(h("p", { class: "klein" }, "Geen vorige les " + vakVoluit(huidige.rij.vak) + " gevonden in de laatste weken.")); return; }
    vak.appendChild(h("details", { class: "rij les" },
      h("summary", {},
        h("span", { class: "label-inline" }, vorige.zelfdeReeks ? "Vorige les in deze reeks" : "Vorige les " + vakVoluit(vorige.rij.vak)),
        h("span", { class: "titel" }, h("span", { class: "wanneer" }, datumTekst(vorige.datum, { weekday: "short", day: "numeric", month: "short" })), lesTitel(vorige.rij))),
      lesKaart(vorige.rij)));
  } catch (e) {
    vak.replaceChildren(h("p", { class: "klein" }, "Vorige les kon niet geladen worden."));
  }
}

async function toonVolgendeSchooldag(doel, n) {
  for (let i = 1; i <= 14; i++) {
    const d = W.plusDagen(W.middernacht(n), i);
    const week = W.weekVoorDatum(staat.weken, d);
    if (!week) continue;
    let dagen;
    try { dagen = await dagenVan(week); await koppelIdem(week); } catch (e) { continue; }
    const dag = dagen.find(x => x.weekdag === weekdagVan(d));
    if (dag && dag.rijen.some(r => r.soort === "les")) {
      doel.appendChild(h("h3", { class: "sectie" }, "Volgende schooldag: " + datumTekst(d)));
      doel.appendChild(dagLijst(dag, d, null));
      return;
    }
  }
}

function volgendeSchooldagKnop(n) {
  const vak = h("div");
  toonVolgendeSchooldag(vak, n);
  return vak;
}

// ---------- Weergave: Week ----------
async function toonWeek(doel) {
  if (!staat.weken.length) { doel.replaceChildren(h("p", {}, "Geen weekdocumenten gevonden.")); return; }
  if (staat.weekIndex == null) {
    const huidige = W.weekVoorDatum(staat.weken, nu());
    staat.weekIndex = huidige ? staat.weken.indexOf(huidige) : staat.weken.length - 1;
  }
  const week = staat.weken[staat.weekIndex];
  const n = nu();
  const huidigeWeek = W.weekVoorDatum(staat.weken, n);
  const zoekbalk = lessenZoekbalk();
  const navigatie = h("div", { class: "weeknav" },
    h("button", { class: "knop secundair", disabled: staat.weekIndex === 0, onclick: () => { staat.weekIndex--; toon(); } }, "←"),
    h("div", {}, h("h2", {}, "Week van " + datumTekst(week.maandag, { day: "numeric", month: "long" })),
      h("a", { class: "klein", href: week.bestand.webViewLink || "#", target: "_blank", rel: "noopener" }, week.bestand.name + " ↗")),
    h("button", { class: "knop secundair", disabled: staat.weekIndex === staat.weken.length - 1, onclick: () => { staat.weekIndex++; toon(); } }, "→")
  );
  const naarNu = huidigeWeek && huidigeWeek !== week
    ? h("div", { class: "naar-vandaag" }, h("button", { class: "knop klein secundair", onclick: () => { staat.weekIndex = staat.weken.indexOf(huidigeWeek); toon(); } }, "↩ Naar deze week")) : null;
  const weekdeel = h("div", { class: "weekdeel" }, navigatie, naarNu, nieuweWeekKnop(), h("p", { class: "laden" }, "Week wordt geladen…"));
  doel.replaceChildren(zoekbalk.element, zoekbalk.resultaten, weekdeel);
  doel.classList.add("met-zoekknop");
  zoekbalk.opZoeken = (actief) => { weekdeel.hidden = actief; };
  zoekbalk.start();
  const dagen = await dagenVan(week);
  await koppelIdem(week);
  weekdeel.querySelector(".laden").remove();
  const raster = h("div", { class: "weekraster" });
  for (const dag of dagen) {
    const datum = W.plusDagen(week.maandag, Math.max(0, dag.weekdag));
    const vandaag = W.middernacht(n).getTime() === datum.getTime();
    raster.appendChild(h("section", { class: "weekdag" + (vandaag ? " vandaag" : ""), "aria-current": vandaag ? "date" : null },
      h("h3", {}, dag.titel.charAt(0) + dag.titel.slice(1).toLowerCase(), vandaag ? h("span", { class: "vandaag-label" }, "Vandaag") : null),
      (() => { const lijst = dagLijst(dag, datum, vandaag ? W.minutenVan(n) : null, { compact: true });
        const l = landingVoorDag(dag, datum);
        if (l && !dag.rijen.some(r => /zachte\s*landing/i.test((r.titel || "") + " " + (r.onderwerp || "")))) lijst.prepend(landingKnop(l));
        return lijst; })()));
  }
  weekdeel.appendChild(raster);
}

// ---------- Zoeken in alle lesvoorbereidingen van dit schooljaar ----------
const lz = { zoek: "", toon: 30, aantalWeken: 0 };

// Alle weken laden (4 tegelijk, enkel wat nog niet in het geheugen zit), met voortgang
async function alleLessen(voortgang) {
  const weken = staat.weken.slice();
  const nodig = weken.filter(w => !staat.cache.has(w.bestand.id));
  if (nodig.length) {
    let klaar = weken.length - nodig.length;
    const rij = nodig.slice();
    const werker = async () => { while (rij.length) { const w = rij.shift(); try { await dagenVan(w); } catch (e) { console.warn("Week niet geladen", w.bestand.name, e); } klaar++; voortgang && voortgang(klaar, weken.length); } };
    await Promise.all([werker(), werker(), werker(), werker()]);
  }
  const lessen = await lessenUit(weken);
  for (const l of lessen) if (l.rij.idem && !l.rij.idemVan) { const v = W.vorigeLes(lessen, l); if (v) l.rij.idemVan = v; }
  lz.aantalWeken = weken.length;
  return lessen;
}

function zoekTekstLes(rij) {
  const t = weergaveRij(rij);
  return [rij.vak, vakVoluit(rij.vak), t.onderwerp, ...(t.doelen || []), ...(t.regels || []).map(r => r.tekst), ...(t.materiaal || [])].join(" \n ");
}

function lessenZoekbalk() {
  const veld = h("input", { type: "search", class: "lessen-zoek", value: lz.zoek, placeholder: "Zoek in al je lesvoorbereidingen van dit schooljaar, bv. breuken, kern 7, Pater Damiaan…",
    "aria-label": "Zoek in alle lesvoorbereidingen" });
  const status = h("p", { class: "klein lessen-status", role: "status" });
  const lijst = h("div", { class: "lessen-resultaten" });
  const resultaten = h("section", { class: "lessen-zoekvak", hidden: true }, status, lijst);
  // standaard enkel een vergrootglas; een klik opent het zoekveld
  const knop = h("button", { class: "zoekknop", "aria-label": "Zoeken in alle lesvoorbereidingen", title: "Zoeken in alle lessen", "aria-expanded": "false" }, "🔍");
  const sluit = h("button", { class: "linkknop zoek-sluit", "aria-label": "Zoeken sluiten", title: "Sluiten" }, "×");
  const balk = h("div", { class: "lessen-zoekbalk" }, knop, h("div", { class: "zoekveld-wrap", hidden: true }, veld, sluit));
  const open = (aan) => {
    balk.classList.toggle("open", aan);
    knop.hidden = aan; knop.setAttribute("aria-expanded", aan ? "true" : "false");
    balk.querySelector(".zoekveld-wrap").hidden = !aan;
    if (aan) setTimeout(() => veld.focus(), 0);
    else { veld.value = ""; zoek(); knop.focus(); }
  };
  knop.addEventListener("click", () => open(true));
  sluit.addEventListener("click", () => open(false));
  const zb = { element: balk, resultaten, opZoeken: () => {}, start: () => { if (lz.zoek) { open(true); zoek(); } } };
  let timer, teller = 0;
  const zoek = async () => {
    lz.zoek = veld.value;
    const termen = L.zoektermen(lz.zoek);
    const actief = termen.length > 0;
    resultaten.hidden = !actief; zb.opZoeken(actief);
    if (!actief) { lijst.replaceChildren(); status.textContent = ""; return; }
    const mijn = ++teller;
    if (staat.weken.some(w => !staat.cache.has(w.bestand.id))) status.textContent = "Weken laden…";
    const lessen = await alleLessen((k, n) => { if (mijn === teller) status.textContent = "Weken laden… " + k + "/" + n; });
    if (mijn !== teller) return;
    const treffers = lessen.filter(l => !(l.rij.idem && !l.rij.idemVan)).filter(l => {
      const tekst = L.normaal(zoekTekstLes(l.rij));
      return termen.every(w => L.bevat(tekst, w));
    }).reverse();
    status.textContent = treffers.length ? treffers.length + (treffers.length === 1 ? " les gevonden" : " lessen gevonden") + " in " + lz.aantalWeken + " weken" : "Niets gevonden in " + lz.aantalWeken + " weken.";
    lijst.replaceChildren(...treffers.slice(0, lz.toon).map(l => zoekResultaat(l, termen)),
      treffers.length > lz.toon ? h("button", { class: "knop secundair", onclick: () => { lz.toon += 30; zoek(); } }, "Meer tonen (" + (treffers.length - lz.toon) + ")") : "");
  };
  veld.addEventListener("input", () => { clearTimeout(timer); lz.toon = 30; timer = setTimeout(zoek, 200); });
  veld.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); open(false); } });
  return zb;
}

function zoekResultaat(l, termen) {
  const t = weergaveRij(l.rij);
  const n = nu();
  // de eerste regels waarin een zoekwoord voorkomt (behalve het onderwerp zelf)
  const regels = [...new Set([...(t.doelen || []), ...(t.regels || []).map(r => r.tekst), ...(t.materiaal || [])])]
    .filter(x => x && x !== t.onderwerp && termen.some(w => L.bevat(L.normaal(x), w))).slice(0, 2);
  const dag = datumTekst(l.datum, { weekday: "short", day: "numeric", month: "short" });
  const toekomst = l.datum > W.middernacht(n);
  return h("button", { class: "lesresultaat", onclick: () => openLesVenster(l.rij, l.datum) },
    h("span", { class: "lesresultaat-wanneer" }, h("span", { class: "lesresultaat-dag" }, dag), h("span", { class: "tijd" }, W.tijdTekst(l.rij.start)), toekomst ? h("span", { class: "klein" }, "gepland") : null),
    h("span", { class: "lesresultaat-inhoud" },
      h("span", { class: "lesresultaat-kop" }, vakLabel(l.rij.vak), h("span", { class: "lesresultaat-titel" }, ...markeer(t.onderwerp || "Nog in te vullen", termen), l.rij.idem ? " (idem)" : "")),
      regels.map(r => h("span", { class: "lesresultaat-regel" }, ...markeer(r.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"), termen)))));
}

// ---------- Weergave: Instellingen ----------
function toonInstellingen(doel) {
  const inst = staat.inst;
  const melding = h("div", { class: "melding" });
  const zeg = (soort, tekst) => { melding.className = "melding " + soort; melding.textContent = tekst; };

  const clientVeld = h("input", { type: "text", value: inst.clientId || "", placeholder: "…apps.googleusercontent.com" });
  const padVeld = h("input", { type: "text", value: (inst.map && inst.map.pad) || STANDAARD_PAD });
  const zwemVeld = h("input", { type: "date", value: inst.zwemweek || "" });
  const testVeld = h("input", { type: "datetime-local", value: staat.testtijd ? lokaal(staat.testtijd) : "" });

  doel.replaceChildren(
    h("h2", {}, "Instellingen"),
    melding,
    h("section", { class: "kaart" },
      h("h3", {}, "Google-koppeling"),
      h("label", {}, "Client-ID van je Google Cloud-project"), clientVeld,
      h("button", { class: "knop", onclick: () => {
        const id = clientVeld.value.trim();
        if (!/\.apps\.googleusercontent\.com$/.test(id)) return zeg("fout", "Dit lijkt geen geldige client-ID.");
        inst.clientId = id; bewaarInstellingen(); location.reload();
      } }, "Opslaan"),
      staat.gebruiker ? h("p", { class: "klein" }, "Aangemeld als " + staat.gebruiker.displayName + " (" + staat.gebruiker.emailAddress + "). ",
        h("a", { href: "#", onclick: (e) => { e.preventDefault(); afmelden(); } }, "Afmelden")) : null
    ),
    installeerKaart(),
    h("section", { class: "kaart" },
      h("h3", {}, "Privacy"),
      h("ul", { class: "privacy" },
        h("li", {}, "Coffee! praat enkel met Google: je agenda in Google Docs en het bestand \u201cCoffee! gegevens.json\u201d in de map Coffee! van je eigen Drive. Er is geen andere server en geen AI."),
        h("li", {}, "De code staat op GitHub, maar bevat geen enkele naam of score. Lettertypes en hulpprogramma's zitten in Coffee! zelf."),
        h("li", {}, "De browser mag van Coffee! nergens anders gegevens naartoe sturen dan naar Google (veiligheidsregel in de pagina)."),
        h("li", {}, "Op dit toestel bewaart Coffee! een kopie om snel te starten. Afmelden wist die kopie; je Drive blijft ongemoeid. Gebruik je een gedeelde computer, meld dan altijd af."),
        h("li", {}, "Als app bewaart Coffee! enkel zijn eigen code (pagina's, lettertypes, iconen) op het toestel, nooit je agenda of gegevens van Google.")),
      staat.gebruiker ? h("button", { class: "knop secundair", onclick: afmelden }, "Afmelden en dit toestel wissen") : null
    ),
    h("section", { class: "kaart" },
      h("h3", {}, "Agendamap"),
      h("p", { class: "klein" }, "De map met je weekdocumenten (en de maandmappen eronder). Elk schooljaar pas je dit aan."),
      padVeld,
      h("button", { class: "knop", onclick: async () => {
        zeg("info", "Bezig met zoeken…");
        try {
          inst.map = await G.zoekPad(padVeld.value); bewaarInstellingen();
          staat.cache.clear(); await laadWeken();
          zeg("ok", "Gevonden: " + inst.map.pad + " (" + staat.weken.length + " weken).");
        } catch (e) { zeg("fout", e.message); }
      } }, "Zoek deze map")
    ),
    h("section", { class: "kaart" },
      h("h3", {}, "Thema"),
      h("p", { class: "klein" }, "Kies licht (latte), donker (espresso) of laat Coffee! je toestel volgen."),
      h("div", { class: "knoppen" }, THEMA_VOLGORDE.map(t => h("button", {
        class: "knop" + ((inst.thema || "auto") === t ? "" : " secundair"),
        onclick: () => { inst.thema = t; bewaarInstellingen(); pasThemaToe(); toon(); } },
        THEMA_INFO[t][0] + " " + { auto: "Zoals mijn toestel", licht: "Licht", donker: "Donker" }[t])))
    ),
    h("section", { class: "kaart" },
      h("h3", {}, "Zwemmen (½ P)"),
      h("p", { class: "klein" }, "Kies een dag in een week waarin je meegaat zwemmen. Coffee! wisselt vanaf dan elke week af tussen zwemmen en permanentie."),
      zwemVeld,
      h("button", { class: "knop", onclick: () => { inst.zwemweek = zwemVeld.value || null; bewaarInstellingen(); zeg("ok", "Zwemritme opgeslagen."); } }, "Opslaan")
    ),
    h("section", { class: "kaart" },
      h("h3", {}, "Zachte landing"),
      h("p", { class: "klein" }, "Wie doet de zachte landing (8.00–8.40 u.)? Typ \u201cik\u201d voor jezelf. Dit staat in je weekoverzicht; inplannen kan elke schooldag, wie het ook doet. Bewaard in je gegevensbestand op Drive."),
      (() => {
        const namen = landingNamen();
        const velden = ["Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag"].map((d, i) => h("input", { type: "text", value: namen[i] || "", placeholder: "naam of ik", "aria-label": "Zachte landing " + d }));
        return [h("div", { class: "landing-namen" }, ["Ma", "Di", "Wo", "Do", "Vr"].map((d, i) => h("label", {}, d, velden[i]))),
          h("button", { class: "knop", onclick: () => { zetLandingNamen(velden.map(v => v.value.trim())); zeg("ok", "Zachte landing opgeslagen."); } }, "Opslaan")];
      })()
    ),
    h("section", { class: "kaart" },
      h("h3", {}, "Avondblok"),
      h("p", { class: "klein" }, "Het moment 's avonds (maandag tot vrijdag) waarin je to-do's kunt plannen."),
      (() => {
        const av = avondInstelling();
        const s = h("input", { type: "time", value: av.start }), e = h("input", { type: "time", value: av.eind });
        return h("div", { class: "rij-tijden" }, h("label", {}, "Van", s), h("label", {}, "Tot", e),
          h("button", { class: "knop", onclick: () => { if (s.value && e.value && s.value < e.value) { inst.avond = { start: s.value, eind: e.value }; bewaarInstellingen(); zeg("ok", "Avondblok opgeslagen."); } else zeg("fout", "Kies een begin- en einduur."); } }, "Opslaan"));
      })()
    ),
    h("section", { class: "kaart" },
      h("h3", {}, "Evaluatie: grenzen"),
      h("p", { class: "klein" }, "Vanaf welk percentage is een resultaat sterk, goed of aandacht? Daaronder is het zorg."),
      (() => {
        const gr = grenzen();
        const veld = (w) => h("input", { type: "text", inputmode: "numeric", value: String(w), class: "grensveld" });
        const s1 = veld(gr.sterk), s2 = veld(gr.goed), s3 = veld(gr.aandacht);
        return h("div", { class: "rij-tijden" },
          h("label", {}, "★ Sterk vanaf", s1), h("label", {}, "✓ Goed vanaf", s2), h("label", {}, "⚠ Aandacht vanaf", s3),
          h("button", { class: "knop", onclick: () => {
            const [a, b, c] = [s1, s2, s3].map(x => Number(x.value));
            if (![a, b, c].every(x => Number.isFinite(x) && x > 0 && x <= 100) || !(a > b && b > c)) return zeg("fout", "Kies drie percentages van hoog naar laag, bv. 80, 65 en 50.");
            inst.grenzen = { sterk: a, goed: b, aandacht: c }; bewaarInstellingen(); zeg("ok", "Grenzen opgeslagen.");
          } }, "Opslaan"),
          h("button", { class: "knop secundair", onclick: () => { delete inst.grenzen; bewaarInstellingen(); s1.value = 80; s2.value = 65; s3.value = 50; zeg("ok", "Standaardgrenzen (80, 65, 50) hersteld."); } }, "Standaard"));
      })()
    ),
    h("section", { class: "kaart" },
      h("h3", {}, "Huiswerk"),
      h("p", { class: "klein" }, "Elke maandag een kolom voor de huistaak taal, elke donderdag een voor rekenen, in weken met een weekagenda. Vanaf welke datum?"),
      (() => {
        const veld = h("input", { type: "date", value: huiswerkVanaf() });
        return h("div", { class: "rij-tijden" }, h("label", {}, "Bijhouden vanaf", veld),
          h("button", { class: "knop", onclick: () => { if (!veld.value) return; inst.huiswerkVanaf = veld.value; bewaarInstellingen(); zeg("ok", "Opgeslagen."); } }, "Opslaan"));
      })()
    ),
    h("section", { class: "kaart" },
      h("h3", {}, "Testtijd"),
      h("p", { class: "klein" }, "Doe alsof het een ander moment is, om het dashboard 's avonds of in het weekend uit te proberen."),
      testVeld,
      h("div", { class: "knoppen" },
        h("button", { class: "knop", onclick: () => { if (testVeld.value) { staat.testtijd = new Date(testVeld.value); staat.weergave = "nu"; toon(); } } }, "Gebruik deze tijd"),
        h("button", { class: "knop secundair", onclick: () => { staat.testtijd = null; staat.weergave = "nu"; toon(); } }, "Terug naar echte tijd"))
    ),
    h("p", { class: "klein" }, h("a", { href: "test.html" }, "Verbindingstest openen"))
  );
}

// Afmelden: sleutel intrekken én alle Coffee!-gegevens op dit toestel wissen (je Drive blijft ongemoeid)
async function afmelden() {
  if (D.heeftOnbewaard()) { toast("Even geduld", "Coffee! bewaart nog je laatste wijziging"); return; }
  G.meldAf();
  D.wisLokaal();
  try { localStorage.removeItem(LEERLIJN_LOKAAL); localStorage.removeItem(SLUIMER); } catch (e) { /* niets */ }
  staat.leerlijn = null; staat.leerlijnGecontroleerd = false;
  try { sessionStorage.clear(); } catch (e) { /* niets */ }
  location.reload();
}

function lokaal(d) {
  const x = new Date(d);
  return W.isoDatum(x) + "T" + W.tijdTekst(W.minutenVan(x));
}

// ---------- To-do's ----------
const STANDAARD_AVOND = { start: "19:30", eind: "21:00" };
const avondInstelling = () => staat.inst.avond || STANDAARD_AVOND;
const tijdMin = (t) => { const [u, m] = t.split(":").map(Number); return u * 60 + m; };
const todos = () => D.data().todos.filter(t => !t.verwijderd);

// Stukken van het scherm die zichzelf verversen als de to-do's veranderen
const levend = new Set();
function levendVak(maak) {
  const el = h("div", { class: "levend" });
  const vul = () => el.replaceChildren(...[].concat(maak()).filter(Boolean));
  vul();
  levend.add({ el, vul });
  return el;
}
D.opWijziging(() => {
  for (const v of [...levend]) { if (v.el.isConnected) v.vul(); else levend.delete(v); }
  const n = T.aantalOpen(todos(), nu());
  document.querySelectorAll(".tab-teller").forEach(teller => { teller.textContent = n || ""; teller.classList.toggle("verborgen", !n); });
});

function todoTab(knop) {
  const n = T.aantalOpen(todos(), nu());
  const k = knop("todo", "To-do");
  k.appendChild(h("span", { class: "tab-teller" + (n ? "" : " verborgen"), title: "Nog in te plannen" }, n ? String(n) : ""));
  return k;
}

function slotTekst(slot, kort = false) {
  const d = W.vanIso(slot.datum);
  const vandaag = W.isoDatum(nu()), morgen = W.isoDatum(W.plusDagen(nu(), 1));
  const dag = slot.datum === vandaag ? "Vandaag" : slot.datum === morgen ? "Morgen" : datumTekst(d, { weekday: kort ? "short" : "long", day: "numeric", month: "short" });
  if (slot.soort === "weekend") return slot.datum === vandaag || slot.datum === morgen ? dag + " (" + slot.titel.toLowerCase() + ")" : dag;
  if (slot.soort === "woensdag") return dag + " namiddag";
  if (slot.soort === "landing") return dag + " " + W.tijdTekst(slot.start) + ", zachte landing";
  const wat = slot.soort === "avond" ? "avond" : slot.titel;
  return dag + " " + W.tijdTekst(slot.start) + ", " + wat;
}

function wijzigTodo(id, fn) {
  D.wijzig(g => { const t = g.todos.find(x => x.id === id); if (t) { fn(t); t.gewijzigd = Date.now(); } });
}

function todoItem(t, opties = {}) {
  const li = h("li", { class: "todo" + (t.klaar ? " klaar" : "") });
  const vink = h("input", { type: "checkbox", "aria-label": "Klaar", checked: t.klaar || null });
  vink.addEventListener("change", () => {
    if (!vink.checked) { wijzigTodo(t.id, x => { x.klaar = false; x.klaarOp = null; }); return; }
    // eerst feest, dan pas de lijst bijwerken (anders verdwijnt het item midden in de animatie)
    const iso = W.isoDatum(nu());
    const vandaagKlaar = todos().filter(x => x.klaar && x.klaarOp && W.isoDatum(new Date(x.klaarOp)) === iso).length + 1;
    const nogOpenVandaag = todos().filter(x => !x.klaar && x.id !== t.id && x.gepland && x.gepland.datum === iso).length;
    const blokLeeg = t.gepland && T.inBlok(todos(), t.gepland.datum, t.gepland.start, t.gepland.soort).filter(x => !x.klaar && x.id !== t.id).length === 0;
    const allesKlaar = t.gepland && t.gepland.datum === iso && nogOpenVandaag === 0;
    li.classList.add("afvinken");
    vier(vink, allesKlaar ? 2 : blokLeeg ? 1 : 0, vandaagKlaar);
    setTimeout(() => wijzigTodo(t.id, x => { x.klaar = true; x.klaarOp = Date.now(); }), 700);
  });
  const tekst = h("span", { class: "todo-tekst", tabindex: "0", title: "Klik om aan te passen" }, ...metLinks(t.tekst));
  const bewerk = () => {
    const veld = h("input", { type: "text", value: t.tekst });
    const datum = h("input", { type: "date", value: t.deadline || "", title: "Deadline (mag leeg)" });
    const klaarMet = (opslaan) => {
      if (opslaan && veld.value.trim()) wijzigTodo(t.id, x => { x.tekst = veld.value.trim(); x.deadline = datum.value || null; });
      else D.wijzig(() => {});   // gewoon opnieuw tonen
    };
    veld.addEventListener("keydown", e => { if (e.key === "Enter") klaarMet(true); if (e.key === "Escape") klaarMet(false); });
    li.replaceChildren(h("div", { class: "todo-bewerk" }, veld,
      h("label", { class: "klein deadline-label" }, "Deadline", datum),
      h("div", { class: "knoppen" },
        h("button", { class: "knop klein", onclick: () => klaarMet(true) }, "Opslaan"),
        h("button", { class: "knop klein secundair", onclick: () => klaarMet(false) }, "Annuleren"),
        h("button", { class: "knop klein secundair gevaar", onclick: () => wijzigTodo(t.id, x => { x.verwijderd = true; }) }, "Verwijderen"))));
    setTimeout(() => veld.focus(), 0);
  };
  tekst.addEventListener("click", (e) => { if (e.target.closest("a")) return; bewerk(); });
  tekst.addEventListener("keydown", e => { if (e.key === "Enter") bewerk(); });

  const extra = [];
  if (t.deadline && !t.klaar) {
    const telaat = t.deadline < W.isoDatum(nu());
    extra.push(h("span", { class: "minichip" + (telaat ? " rood" : "") }, "⏰ " + datumTekst(W.vanIso(t.deadline), { weekday: "short", day: "numeric", month: "short" })));
  }
  if (!t.klaar && t.gepland && T.isVoorbij(t.gepland, nu())) extra.push(h("span", { class: "minichip rood" }, "Gemist: " + slotTekst(t.gepland, true)));
  const gepland = t.gepland && !T.isVoorbij(t.gepland, nu());
  if (!t.klaar && !opties.inBlok) {
    extra.push(gepland
      ? h("button", { class: "minichip plan", title: "Ander moment kiezen", onclick: () => openInplanner(t) }, opties.inGroep ? "📅 Ander moment" : "📅 " + slotTekst(t.gepland, true))
      : h("button", { class: "minichip plan", onclick: () => openInplanner(t) }, "📅 Inplannen"));
  }
  li.append(vink, h("div", { class: "todo-midden" }, tekst, extra.length ? h("div", { class: "todo-extra" }, extra) : null));
  if (!t.klaar && opties.inBlok) {
    li.append(h("button", { class: "minichip uit-blok", title: "Uit dit blok halen (terug naar 'nog in te plannen')", "aria-label": "Uit dit blok halen",
      onclick: () => wijzigTodo(t.id, x => { x.gepland = null; }) }, "✕"));
  }
  return li;
}

// ---------- Feestje bij een afgevinkte to-do ----------
const AANMOEDIGING = [
  "Afgevinkt! ☕", "Weer eentje minder!", "Lekker bezig!", "Die is van tafel!", "Vers gezet, snel gedaan!",
  "Zo gaat dat!", "Check! ✓", "Hop, volgende!", "Dat smaakt naar meer!", "Opgeruimd staat netjes!"
];
const DEELTJES = ["☕", "✨", "⭐", "🤎", "✓"];
const KLEUREN = ["#c08a55", "#6b4226", "#e9c49a", "#f7e7bf", "#3d7a37", "#d9a46c"];

// niveau 0 = gewone to-do, 1 = blok leeg, 2 = alles van vandaag klaar
function vier(bron, niveau, aantalVandaag) {
  const minderBeweging = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const r = bron.getBoundingClientRect();
  const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
  if (!minderBeweging) {
    bron.classList.remove("pop"); void bron.offsetWidth; bron.classList.add("pop");
    const aantal = [26, 44, 80][niveau];
    const laag = h("div", { class: "feestlaag", "aria-hidden": "true" });
    document.body.appendChild(laag);
    for (let i = 0; i < aantal; i++) {
      const emoji = Math.random() < 0.35;
      const d = h("span", { class: "deeltje" + (emoji ? " emoji" : "") }, emoji ? DEELTJES[Math.floor(Math.random() * DEELTJES.length)] : "");
      if (!emoji) {
        d.style.background = KLEUREN[Math.floor(Math.random() * KLEUREN.length)];
        if (Math.random() < 0.5) d.style.borderRadius = "2px";
      }
      d.style.left = x0 + "px"; d.style.top = y0 + "px";
      laag.appendChild(d);
      const hoek = Math.random() * Math.PI * 2;
      const kracht = (60 + Math.random() * 120) * (1 + niveau * 0.6);
      const dx = Math.cos(hoek) * kracht, dy = Math.sin(hoek) * kracht - 60 - niveau * 40;
      const draai = (Math.random() - 0.5) * 720;
      d.animate([
        { transform: "translate(-50%, -50%) scale(.4)", opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${draai / 2}deg) scale(1)`, opacity: 1, offset: 0.45 },
        { transform: `translate(calc(-50% + ${dx * 1.25}px), calc(-50% + ${dy + 160 + niveau * 60}px)) rotate(${draai}deg) scale(.8)`, opacity: 0 }
      ], { duration: 900 + Math.random() * 500 + niveau * 250, easing: "cubic-bezier(.15,.7,.35,1)", fill: "forwards" });
    }
    setTimeout(() => laag.remove(), 2200);
  }
  const tekst = niveau === 2 ? "Alles van vandaag is klaar! 🎉"
    : niveau === 1 ? "Dit blok is helemaal klaar! 🙌"
    : AANMOEDIGING[Math.floor(Math.random() * AANMOEDIGING.length)];
  toast(tekst, aantalVandaag > 1 ? aantalVandaag + " to-do's afgevinkt vandaag" + (aantalVandaag >= 5 ? " 🔥" : "") : null, niveau);
}

function toast(hoofd, sub, niveau = 0) {
  document.querySelectorAll(".toast").forEach(t => t.remove());
  const t = h("div", { class: "toast" + (niveau ? " groot" : ""), role: "status", "aria-live": "polite" },
    h("strong", {}, hoofd), sub ? h("span", {}, sub) : null);
  document.body.appendChild(t);
  setTimeout(() => t.classList.add("weg"), 2400);
  setTimeout(() => t.remove(), 2900);
}

function snelToevoegen(plaatshouder, gepland = null) {
  const veld = h("input", { type: "text", class: "snel", placeholder: plaatshouder, "aria-label": plaatshouder });
  const voegToe = () => {
    const tekst = veld.value.trim();
    if (!tekst) return;
    D.wijzig(g => g.todos.push(T.nieuweTodo(tekst, gepland)));
    veld.value = "";
    setTimeout(() => { const nieuw = document.querySelector("input.snel[placeholder='" + plaatshouder.replace(/'/g, "\\'") + "']"); if (nieuw) nieuw.focus(); }, 0);
  };
  veld.addEventListener("keydown", e => { if (e.key === "Enter") voegToe(); });
  return h("div", { class: "snel-rij" }, veld, h("button", { class: "knop klein", onclick: voegToe }, "Toevoegen"));
}

// To-do's van één blok (P, LO of avond), met een veld om er meteen een toe te voegen
function todoBlok(slot) {
  const lijst = levendVak(() => {
    const items = T.inBlok(todos(), slot.datum, slot.start, slot.soort);
    const open = items.filter(t => !t.klaar), klaar = items.filter(t => t.klaar);
    return [
      h("h4", { class: "todo-kop" }, open.length ? "To-do's in dit blok" : "Nog niets gepland in dit blok"),
      open.length || klaar.length ? h("ul", { class: "todolijst" }, open.concat(klaar).map(t => todoItem(t, { inBlok: true }))) : null
    ];
  });
  return h("div", { class: "todo-blok" }, lijst, snelToevoegen("Nieuwe to-do voor dit blok", { ...slot }));
}

// Kaart op het dashboard: alle to-do's die vandaag gepland staan (permanenties, LO, namiddag, avond, weekend)
const SOORT_LABEL = { landing: "🌅", perm: "P", vrij: "LO", avond: "🌙", woensdag: "🌤️", weekend: "🛋️" };
function todoVandaagKaart() {
  return levendVak(() => {
    const iso = W.isoDatum(nu());
    const nuMin = W.minutenVan(nu());
    const vandaag = todos().filter(t => t.gepland && t.gepland.datum === iso && (!t.klaar || (t.klaarOp && W.isoDatum(new Date(t.klaarOp)) === iso)))
      .sort((a, b) => (a.klaar - b.klaar) || a.gepland.start - b.gepland.start || a.aangemaakt - b.aangemaakt);
    const open = T.aantalOpen(todos(), nu());
    if (!vandaag.length && !open) return null;
    const nogOpen = vandaag.filter(t => !t.klaar).length;
    return h("div", { class: "kaart todo-vandaag" },
      h("h4", {}, "✅ To-do's vandaag", vandaag.length ? h("span", { class: "klein" }, " " + (vandaag.length - nogOpen) + "/" + vandaag.length + " klaar") : null),
      vandaag.length ? h("ul", { class: "todolijst" }, vandaag.map(t => {
        const li = todoItem(t, { inBlok: true });
        const g = t.gepland;
        const bezig = g.start <= nuMin && nuMin < g.eind && g.soort !== "weekend";
        const wanneer = g.soort === "weekend" ? SOORT_LABEL.weekend : W.tijdTekst(g.start) + " " + (SOORT_LABEL[g.soort] || "");
        li.querySelector(".todo-midden").prepend(h("span", { class: "tijd" + (bezig ? " nu" : ""), title: g.titel }, wanneer.trim() + " "));
        if (!t.klaar && T.isVoorbij(g, nu())) li.classList.add("verlopen");
        return li;
      })) : h("p", { class: "klein" }, "Niets gepland voor vandaag."),
      open ? h("p", { class: "klein" }, h("a", { href: "#", onclick: (e) => { e.preventDefault(); staat.weergave = "todo"; toon(); } },
        open === 1 ? "1 to-do wacht nog op een moment" : open + " to-do's wachten nog op een moment")) : null);
  });
}

// Het vrije blok buiten de schooluren van vandaag: avond, woensdagnamiddag of weekend
function vrijeTijdSlot(n) {
  const wd = weekdagVan(n), iso = W.isoDatum(n);
  if (wd >= 5) return { datum: iso, start: 0, eind: 24 * 60, soort: "weekend", titel: wd === 5 ? "Zaterdag" : "Zondag" };
  if (wd === 2) return { datum: iso, start: 13 * 60, eind: 22 * 60, soort: "woensdag", titel: "Woensdagnamiddag" };
  const av = avondInstelling();
  return { datum: iso, start: tijdMin(av.start), eind: tijdMin(av.eind), soort: "avond", titel: "Avond" };
}
function vrijeTijdKaart(n, titel) {
  const slot = vrijeTijdSlot(n);
  const uitleg = slot.soort === "weekend" ? "Plan hier wat je dit weekend wilt doen:" :
    slot.soort === "woensdag" ? "Woensdagnamiddag (13–22 u.):" : "Vanavond, " + W.tijdTekst(slot.start) + "–" + W.tijdTekst(slot.eind) + ":";
  return h("div", { class: "kaart" }, h("h3", {}, titel), h("p", { class: "klein" }, uitleg), todoBlok(slot));
}

// ---------- Notities voor de volgende les ----------
function notitieBlok(n) {
  return h("div", { class: "notitie" }, h("span", { class: "notitie-kop" }, "📝 Vorige keer (" + datumTekst(W.vanIso(n.datum), { weekday: "short", day: "numeric", month: "short" }) + ")"),
    h("span", {}, ...metLinks(n.tekst)));
}
// Wat je de vorige keer noteerde bij dit vak, en (optioneel) een veld voor een nieuwe notitie
function lesNotities(rij, datum, { invoer = false } = {}) {
  if (rij.soort !== "les" || !rij.vak || !datum) return null;
  const iso = W.isoDatum(datum);
  return levendVak(() => {
    const lijst = D.data().notities || [];
    const vorige = N.vorigeNotitie(lijst, rij.vak, iso, rij.start);
    if (!invoer) return vorige ? notitieBlok(vorige) : null;
    const eigen = N.eigenNotitie(lijst, rij.vak, iso, rij.start);
    const veld = h("input", { type: "text", class: "notitie-veld", value: eigen ? eigen.tekst : "",
      placeholder: "Notitie voor de volgende les, bv. afgewerkt tot oef. 7", "aria-label": "Notitie voor de volgende les " + vakVoluit(rij.vak) });
    const bewaar = () => {
      const nu_ = N.eigenNotitie(D.data().notities || [], rij.vak, iso, rij.start);
      if ((nu_ ? nu_.tekst : "") !== veld.value.trim()) D.wijzig(g => N.zetNotitie(g, rij.vak, iso, rij.start, veld.value));
    };
    veld.addEventListener("input", (e) => maakPijlen(veld, e));
    veld.addEventListener("change", bewaar);
    veld.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); veld.blur(); } });
    return [vorige ? notitieBlok(vorige) : null, h("label", { class: "notitie-invoer" }, h("span", {}, "📝"), veld)];
  });
}

// ---------- Wie doet de zachte landing? ----------
// Bewaard in je gegevensbestand op Drive (niet in de code): { id: "landing", namen: [ma, di, wo, do, vr] }; "ik" = jij.
const LANDING_STANDAARD = ["ik", "ik", "ik", "", ""];
function landingNamen() {
  const x = (D.data().instellingen || []).find(i => i.id === "landing" && !i.verwijderd);
  return x && Array.isArray(x.namen) ? x.namen : LANDING_STANDAARD;
}
const eigenVoornaam = () => ((staat.gebruiker && staat.gebruiker.displayName) || "").split(" ")[0] || "jij";
function landingWie(weekdag) {
  const n = (landingNamen()[weekdag] || "").trim();
  return !n ? "" : /^ik$/i.test(n) ? eigenVoornaam() : n;
}
function zetLandingNamen(namen) {
  D.wijzig(g => {
    g.instellingen = g.instellingen || [];
    const x = g.instellingen.find(i => i.id === "landing");
    if (x) { x.namen = namen; x.gewijzigd = Date.now(); delete x.verwijderd; }
    else g.instellingen.push({ id: "landing", namen, gewijzigd: Date.now() });
  });
}
// Zachte landing van een dag (null als er die dag geen les is)
function landingVoorDag(dag, datum) {
  const wd = weekdagVan(datum);
  if (wd > 4 || !dag || !dag.rijen.some(r => r.start != null)) return null;
  return { ...T.landingVan(dag, datum), wie: landingWie(wd) };
}
function openLanding(l) {
  const dagNaam = datumTekst(W.vanIso(l.datum), { weekday: "long", day: "numeric", month: "long" });
  const venster = sluitbaarVenster([
    h("h2", {}, "🌅 Zachte landing"),
    h("p", { class: "klein" }, dagNaam.charAt(0).toUpperCase() + dagNaam.slice(1) + ", " + W.tijdTekst(l.start) + "–" + W.tijdTekst(l.eind) + (l.wie ? " · " + l.wie : " · nog niet ingevuld wie (Instellingen → Zachte landing)")),
    todoBlok(l),
    h("div", { class: "knoppen" }, h("button", { class: "knop", onclick: () => sluit() }, "Sluiten"))
  ], { klein: true });
  const sluit = () => { venster.sluit(); document.removeEventListener("keydown", opEsc); };
  const opEsc = (e) => { if (e.key === "Escape" && document.querySelectorAll(".venster").length === 1) sluit(); };
  document.addEventListener("keydown", opEsc);
  venster.element.addEventListener("click", (e) => { if (e.target === venster.element) sluit(); });
}
function landingKnop(l) {
  return h("button", { type: "button", class: "rij compact landing-rij", onclick: () => openLanding(l), title: "To-do's voor de zachte landing" },
    h("span", { class: "tijd" }, W.tijdTekst(l.start)),
    h("span", { class: "vak landing-label" }, "🌅"),
    h("span", { class: "titel" }, "Zachte landing", h("span", { class: "landing-wie" }, l.wie ? " · " + l.wie : " · wie?")),
    levendVak(() => { const n = T.inBlok(todos(), l.datum, l.start, l.soort).filter(t => !t.klaar).length; return n ? h("span", { class: "tab-teller", title: n + " to-do's" }, String(n)) : null; }));
}

// ---------- Afdruklijst voor de zachte landing ----------
function afdrukKaart(dag, datum) {
  const iso = W.isoDatum(datum);
  const lessen = dag.rijen.filter(r => r.soort === "les").map(r => ({ rij: r, items: (weergaveRij(r).materiaal || []).filter(m => m && m !== "•") }))
    .filter(x => x.items.length);
  if (!lessen.length) return null;
  const sleutel = "coffee_afgedrukt_" + iso;
  let gedaan = {};
  try { gedaan = JSON.parse(localStorage.getItem(sleutel) || "{}"); } catch (e) { gedaan = {}; }
  const zet = (k, v) => { gedaan[k] = v; try { localStorage.setItem(sleutel, JSON.stringify(gedaan)); } catch (e) { /* niet erg */ } };
  return h("div", { class: "kaart afdruklijst" },
    h("h4", {}, "🖨️ Afdrukken en klaarleggen voor vandaag"),
    lessen.map(({ rij, items }) => h("div", { class: "afdruk-les" },
      h("div", { class: "afdruk-kop" }, h("span", { class: "tijd" }, W.tijdTekst(rij.start)), vakLabel(rij.vak), h("span", {}, lesTitel(rij))),
      h("ul", {}, items.map((m, i) => {
        const k = rij.start + "|" + i;
        const vink = h("input", { type: "checkbox", checked: gedaan[k] || null, "aria-label": "Klaargelegd" });
        const li = h("li", { class: gedaan[k] ? "gedaan" : "" }, vink, h("span", {}, ...metLinks(m)));
        vink.addEventListener("change", () => { zet(k, vink.checked); li.classList.toggle("gedaan", vink.checked); });
        return li;
      })))));
}

function dagKop(iso) {
  const kort = datumTekst(W.vanIso(iso), { weekday: "short", day: "numeric", month: "short" });
  if (iso === W.isoDatum(nu())) return "Vandaag (" + kort + ")";
  if (iso === W.isoDatum(W.plusDagen(nu(), 1))) return "Morgen (" + kort + ")";
  return datumTekst(W.vanIso(iso), { weekday: "long", day: "numeric", month: "long" });
}

// Venster: een moment kiezen
async function openInplanner(todo) {
  const lijst = h("div", { class: "slots" }, h("p", { class: "laden" }, "Vrije momenten zoeken…"));
  const venster = sluitbaarVenster([
    h("h3", {}, "📅 Wanneer doe je dit?"),
    h("p", { class: "todo-titel" }, todo.tekst),
    lijst,
    h("div", { class: "knoppen" },
      todo.gepland ? h("button", { class: "knop secundair", onclick: () => { wijzigTodo(todo.id, x => { x.gepland = null; }); venster.sluit(); } }, "Niet meer inplannen") : null,
      h("button", { class: "knop secundair", onclick: () => venster.sluit() }, "Annuleren"))
  ], { klein: true });
  const dagen = new Map();
  for (let i = 0; i < 14; i++) {
    const d = W.plusDagen(W.middernacht(nu()), i);
    const week = W.weekVoorDatum(staat.weken, d);
    if (!week) continue;
    try {
      const dg = (await dagenVan(week)).find(x => x.weekdag === weekdagVan(d));
      if (dg) dagen.set(W.isoDatum(d), dg);
    } catch (e) { /* week niet leesbaar: overslaan */ }
  }
  const slots = T.vrijeBlokken(dagen, nu(), 14, { zwemweek: staat.inst.zwemweek, avond: avondInstelling() });
  if (!slots.length) { lijst.replaceChildren(h("p", { class: "klein" }, "Geen vrije momenten gevonden in de komende twee weken.")); return; }
  const perDag = new Map();
  for (const s of slots) { if (!perDag.has(s.datum)) perDag.set(s.datum, []); perDag.get(s.datum).push(s); }
  lijst.replaceChildren(...[...perDag].map(([datum, ss]) => h("div", { class: "slotdag" },
    h("h4", {}, dagKop(datum)),
    h("div", { class: "knoppen" }, ss.map(s => {
      const al = T.inBlok(todos(), s.datum, s.start, s.soort).filter(t => !t.klaar && t.id !== todo.id).length;
      const gekozen = todo.gepland && T.slotSleutel(todo.gepland) === T.slotSleutel(s);
      return h("button", { class: "slot " + s.soort + (gekozen ? " gekozen" : ""), onclick: () => { wijzigTodo(todo.id, x => { x.gepland = { ...s }; }); venster.sluit(); } },
        s.soort === "weekend" ? null : h("span", { class: "tijd" }, W.tijdTekst(s.start) + "–" + W.tijdTekst(s.eind)),
        h("span", {}, s.soort === "landing" ? "🌅 Zachte landing" : s.soort === "avond" ? "🌙 Avond" : s.soort === "vrij" ? "LO (vrij)" : s.soort === "weekend" ? "🛋️ " + s.titel : s.soort === "woensdag" ? "🌤️ Namiddag" : s.titel),
        al ? h("span", { class: "slot-aantal", title: "Al gepland in dit blok" }, String(al)) : null);
    })))));
}

// Het to-do-scherm
async function toonTodo(doel) {
  const statusVak = levendVak(() => {
    const st = D.status();
    return h("span", { class: "klein opslagstatus" }, st === "bezig" ? "Bezig met bewaren…" : st === "fout" ? "⚠️ Niet bewaard in je Drive, Coffee! probeert opnieuw" : st === "offline" ? "Niet verbonden: verbind opnieuw om te bewaren" : "Bewaard in je Drive (map Coffee!)");
  });
  doel.replaceChildren(
    h("div", { class: "nu-kop" }, h("h2", {}, "To-do's"), statusVak),
    snelToevoegen("Wat moet je nog doen of onthouden?"),
    levendVak(() => {
      const g = T.groepeer(todos(), nu());
      const uit = [];
      uit.push(h("h3", { class: "sectie" }, "Nog in te plannen"));
      uit.push(g.teplannen.length ? h("ul", { class: "todolijst kaart" }, g.teplannen.map(t => todoItem(t)))
        : h("p", { class: "klein" }, g.gemist.length ? "Geen nieuwe to-do's zonder moment." : "Alles heeft een moment gekregen. ☕"));
      if (g.gemist.length) {
        uit.push(h("h3", { class: "sectie gemist-kop" }, "Gemist ", h("span", { class: "teller-rood" }, String(g.gemist.length))));
        uit.push(h("p", { class: "klein" }, "Het blok is voorbij en de to-do is nog niet klaar. Plan hem opnieuw in of vink hem af."));
        uit.push(h("ul", { class: "todolijst kaart gemist-lijst" }, g.gemist.map(t => todoItem(t))));
      }
      if (g.gepland.length) {
        uit.push(h("h3", { class: "sectie" }, "Ingepland"));
        for (const groep of g.gepland) {
          uit.push(h("div", { class: "slotgroep " + groep.slot.soort },
            h("h4", {}, slotTekst(groep.slot)),
            h("ul", { class: "todolijst" }, groep.items.map(t => todoItem(t, { inGroep: true })))));
        }
      }
      if (g.klaar.length) {
        uit.push(h("details", { class: "klaar-lijst" },
          h("summary", {}, "Klaar (" + g.klaar.length + ")"),
          h("ul", { class: "todolijst" }, g.klaar.slice(0, 50).map(t => todoItem(t))),
          h("button", { class: "knop klein secundair", onclick: () => D.wijzig(dd => dd.todos.forEach(t => { if (t.klaar && !t.verwijderd) { t.verwijderd = true; t.gewijzigd = Date.now(); } })) }, "Klare to-do's wissen")));
      }
      return uit;
    })
  );
  setTimeout(() => { const v = doel.querySelector("input.snel"); if (v && matchMedia("(pointer: fine)").matches) v.focus(); }, 0);
}

// ---------- Evaluatie ----------
const ev = { scherm: "lijst", id: null, vak: "alle" };   // scherm: lijst | toets | leerling | leerlingen
const lijst = (g, k) => (g[k] = g[k] || []);
const gaNaar = (scherm, id = null) => { ev.scherm = scherm; ev.id = id; toon(); window.scrollTo(0, 0); };
const terugKnop = () => h("button", { class: "knop klein secundair terug", onclick: () => gaNaar("lijst") }, "← Evaluatie");
const procentTekst = (r) => r.procent != null ? r.procent + "%" : r.status === "afw" ? "afwezig" : r.status === "vrij" ? "vrijgesteld" : "";
const datumKort = (iso) => datumTekst(W.vanIso(iso), { weekday: "short", day: "numeric", month: "short" });

// Resultaatniveaus: kleur + icoon + getal (nooit kleur alleen)
const grenzen = () => staat.inst.grenzen || E.STANDAARD_GRENZEN;
function niveauLabel(procent, extra = "") {
  const n = E.niveau(procent, grenzen());
  if (!n) return h("span", { class: "klein" }, "–");
  return h("span", { class: "niveau niv-" + n, title: E.NIVEAUS[n].naam + ": " + procent + "%" + extra },
    h("span", { class: "niv-icoon", "aria-hidden": "true" }, E.NIVEAUS[n].icoon), procent + "%",
    h("span", { class: "sr-only" }, " (" + E.NIVEAUS[n].naam.toLowerCase() + ")"));
}
// Staafje: lengte = percentage, kleur = niveau, getal + icoon erbij
function procentStaaf(procent, titel) {
  if (procent == null) return h("span", { class: "klein" }, "–");
  const n = E.niveau(procent, grenzen());
  return h("span", { class: "staaf-rij", title: titel || procent + "%" },
    h("span", { class: "staaf" }, h("span", { class: "niv-vul-" + n, style: "width:" + Math.min(100, procent) + "%" })),
    niveauLabel(procent));
}
const TREND = { op: ["↗", "beter dan de vorige toetsen"], neer: ["↘", "minder dan de vorige toetsen"], gelijk: ["→", "ongeveer gelijk"] };
function trendTeken(t) {
  if (!t) return null;
  return h("span", { class: "trend trend-" + t, title: "Trend: " + TREND[t][1] }, TREND[t][0], h("span", { class: "sr-only" }, " " + TREND[t][1]));
}
function legende() {
  const gr = grenzen();
  return h("div", { class: "legende", "aria-label": "Legende resultaatniveaus" },
    h("span", { class: "niveau niv-sterk" }, h("span", { class: "niv-icoon" }, "★"), "Sterk ", gr.sterk + "%+"),
    h("span", { class: "niveau niv-goed" }, h("span", { class: "niv-icoon" }, "✓"), "Goed ", gr.goed + "–" + (gr.sterk - 1) + "%"),
    h("span", { class: "niveau niv-aandacht" }, h("span", { class: "niv-icoon" }, "⚠"), "Aandacht ", gr.aandacht + "–" + (gr.goed - 1) + "%"),
    h("span", { class: "niveau niv-zorg" }, h("span", { class: "niv-icoon" }, "!"), "Zorg <", gr.aandacht + "%"),
    h("span", { class: "niveau niv-geen" }, "afw / vrij"));
}

function toonEvaluatie(doel) {
  const g = D.data();
  if (ev.scherm === "toets") { const t = (g.toetsen || []).find(x => x.id === ev.id && !x.verwijderd); if (t) return toonToets(doel, t); }
  if (ev.scherm === "leerling") { const l = (g.leerlingen || []).find(x => x.id === ev.id && !x.verwijderd); if (l) return toonLeerling(doel, l); }
  if (ev.scherm === "leerlingen") return toonLeerlingenBeheer(doel);
  if (ev.scherm === "klas" && E.VAKKEN[ev.id]) return toonKlasoverzicht(doel, ev.id);
  ev.scherm = "lijst";
  const ll = E.leerlingen(g);
  doel.replaceChildren(...[
    h("div", { class: "nu-kop" }, h("h2", {}, "Evaluatie"),
      h("div", { class: "knoppen" },
        h("button", { class: "knop secundair", onclick: () => gaNaar("leerlingen") }, "👥 Leerlingen"),
        ll.length ? h("button", { class: "knop", onclick: () => openToetsVenster() }, "＋ Nieuwe toets") : null)),
    !ll.length ? h("div", { class: "kaart leeg-staat" },
      h("h3", {}, "Begin met je leerlingen"),
      h("p", {}, "Voeg je leerlingen toe en duid aan wie in je klasgroep, taalgroep en rekengroep zit. Daarna kun je toetsen aanmaken en punten invoeren."),
      h("button", { class: "knop", onclick: () => gaNaar("leerlingen") }, "Leerlingen toevoegen")) : null,
    ll.length ? levendVak(() => {
      const alle = E.toetsen(D.data());
      const filter = h("div", { class: "filter", role: "group", "aria-label": "Vak" },
        [["alle", "Alle vakken"], ...Object.entries(E.VAKKEN).map(([k, v]) => [k, v.naam])].map(([k, naam]) =>
          h("button", { class: "filterknop" + (ev.vak === k ? " actief" : ""), "aria-pressed": ev.vak === k ? "true" : "false",
            onclick: () => { ev.vak = k; toon(); } }, naam)));
      const zichtbaar = alle.filter(t => ev.vak === "alle" || t.vak === ev.vak);
      return [
        h("h3", { class: "sectie" }, "Toetsen"), filter, legende(),
        zichtbaar.length ? h("div", { class: "toetslijst" }, zichtbaar.map(t => {
          const st = E.statistiek(D.data(), t);
          return h("button", { class: "toetsrij", onclick: () => gaNaar("toets", t.id) },
            h("span", { class: "tijd" }, datumKort(t.datum)),
            h("span", { class: "vak" }, E.VAKKEN[t.vak].naam),
            h("span", { class: "toetsnaam" }, t.titel),
            h("span", { class: "klein" }, st.ingevuld + "/" + st.aantal + " ingevuld"),
            procentStaaf(st.gemiddelde, "Gemiddelde: " + (st.gemiddelde == null ? "nog geen punten" : st.gemiddelde + "%")));
        })) : h("p", { class: "klein" }, alle.length ? "Geen toetsen voor dit vak." : "Nog geen toetsen. Maak je eerste toets aan met ＋ Nieuwe toets."),
        h("h3", { class: "sectie" }, "Klasoverzicht"),
        h("div", { class: "leerlingknoppen" }, Object.entries(E.VAKKEN).map(([k, v]) =>
          h("button", { class: "knop secundair", onclick: () => gaNaar("klas", k) }, "▦ " + v.naam))),
        h("h3", { class: "sectie" }, "Per leerling"),
        h("div", { class: "leerlingknoppen" }, E.leerlingen(D.data()).map(l =>
          h("button", { class: "knop secundair", onclick: () => gaNaar("leerling", l.id) }, l.naam)))
      ];
    }) : null
  ].filter(Boolean));
}

// ----- Leerlingen beheren -----
function toonLeerlingenBeheer(doel) {
  const namen = h("textarea", { rows: 4, placeholder: "Eén naam per lijn (voornaam of initialen volstaat)" });
  const kies = Object.fromEntries(Object.keys(E.GROEPEN).map(k => [k, h("input", { type: "checkbox", checked: k === "klas" || null })]));
  doel.replaceChildren(
    terugKnop(),
    h("div", { class: "nu-kop" }, h("h2", {}, "Leerlingen")),
    h("p", { class: "klein" }, "Deze lijst staat enkel in je eigen Drive (map Coffee!). Voornamen of initialen volstaan."),
    h("div", { class: "kaart" },
      h("h3", {}, "Leerlingen toevoegen"),
      namen,
      h("div", { class: "groepkeuze" }, Object.entries(E.GROEPEN).map(([k, naam]) => h("label", {}, kies[k], " " + naam))),
      h("button", { class: "knop", onclick: () => {
        const lijnen = namen.value.split("\n").map(x => x.trim()).filter(Boolean);
        if (!lijnen.length) return;
        const groepen = Object.keys(kies).filter(k => kies[k].checked);
        D.wijzig(g => lijnen.forEach(n => lijst(g, "leerlingen").push(E.nieuweLeerling(n, groepen))));
        namen.value = "";
        toast(lijnen.length === 1 ? "Leerling toegevoegd" : lijnen.length + " leerlingen toegevoegd");
      } }, "Toevoegen")),
    levendVak(() => {
      const ll = E.leerlingen(D.data());
      if (!ll.length) return h("p", { class: "klein" }, "Nog geen leerlingen.");
      return h("div", { class: "tabelvak" }, h("table", { class: "leerlingtabel" },
        h("thead", {}, h("tr", {}, h("th", {}, "Naam"), Object.values(E.GROEPEN).map(n => h("th", {}, n)), h("th", {}, ""))),
        h("tbody", {}, ll.map(l => {
          const naam = h("input", { type: "text", value: l.naam, "aria-label": "Naam" });
          naam.addEventListener("change", () => { if (naam.value.trim()) D.wijzig(g => { const x = g.leerlingen.find(y => y.id === l.id); x.naam = naam.value.trim(); x.gewijzigd = Date.now(); }); });
          return h("tr", {},
            h("td", {}, naam),
            Object.keys(E.GROEPEN).map(k => {
              const c = h("input", { type: "checkbox", checked: l.groepen.includes(k) || null, "aria-label": E.GROEPEN[k] + " " + l.naam });
              c.addEventListener("change", () => D.wijzig(g => {
                const x = g.leerlingen.find(y => y.id === l.id);
                x.groepen = c.checked ? [...new Set([...x.groepen, k])] : x.groepen.filter(y => y !== k);
                x.gewijzigd = Date.now();
              }));
              return h("td", { class: "midden" }, c);
            }),
            h("td", {}, h("button", { class: "knop klein secundair gevaar", onclick: (e) => {
              const knop = e.currentTarget;
              if (knop.dataset.zeker) { D.wijzig(g => { const x = g.leerlingen.find(y => y.id === l.id); x.verwijderd = true; x.gewijzigd = Date.now(); }); }
              else { knop.dataset.zeker = "1"; knop.textContent = "Zeker?"; }
            } }, "Verwijderen")));
        }))));
    })
  );
}

// ----- Toets aanmaken / aanpassen -----
function openToetsVenster(bestaand = null) {
  const titel = h("input", { type: "text", value: bestaand ? bestaand.titel : "", placeholder: "bv. Toets breuken, dictee kern 7" });
  const vak = h("select", {}, Object.entries(E.VAKKEN).map(([k, v]) => h("option", { value: k, selected: (bestaand ? bestaand.vak : "taal") === k || null }, v.naam)));
  const datum = h("input", { type: "date", value: bestaand ? bestaand.datum : W.isoDatum(nu()) });
  const groep = h("select", {}, Object.entries(E.GROEPEN).map(([k, n]) => h("option", { value: k }, n)));
  groep.value = bestaand ? bestaand.groep : E.VAKKEN[vak.value].groep;
  let groepAangepast = !!bestaand;
  groep.addEventListener("change", () => { groepAangepast = true; });
  vak.addEventListener("change", () => { if (!groepAangepast) groep.value = E.VAKKEN[vak.value].groep; });
  const onderdelen = h("div", { class: "onderdelen" });
  const voegOnderdeelToe = (o = { naam: "", max: "" }) => {
    const rij = h("div", { class: "onderdeel", "data-id": o.id || "" },
      h("input", { type: "text", value: o.naam, placeholder: "Onderdeel (bv. Lezen)", "aria-label": "Naam onderdeel" }),
      h("input", { type: "text", inputmode: "decimal", value: o.max === "" ? "" : E.toonScore(o.max), placeholder: "max", "aria-label": "Maximum", class: "max" }),
      h("button", { type: "button", class: "knop klein secundair", "aria-label": "Onderdeel verwijderen", onclick: () => { if (onderdelen.children.length > 1) rij.remove(); } }, "✕"));
    onderdelen.appendChild(rij);
  };
  (bestaand ? bestaand.onderdelen : [{ naam: "Totaal", max: 20 }]).forEach(voegOnderdeelToe);
  const melding = h("div", { class: "melding" });
  const venster = sluitbaarVenster([
    h("h3", {}, bestaand ? "Toets aanpassen" : "Nieuwe toets"),
    melding,
    h("div", { class: "formulier" },
      h("div", { class: "veld" }, h("label", {}, "Titel"), titel),
      h("div", { class: "rij-velden" },
        h("div", { class: "veld" }, h("label", {}, "Vak"), vak),
        h("div", { class: "veld" }, h("label", {}, "Datum"), datum),
        h("div", { class: "veld" }, h("label", {}, "Groep"), groep)),
      h("div", { class: "veld" }, h("label", {}, "Onderdelen en maximum"),
        h("p", { class: "klein" }, "Eén onderdeel volstaat voor een gewone totaalscore."),
        onderdelen,
        h("button", { type: "button", class: "knop klein secundair", onclick: () => voegOnderdeelToe() }, "＋ Onderdeel"))),
    h("div", { class: "knoppen" },
      h("button", { class: "knop", onclick: () => {
        const ond = [...onderdelen.children].map(r => {
          const [n, m] = r.querySelectorAll("input");
          return { id: r.dataset.id || undefined, naam: n.value, max: E.leesScore(m.value) };
        });
        if (!titel.value.trim()) { melding.className = "melding fout"; melding.textContent = "Geef de toets een titel."; return; }
        if (ond.some(o => typeof o.max !== "number" || o.max <= 0)) { melding.className = "melding fout"; melding.textContent = "Geef elk onderdeel een maximum (bv. 10)."; return; }
        if (bestaand) {
          D.wijzig(g => {
            const t = g.toetsen.find(x => x.id === bestaand.id);
            const nieuw = E.nieuweToets({ titel: titel.value, vak: vak.value, datum: datum.value, groep: groep.value, onderdelen: ond });
            Object.assign(t, { titel: nieuw.titel, vak: nieuw.vak, datum: nieuw.datum, groep: nieuw.groep, onderdelen: nieuw.onderdelen, gewijzigd: Date.now() });
          });
          venster.sluit(); toon();
        } else {
          const t = E.nieuweToets({ titel: titel.value, vak: vak.value, datum: datum.value || W.isoDatum(nu()), groep: groep.value, onderdelen: ond });
          D.wijzig(g => lijst(g, "toetsen").push(t));
          venster.sluit(); gaNaar("toets", t.id);
        }
      } }, bestaand ? "Opslaan" : "Toets aanmaken"),
      h("button", { class: "knop secundair", onclick: () => venster.sluit() }, "Annuleren"))
  ], { klein: true });
  setTimeout(() => titel.focus(), 0);
}

// ----- Punten invoeren -----
function toonToets(doel, toets) {
  const g = D.data();
  const ll = E.leerlingenVanToets(g, toets);
  const max = E.maxVan(toets);
  const wijzigScore = (lid, oid, waarde) => D.wijzig(gg => {
    const t = gg.toetsen.find(x => x.id === toets.id);
    t.scores[lid] = t.scores[lid] || {};
    if (waarde == null) delete t.scores[lid][oid]; else t.scores[lid][oid] = waarde;
    t.gewijzigd = Date.now();
  });
  const totaalCellen = {}, gemCellen = [];
  const herbereken = () => {
    const t = D.data().toetsen.find(x => x.id === toets.id);
    for (const l of ll) {
      const r = E.resultaat(t, l.id);
      totaalCellen[l.id].tot.textContent = r.totaal != null ? E.toonScore(r.totaal) + (r.max !== max ? " /" + E.toonScore(r.max) : "") : "";
      totaalCellen[l.id].pct.replaceChildren(r.procent != null ? niveauLabel(r.procent) : r.status === "leeg" ? h("span", { class: "klein" }, "") : h("span", { class: "niveau niv-geen" }, procentTekst(r)));
    }
    const st = E.statistiek(D.data(), t);
    st.perOnderdeel.forEach((w, i) => { gemCellen[i].textContent = w == null ? "" : E.toonScore(w); });
    gemCellen[gemCellen.length - 1].replaceChildren(st.gemiddelde != null ? niveauLabel(st.gemiddelde) : "");
  };
  const invoer = [];   // [rij][kolom]
  const rijen = ll.map((l, ri) => {
    const s = toets.scores[l.id] || {};
    invoer[ri] = [];
    const cellen = toets.onderdelen.map((o, ci) => {
      const veld = h("input", { type: "text", inputmode: "decimal", class: "score", value: E.toonScore(s[o.id]), "aria-label": l.naam + ", " + o.naam + " (max " + E.toonScore(o.max) + ")", autocomplete: "off" });
      invoer[ri][ci] = veld;
      const bewaar = () => {
        const w = E.leesScore(veld.value);
        const fout = w === undefined || (typeof w === "number" && w > o.max);
        veld.classList.toggle("fout", fout);
        veld.title = fout ? (w === undefined ? "Typ een getal, a (afwezig) of v (vrijgesteld)" : "Meer dan het maximum (" + E.toonScore(o.max) + ")") : "";
        if (fout) return;
        if (w !== s[o.id]) { s[o.id] = w; wijzigScore(l.id, o.id, w); herbereken(); }
      };
      veld.addEventListener("change", bewaar);
      veld.addEventListener("blur", bewaar);
      veld.addEventListener("focus", () => veld.select());
      veld.addEventListener("keydown", (e) => {
        const ga = (r, c) => { const v = invoer[r] && invoer[r][c]; if (v) { e.preventDefault(); bewaar(); v.focus(); } };
        if (e.key === "Enter" || e.key === "ArrowDown") ga(ri + 1, ci);
        else if (e.key === "ArrowUp") ga(ri - 1, ci);
        else if (e.key === "ArrowRight" && veld.selectionStart === veld.value.length) ga(ri, ci + 1);
        else if (e.key === "ArrowLeft" && veld.selectionStart === 0) ga(ri, ci - 1);
      });
      return h("td", {}, veld);
    });
    totaalCellen[l.id] = { tot: h("td", { class: "totaal kol-totaal" }), pct: h("td", { class: "pct" }) };
    return h("tr", {}, h("th", { scope: "row" }, h("button", { class: "linkknop", onclick: () => gaNaar("leerling", l.id) }, l.naam)),
      cellen, totaalCellen[l.id].tot, totaalCellen[l.id].pct);
  });
  toets.onderdelen.forEach(() => gemCellen.push(h("td", { class: "gem" })));
  gemCellen.push(h("td", { class: "gem kol-totaal" }));   // totaal (leeg)
  gemCellen.push(h("td", { class: "gem pct" }));
  const tabel = h("table", { class: "puntentabel" + (toets.onderdelen.length === 1 ? " een-onderdeel" : "") },
    h("thead", {}, h("tr", {}, h("th", {}, "Leerling"),
      toets.onderdelen.map(o => h("th", {}, o.naam, h("span", { class: "max" }, "/" + E.toonScore(o.max)))),
      h("th", { class: "kol-totaal" }, "Totaal", h("span", { class: "max" }, "/" + E.toonScore(max))), h("th", {}, "%"))),
    h("tbody", {}, rijen),
    h("tfoot", {}, h("tr", {}, h("th", { scope: "row" }, "Gemiddelde"), gemCellen.slice(0, toets.onderdelen.length), gemCellen[gemCellen.length - 2], gemCellen[gemCellen.length - 1])));
  let wisZeker = false;
  doel.replaceChildren(
    terugKnop(),
    h("div", { class: "nu-kop" },
      h("div", {}, h("h2", {}, toets.titel), h("div", { class: "klein" }, E.VAKKEN[toets.vak].naam + ", " + datumKort(toets.datum) + ", " + E.GROEPEN[toets.groep].toLowerCase())),
      h("div", { class: "knoppen" },
        h("button", { class: "knop secundair", onclick: async () => {
          try { await navigator.clipboard.writeText(E.alsTabel(D.data(), D.data().toetsen.find(x => x.id === toets.id))); toast("Gekopieerd", "Plak in Google Sheets, Docs of Excel"); }
          catch (e) { toast("Kopiëren lukte niet"); }
        } }, "📋 Kopiëren"),
        h("button", { class: "knop secundair", onclick: () => openToetsVenster(toets) }, "✏️ Aanpassen"))),
    ...(ll.length ? [legende(), h("div", { class: "tabelvak" }, tabel)]
      : [h("p", {}, "Er zitten nog geen leerlingen in de " + E.GROEPEN[toets.groep].toLowerCase() + ". ", h("button", { class: "linkknop", onclick: () => gaNaar("leerlingen") }, "Leerlingen beheren"))]),
    h("p", { class: "klein" }, "Typ een score en druk op Enter om naar de volgende leerling te gaan. a = afwezig, v = vrijgesteld (telt niet mee). Alles wordt meteen bewaard."),
    h("button", { class: "knop klein secundair gevaar", onclick: (e) => {
      if (!wisZeker) { wisZeker = true; e.currentTarget.textContent = "Zeker? Klik nog eens om de toets te verwijderen"; return; }
      D.wijzig(gg => { const t = gg.toetsen.find(x => x.id === toets.id); t.verwijderd = true; t.gewijzigd = Date.now(); });
      gaNaar("lijst");
    } }, "Toets verwijderen"));
  herbereken();
  setTimeout(() => { const eerste = invoer.find(r => r && r.some(v => !v.value)); const v = eerste ? eerste.find(x => !x.value) : null; if (v && matchMedia("(pointer: fine)").matches) v.focus(); }, 0);
}

// ----- Klasoverzicht per vak: leerlingen × toetsen -----
function toonKlasoverzicht(doel, vak) {
  const ko = E.klasoverzicht(D.data(), vak);
  const info = E.VAKKEN[vak];
  const kop = h("tr", {}, h("th", { class: "n" }, "Leerling"),
    ko.toetsen.map(t => h("th", { title: t.titel + " (" + datumKort(t.datum) + ")" },
      h("button", { class: "linkknop kolomkop", onclick: () => gaNaar("toets", t.id) }, h("span", { class: "kolomdatum" }, datumKort(t.datum)), h("span", { class: "kolomtitel" }, t.titel)))),
    h("th", {}, "Gemiddeld"));
  const rijen = ko.rijen.map(r => h("tr", {},
    h("th", { class: "n", scope: "row" }, h("button", { class: "linkknop", onclick: () => gaNaar("leerling", r.leerling.id) }, r.leerling.naam)),
    r.cellen.map((c, i) => {
      const t = ko.toetsen[i];
      if (!c) return h("td", { class: "cel niet", title: "Niet in de groep van deze toets" }, "");
      if (c.status === "leeg") return h("td", { class: "cel open", title: "Nog geen punten" }, h("button", { class: "celknop", onclick: () => gaNaar("toets", t.id), "aria-label": "Punten invullen voor " + t.titel }, "+"));
      if (c.procent == null) return h("td", { class: "cel niv-geen" }, c.status === "afw" ? "afw" : "vrij");
      const n = E.niveau(c.procent, grenzen());
      return h("td", { class: "cel niv-" + n, title: r.leerling.naam + ", " + t.titel + ": " + E.toonScore(c.totaal) + "/" + E.toonScore(c.max) + " (" + E.NIVEAUS[n].naam.toLowerCase() + ")" },
        h("span", { class: "niv-icoon", "aria-hidden": "true" }, E.NIVEAUS[n].icoon), c.procent + "%");
    }),
    h("td", { class: "gem-cel" }, r.gemiddelde != null ? niveauLabel(r.gemiddelde) : h("span", { class: "klein" }, "–"), trendTeken(r.trend))));
  doel.replaceChildren(
    terugKnop(),
    h("div", { class: "nu-kop" }, h("div", {}, h("h2", {}, "Klasoverzicht " + info.naam.toLowerCase().replace("wo", "WO")),
      h("div", { class: "klein" }, E.GROEPEN[info.groep] + ", " + ko.toetsen.length + (ko.toetsen.length === 1 ? " toets" : " toetsen")))),
    legende(),
    ko.toetsen.length && ko.rijen.length
      ? h("div", { class: "tabelvak" }, h("table", { class: "klastabel" }, h("thead", {}, kop), h("tbody", {}, rijen)))
      : h("p", { class: "klein" }, "Nog geen toetsen of leerlingen voor " + info.naam.toLowerCase() + "."),
    h("p", { class: "klein" }, "Pijltje = trend: het laatste resultaat tegenover de vorige toetsen (↗ beter, ↘ minder, → gelijk). Klik op een toets of leerling voor details."));
}

// ----- Overzicht per leerling -----
function toonLeerling(doel, l) {
  const ov = E.overzichtLeerling(D.data(), l.id);
  const blokken = Object.entries(E.VAKKEN).map(([vak, info]) => {
    const o = ov[vak];
    return h("section", { class: "kaart" },
      h("header", {}, h("h3", {}, info.naam),
        o.gemiddelde != null ? h("span", { class: "klein" }, "gemiddeld ") : null, o.gemiddelde != null ? niveauLabel(o.gemiddelde) : null,
        trendTeken(E.trend(o.rijen.map(r => r.res.procent)))),
      o.rijen.length ? h("table", { class: "overzichttabel" },
        h("thead", {}, h("tr", {}, h("th", {}, "Datum"), h("th", {}, "Toets"), h("th", {}, "Score"), h("th", {}, "Resultaat"))),
        h("tbody", {}, o.rijen.map(({ toets, res }) => h("tr", {},
          h("td", { class: "tijd" }, datumKort(toets.datum)),
          h("td", {}, h("button", { class: "linkknop", onclick: () => gaNaar("toets", toets.id) }, toets.titel)),
          h("td", {}, res.totaal != null ? E.toonScore(res.totaal) + "/" + E.toonScore(res.max) : ""),
          h("td", {}, res.procent != null ? procentStaaf(res.procent, toets.titel + ": " + res.procent + "%") : h("span", { class: "niveau niv-geen" }, procentTekst(res)))))))
        : h("p", { class: "klein" }, "Nog geen toetsen."));
  });
  doel.replaceChildren(
    terugKnop(),
    h("div", { class: "nu-kop" }, h("div", {}, h("h2", {}, l.naam), h("div", { class: "klein" }, l.groepen.map(k => E.GROEPEN[k]).join(", ") || "geen groep"))),
    ...blokken);
}

// ---------- Huiswerk ----------
const hw = { vak: "taal", alles: false, weggevallen: false, scroll: null, focus: null };
const ZICHTBAAR = 10;

function huiswerkVanaf() {
  if (!staat.inst.huiswerkVanaf) { staat.inst.huiswerkVanaf = W.isoDatum(W.maandagVan(nu())); bewaarInstellingen(); }
  return staat.inst.huiswerkVanaf;
}
function huiswerkKolommen(vak, opties = {}) {
  return H.kolommen(D.data(), vak, {
    maandagen: staat.weken.map(w => W.isoDatum(w.maandag)),
    vanaf: huiswerkVanaf(), tot: W.isoDatum(nu()), metWeggevallen: hw.weggevallen, ...opties
  });
}

function hwBol(t) {
  return h("span", { class: "hw-bol hw-" + t, "aria-hidden": "true" }, H.TOESTANDEN[t].teken);
}

function toonHuiswerk(doel) {
  const g = D.data();
  const heeftLeerlingen = E.leerlingen(g).length > 0;
  const tabs = h("div", { class: "filter", role: "group", "aria-label": "Vak" },
    Object.entries(H.HW_VAKKEN).map(([k, v]) => h("button", { class: "filterknop" + (hw.vak === k ? " actief" : ""), "aria-pressed": hw.vak === k ? "true" : "false",
      onclick: () => { hw.vak = k; hw.scroll = null; toon(); } }, v.naam + " (" + E.GROEPEN[v.groep].toLowerCase() + ")")));
  doel.replaceChildren(...[
    h("div", { class: "nu-kop" }, h("h2", {}, "Huiswerk"),
      h("div", { class: "knoppen" }, heeftLeerlingen ? h("button", { class: "knop secundair", onclick: () => openExtraHuistaak() }, "＋ Extra huistaak") : null)),
    !heeftLeerlingen ? h("div", { class: "kaart leeg-staat" }, h("h3", {}, "Eerst je leerlingen"),
      h("p", {}, "Het huiswerkrooster gebruikt de leerlingen en groepen uit Evaluatie. Voeg ze daar toe en duid de taalgroep en rekengroep aan."),
      h("button", { class: "knop", onclick: () => { staat.weergave = "evaluatie"; gaNaar("leerlingen"); } }, "Leerlingen toevoegen")) : null,
    heeftLeerlingen ? tabs : null,
    heeftLeerlingen ? h("div", { class: "legende hw-legende", "aria-label": "Legende" },
      ["open", "in", "laat"].map(t => h("span", {}, hwBol(t), H.TOESTANDEN[t].naam)),
      h("span", { class: "klein" }, "Klik om te wisselen.")) : null,
    heeftLeerlingen ? levendVak(() => huiswerkRooster()) : null].filter(Boolean));
}

function huiswerkRooster() {
  const g = D.data();
  const alle = huiswerkKolommen(hw.vak);
  const kols = hw.alles ? alle : alle.slice(-ZICHTBAAR);
  const ll = H.leerlingenVan(g, hw.vak, kols);
  const info = H.HW_VAKKEN[hw.vak];
  if (!ll.length) return h("p", { class: "klein" }, "Nog niemand in de " + E.GROEPEN[info.groep].toLowerCase() + ". Duid dit aan bij Evaluatie → Leerlingen.");
  if (!kols.length) return h("div", { class: "kaart leeg-staat" }, h("p", {},
    "Nog geen huistaken " + info.naam.toLowerCase() + ". Elke " + (hw.vak === "taal" ? "maandag" : "donderdag") + " komt er automatisch een kolom bij (in weken met een weekagenda)."),
    h("button", { class: "knop secundair", onclick: () => openExtraHuistaak() }, "＋ Extra huistaak"));

  const kop = h("tr", {}, h("th", { class: "n", scope: "col" }, "Leerling"),
    kols.map(k => h("th", { scope: "col", class: k.weggevallen ? "weggevallen" : "" },
      h("button", { class: "linkknop kolomkop", onclick: () => openHuistaak(k), title: "Huistaak aanpassen" },
        h("span", { class: "kolomdatum" }, datumKort(k.datum)), h("span", { class: "kolomtitel" }, (k.extra ? "➕ " : "") + H.kolomTitel(k) + (k.weggevallen ? " (valt weg)" : ""))))),
    h("th", { scope: "col", class: "hw-som" }, "Te laat / open"));
  const rijen = ll.map(l => {
    const tel = H.telling(kols.filter(k => !k.weggevallen), l.id);
    return h("tr", {},
      h("th", { class: "n", scope: "row" }, l.naam),
      kols.map(k => {
        if (k.weggevallen) return h("td", { class: "hw-cel weg" }, "–");
        const t = H.toestand(k, l.id);
        const sleutel = k.id + "§" + l.id;
        return h("td", { class: "hw-cel" }, h("button", { class: "hw-knop", "data-sleutel": sleutel,
          "aria-label": l.naam + ", " + H.kolomTitel(k) + " " + datumKort(k.datum) + ": " + H.TOESTANDEN[t].naam.toLowerCase() + ". Klik om te wijzigen.",
          title: H.TOESTANDEN[t].naam,
          onclick: () => { hw.focus = sleutel; D.wijzig(g2 => H.zetToestand(g2, k, l.id, H.volgendeToestand(t))); } }, hwBol(t)));
      }),
      h("td", { class: "hw-som" },
        tel.laat ? h("span", { class: "hw-tel laat" }, hwBol("laat"), tel.laat) : null,
        tel.open ? h("span", { class: "hw-tel open" }, hwBol("open"), tel.open) : null,
        !tel.laat && !tel.open ? h("span", { class: "hw-tel in" }, hwBol("in"), "alles") : null));
  });
  const voet = h("tr", {}, h("th", { class: "n", scope: "row" }, "Ingediend"),
    kols.map(k => {
      if (k.weggevallen) return h("td", { class: "hw-cel weg" }, "");
      const n = ll.filter(l => H.toestand(k, l.id) !== "open").length;
      return h("td", { class: "hw-totaal" + (n === ll.length ? " vol" : "") }, n + "/" + ll.length);
    }), h("td", {}));
  const vak = h("div", { class: "tabelvak hw-vak" }, h("table", { class: "hw-tabel" },
    h("caption", { class: "sr-only" }, "Huiswerk " + info.naam.toLowerCase()),
    h("thead", {}, kop), h("tbody", {}, rijen), h("tfoot", {}, voet)));
  vak.addEventListener("scroll", () => { hw.scroll = vak.scrollLeft; });
  requestAnimationFrame(() => {
    vak.scrollLeft = hw.scroll == null ? vak.scrollWidth : hw.scroll;
    if (hw.focus) { const k = vak.querySelector('[data-sleutel="' + CSS.escape(hw.focus) + '"]'); if (k) k.focus({ preventScroll: true }); hw.focus = null; }
  });
  const weg = huiswerkKolommen(hw.vak, { metWeggevallen: true }).filter(k => k.weggevallen).length;
  return [vak, h("div", { class: "knoppen hw-opties" },
    alle.length > ZICHTBAAR ? h("button", { class: "knop klein secundair", onclick: () => { hw.alles = !hw.alles; hw.scroll = null; toon(); } },
      hw.alles ? "Enkel de laatste " + ZICHTBAAR : "Alle " + alle.length + " huistaken tonen") : null,
    weg || hw.weggevallen ? h("button", { class: "knop klein secundair", onclick: () => { hw.weggevallen = !hw.weggevallen; toon(); } },
      hw.weggevallen ? "Weggevallen huistaken verbergen" : "Weggevallen huistaken tonen (" + weg + ")") : null),
    h("p", { class: "klein" }, "Klik op een kolomtitel om de huistaak een naam te geven, de datum te verschuiven, iedereen op ingediend te zetten of de huistaak te laten wegvallen.")];
}

function openHuistaak(k) {
  const titel = h("input", { type: "text", value: k.titel || "", placeholder: H.kolomTitel({ ...k, titel: "" }) });
  const datum = h("input", { type: "date", value: k.datum });
  const sluit = () => venster.sluit();
  const bewaar = () => {
    const velden = {};
    if ((k.titel || "") !== titel.value.trim()) velden.titel = titel.value.trim();
    if (datum.value && datum.value !== k.datum) velden.datum = datum.value;
    if (Object.keys(velden).length) D.wijzig(g => H.pasAan(g, k, velden));
  };
  const ll = H.leerlingenVan(D.data(), k.vak, [k]);
  const venster = sluitbaarVenster([
    h("h2", {}, H.kolomTitel(k)),
    h("div", { class: "veld" }, h("label", {}, "Naam (bv. werkblad lezen p. 12)"), titel),
    h("div", { class: "veld" }, h("label", {}, "Datum"), datum),
    h("div", { class: "knoppen kolom" },
      k.weggevallen ? null : h("button", { class: "knop secundair", onclick: () => { bewaar(); D.wijzig(g => H.iedereenIngediend(g, k, ll.map(l => l.id))); sluit(); } }, "✓ Iedereen die nog rood staat: ingediend"),
      k.extra
        ? h("button", { class: "knop secundair gevaar", onclick: () => { if (confirm("Deze extra huistaak verwijderen?")) { D.wijzig(g => H.verwijderExtra(g, k)); sluit(); } } }, "Extra huistaak verwijderen")
        : h("button", { class: "knop secundair", onclick: () => { bewaar(); D.wijzig(g => H.pasAan(g, k, { weggevallen: !k.weggevallen })); sluit(); } },
          k.weggevallen ? "Toch gegeven: terugzetten" : "Valt weg deze week")),
    h("div", { class: "knoppen" }, h("button", { class: "knop secundair", onclick: sluit }, "Annuleren"), h("button", { class: "knop", onclick: () => { bewaar(); sluit(); } }, "Bewaren"))
  ], { klein: true });
  setTimeout(() => titel.focus(), 0);
}

function openExtraHuistaak() {
  const vak = h("select", {}, Object.entries(H.HW_VAKKEN).map(([k, v]) => h("option", { value: k, selected: k === hw.vak || null }, v.naam)));
  const titel = h("input", { type: "text", placeholder: "bv. spreekbeurt voorbereiden" });
  const datum = h("input", { type: "date", value: W.isoDatum(nu()) });
  const venster = sluitbaarVenster([
    h("h2", {}, "Extra huistaak"),
    h("div", { class: "veld" }, h("label", {}, "Vak"), vak),
    h("div", { class: "veld" }, h("label", {}, "Naam"), titel),
    h("div", { class: "veld" }, h("label", {}, "Datum"), datum),
    h("div", { class: "knoppen" }, h("button", { class: "knop secundair", onclick: () => venster.sluit() }, "Annuleren"),
      h("button", { class: "knop", onclick: () => {
        if (!datum.value) return;
        const nieuw = H.nieuweExtra(vak.value, datum.value, titel.value);
        if (datum.value < huiswerkVanaf()) { staat.inst.huiswerkVanaf = datum.value; bewaarInstellingen(); }
        D.wijzig(g => { g.huiswerk = g.huiswerk || []; g.huiswerk.push(nieuw); });
        hw.vak = vak.value; hw.scroll = null; venster.sluit(); toon();
      } }, "Toevoegen"))
  ], { klein: true });
  setTimeout(() => titel.focus(), 0);
}

// ---------- Doelen (leerlijn WO) ----------
const LEERLIJN_NAAM = "Coffee! leerlijn WO.json";
const LEERLIJN_LOKAAL = "coffee_leerlijn";
const du = { zoek: "", leerlijn: "alle", nogNiet: false, selectie: new Set(), thema: null, open: new Set(), dekking: false };

function lokaleLeerlijn() {
  if (staat.leerlijn === undefined || staat.leerlijn === null) {
    try { const x = JSON.parse(localStorage.getItem(LEERLIJN_LOKAAL) || "null"); if (L.isLeerlijn(x)) staat.leerlijn = x; } catch (e) { /* leeg */ }
  }
  return staat.leerlijn || null;
}
function zetLeerlijn(x) {
  staat.leerlijn = x; staat.leerlijnIndex = L.index(x);
  try { localStorage.setItem(LEERLIJN_LOKAAL, JSON.stringify(x)); } catch (e) { /* te groot: enkel in geheugen */ }
}
// Eén keer per sessie de leerlijn op Drive controleren (bron = Drive)
async function controleerLeerlijn() {
  if (staat.leerlijnGecontroleerd) return;
  staat.leerlijnGecontroleerd = true;
  try {
    const b = await G.leesEigenBestand(LEERLIJN_NAAM);
    if (b && L.isLeerlijn(b.inhoud)) {
      const nieuw = JSON.stringify(b.inhoud) !== JSON.stringify(staat.leerlijn);
      zetLeerlijn(b.inhoud);
      if (nieuw && staat.weergave === "doelen") toon();
    } else if (!b && staat.leerlijn) {
      // de kopie op dit toestel staat nog niet op Drive (bv. eerste keer): bewaren
      await G.schrijfEigenBestand(LEERLIJN_NAAM, staat.leerlijn);
    }
  } catch (e) { staat.leerlijnGecontroleerd = false; console.warn("Leerlijn controleren mislukt", e); }
}
const leerlijnIdx = () => { if (!staat.leerlijnIndex && staat.leerlijn) staat.leerlijnIndex = L.index(staat.leerlijn); return staat.leerlijnIndex || new Map(); };
const bouwKeuze = () => staat.inst.bouw || "";

async function laadLeerlijnBestand(bestand, opBezig) {
  let x;
  try { x = JSON.parse(await bestand.text()); } catch (e) { throw new Error("Dit is geen leesbaar leerlijnbestand (json)."); }
  if (!L.isLeerlijn(x)) throw new Error("Dit bestand is geen Coffee!-leerlijn. Kies het bestand \"leerlijn WO … .json\".");
  opBezig && opBezig();
  await G.schrijfEigenBestand(LEERLIJN_NAAM, x);
  zetLeerlijn(x);
  staat.leerlijnGecontroleerd = true;
}

function leerlijnLaadKnop(tekst, klasse = "knop") {
  const invoer = h("input", { type: "file", accept: ".json,application/json", class: "sr-only", "aria-label": "Leerlijnbestand kiezen" });
  const knop = h("button", { class: klasse, onclick: () => invoer.click() }, tekst);
  invoer.addEventListener("change", async () => {
    const f = invoer.files[0]; if (!f) return;
    knop.disabled = true; knop.textContent = "Lezen…";
    try { await laadLeerlijnBestand(f, () => { knop.textContent = "Bewaren op je Drive…"; }); toast("Leerlijn geladen", "Bewaard in je map Coffee! op Drive"); staat.weergave = "doelen"; toon(); }
    catch (e) { knop.disabled = false; knop.textContent = tekst; toast("Niet gelukt", e.message || String(e)); }
  });
  return h("span", {}, knop, invoer);
}

// Tekst met <mark> rond de zoekwoorden (accenten en hoofdletters tellen niet)
function markeer(tekst, termen) {
  if (!termen.length || !tekst) return [tekst];
  let norm = "", map = [];
  for (let i = 0; i < tekst.length; i++) {
    const n = L.normaal(tekst[i]) || (tekst[i] === " " ? " " : "");
    for (const c of n) { norm += c; map.push(i); }
  }
  const stukken = [];
  for (const w0 of termen) {
    const w = norm.includes(w0) ? w0 : L.stam(w0);
    if (!w) continue;
    let p = norm.indexOf(w); while (p >= 0) { stukken.push([map[p], map[p + w.length - 1] + 1]); p = norm.indexOf(w, p + 1); }
  }
  if (!stukken.length) return [tekst];
  stukken.sort((a, b) => a[0] - b[0]);
  const samen = [];
  for (const s of stukken) { if (samen.length && s[0] <= samen[samen.length - 1][1]) samen[samen.length - 1][1] = Math.max(samen[samen.length - 1][1], s[1]); else samen.push([...s]); }
  const uit = []; let pos = 0;
  for (const [a, b] of samen) { if (a > pos) uit.push(tekst.slice(pos, a)); uit.push(h("mark", {}, tekst.slice(a, b))); pos = b; }
  if (pos < tekst.length) uit.push(tekst.slice(pos));
  return uit;
}
const meerRegels = (tekst, termen) => tekst.split("\n").flatMap((r, i) => i ? [h("br"), ...markeer(r, termen)] : markeer(r, termen));

// Actieve selectie: een bewaard thema of de losse selectie
function actiefThema() {
  if (!du.thema) return null;
  const t = (D.data().themas || []).find(x => x.id === du.thema && !x.verwijderd);
  if (!t) du.thema = null;
  return t || null;
}
const gekozen = () => { const t = actiefThema(); return new Set(t ? t.doelen : du.selectie); };
function zetGekozen(id, aan) {
  const t = actiefThema();
  if (t) D.wijzig(g => { const x = g.themas.find(y => y.id === t.id); if (x) L.wisselDoel(x, id, aan); });
  else { if (aan) du.selectie.add(id); else du.selectie.delete(id); werkDoelenBij(); }
}

let werkDoelenBij = () => {};

function toonDoelen(doel) {
  const ll = lokaleLeerlijn();
  controleerLeerlijn();
  if (!ll) {
    doel.replaceChildren(
      h("div", { class: "nu-kop" }, h("h2", {}, "Doelen")),
      h("div", { class: "kaart leeg-staat" },
        h("h3", {}, "Leerlijn laden"),
        h("p", {}, "Kies het leerlijnbestand (json) dat je van Claude kreeg. Coffee! bewaart het in je map Coffee! op je eigen Drive; het komt niet in de openbare code."),
        leerlijnLaadKnop("Leerlijnbestand kiezen…")));
    return;
  }
  const idx = leerlijnIdx();
  const termen = L.zoektermen(du.zoek);
  let bouw = bouwKeuze();

  const zoekveld = h("input", { type: "search", class: "doelen-zoek", value: du.zoek, placeholder: "Zoek in doelen en suggesties, bv. kaart, gevoelens, magneet…", "aria-label": "Zoek in de doelen" });
  let zoekTimer;
  zoekveld.addEventListener("input", () => { clearTimeout(zoekTimer); zoekTimer = setTimeout(() => { du.zoek = zoekveld.value; tekenBoom(); }, 160); });
  zoekveld.addEventListener("keydown", (e) => { if (e.key === "Escape" && zoekveld.value) { e.preventDefault(); zoekveld.value = ""; du.zoek = ""; tekenBoom(); } });

  const knopjes = (opties, waarde, zet, label) => h("div", { class: "filter", role: "group", "aria-label": label },
    opties.map(([k, t]) => h("button", { class: "filterknop" + (waarde() === k ? " actief" : ""), "aria-pressed": waarde() === k ? "true" : "false",
      onclick: (e) => { zet(k); e.currentTarget.parentNode.querySelectorAll(".filterknop").forEach(b => { const a = b === e.currentTarget; b.classList.toggle("actief", a); b.setAttribute("aria-pressed", a ? "true" : "false"); }); tekenBoom(); } }, t)));
  const filters = h("div", { class: "doelen-filters" },
    knopjes([["alle", "Alle"], ...ll.leerlijnen.map(l => [l.id, l.naam])], () => du.leerlijn, (k) => { du.leerlijn = k; }, "Leerlijn"),
    knopjes([["", "Alle bouwen"], ...L.BOUWEN.map(b => [b, b])], bouwKeuze, (k) => { staat.inst.bouw = k; bewaarInstellingen(); }, "Bouw"),
    h("label", { class: "schakel" }, (() => { const c = h("input", { type: "checkbox", checked: du.nogNiet || null }); c.addEventListener("change", () => { du.nogNiet = c.checked; tekenBoom(); }); return c; })(), " Enkel nog niet behandeld"));

  const boom = h("section", { class: "doelen-boom", "aria-label": "Leerlijn" });
  const teller = h("p", { class: "klein doelen-teller", role: "status" });
  const kader = h("aside", { class: "doelen-kader", "aria-label": "Geselecteerde doelen" });
  const kaderKnop = h("button", { class: "knop doelen-kaderknop", onclick: () => kader.classList.toggle("open") });

  // ---- de boom ----
  const rijen = new Map(); // id -> { vink, badges }
  function badges(id) {
    const dek = L.dekking(D.data(), ll.schooljaar);
    const lijst = dek.get(id) || [];
    return lijst.map(t => h("button", { class: "themachip" + (t.id === du.thema ? " actief" : ""), title: "Thema " + t.naam + " openen",
      onclick: (e) => { e.preventDefault(); e.stopPropagation(); du.thema = t.id; werkDoelenBij(); } }, t.naam));
  }
  function vinkje(id, label) {
    const c = h("input", { type: "checkbox", class: "doelvink", "aria-label": label, "data-id": id });
    c.checked = gekozen().has(id);
    c.addEventListener("click", (e) => e.stopPropagation());
    c.addEventListener("change", () => zetGekozen(id, c.checked));
    return c;
  }
  function suggestiesBlok(houder, zichtbaar) {
    const blokken = L.suggestiesVoor(houder, bouw);
    if (!blokken.length) return null;
    const lijst = h("div", { class: "sugblokken" }, blokken.map(b => h("div", { class: "sugblok" },
      (!bouw || !b.bouw.length) ? h("div", { class: "bouwlabels" }, b.bouw.length ? b.bouw.map(x => h("span", { class: "bouwlabel", title: L.BOUW_NAAM[x] }, x)) : h("span", { class: "bouwlabel alle" }, "alle bouwen")) : null,
      h("ul", {}, b.items.map(i => h("li", { class: (i.s ? "sug-" + i.s : "") + (i.n ? " sub" : "") }, i.s === "methode" ? "📘 " : "", ...markeer(i.t, termen)))))));
    const aantal = blokken.reduce((n, b) => n + b.items.length, 0);
    const d = h("details", { class: "suggesties" }, h("summary", {}, "Suggesties" + (bouw ? " " + bouw : "") + " (" + aantal + ")"), lijst);
    if (zichtbaar) d.open = true;
    return d;
  }
  function doelKaart(leer, d, treffer) {
    const sleutel = leer.id + "|" + (d.nr || d.tekst);
    const id = d.nr ? L.doelId(leer.id, d.nr) : null;
    const tussenIds = (d.tussendoelen || []).map(t => L.doelId(leer.id, t.nr));
    const kop = h("summary", { class: "doelkop" },
      id ? vinkje(id, "Hoofddoel " + d.nr + " selecteren") : h("span", { class: "doelvink-leeg" }),
      h("span", { class: "doelnr" + (d.extra ? " extra" : "") }, d.nr || "+"),
      h("span", { class: "doeltekst" }, ...meerRegels(d.tekst, termen)),
      h("span", { class: "doelmeta" }, id ? h("span", { class: "badges", "data-id": id }) : null,
        tussenIds.length ? h("span", { class: "tussenteller", "data-tussen": tussenIds.join(" ") }) : null));
    const details = h("details", { class: "doel" + (d.extra ? " extra" : "") }, kop);
    let gevuld = false;
    const vul = () => {
      if (gevuld) return; gevuld = true;
      details.append(h("div", { class: "doelbody" },
        d.toelichting ? h("p", { class: "toelichting" }, ...meerRegels(d.toelichting, termen)) : null,
        (d.tussendoelen || []).length ? h("ol", { class: "tussendoelen" }, d.tussendoelen.map(t => {
          const tid = L.doelId(leer.id, t.nr);
          const gevonden = treffer && treffer.tussen && treffer.tussen.has(t.nr);
          return h("li", { class: "tussendoel" + (gevonden && termen.length ? " treffer" : "") },
            h("label", { class: "tussenkop" }, vinkje(tid, "Tussendoel " + t.nr + " selecteren"),
              h("span", { class: "doelnr klein-nr" }, t.nr), h("span", { class: "doeltekst" }, ...meerRegels(t.tekst, termen)),
              h("span", { class: "badges", "data-id": tid })),
            suggestiesBlok(t, termen.length && treffer && treffer.tussenSug && treffer.tussenSug.has(t.nr)));
        })) : null,
        suggestiesBlok(d, termen.length && treffer && treffer.sug)));
      werkRijenBij(details);
    };
    details.addEventListener("toggle", () => { if (details.open) { vul(); du.open.add(sleutel); } else du.open.delete(sleutel); });
    if (du.open.has(sleutel) || (termen.length && treffer && (treffer.sug || treffer.tussen.size))) { details.open = true; vul(); }
    return details;
  }
  function werkRijenBij(binnen = boom) {
    const g = gekozen();
    binnen.querySelectorAll(".badges[data-id]").forEach(b => b.replaceChildren(...badges(b.dataset.id)));
    binnen.querySelectorAll(".tussenteller[data-tussen]").forEach(el => {
      const ids = el.dataset.tussen.split(" ");
      const dek = L.dekking(D.data(), ll.schooljaar);
      const n = ids.filter(i => dek.has(i)).length, k = ids.filter(i => g.has(i)).length;
      el.textContent = (k ? "✓ " + k + " gekozen · " : "") + n + "/" + ids.length + " tussendoelen behandeld";
      el.classList.toggle("leeg", !n && !k);
    });
    binnen.querySelectorAll("input.doelvink[data-id]").forEach(c => { c.checked = g.has(c.dataset.id); });
  }
  function tekenBoom() {
    bouw = bouwKeuze();
    const dek = L.dekking(D.data(), ll.schooljaar);
    const termenNu = L.zoektermen(du.zoek);
    termen.splice(0, termen.length, ...termenNu);
    let gevonden = 0;
    const delen = [];
    for (const leer of ll.leerlijnen) {
      if (du.leerlijn !== "alle" && du.leerlijn !== leer.id) continue;
      const domeinen = [];
      for (const dm of leer.domeinen) {
        const rubrieken = [];
        let totaal = 0, behandeld = 0, inDomein = 0;
        for (const r of dm.rubrieken) {
          const kaarten = [];
          for (const d of r.doelen) {
            const tel = d.nr || (d.tussendoelen || []).length;
            const isBehandeld = L.hoofddoelBehandeld(leer.id, d, dek);
            if (tel) { totaal++; if (isBehandeld) behandeld++; }
            if (du.nogNiet && isBehandeld) continue;
            const treffer = L.zoekInDoel(d, termen, bouw);
            if (!treffer) continue;
            kaarten.push(doelKaart(leer, d, termen.length ? treffer : null));
            inDomein++;
          }
          if (kaarten.length) rubrieken.push(h("div", { class: "rubriek" },
            r.naam ? h("h4", { class: "rubriekkop" }, r.groep ? h("span", { class: "groep" }, r.groep + " › ") : null, r.naam) : null,
            r.noot ? h("p", { class: "noot" }, r.noot) : null, kaarten));
        }
        gevonden += inDomein;
        if (!rubrieken.length) continue;
        const sleutel = "dm|" + leer.id + "|" + dm.naam;
        const det = h("details", { class: "domein" },
          h("summary", {}, h("span", { class: "domeinnaam" }, dm.naam),
            h("span", { class: "domeinmeta" }, termen.length || du.nogNiet ? inDomein + " getoond · " : "", behandeld + "/" + totaal + " behandeld",
              h("span", { class: "meter", "aria-hidden": "true" }, h("span", { style: "width:" + (totaal ? Math.round(100 * behandeld / totaal) : 0) + "%" })))),
          dm.noot ? h("p", { class: "noot" }, dm.noot) : null, rubrieken);
        det.open = du.open.has(sleutel) || termen.length > 0 || du.nogNiet;
        det.addEventListener("toggle", () => { if (det.open) du.open.add(sleutel); else du.open.delete(sleutel); });
        domeinen.push(det);
      }
      if (domeinen.length) delen.push(h("div", { class: "leerlijnblok" }, h("h3", {}, leer.naam), domeinen));
    }
    boom.replaceChildren(...(delen.length ? delen : [h("div", { class: "kaart leeg-staat" }, h("p", {}, termen.length ? "Niets gevonden voor “" + du.zoek + "”. Probeer een ander woord of zet de bouw op “Alle bouwen”." : "Alle doelen zijn al behandeld in een thema. 🎉"))]));
    teller.textContent = termen.length ? gevonden + (gevonden === 1 ? " doel gevonden" : " doelen gevonden") : "";
    werkRijenBij();
  }

  // ---- het kader met de selectie ----
  function tekenKader() {
    const t = actiefThema();
    const ids = gekozen();
    const lijst = L.geselecteerd(idx, ids);
    const alleThemas = L.themas(D.data(), ll.schooljaar);
    const kies = h("select", { "aria-label": "Thema" },
      h("option", { value: "" }, "Losse selectie (niet bewaard)"),
      alleThemas.map(x => h("option", { value: x.id, selected: x.id === du.thema || null }, x.naam + " (" + (x.doelen || []).length + ")")));
    kies.addEventListener("change", () => { du.thema = kies.value || null; werkDoelenBij(); });
    const naamVeld = h("input", { type: "text", placeholder: "Naam van het thema, bv. Herfst" });
    const bewaar = () => {
      const naam = naamVeld.value.trim();
      if (!naam) { naamVeld.focus(); return; }
      const nieuw = L.nieuwThema(naam, ll.schooljaar, [...du.selectie]);
      D.wijzig(g => { g.themas = g.themas || []; g.themas.push(nieuw); });
      du.thema = nieuw.id; du.selectie = new Set();
      toast("Thema bewaard", naam);
    };
    naamVeld.addEventListener("keydown", (e) => { if (e.key === "Enter") bewaar(); });
    const kopieer = async () => {
      const { tekst, html } = L.kopieerTekst(idx, ids, { titel: t ? t.naam : "" });
      try {
        if (window.ClipboardItem) await navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([tekst], { type: "text/plain" }), "text/html": new Blob([html], { type: "text/html" }) })]);
        else await navigator.clipboard.writeText(tekst);
        toast("Gekopieerd", lijst.length + (lijst.length === 1 ? " doel" : " doelen") + " – plak in je groepswerkplan");
      } catch (e) {
        const vak = h("textarea", { rows: 10, readonly: true }, tekst);
        sluitbaarVenster([h("h2", {}, "Kopieer de doelen"), h("p", { class: "klein" }, "Kopiëren lukte niet automatisch. Selecteer de tekst en kopieer met Ctrl+C."), vak,
          h("div", { class: "knoppen" }, h("button", { class: "knop", onclick: (ev) => ev.target.closest(".venster").remove() }, "Sluiten"))], { klein: true });
        setTimeout(() => vak.select(), 0);
      }
    };
    let groep = null;
    const items = [];
    for (const x of lijst) {
      const kop = x.leerlijn.naam + " – " + x.domein.naam;
      if (kop !== groep) { items.push(h("li", { class: "kadergroep" }, kop)); groep = kop; }
      items.push(h("li", { class: "kaderdoel" + (x.soort === "tussendoel" ? " tussen" : "") },
        h("span", { class: "doelnr klein-nr" }, x.nr), h("span", { class: "kadertekst" }, x.tekst.split("\n")[0]),
        h("button", { class: "linkknop wis", "aria-label": "Doel " + x.nr + " weghalen", title: "Weghalen", onclick: () => zetGekozen(x.id, false) }, "×")));
    }
    kader.replaceChildren(...[
      h("div", { class: "kaderkop" }, h("h3", {}, t ? "Thema" : "Selectie"), h("button", { class: "linkknop sluit-kader", onclick: () => kader.classList.remove("open"), "aria-label": "Kader sluiten" }, "×")),
      kies,
      t ? h("div", { class: "knoppen klein-knoppen" },
        h("button", { class: "knop klein secundair", onclick: () => { const n = prompt("Nieuwe naam voor dit thema:", t.naam); if (n && n.trim()) D.wijzig(g => { const x = g.themas.find(y => y.id === t.id); x.naam = n.trim(); x.gewijzigd = Date.now(); }); } }, "Hernoemen"),
        h("button", { class: "knop klein secundair", onclick: () => { du.selectie = new Set(t.doelen); du.thema = null; werkDoelenBij(); toast("Kopie als losse selectie", "Bewaar ze onder een nieuwe naam"); } }, "Dupliceren"),
        h("button", { class: "knop klein secundair gevaar", onclick: () => { if (confirm("Thema “" + t.naam + "” verwijderen? De doelen tellen dan niet meer als behandeld.")) { D.wijzig(g => { const x = g.themas.find(y => y.id === t.id); Object.assign(x, { verwijderd: true, doelen: [], gewijzigd: Date.now() }); }); du.thema = null; } } }, "Verwijderen")) : null,
      lijst.length ? h("ul", { class: "kaderlijst" }, items) : h("p", { class: "klein kaderleeg" }, t ? "Nog geen doelen in dit thema. Vink doelen aan in de lijst." : "Vink hoofd- of tussendoelen aan; ze verschijnen hier."),
      lijst.length ? h("div", { class: "knoppen kolom" },
        h("button", { class: "knop", onclick: kopieer }, "📋 Kopiëren (" + lijst.length + ")"),
        !t ? h("button", { class: "knop secundair", onclick: () => { du.selectie = new Set(); werkDoelenBij(); } }, "Selectie wissen") : null) : null,
      !t && lijst.length ? h("div", { class: "veld bewaar-thema" }, h("label", {}, "Bewaren als thema"), h("div", { class: "rij-invoer" }, naamVeld, h("button", { class: "knop secundair", onclick: bewaar }, "Bewaren"))) : null,
      h("p", { class: "klein" }, "Een doel in een bewaard thema telt als behandeld voor schooljaar " + ll.schooljaar + ".")].filter(Boolean));
    kaderKnop.textContent = (t ? t.naam + ": " : "Selectie: ") + lijst.length + (lijst.length === 1 ? " doel" : " doelen");
  }

  werkDoelenBij = () => { if (!boom.isConnected) return; tekenKader(); werkRijenBij(); };
  levend.add({ el: boom, vul: () => werkDoelenBij() });

  const dekKnop = h("button", { class: "knop secundair", onclick: () => openDekking(ll) }, "📊 Dekking");
  doel.replaceChildren(
    h("div", { class: "nu-kop" }, h("div", {}, h("h2", {}, "Doelen"), h("p", { class: "klein" }, ll.titel)), h("div", { class: "knoppen" }, dekKnop)),
    h("div", { class: "doelen-balk" }, zoekveld, filters, teller),
    h("div", { class: "doelen-raam" }, boom, kader),
    kaderKnop);
  tekenBoom();
  tekenKader();
  if (du.zoek) setTimeout(() => zoekveld.focus(), 0);
}

function openDekking(ll) {
  const dek = L.dekking(D.data(), ll.schooljaar);
  const per = L.dekkingPerDomein(ll, dek);
  const th = L.themas(D.data(), ll.schooljaar);
  const venster = sluitbaarVenster([
    h("h2", {}, "Dekking " + ll.schooljaar),
    h("p", { class: "klein" }, "Een hoofddoel telt als behandeld als het (of een van zijn tussendoelen) in een bewaard thema zit."),
    h("table", { class: "dekkingtabel" }, h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Domein"), h("th", { scope: "col" }, "Hoofddoelen behandeld"), h("th", { scope: "col" }, ""))),
      h("tbody", {}, per.map(p => h("tr", {}, h("th", { scope: "row" }, p.leerlijn.naam + " – " + p.domein.naam),
        h("td", {}, p.behandeld + " / " + p.totaal),
        h("td", {}, h("span", { class: "meter breed", role: "img", "aria-label": Math.round(100 * p.behandeld / (p.totaal || 1)) + "%" }, h("span", { style: "width:" + Math.round(100 * p.behandeld / (p.totaal || 1)) + "%" }))))))),
    h("h3", {}, "Thema's"),
    th.length ? h("ul", { class: "themalijst" }, th.map(t => h("li", {}, h("button", { class: "linkknop", onclick: () => { du.thema = t.id; venster.sluit(); staat.weergave = "doelen"; toon(); } }, t.naam), " – " + (t.doelen || []).length + " doelen"))) : h("p", { class: "klein" }, "Nog geen thema's bewaard."),
    h("div", { class: "knoppen" },
      h("button", { class: "knop secundair", onclick: () => { du.nogNiet = true; venster.sluit(); toon(); } }, "Toon wat nog niet behandeld is"),
      h("button", { class: "knop", onclick: () => venster.sluit() }, "Sluiten"))
  ]);
}

// ---------- Bewerken ----------
const VAKKEN = ["T", "W", "WO", "GO", "SOVA", "PROJ", "Func. T", "Func. W", "Schrift", "Voorlezen", "CREA", "LO"];

// Huidige lijn(en) in een tekstvak aanpassen
function lijnBereik(el) {
  const v = el.value;
  const s = v.lastIndexOf("\n", el.selectionStart - 1) + 1;
  let e = v.indexOf("\n", el.selectionEnd);
  if (e < 0) e = v.length;
  return [s, e];
}
function vervangBereik(el, s, e, tekst, cursor) {
  el.value = el.value.slice(0, s) + tekst + el.value.slice(e);
  el.focus();
  const c = cursor != null ? cursor : s + tekst.length;
  el.setSelectionRange(c, c);
  el.dispatchEvent(new Event("input"));
}
function wisselKleur(el, teken) {
  const [s, e] = lijnBereik(el);
  const lijnen = el.value.slice(s, e).split("\n").map(l => {
    if (!l.trim()) return l;
    const m = l.match(/^(\s*(?:[-–•◦▪]\s+)?)(❗ |🟢 )?(.*)$/u);
    return m[2] === teken + " " ? m[1] + m[3] : m[1] + teken + " " + m[3];
  });
  vervangBereik(el, s, e, lijnen.join("\n"));
}

// Tekst vervangen zodat Ctrl+Z blijft werken (execCommand), met terugval
function typVervang(el, s, e, tekst) {
  el.focus();
  el.setSelectionRange(s, e);
  let gelukt = false;
  try { gelukt = document.execCommand("insertText", false, tekst); } catch (x) { gelukt = false; }
  if (!gelukt || el.value.slice(s, s + tekst.length) !== tekst) vervangBereik(el, s, e, tekst);
  el.setSelectionRange(s + tekst.length, s + tekst.length);
}

// "-->" en "->" worden een pijl (in alle tekstvelden van de bewerker)
function maakPijlen(el, e) {
  if (e.inputType !== "insertText" || e.data !== ">") return false;
  const pos = el.selectionStart, voor = el.value.slice(0, pos);
  const m = voor.match(/-{1,2}>$/);
  if (!m) return false;
  typVervang(el, pos - m[0].length, pos, "→");
  return true;
}

// ----- Slimme opsomming in een tekstvak -----
const OPSOMMING = /^([ \t]*)([-–•◦▪])([ \t]+|$)/;
function niveauVan(ruimte) { const n = ruimte.replace(/\t/g, B.INSPRING).length; return n >= 6 ? 2 : n >= 2 ? 1 : 0; }
function lijnInfo(el) {
  const v = el.value, pos = el.selectionStart;
  const s = v.lastIndexOf("\n", pos - 1) + 1;
  let e = v.indexOf("\n", pos); if (e < 0) e = v.length;
  const lijn = v.slice(s, e);
  const m = lijn.match(OPSOMMING);
  if (!m) return { s, e, lijn, pos, opsomming: false };
  return { s, e, lijn, pos, opsomming: true, niveau: niveauVan(m[1]), voorLen: m[0].length, inhoud: lijn.slice(m[0].length) };
}
function zetNiveau(el, info, niveau) {
  const nieuwVoor = niveau < 0 ? "" : B.opsommingTeken(niveau);
  const cursorNaInhoud = Math.max(0, info.pos - info.s - info.voorLen);
  typVervang(el, info.s, info.s + info.voorLen, nieuwVoor);
  const c = info.s + nieuwVoor.length + cursorNaInhoud;
  el.setSelectionRange(c, c);
}
function slimmeLijst(el) {
  el.addEventListener("keydown", (e) => {
    if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    const info = lijnInfo(el);
    if (e.key === "Tab" && info.opsomming && el.selectionStart === el.selectionEnd) {
      e.preventDefault();
      if (e.shiftKey) zetNiveau(el, info, info.niveau - 1);
      else if (info.niveau < 2) zetNiveau(el, info, info.niveau + 1);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && info.opsomming && el.selectionStart === el.selectionEnd) {
      e.preventDefault();
      if (!info.inhoud.trim()) {
        // lege opsommingsregel: één niveau terug, of de lijst stoppen
        if (info.niveau > 0) zetNiveau(el, info, info.niveau - 1);
        else typVervang(el, info.s, info.e, "");
        return;
      }
      typVervang(el, info.pos, info.pos, "\n" + B.opsommingTeken(info.niveau));
      return;
    }
    if (e.key === "Backspace" && info.opsomming && el.selectionStart === el.selectionEnd && info.pos === info.s + info.voorLen) {
      e.preventDefault();
      zetNiveau(el, info, info.niveau - 1);
    }
  });
  el.addEventListener("input", (e) => {
    if (e.inputType !== "insertText" || e.data !== " ") return;
    // "- " of "* " aan het begin van een lijn wordt een bolletje
    const pos = el.selectionStart, v = el.value;
    const s = v.lastIndexOf("\n", pos - 2) + 1;
    const m = v.slice(s, pos).match(/^([ \t]*)[-*] $/);
    if (m) typVervang(el, s, pos, B.opsommingTeken(niveauVan(m[1])));
  });
}
function voegInBijCursor(el, tekst, vervangVorig = 0) {
  const s = el.selectionStart - vervangVorig;
  vervangBereik(el, s, el.selectionEnd, tekst);
}

function sluitbaarVenster(inhoud, opties = {}) {
  const achtergrond = h("div", { class: "venster" + (opties.klein ? " klein" : "") + (opties.lezen ? " lezen" : "") }, h("div", { class: "venster-inhoud" }, inhoud));
  document.body.appendChild(achtergrond);
  document.body.classList.add("geen-scroll");
  const sluit = () => { achtergrond.remove(); if (!document.querySelector(".venster")) document.body.classList.remove("geen-scroll"); };
  return { sluit, element: achtergrond };
}

function openDriveZoeker(gekozen) {
  const veld = h("input", { type: "text", placeholder: "Zoek een bestand in Drive (bv. werkblad breuken)…" });
  const lijst = h("ul", { class: "zoekresultaten" });
  const status = h("p", { class: "klein" }, "Typ minstens 2 letters.");
  let resultaten = [], wacht = null, teller = 0;
  const kies = (f) => { venster.sluit(); gekozen(f); };
  const zoek = async () => {
    const term = veld.value.trim();
    if (term.length < 2) { lijst.replaceChildren(); status.textContent = "Typ minstens 2 letters."; return; }
    const mijn = ++teller;
    status.textContent = "Zoeken…";
    try {
      resultaten = await G.zoekBestanden(term);
      if (mijn !== teller) return;
      status.textContent = resultaten.length ? "" : "Niets gevonden.";
      lijst.replaceChildren(...resultaten.map(f => h("li", { onclick: () => kies(f) },
        f.iconLink ? h("img", { src: f.iconLink, alt: "" }) : null,
        h("span", {}, f.name),
        h("span", { class: "klein" }, new Date(f.modifiedTime).toLocaleDateString("nl-BE", { day: "numeric", month: "short", year: "numeric" })))));
    } catch (e) { status.textContent = "Zoeken mislukt: " + e.message; }
  };
  veld.addEventListener("input", () => { clearTimeout(wacht); wacht = setTimeout(zoek, 300); });
  veld.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && resultaten[0]) { e.preventDefault(); kies(resultaten[0]); }
    if (e.key === "Escape") { e.stopPropagation(); venster.sluit(); }
  });
  const venster = sluitbaarVenster([
    h("h3", {}, "📎 Drive-bestand koppelen"), veld, status, lijst,
    h("div", { class: "knoppen" }, h("button", { class: "knop secundair", onclick: () => venster.sluit() }, "Annuleren"))
  ], { klein: true });
  setTimeout(() => veld.focus(), 0);
}

const mdLink = (f) => "[" + f.name.replace(/[\[\]]/g, "") + "](" + f.webViewLink + ")";

function openBewerker(rij) {
  const origineel = B.rijNaarVelden(rij);
  const v = { ...origineel };
  const voorbeeld = h("div", { class: "voorbeeld" });
  const melding = h("div", { class: "melding" });
  const zeg = (soort, ...inhoud) => { melding.className = "melding " + soort; melding.replaceChildren(...inhoud); };
  const ververs = () => voorbeeld.replaceChildren(lesKaart(B.voorbeeldRij(v, rij), { voorbeeld: true }));

  const vakVeld = h("input", { type: "text", list: "vakkenlijst", value: v.vak });
  let vakTimer = null;
  vakVeld.addEventListener("input", () => { v.vak = vakVeld.value; ververs(); clearTimeout(vakTimer); vakTimer = setTimeout(() => { toonVorige(0); toonVorigeNotitie(); }, 400); });
  const onderwerpVeld = h("input", { type: "text", value: v.onderwerp, placeholder: "bv. VLL kern 7 dag 15: herhaling" });
  onderwerpVeld.addEventListener("input", (e) => { if (maakPijlen(onderwerpVeld, e)) return; v.onderwerp = onderwerpVeld.value; ververs(); });

  // Een geplakte link wordt een knop; bij een Drive-link zoekt Coffee! de bestandsnaam op
  const plakLink = (el) => el.addEventListener("paste", async (e) => {
    const tekst = ((e.clipboardData || window.clipboardData).getData("text") || "").trim();
    if (!/^https?:\/\/\S+$/.test(tekst)) return;
    e.preventDefault();
    const naam = B.isDriveLink(tekst) ? await G.driveNaam(tekst) : null;
    voegInBijCursor(el, "[" + (naam || linkLabel(tekst)).replace(/[\[\]]/g, "") + "](" + tekst + ")");
  });
  plakLink(onderwerpVeld);
  const tekstvak = (naam, rijen, plaatshouder, lijst = true) => {
    const el = h("textarea", { rows: rijen, placeholder: plaatshouder, spellcheck: "true" });
    plakLink(el);
    if (lijst) slimmeLijst(el);
    el.value = v[naam];
    el.addEventListener("input", (e) => {
      if (maakPijlen(el, e)) return;
      v[naam] = el.value; ververs();
      // @ typen = Drive-bestand koppelen
      const pos = el.selectionStart;
      if (e.inputType === "insertText" && e.data === "@" && (pos === 1 || /\s/.test(el.value[pos - 2] || " "))) {
        openDriveZoeker(f => voegInBijCursor(el, mdLink(f), 1));
      }
    });
    return el;
  };
  const doelenVeld = tekstvak("doelen", 3, "Ik kan …  (één doel per lijn)");
  const verloopVeld = tekstvak("verloop", 12, "Inl\n• …\nKern\n• …\nSlot\n• …");
  const materiaalVeld = tekstvak("materiaal", 4, "• werkbundel\n• @ om een Drive-bestand te koppelen");
  const therapieVeld = tekstvak("therapie", 2, "bv. 9.55 u. therapie … / … afwezig", false);

  // Notitie voor de volgende les: enkel in je gegevensbestand op Drive
  const iso = rij.datum ? W.isoDatum(rij.datum) : null;
  const notities = () => D.data().notities || [];
  const eigen = iso ? N.eigenNotitie(notities(), v.vak || rij.vak, iso, rij.start) : null;
  const notitieVeld = h("input", { type: "text", value: eigen ? eigen.tekst : "", placeholder: "bv. afgewerkt tot oef. 7" });
  notitieVeld.addEventListener("input", (e) => { maakPijlen(notitieVeld, e); });
  const bewaarNotitie = () => {
    if (!iso) return;
    const vak = v.vak.trim() || rij.vak;
    const huidig = N.eigenNotitie(notities(), vak, iso, rij.start);
    if ((huidig ? huidig.tekst : "") === notitieVeld.value.trim()) return;
    D.wijzig(g => N.zetNotitie(g, vak, iso, rij.start, notitieVeld.value));
  };
  notitieVeld.addEventListener("change", bewaarNotitie);
  const vorigeNotitieVak = h("div");
  const toonVorigeNotitie = () => {
    const n = iso ? N.vorigeNotitie(notities(), v.vak, iso, rij.start) : null;
    vorigeNotitieVak.replaceChildren(n ? notitieBlok(n) : "");
  };
  toonVorigeNotitie();

  const knop = (tekst, titel, actie) => h("button", { type: "button", class: "knop klein secundair", title: titel, onclick: actie }, tekst);
  const werkbalk = (el, extra) => h("div", { class: "werkbalk" },
    extra || [],
    knop("❗ rood", "Rode herinnering aan/uit", () => wisselKleur(el, "❗")),
    knop("📎 Drive", "Drive-bestand koppelen (of typ @)", () => openDriveZoeker(f => voegInBijCursor(el, mdLink(f)))));

  const opslaanKnop = h("button", { class: "knop" }, "Opslaan in Google Docs");
  let wegGooienGevraagd = false;
  const annuleerKnop = h("button", { class: "knop secundair" }, "Annuleren");
  const probeerSluiten = () => {
    if (B.gewijzigdeCellen(origineel, v).length && !wegGooienGevraagd) {
      wegGooienGevraagd = true; annuleerKnop.textContent = "Wijzigingen weggooien?"; return;
    }
    bewaarNotitie(); venster.sluit(); document.removeEventListener("keydown", opEscape);
  };
  const opEscape = (e) => { if (e.key === "Escape" && !document.querySelector(".venster.klein")) probeerSluiten(); };
  document.addEventListener("keydown", opEscape);
  annuleerKnop.addEventListener("click", probeerSluiten);

  opslaanKnop.addEventListener("click", async () => {
    bewaarNotitie();
    const cellen = B.gewijzigdeCellen(origineel, v);
    if (!cellen.length) { venster.sluit(); document.removeEventListener("keydown", opEscape); toon(); return; }
    opslaanKnop.disabled = true; opslaanKnop.textContent = "Bezig met opslaan…";
    try {
      await G.schrijfLes(rij.week.bestand, rij.plaats, rij.bron.tekst, v, cellen);
      staat.cache.delete(rij.week.bestand.id);
      venster.sluit(); document.removeEventListener("keydown", opEscape);
      toon();
    } catch (e) {
      opslaanKnop.disabled = false; opslaanKnop.textContent = "Opslaan in Google Docs";
      if (e instanceof G.ConflictFout) {
        zeg("fout", e.message + " Je wijzigingen zijn niet opgeslagen. Kopieer ze eventueel, en herlaad daarna. ",
          h("button", { class: "knop klein", onclick: () => { staat.cache.delete(rij.week.bestand.id); venster.sluit(); document.removeEventListener("keydown", opEscape); toon(); } }, "Herladen"));
      } else if (e instanceof G.AanmeldFout) {
        zeg("fout", "Je aanmelding is verlopen. Verbind opnieuw en klik daarna nog eens op Opslaan. Je wijzigingen blijven staan. ",
          h("button", { class: "knop klein", onclick: async () => { try { await G.meldAan(); zeg("ok", "Verbonden. Klik nu op Opslaan."); } catch (x) { zeg("fout", x.message); } } }, "Opnieuw verbinden"));
      } else {
        zeg("fout", "Opslaan mislukt: " + (e.message || e));
      }
    }
  });

  // IDEM: inhoud van de vorige les overnemen (therapieregels van die dag niet)
  let idemBalk = null;
  if (rij.idem && rij.idemVan) {
    const wanneer = datumTekst(rij.idemVan.datum, { weekday: "short", day: "numeric", month: "short" });
    idemBalk = h("div", { class: "melding info" }, "Deze les staat op IDEM (zoals " + wanneer + "). ",
      h("button", { type: "button", class: "knop klein", onclick: () => {
        const bv = B.rijNaarVelden(rij.idemVan.rij);
        v.onderwerp = bv.onderwerp; v.doelen = bv.doelen; v.verloop = bv.verloop;
        v.hadDoelen = true; v.hadVerloop = true;
        if (rij.materiaalIdem) v.materiaal = bv.materiaal;
        onderwerpVeld.value = v.onderwerp; doelenVeld.value = v.doelen; verloopVeld.value = v.verloop; materiaalVeld.value = v.materiaal;
        ververs(); idemBalk.remove();
      } }, "↺ Inhoud van " + wanneer + " overnemen"));
  }

  // ----- Rechterkolom: vorige les van hetzelfde vak | voorbeeld -----
  const vorigePaneel = h("div", { class: "vorige-paneel" });
  const tabVorige = h("button", { type: "button", class: "paneel-tab actief" }, "Vorige les");
  const tabVoorbeeld = h("button", { type: "button", class: "paneel-tab" }, "Voorbeeld");
  const toonPaneel = (welk) => {
    tabVorige.classList.toggle("actief", welk === "vorige"); tabVoorbeeld.classList.toggle("actief", welk === "voorbeeld");
    vorigePaneel.classList.toggle("verborgen", welk !== "vorige"); voorbeeld.classList.toggle("verborgen", welk !== "voorbeeld");
  };
  tabVorige.addEventListener("click", () => toonPaneel("vorige"));
  tabVoorbeeld.addEventListener("click", () => toonPaneel("voorbeeld"));
  const rechts = h("div", { class: "rechts" }, h("div", { class: "paneel-tabs", role: "tablist" }, tabVorige, tabVoorbeeld), vorigePaneel, voorbeeld);
  toonPaneel("vorige");

  const zetVeld = (naam, waarde, veld) => { v[naam] = waarde; veld.value = waarde; ververs(); };
  let eerdereLessen = null;
  async function toonVorige(index) {
    vorigePaneel.replaceChildren(h("p", { class: "laden" }, "Vorige lessen zoeken…"));
    try {
      if (!eerdereLessen) {
        const alle = await lessenUit(wekenRond(rij.week, 6));
        for (const l of alle) if (l.rij.idem && !l.rij.idemVan) { const x = W.vorigeLes(alle, l); if (x) l.rij.idemVan = x; }
        const grens = (rij.datum ? rij.datum.getTime() : Date.now()) + (rij.start || 0) * 60000;
        eerdereLessen = alle.filter(l => l.datum.getTime() + (l.rij.start || 0) * 60000 < grens);
      }
    } catch (e) { vorigePaneel.replaceChildren(h("p", { class: "klein" }, "Vorige lessen konden niet geladen worden.")); return; }
    const vak = W.vakSleutel(v.vak);
    const lijst = vak ? eerdereLessen.filter(l => W.vakSleutel(l.rij.vak) === vak && (weergaveRij(l.rij).onderwerp || "").trim()).reverse() : [];
    if (!vak) { vorigePaneel.replaceChildren(h("p", { class: "klein" }, "Vul een vak in om de vorige les te zien.")); return; }
    if (!lijst.length) { vorigePaneel.replaceChildren(h("p", { class: "klein" }, "Geen eerdere les " + vakVoluit(v.vak) + " gevonden in de laatste zes weken.")); return; }
    index = Math.max(0, Math.min(index, lijst.length - 1));
    const l = lijst[index];
    const toon = weergaveRij(l.rij);
    const bv = B.rijNaarVelden(toon);
    const volgende = index === 0 ? W.volgendeInReeks(toon.onderwerp) : null;
    const wanneer = datumTekst(l.datum, { weekday: "long", day: "numeric", month: "long" }) + ", " + W.tijdTekst(l.rij.start);
    vorigePaneel.replaceChildren(
      h("div", { class: "vorige-nav" },
        h("button", { type: "button", class: "knop klein secundair", disabled: index >= lijst.length - 1, onclick: () => toonVorige(index + 1), "aria-label": "Eerdere les" }, "← Eerder"),
        h("div", { class: "vorige-wanneer" }, h("strong", {}, index === 0 ? "Vorige les " + vakVoluit(v.vak) : (index + 1) + " lessen terug"), h("div", { class: "klein" }, wanneer)),
        h("button", { type: "button", class: "knop klein secundair", disabled: index === 0, onclick: () => toonVorige(index - 1), "aria-label": "Latere les" }, "Later →")),
      h("div", { class: "overnemen" },
        volgende ? h("button", { type: "button", class: "knop klein", title: "Als lesonderwerp invullen", onclick: () => zetVeld("onderwerp", volgende, onderwerpVeld) }, "↪ " + volgende) : null,
        bv.doelen ? h("button", { type: "button", class: "knop klein secundair", onclick: () => { v.hadDoelen = true; zetVeld("doelen", bv.doelen, doelenVeld); } }, "Doelen overnemen") : null,
        bv.verloop ? h("button", { type: "button", class: "knop klein secundair", onclick: () => { v.hadVerloop = true; zetVeld("verloop", bv.verloop, verloopVeld); } }, "Verloop overnemen") : null,
        bv.materiaal ? h("button", { type: "button", class: "knop klein secundair", onclick: () => zetVeld("materiaal", bv.materiaal, materiaalVeld) }, "Materiaal overnemen") : null),
      lesKaart(toon, { voorbeeld: true }));
  }
  toonVorige(0);

  const datumTekstDag = rij.dagTitel ? rij.dagTitel.charAt(0) + rij.dagTitel.slice(1).toLowerCase() : "";
  const formulier = h("div", { class: "formulier" },
    h("div", { class: "rij-velden" },
      h("div", { class: "veld smal" }, h("label", {}, "Vak"), vakVeld,
        h("datalist", { id: "vakkenlijst" }, VAKKEN.map(x => h("option", { value: x })))),
      h("div", { class: "veld" }, h("label", {}, "Lesonderwerp"), onderwerpVeld)),
    vorigeNotitieVak,
    h("div", { class: "veld" }, h("label", {}, "Doelen"), doelenVeld),
    h("div", { class: "veld" }, h("label", {}, "Verloop"), werkbalk(verloopVeld), verloopVeld),
    h("div", { class: "veld" }, h("label", {}, "Materiaal"), werkbalk(materiaalVeld), materiaalVeld),
    h("div", { class: "veld" }, h("label", {}, "Extra therapie of afwezigheid ", h("span", { class: "klein" }, "(groen, onderaan in je agenda)")), therapieVeld),
    h("div", { class: "veld" }, h("label", {}, "📝 Notitie voor de volgende les ", h("span", { class: "klein" }, "(enkel in Coffee!)")), notitieVeld),
    h("p", { class: "klein" }, "Tip: typ - en een spatie voor een opsomming, Tab om in te springen, @ om een Drive-bestand te koppelen, --> voor →.")
  );

  const venster = sluitbaarVenster([
    h("header", { class: "venster-kop" },
      h("div", {}, h("h2", {}, "Lesuur bewerken"), h("div", { class: "klein" }, datumTekstDag + ", " + rij.uur)),
      h("div", { class: "knoppen" }, annuleerKnop, opslaanKnop)),
    melding, idemBalk,
    h("div", { class: "bewerker" }, formulier, rechts)
  ]);
  ververs();
  setTimeout(() => onderwerpVeld.focus(), 0);
}

// ---------- Nieuwe week ----------
function nieuweWeekKnop() {
  const vak = h("div", { class: "nieuwe-week" });
  if (!staat.sjabloon) {
    vak.appendChild(h("p", { class: "klein" }, "Nieuwe weken aanmaken: zet een Google Doc met \"sjabloon\" in de naam in je agendamap."));
    return vak;
  }
  const laatste = staat.weken[staat.weken.length - 1];
  const voorstel = laatste ? W.plusDagen(laatste.maandag, 7) : W.maandagVan(nu());
  const datumVeld = h("input", { type: "date", value: W.isoDatum(voorstel) });
  const melding = h("div", { class: "melding" });
  const maakKnop = h("button", { class: "knop" }, "Aanmaken");
  const formulier = h("div", { class: "kaart verborgen" },
    h("h3", {}, "Nieuwe week aanmaken"),
    h("p", { class: "klein" }, "Coffee! kopieert \"" + staat.sjabloon.name + "\" naar de juiste maandmap en vult de datums van de dagen in."),
    h("label", {}, "Week van (maandag)"), datumVeld,
    h("div", { class: "knoppen" }, maakKnop), melding);
  maakKnop.addEventListener("click", async () => {
    if (!datumVeld.value) return;
    const maandag = W.maandagVan(W.vanIso(datumVeld.value));
    maakKnop.disabled = true; maakKnop.textContent = "Bezig…";
    try {
      const nieuw = await G.maakNieuweWeek(staat.inst.map.id, maandag, staat.sjabloon);
      await laadWeken();
      staat.weekIndex = staat.weken.findIndex(w => w.bestand.id === nieuw.id);
      if (staat.weekIndex < 0) staat.weekIndex = null;
      toon();
    } catch (e) {
      melding.className = "melding fout"; melding.textContent = e.message || String(e);
      maakKnop.disabled = false; maakKnop.textContent = "Aanmaken";
    }
  });
  vak.append(h("button", { class: "knop secundair", onclick: () => formulier.classList.toggle("verborgen") }, "＋ Nieuwe week"), formulier);
  return vak;
}

// ---------- Opbouw van de pagina ----------
function kopbalk() {
  const knop = (id, tekst) => h("button", { class: "tab" + (staat.weergave === id ? " actief" : ""), onclick: () => { staat.weergave = id; toon(); } }, tekst);
  return h("header", { class: "balk" },
    h("div", { class: "merk" }, "☕ Coffee!"),
    staat.testtijd ? h("button", { class: "testtijd", title: "Klik om terug te keren naar de echte tijd", onclick: () => { staat.testtijd = null; toon(); } },
      "Testtijd " + datumTekst(nu(), { weekday: "short", day: "numeric", month: "short" }) + " " + W.tijdTekst(W.minutenVan(nu())) + " ✕") : null,
    h("nav", {}, knop("nu", "Nu"), knop("week", "Week"), todoTab(knop), knop("huiswerk", "Huiswerk"), knop("evaluatie", "Evaluatie"), knop("doelen", "Doelen"),
      h("button", { class: "tab thema-knop", title: THEMA_INFO[staat.inst.thema || "auto"][1] + " (klik om te wisselen)",
        "aria-label": THEMA_INFO[staat.inst.thema || "auto"][1], onclick: volgendThema }, THEMA_INFO[staat.inst.thema || "auto"][0]),
      knop("instellingen", "⚙︎"))
  );
}

// Gsm: menu onderaan met Nu, Week, To-do en Meer (de rest)
const MEER = [["huiswerk", "📋", "Huiswerk"], ["evaluatie", "📊", "Evaluatie"], ["doelen", "🎯", "Doelen"], ["instellingen", "⚙︎", "Instellingen"]];
function onderbalk() {
  const ga = (id) => { sluitMeer(); staat.weergave = id; toon(); window.scrollTo(0, 0); };
  const knop = (id, icoon, tekst, extra) => h("button", { class: "onder-tab" + (staat.weergave === id ? " actief" : ""), "aria-current": staat.weergave === id ? "page" : null, onclick: () => ga(id) },
    h("span", { class: "onder-icoon", "aria-hidden": "true" }, icoon), h("span", { class: "onder-tekst" }, tekst), extra || null);
  const n = T.aantalOpen(todos(), nu());
  const inMeer = MEER.some(m => m[0] === staat.weergave);
  const meerKnop = h("button", { class: "onder-tab" + (inMeer ? " actief" : ""), "aria-haspopup": "true", "aria-expanded": "false", onclick: () => openMeer(meerKnop, ga) },
    h("span", { class: "onder-icoon", "aria-hidden": "true" }, "☰"), h("span", { class: "onder-tekst" }, inMeer ? MEER.find(m => m[0] === staat.weergave)[2] : "Meer"));
  return h("nav", { class: "onderbalk", "aria-label": "Hoofdmenu" },
    knop("nu", "☕", "Nu"), knop("week", "🗓️", "Week"),
    knop("todo", "✅", "To-do", h("span", { class: "tab-teller" + (n ? "" : " verborgen") }, n ? String(n) : "")),
    meerKnop);
}
function sluitMeer() { const m = document.querySelector(".meer-paneel"); if (m) m.remove(); document.querySelectorAll(".onderbalk [aria-expanded]").forEach(b => b.setAttribute("aria-expanded", "false")); }
function openMeer(knop, ga) {
  if (document.querySelector(".meer-paneel")) return sluitMeer();
  knop.setAttribute("aria-expanded", "true");
  const thema = THEMA_INFO[staat.inst.thema || "auto"];
  const paneel = h("div", { class: "meer-paneel", role: "dialog", "aria-label": "Meer" },
    h("div", { class: "meer-achter", onclick: sluitMeer }),
    h("div", { class: "meer-blad" },
      MEER.map(([id, icoon, tekst]) => h("button", { class: "meer-knop" + (staat.weergave === id ? " actief" : ""), onclick: () => ga(id) },
        h("span", { class: "onder-icoon", "aria-hidden": "true" }, icoon), tekst)),
      h("button", { class: "meer-knop", onclick: () => { sluitMeer(); volgendThema(); } }, h("span", { class: "onder-icoon", "aria-hidden": "true" }, thema[0]), thema[1])));
  document.body.appendChild(paneel);
  paneel.querySelector(".meer-knop").focus();
  const opEsc = (e) => { if (e.key === "Escape") { sluitMeer(); knop.focus(); document.removeEventListener("keydown", opEsc); } };
  document.addEventListener("keydown", opEsc);
}

let bezigMetTonen = 0;
async function toon() {
  const mijnBeurt = ++bezigMetTonen;
  const app = $("app");
  const inhoud = h("main", { class: "weergave-" + staat.weergave });
  sluitMeer();
  app.replaceChildren(kopbalk(), inhoud, onderbalk());
  try {
    if (staat.weergave === "instellingen") return toonInstellingen(inhoud);
    if (!staat.inst.map) { staat.weergave = "instellingen"; return toon(); }
    if (staat.weergave === "week") await toonWeek(inhoud);
    else if (staat.weergave === "todo") await toonTodo(inhoud);
    else if (staat.weergave === "evaluatie") toonEvaluatie(inhoud);
    else if (staat.weergave === "huiswerk") toonHuiswerk(inhoud);
    else if (staat.weergave === "doelen") toonDoelen(inhoud);
    else await toonNu(inhoud);
  } catch (e) {
    if (mijnBeurt !== bezigMetTonen) return;
    toonFout(inhoud, e);
  }
}

function toonFout(doel, e) {
  if (e instanceof G.AanmeldFout) {
    doel.replaceChildren(h("div", { class: "kaart start" },
      h("h3", {}, "Opnieuw verbinden"),
      h("p", {}, e.message + " Klik om opnieuw te verbinden met Google."),
      h("button", { class: "knop groot", onclick: () => start(true) }, "Verbinden ☕")));
  } else {
    doel.replaceChildren(h("div", { class: "melding fout" }, "Er liep iets mis: " + (e.message || e)),
      h("button", { class: "knop", onclick: () => { staat.cache.clear(); toon(); } }, "Opnieuw proberen"));
  }
}

// Het laadscherm (kopje dat volloopt) staat in index.html; bij de eerste start bewaren we het om later opnieuw te tonen
const laadSjabloon = document.querySelector("#app .koffie-laden")?.cloneNode(true);
function laadScherm() {
  if (laadSjabloon) $("app").replaceChildren(laadSjabloon.cloneNode(true));
  else $("app").replaceChildren(h("div", { class: "startscherm" }, h("div", { class: "beker" }, "☕"), h("p", {}, "Koffie wordt gezet…")));
}

function startScherm(boodschap) {
  $("app").replaceChildren(
    h("div", { class: "startscherm" },
      h("div", { class: "beker" }, "☕"),
      h("h1", {}, "Coffee!"),
      h("p", {}, "Je lesdag in één oogopslag."),
      boodschap ? h("div", { class: "melding fout" }, boodschap) : null,
      h("button", { class: "knop groot", onclick: () => start(true) }, G.wasAangemeld() ? "Verder met Coffee! ☕" : "Aanmelden met Google"),
      h("p", { class: "klein" }, h("a", { href: "#", onclick: (e) => { e.preventDefault(); staat.weergave = "instellingen"; toon(); } }, "Instellingen")))
  );
}

async function start(viaKlik) {
  if (!staat.inst.clientId) { staat.weergave = "instellingen"; return toon(); }
  try {
    try { await G.initAanmelden(staat.inst.clientId); }
    catch (e) { if (!viaKlik && G.wasAangemeld() && sluimerStart()) { await D.laad(); await toon(); toonVerbindBalk(); return; } throw e; }
    if (!G.isAangemeld()) {
      if (!viaKlik) {
        // verlopen sleutel: meteen verder met de bewaarde gegevens, verbinden gebeurt bij je eerste klik
        if (G.wasAangemeld() && sluimerStart()) { await D.laad(); await toon(); toonVerbindBalk(); return; }
        return startScherm();
      }
      await G.meldAan();
    }
    laadScherm();
    staat.gebruiker = await G.gebruiker();
    G.onthoudAccount(staat.gebruiker.emailAddress);
    await D.laad();
    if (!staat.inst.map) {
      try { staat.inst.map = await G.zoekPad(STANDAARD_PAD); bewaarInstellingen(); } catch (e) { /* zelf instellen */ }
    }
    if (staat.inst.map) await laadWeken();
    await toon();
  } catch (e) {
    if (e instanceof G.AanmeldFout) startScherm(e.message);
    else startScherm("Er liep iets mis: " + (e.message || e));
  }
}

// Elke halve minuut het dashboard verversen (enkel bij echte tijd)
setInterval(() => {
  if (staat.weergave === "nu" && !staat.testtijd && (G.isAangemeld() || staat.slaapt) && !document.querySelector("details[open]") && !document.querySelector(".venster") &&
      !(document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName))) toon();
}, 30000);

document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { D.ververs(); toonVerbindBalk(); } });

// ---------- Ingelogd blijven ----------
// Google geeft een sleutel die ± 1 uur geldig is. Nadert het einde, dan vernieuwt Coffee! hem bij je volgende klik
// (een venstertje van Google flitst dan even open en dicht). Is hij toch verlopen, dan volstaat één klik op de balk.
let laatsteVernieuwing = 0;
const vernieuwBijKlik = () => {
  if (!G.wasAangemeld() || !staat.gebruiker) return;
  const min = G.minutenGeldig();
  if (min > 20 || Date.now() - laatsteVernieuwing < 30000) return;
  laatsteVernieuwing = Date.now();
  G.meldAan().then(() => { verbergVerbindBalk(); if (staat.slaapt) wakker(); else if (min <= 0) toon(); }).catch(() => toonVerbindBalk());
};
document.addEventListener("click", vernieuwBijKlik, true);
document.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") vernieuwBijKlik(); }, true);

function verbergVerbindBalk() { const b = document.querySelector(".verbindbalk"); if (b) b.remove(); }
function toonVerbindBalk() {
  if (!staat.gebruiker || G.isAangemeld() || document.querySelector(".verbindbalk")) return;
  document.body.appendChild(h("button", { class: "verbindbalk", onclick: async (e) => {
    e.stopPropagation();
    try { await G.meldAan(); verbergVerbindBalk(); if (staat.slaapt) wakker(); else toon(); } catch (x) { /* blijft staan */ }
  } }, staat.slaapt ? "☕ Je ziet de bewaarde agenda. Klik ergens om te verbinden met Google." : "☕ Klik om verder te werken (je Google-verbinding is verlopen)"));
}
setInterval(toonVerbindBalk, 60000);

// ---------- Als app op je toestel ----------
// De service worker bewaart enkel de code van Coffee! (geen gegevens). Een nieuwe versie meldt zich met een knop.
let installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; if (staat.weergave === "instellingen") toon(); });
window.addEventListener("appinstalled", () => { installPrompt = null; toast("Coffee! staat op je toestel", "Open het voortaan via het icoon"); });
const isGeinstalleerd = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("sw.js");
      const meldNieuw = (sw) => {
        if (!sw || !navigator.serviceWorker.controller || document.querySelector(".updatebalk")) return;
        document.body.appendChild(h("button", { class: "updatebalk", onclick: () => sw.postMessage("nu-bijwerken") }, "☕ Klik om de nieuwe versie van Coffee! te laden"));
      };
      if (reg.waiting) meldNieuw(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const nieuw = reg.installing;
        nieuw && nieuw.addEventListener("statechange", () => { if (nieuw.state === "installed") meldNieuw(nieuw); });
      });
      let herladen = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => { if (!herladen && navigator.serviceWorker.controller) { herladen = true; location.reload(); } });
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); });
    } catch (e) { console.warn("Service worker niet geregistreerd", e); }
  });
}
function installeerKaart() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return h("section", { class: "kaart" },
    h("h3", {}, "Coffee! als app"),
    isGeinstalleerd() ? h("p", { class: "klein" }, "✓ Je gebruikt Coffee! als app op dit toestel.")
      : installPrompt ? [h("p", { class: "klein" }, "Zet Coffee! op je beginscherm of in je taakbalk: eigen icoon, geen adresbalk en sneller starten. Je gegevens blijven op je Drive."),
          h("button", { class: "knop", onclick: async () => { installPrompt.prompt(); try { await installPrompt.userChoice; } catch (e) { /* niets */ } installPrompt = null; toon(); } }, "📲 Installeren")]
      : ios ? h("p", { class: "klein" }, "Op iPhone of iPad: open Coffee! in Safari, tik op de deelknop (□↑) en kies “Zet op beginscherm”.")
      : h("p", { class: "klein" }, "In Chrome of Edge: klik op het installeer-icoon in de adresbalk, of kies in het menu (⋮) “Coffee! installeren” / “App installeren”. Op Android: menu (⋮) → “Toevoegen aan startscherm”."));
}

pasThemaToe();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", pasThemaToe);

// Testtijd via de adresbalk: ?nu=2026-11-17T09:45
const param = new URLSearchParams(location.search).get("nu");
if (param && !isNaN(new Date(param))) staat.testtijd = new Date(param);

start(false);
