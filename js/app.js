// Coffee! – de app: dashboard "Nu", weekoverzicht en instellingen.
import * as G from "./google.js";
import * as W from "./weken.js";
import * as B from "./bewerken.js";
import * as T from "./todo.js";
import * as D from "./gegevens.js";

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

function dagenVan(week) {
  if (!week) return Promise.resolve([]);
  if (!staat.cache.has(week.bestand.id)) {
    const p = G.leesWeekBestand(week.bestand)
      .then(dagen => {
        dagen.forEach((d, i) => d.rijen.forEach((r, j) => { r.plaats = { dagIndex: i, rijIndex: j }; r.week = week; r.dagTitel = d.titel; }));
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
  const kanBewerken = !opties.voorbeeld && rij.bron && rij.week && rij.week.bestand.mimeType === G.DOC_TYPE;
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

function rijKaart(rij, datum, opties) { return rij.soort === "les" ? lesKaart(rij, opties) : blokKaart(rij, datum, opties); }

function dagLijst(dag, datum, nuMin) {
  const lijst = h("div", { class: "daglijst" });
  for (const rij of dag.rijen) {
    const bezig = nuMin != null && rij.start != null && nuMin >= rij.start && nuMin < rij.eind;
    const voorbij = nuMin != null && rij.eind != null && nuMin >= rij.eind;
    const titel = rij.soort === "les" ? lesTitel(rij) : rij.soort === "vrij" ? "Vrij" : rij.titel;
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
    return;
  }

  doel.appendChild(h("p", { class: "laden" }, "Je agenda wordt geladen…"));
  const dagen = await dagenVan(week);
  await koppelIdem(week);
  doel.querySelector(".laden").remove();
  const dag = dagen.find(d => d.weekdag === weekdagVan(n));
  const nuMin = W.minutenVan(n);

  if (!dag || !dag.rijen.length) {
    doel.appendChild(h("div", { class: "kaart" }, h("h3", {}, "Geen lessen vandaag"), h("p", {}, "Geniet ervan! ☕")));
    await toonVolgendeSchooldag(doel, n);
    return;
  }

  const { huidig, volgende } = W.huidigBlok(dag, nuMin);
  const eerste = dag.rijen.find(r => r.start != null);
  const laatste = [...dag.rijen].reverse().find(r => r.eind != null);

  // herinneringen van vandaag
  const vandaagRood = dag.rijen.flatMap(r => r.rood.map(t => ({ t, rij: r })));
  if (vandaagRood.length) {
    doel.appendChild(h("div", { class: "kaart herinneringen" },
      h("h4", {}, "❗ Niet vergeten vandaag"),
      h("ul", {}, vandaagRood.map(x => h("li", {}, h("span", { class: "tijd" }, W.tijdTekst(x.rij.start)), " ", x.t)))));
  }

  doel.appendChild(todoVandaagKaart());
  const hoofd = h("section", { class: "hoofd" });
  doel.appendChild(hoofd);

  if (huidig) {
    hoofd.appendChild(h("div", { class: "label-boven" }, "Nu bezig, nog " + (huidig.eind - nuMin) + " min"));
    const kaart = rijKaart(huidig, n, { groot: true });
    // voortgangsbalk: hoe ver het lesuur al gevorderd is
    const procent = Math.max(0, Math.min(100, Math.round((nuMin - huidig.start) / Math.max(1, huidig.eind - huidig.start) * 100)));
    const kop = kaart.querySelector("header");
    if (kop) kop.after(h("div", { class: "voortgang", role: "progressbar", "aria-valuenow": procent, "aria-valuemin": 0, "aria-valuemax": 100,
      "aria-label": "Verloop van dit lesuur" }, h("span", { style: "width:" + procent + "%" })));
    hoofd.appendChild(kaart);
    if (huidig.soort === "les" && !huidig.idem) {
      const vorigeVak = h("div", { class: "vorige" }, h("p", { class: "klein" }, "Vorige les zoeken…"));
      hoofd.appendChild(vorigeVak);
      toonVorigeLes(vorigeVak, week, { datum: W.middernacht(n), rij: huidig });
    }
  } else if (eerste && nuMin < eerste.start) {
    hoofd.appendChild(h("div", { class: "label-boven" }, "Straks om " + W.tijdTekst(eerste.start)));
    hoofd.appendChild(rijKaart(eerste, n, { groot: true }));
    if (eerste.soort === "les" && !eerste.idem) {
      const vorigeVak = h("div", { class: "vorige" });
      hoofd.appendChild(vorigeVak);
      toonVorigeLes(vorigeVak, week, { datum: W.middernacht(n), rij: eerste });
    }
  } else if (laatste && nuMin >= laatste.eind) {
    const av = avondInstelling();
    hoofd.appendChild(h("div", { class: "kaart" }, h("h3", {}, "De lesdag zit erop 🎉"),
      weekdagVan(n) < 5 ? [h("p", { class: "klein" }, "Vanavond, " + av.start + "–" + av.eind + ":"),
        todoBlok({ datum: W.isoDatum(n), start: tijdMin(av.start), eind: tijdMin(av.eind), soort: "avond", titel: "Avond" })] : null));
  }

  if (volgende && volgende !== eerste) {
    hoofd.appendChild(h("div", { class: "label-boven" }, "Daarna om " + W.tijdTekst(volgende.start)));
    const kort = h("details", { class: "rij " + rijKlasse(volgende) },
      h("summary", {}, h("span", { class: "tijd" }, W.tijdTekst(volgende.start)),
        rijLabel(volgende),
        h("span", { class: "titel" }, volgende.soort === "les" ? lesTitel(volgende) : volgende.soort === "vrij" ? "Vrij" : volgende.titel)),
      rijKaart(volgende, n));
    hoofd.appendChild(kort);
  }

  if (laatste && nuMin >= laatste.eind) await toonVolgendeSchooldag(doel, n);

  doel.appendChild(h("h3", { class: "sectie" }, "Vandaag"));
  doel.appendChild(dagLijst(dag, n, nuMin));
  doel.appendChild(h("p", { class: "klein" }, h("a", { href: week.bestand.webViewLink || "#", target: "_blank", rel: "noopener" }, "Weekagenda openen in Google Docs ↗")));
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
  const navigatie = h("div", { class: "weeknav" },
    h("button", { class: "knop secundair", disabled: staat.weekIndex === 0, onclick: () => { staat.weekIndex--; toon(); } }, "←"),
    h("div", {}, h("h2", {}, "Week van " + datumTekst(week.maandag, { day: "numeric", month: "long" })),
      h("a", { class: "klein", href: week.bestand.webViewLink || "#", target: "_blank", rel: "noopener" }, week.bestand.name + " ↗")),
    h("button", { class: "knop secundair", disabled: staat.weekIndex === staat.weken.length - 1, onclick: () => { staat.weekIndex++; toon(); } }, "→")
  );
  doel.replaceChildren(navigatie, nieuweWeekKnop(), h("p", { class: "laden" }, "Week wordt geladen…"));
  const dagen = await dagenVan(week);
  await koppelIdem(week);
  doel.querySelector(".laden").remove();
  const raster = h("div", { class: "weekraster" });
  for (const dag of dagen) {
    const datum = W.plusDagen(week.maandag, Math.max(0, dag.weekdag));
    const vandaag = W.middernacht(n).getTime() === datum.getTime();
    raster.appendChild(h("section", { class: "weekdag" + (vandaag ? " vandaag" : "") },
      h("h3", {}, dag.titel.charAt(0) + dag.titel.slice(1).toLowerCase()),
      dagLijst(dag, datum, vandaag ? W.minutenVan(n) : null)));
  }
  doel.appendChild(raster);
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
        h("a", { href: "#", onclick: (e) => { e.preventDefault(); G.meldAf(); location.reload(); } }, "Afmelden")) : null
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
  const teller = document.querySelector(".tab-teller");
  if (teller) { const n = T.aantalOpen(todos(), nu()); teller.textContent = n || ""; teller.classList.toggle("verborgen", !n); }
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
  const wat = slot.soort === "avond" ? "avond" : slot.titel;
  return dag + " " + W.tijdTekst(slot.start) + ", " + wat;
}

function wijzigTodo(id, fn) {
  D.wijzig(g => { const t = g.todos.find(x => x.id === id); if (t) { fn(t); t.gewijzigd = Date.now(); } });
}

function todoItem(t, opties = {}) {
  const li = h("li", { class: "todo" + (t.klaar ? " klaar" : "") });
  const vink = h("input", { type: "checkbox", "aria-label": "Klaar", checked: t.klaar || null });
  vink.addEventListener("change", () => wijzigTodo(t.id, x => { x.klaar = vink.checked; }));
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

// Kaart op het dashboard: wat staat er vandaag nog gepland?
function todoVandaagKaart() {
  return levendVak(() => {
    const iso = W.isoDatum(nu());
    const nuMin = W.minutenVan(nu());
    // wat in het lopende blok staat, zie je al in de grote kaart
    const vandaag = todos().filter(t => !t.klaar && t.gepland && t.gepland.datum === iso && !T.isVoorbij(t.gepland, nu()) &&
                                        !(t.gepland.start <= nuMin && nuMin < t.gepland.eind))
      .sort((a, b) => a.gepland.start - b.gepland.start);
    const open = T.aantalOpen(todos(), nu());
    if (!vandaag.length && !open) return null;
    return h("div", { class: "kaart todo-vandaag" },
      h("h4", {}, "✅ To-do's vandaag"),
      vandaag.length ? h("ul", { class: "todolijst" }, vandaag.map(t => {
        const li = todoItem(t, { inBlok: true });
        li.querySelector(".todo-midden").prepend(h("span", { class: "tijd" }, W.tijdTekst(t.gepland.start) + " "));
        return li;
      })) : h("p", { class: "klein" }, "Niets meer gepland voor vandaag."),
      open ? h("p", { class: "klein" }, h("a", { href: "#", onclick: (e) => { e.preventDefault(); staat.weergave = "todo"; toon(); } },
        open === 1 ? "1 to-do wacht nog op een moment" : open + " to-do's wachten nog op een moment")) : null);
  });
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
        h("span", { class: "tijd" }, W.tijdTekst(s.start) + "–" + W.tijdTekst(s.eind)),
        h("span", {}, s.soort === "avond" ? "🌙 Avond" : s.soort === "vrij" ? "LO (vrij)" : s.titel),
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
        : h("p", { class: "klein" }, "Alles heeft een moment gekregen. ☕"));
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
function wisselOpsomming(el) {
  const [s, e] = lijnBereik(el);
  const lijnen = el.value.slice(s, e).split("\n");
  const allemaal = lijnen.every(l => /^\s*[-–•]\s/.test(l) || !l.trim());
  const nieuw = lijnen.map(l => !l.trim() ? l : allemaal ? l.replace(/^\s*[-–•]\s+/, "") : (/^\s*[-–•]\s/.test(l) ? l : "- " + l));
  vervangBereik(el, s, e, nieuw.join("\n"));
}
function wisselKleur(el, teken) {
  const [s, e] = lijnBereik(el);
  const lijnen = el.value.slice(s, e).split("\n").map(l => {
    if (!l.trim()) return l;
    const m = l.match(/^(\s*(?:[-–•]\s+)?)(❗ |🟢 )?(.*)$/u);
    return m[2] === teken + " " ? m[1] + m[3] : m[1] + teken + " " + m[3];
  });
  vervangBereik(el, s, e, lijnen.join("\n"));
}
function voegLijnToe(el, tekst) {
  const [, e] = lijnBereik(el);
  const huidig = el.value.slice(lijnBereik(el)[0], e);
  const invoeg = (huidig.trim() ? "\n" : "") + tekst;
  vervangBereik(el, e, e, invoeg + (e === el.value.length ? "\n" : ""), e + invoeg.length + 1);
}
function voegInBijCursor(el, tekst, vervangVorig = 0) {
  const s = el.selectionStart - vervangVorig;
  vervangBereik(el, s, el.selectionEnd, tekst);
}

function sluitbaarVenster(inhoud, opties = {}) {
  const achtergrond = h("div", { class: "venster" + (opties.klein ? " klein" : "") }, h("div", { class: "venster-inhoud" }, inhoud));
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
  vakVeld.addEventListener("input", () => { v.vak = vakVeld.value; ververs(); });
  const onderwerpVeld = h("input", { type: "text", value: v.onderwerp, placeholder: "bv. VLL kern 7 dag 15: herhaling" });
  onderwerpVeld.addEventListener("input", () => { v.onderwerp = onderwerpVeld.value; ververs(); });

  // Een geplakte link wordt een knop; bij een Drive-link zoekt Coffee! de bestandsnaam op
  const plakLink = (el) => el.addEventListener("paste", async (e) => {
    const tekst = ((e.clipboardData || window.clipboardData).getData("text") || "").trim();
    if (!/^https?:\/\/\S+$/.test(tekst)) return;
    e.preventDefault();
    const naam = B.isDriveLink(tekst) ? await G.driveNaam(tekst) : null;
    voegInBijCursor(el, "[" + (naam || linkLabel(tekst)).replace(/[\[\]]/g, "") + "](" + tekst + ")");
  });
  plakLink(onderwerpVeld);
  const tekstvak = (naam, rijen, plaatshouder) => {
    const el = h("textarea", { rows: rijen, placeholder: plaatshouder, spellcheck: "true" });
    plakLink(el);
    el.value = v[naam];
    el.addEventListener("input", (e) => {
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
  const verloopVeld = tekstvak("verloop", 12, "Inl\n- …\nKern\n- …\nSlot\n- …");
  const materiaalVeld = tekstvak("materiaal", 5, "- werkbundel\n- @ om een Drive-bestand te koppelen");

  const knop = (tekst, titel, actie) => h("button", { type: "button", class: "knop klein secundair", title: titel, onclick: actie }, tekst);
  const werkbalk = (el, extra) => h("div", { class: "werkbalk" },
    extra || [],
    knop("– opsomming", "Opsomming aan/uit voor de huidige lijn(en)", () => wisselOpsomming(el)),
    knop("❗ rood", "Rode herinnering aan/uit", () => wisselKleur(el, "❗")),
    knop("🟢 therapie", "Groene regel (therapie) aan/uit", () => wisselKleur(el, "🟢")),
    knop("📎 Drive", "Drive-bestand koppelen (of typ @)", () => openDriveZoeker(f => voegInBijCursor(el, mdLink(f)))));

  const opslaanKnop = h("button", { class: "knop" }, "Opslaan in Google Docs");
  let wegGooienGevraagd = false;
  const annuleerKnop = h("button", { class: "knop secundair" }, "Annuleren");
  const probeerSluiten = () => {
    if (B.gewijzigdeCellen(origineel, v).length && !wegGooienGevraagd) {
      wegGooienGevraagd = true; annuleerKnop.textContent = "Wijzigingen weggooien?"; return;
    }
    venster.sluit(); document.removeEventListener("keydown", opEscape);
  };
  const opEscape = (e) => { if (e.key === "Escape" && !document.querySelector(".venster.klein")) probeerSluiten(); };
  document.addEventListener("keydown", opEscape);
  annuleerKnop.addEventListener("click", probeerSluiten);

  opslaanKnop.addEventListener("click", async () => {
    const cellen = B.gewijzigdeCellen(origineel, v);
    if (!cellen.length) { venster.sluit(); document.removeEventListener("keydown", opEscape); return; }
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
        const zonderTherapie = (t) => t.split("\n").filter(l => !/^\s*(?:[-–•]\s+)?🟢/u.test(l)).join("\n");
        v.onderwerp = bv.onderwerp; v.doelen = bv.doelen; v.verloop = zonderTherapie(bv.verloop);
        v.hadDoelen = true; v.hadVerloop = true;
        if (rij.materiaalIdem) v.materiaal = bv.materiaal;
        onderwerpVeld.value = v.onderwerp; doelenVeld.value = v.doelen; verloopVeld.value = v.verloop; materiaalVeld.value = v.materiaal;
        ververs(); idemBalk.remove();
      } }, "↺ Inhoud van " + wanneer + " overnemen"));
  }

  const datumTekstDag = rij.dagTitel ? rij.dagTitel.charAt(0) + rij.dagTitel.slice(1).toLowerCase() : "";
  const formulier = h("div", { class: "formulier" },
    h("div", { class: "rij-velden" },
      h("div", { class: "veld smal" }, h("label", {}, "Vak"), vakVeld,
        h("datalist", { id: "vakkenlijst" }, VAKKEN.map(x => h("option", { value: x })))),
      h("div", { class: "veld" }, h("label", {}, "Lesonderwerp"), onderwerpVeld)),
    h("div", { class: "veld" }, h("label", {}, "Doelen"), doelenVeld),
    h("div", { class: "veld" }, h("label", {}, "Verloop"),
      werkbalk(verloopVeld, ["Inl", "Kern", "Slot"].map(f => knop(f, "Kopje " + f + " toevoegen", () => voegLijnToe(verloopVeld, f + "\n- ")))),
      verloopVeld),
    h("div", { class: "veld" }, h("label", {}, "Materiaal"), werkbalk(materiaalVeld), materiaalVeld),
    h("p", { class: "klein" }, "Tip: typ @ om een werkblad of ander bestand uit je Drive te koppelen.")
  );

  const venster = sluitbaarVenster([
    h("header", { class: "venster-kop" },
      h("div", {}, h("h2", {}, "Lesuur bewerken"), h("div", { class: "klein" }, datumTekstDag + " · " + rij.uur)),
      h("div", { class: "knoppen" }, annuleerKnop, opslaanKnop)),
    melding, idemBalk,
    h("div", { class: "bewerker" }, formulier, h("div", {}, h("h4", { class: "klein" }, "Voorbeeld"), voorbeeld))
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
    h("nav", {}, knop("nu", "Nu"), knop("week", "Week"), todoTab(knop),
      h("button", { class: "tab thema-knop", title: THEMA_INFO[staat.inst.thema || "auto"][1] + " (klik om te wisselen)",
        "aria-label": THEMA_INFO[staat.inst.thema || "auto"][1], onclick: volgendThema }, THEMA_INFO[staat.inst.thema || "auto"][0]),
      knop("instellingen", "⚙︎"))
  );
}

let bezigMetTonen = 0;
async function toon() {
  const mijnBeurt = ++bezigMetTonen;
  const app = $("app");
  const inhoud = h("main", {});
  app.replaceChildren(kopbalk(), inhoud);
  try {
    if (staat.weergave === "instellingen") return toonInstellingen(inhoud);
    if (!staat.inst.map) { staat.weergave = "instellingen"; return toon(); }
    if (staat.weergave === "week") await toonWeek(inhoud);
    else if (staat.weergave === "todo") await toonTodo(inhoud);
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

function startScherm(boodschap) {
  $("app").replaceChildren(
    h("div", { class: "startscherm" },
      h("div", { class: "beker" }, "☕"),
      h("h1", {}, "Coffee!"),
      h("p", {}, "Je lesdag in één oogopslag."),
      boodschap ? h("div", { class: "melding fout" }, boodschap) : null,
      h("button", { class: "knop groot", onclick: () => start(true) }, "Aanmelden met Google"),
      h("p", { class: "klein" }, h("a", { href: "#", onclick: (e) => { e.preventDefault(); staat.weergave = "instellingen"; toon(); } }, "Instellingen")))
  );
}

async function start(viaKlik) {
  if (!staat.inst.clientId) { staat.weergave = "instellingen"; return toon(); }
  try {
    await G.initAanmelden(staat.inst.clientId);
    if (!G.isAangemeld()) {
      if (!viaKlik) return startScherm();
      await G.meldAan();
    }
    $("app").replaceChildren(h("div", { class: "startscherm" }, h("div", { class: "beker draait" }, "☕"), h("p", {}, "Agenda zetten…")));
    staat.gebruiker = await G.gebruiker();
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
  if (staat.weergave === "nu" && !staat.testtijd && G.isAangemeld() && !document.querySelector("details[open]") && !document.querySelector(".venster") &&
      !(document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName))) toon();
}, 30000);

document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") D.ververs(); });

pasThemaToe();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", pasThemaToe);

// Testtijd via de adresbalk: ?nu=2026-11-17T09:45
const param = new URLSearchParams(location.search).get("nu");
if (param && !isNaN(new Date(param))) staat.testtijd = new Date(param);

start(false);
