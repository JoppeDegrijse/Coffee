// Coffee! – de app: dashboard "Nu", weekoverzicht en instellingen.
import * as G from "./google.js";
import * as W from "./weken.js";
import * as B from "./bewerken.js";

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

// Tekst met klikbare URL's
function metLinks(tekst) {
  const delen = [];
  const re = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|https?:\/\/[^\s)]+/g;
  let laatste = 0, m;
  while ((m = re.exec(tekst))) {
    if (m.index > laatste) delen.push(tekst.slice(laatste, m.index));
    const url = m[1] != null ? m[2] : m[0];
    delen.push(h("a", { href: url, target: "_blank", rel: "noopener" }, m[1] != null ? m[1] : linkLabel(url)));
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
      losseLinks.map(l => h("a", { class: "knop klein", href: l, target: "_blank", rel: "noopener" }, "🔗 " + linkLabel(l)))) : null
  );
}

function lesKaart(rij, opties = {}) {
  const kanBewerken = !opties.voorbeeld && rij.bron && rij.week && rij.week.bestand.mimeType === G.DOC_TYPE;
  return h("article", { class: "kaart les" + (opties.groot ? " groot" : "") },
    h("header", {},
      h("div", { class: "tijd" }, rij.uur),
      vakLabel(rij.vak),
      h("h3", { class: rij.onderwerp ? "" : "open" }, rij.onderwerp || "Nog in te vullen"),
      kanBewerken ? h("button", { class: "knop klein secundair bewerk", onclick: (e) => { e.stopPropagation(); openBewerker(rij); } }, "✏️ Bewerken") : null
    ),
    chips(rij),
    h("div", { class: "lesinhoud" }, regelsWeergave(rij), materiaalWeergave(rij))
  );
}

function blokKaart(rij, datum, opties = {}) {
  let extra = null;
  if (rij.soort === "vrij") {
    extra = h("div", {}, h("p", { class: "nadruk" }, "Je bent vrij en hoeft niet op school te zijn."),
      h("p", { class: "klein" }, "Hier komen straks de to-do's die je in dit blok plant."));
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
      echtePerm ? h("p", { class: "klein" }, "Hier komen straks de to-do's die je in dit permanentieblok plant.") : null);
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
    const titel = rij.soort === "les" ? (rij.onderwerp || "Nog in te vullen") : rij.soort === "vrij" ? "Vrij" : rij.titel;
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

  const hoofd = h("section", { class: "hoofd" });
  doel.appendChild(hoofd);

  if (huidig) {
    hoofd.appendChild(h("div", { class: "label-boven" }, "Nu bezig · nog " + (huidig.eind - nuMin) + " min"));
    hoofd.appendChild(rijKaart(huidig, n, { groot: true }));
    if (huidig.soort === "les") {
      const vorigeVak = h("div", { class: "vorige" }, h("p", { class: "klein" }, "Vorige les zoeken…"));
      hoofd.appendChild(vorigeVak);
      toonVorigeLes(vorigeVak, week, { datum: W.middernacht(n), rij: huidig });
    }
  } else if (eerste && nuMin < eerste.start) {
    hoofd.appendChild(h("div", { class: "label-boven" }, "Straks · om " + W.tijdTekst(eerste.start)));
    hoofd.appendChild(rijKaart(eerste, n, { groot: true }));
    if (eerste.soort === "les") {
      const vorigeVak = h("div", { class: "vorige" });
      hoofd.appendChild(vorigeVak);
      toonVorigeLes(vorigeVak, week, { datum: W.middernacht(n), rij: eerste });
    }
  } else if (laatste && nuMin >= laatste.eind) {
    hoofd.appendChild(h("div", { class: "kaart" }, h("h3", {}, "De lesdag zit erop 🎉"),
      h("p", { class: "klein" }, "Straks kun je hier je avondblok met to-do's plannen.")));
  }

  if (volgende && volgende !== eerste) {
    hoofd.appendChild(h("div", { class: "label-boven" }, "Daarna · om " + W.tijdTekst(volgende.start)));
    const kort = h("details", { class: "rij " + rijKlasse(volgende) },
      h("summary", {}, h("span", { class: "tijd" }, W.tijdTekst(volgende.start)),
        rijLabel(volgende),
        h("span", { class: "titel" }, volgende.soort === "les" ? volgende.onderwerp : volgende.soort === "vrij" ? "Vrij" : volgende.titel)),
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
        h("span", { class: "titel" }, datumTekst(vorige.datum, { weekday: "short", day: "numeric", month: "short" }) + " · " + vorige.rij.onderwerp)),
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
    try { dagen = await dagenVan(week); } catch (e) { continue; }
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
      h("h3", {}, "Zwemmen (½ P)"),
      h("p", { class: "klein" }, "Kies een dag in een week waarin je meegaat zwemmen. Coffee! wisselt vanaf dan elke week af tussen zwemmen en permanentie."),
      zwemVeld,
      h("button", { class: "knop", onclick: () => { inst.zwemweek = zwemVeld.value || null; bewaarInstellingen(); zeg("ok", "Zwemritme opgeslagen."); } }, "Opslaan")
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

  const tekstvak = (naam, rijen, plaatshouder) => {
    const el = h("textarea", { rows: rijen, placeholder: plaatshouder, spellcheck: "true" });
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
    const alle = B.veldenNaarRegels(v);
    const regels = {};
    cellen.forEach(k => { regels[k] = alle[k]; });
    opslaanKnop.disabled = true; opslaanKnop.textContent = "Bezig met opslaan…";
    try {
      await G.schrijfLes(rij.week.bestand, rij.plaats, rij.bron.tekst, regels);
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
    melding,
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
      "Testtijd: " + datumTekst(nu(), { weekday: "short", day: "numeric", month: "short" }) + " " + W.tijdTekst(W.minutenVan(nu())) + " ✕") : null,
    h("nav", {}, knop("nu", "Nu"), knop("week", "Week"), knop("instellingen", "⚙︎"))
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
  if (staat.weergave === "nu" && !staat.testtijd && G.isAangemeld() && !document.querySelector("details[open]") && !document.querySelector(".venster")) toon();
}, 30000);

// Testtijd via de adresbalk: ?nu=2026-11-17T09:45
const param = new URLSearchParams(location.search).get("nu");
if (param && !isNaN(new Date(param))) staat.testtijd = new Date(param);

start(false);
