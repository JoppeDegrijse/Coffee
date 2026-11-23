// Coffee! – een lesuur omzetten naar bewerkbare velden en terug naar Google Docs-opdrachten.
//
// Invulformaat in de tekstvakken (één regel per lijn):
//   - iets          opsomming (streepje)
//     - iets        opsomming, niveau 2 (twee spaties ervoor)
//   ❗ iets         rode herinnering
//   🟢 iets         groene regel (therapie)
//   Inl / Kern / Slot   onderlijnde kopjes
//   [tekst](url)    link

const ROOD = "❗";
const GROEN = "🟢";
const STANDAARD_KLEUR = { groen: { red: 0.22, green: 0.6, blue: 0.18 }, rood: { red: 1, green: 0, blue: 0 } };
const LINK_KLEUR = { red: 0.067, green: 0.333, blue: 0.8 };
const LABEL = "Lesonderwerp:";

// ---------- Van document naar velden ----------
function regelNaarMarkup(r) {
  const opsomming = r.niveau >= 0 ? "  ".repeat(Math.min(r.niveau, 3)) + "- " : "";
  const kleur = r.kleur === "rood" ? ROOD + " " : r.kleur === "groen" ? GROEN + " " : "";
  return opsomming + kleur + (r.md != null ? r.md : r.tekst).trim();
}

function trimLeeg(lijnen) {
  while (lijnen.length && !lijnen[0].trim()) lijnen.shift();
  while (lijnen.length && !lijnen[lijnen.length - 1].trim()) lijnen.pop();
  // hoogstens één lege lijn na elkaar
  return lijnen.filter((l, i) => l.trim() || (lijnen[i - 1] || "").trim());
}

export function rijNaarVelden(rij) {
  let onderwerp = "";
  const delen = { voor: [], doelen: [], verloop: [] };
  let huidig = "voor", hadDoelen = false, hadVerloop = false, hadLabel = false;
  for (const r of rij.regels || []) {
    const t = (r.tekst || "").trim();
    const lo = t.match(/^Lesonderwerp:\s*(.*)$/i);
    if (lo && !hadLabel) { onderwerp = (r.md || r.tekst).replace(/^\s*Lesonderwerp:\s*/i, "").trim(); hadLabel = true; continue; }
    const kop = t.match(/^(Doelen|Verloop):\s*(.*)$/i);
    if (kop && r.niveau < 0) {
      huidig = kop[1].toLowerCase();
      if (huidig === "doelen") hadDoelen = true; else hadVerloop = true;
      if (kop[2]) delen[huidig].push(kop[2]);
      continue;
    }
    delen[huidig].push(t ? regelNaarMarkup(r) : "");
  }
  if (!hadLabel && !onderwerp && rij.onderwerp) onderwerp = rij.onderwerp;
  const verloop = trimLeeg(delen.voor.concat(delen.voor.some(l => l.trim()) && delen.verloop.length ? [""] : [], delen.verloop));
  return {
    vak: rij.vak || "",
    onderwerp,
    doelen: trimLeeg(delen.doelen).join("\n"),
    verloop: verloop.join("\n"),
    materiaal: trimLeeg((rij.materiaalRegels || []).map(r => r.tekst.trim() ? regelNaarMarkup(r) : "")).join("\n"),
    hadDoelen, hadVerloop
  };
}

// ---------- Van velden naar regels ----------
// regel = { text, bold:[[s,e]], underline:[[s,e]], kleur, links:[{s,e,url}], opsomming }

// Is dit een link naar een Google Drive-bestand of -map? (die worden in Google Docs een chip)
export function isDriveLink(url) {
  return /^https:\/\/(docs\.google\.com\/(document|spreadsheets|presentation|forms|drawings)\/d\/|drive\.google\.com\/(file\/d\/|drive\/(u\/\d+\/)?folders\/|open\?id=))/.test(url);
}

// "[tekst](url)" en losse URL's → platte tekst + linkposities.
// Met chips = true komen Drive-links niet als tekst in de lijn, maar als chip (positie in 'chips').
function ontleedLinks(md, verschuiving = 0, chips = false) {
  const links = [];
  const chipLijst = [];
  let tekst = "";
  const re = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|https?:\/\/[^\s)]+/g;
  let laatste = 0, m;
  while ((m = re.exec(md))) {
    tekst += md.slice(laatste, m.index);
    const zicht = m[1] != null ? m[1] : m[0];
    const url = m[1] != null ? m[2] : m[0];
    if (chips && isDriveLink(url)) {
      chipLijst.push({ pos: verschuiving + tekst.length, url });
    } else {
      links.push({ s: verschuiving + tekst.length, e: verschuiving + tekst.length + zicht.length, url });
      tekst += zicht;
    }
    laatste = m.index + m[0].length;
  }
  tekst += md.slice(laatste);
  return { tekst, links, chips: chipLijst };
}

export function lijnNaarRegel(lijn, { chips = false } = {}) {
  let rest = lijn.replace(/\s+$/, "");
  let opsomming = -1;
  const op = rest.match(/^(\s*)[-–•]\s+(.*)$/);
  if (op) { opsomming = op[1].length >= 2 ? 1 : 0; rest = op[2]; }
  else rest = rest.trim();
  let kleur = null;
  if (rest.startsWith(ROOD)) { kleur = "rood"; rest = rest.slice(ROOD.length).trim(); }
  else if (rest.startsWith(GROEN)) { kleur = "groen"; rest = rest.slice(GROEN.length).trim(); }
  const voorvoegsel = opsomming >= 0 ? "- " : "";
  const { tekst, links, chips: chipLijst } = ontleedLinks(rest, voorvoegsel.length, chips);
  const text = voorvoegsel + tekst;
  const fase = opsomming < 0 && /^(Inl|Kern|Slot)\.?$/i.test(tekst);
  return {
    text, bold: [], underline: fase ? [[0, text.length]] : [], kleur, kleurStart: voorvoegsel.length, links, chips: chipLijst, opsomming,
    // voor het voorbeeld
    md: rest, niveau: opsomming, platteTekst: tekst
  };
}

const lijnen = (s) => (s || "").split("\n");

export function veldenNaarRegels(v, { chips = false } = {}) {
  const inhoud = [];
  const lijnNaarRegel_ = (l) => lijnNaarRegel(l, { chips });
  const ond = ontleedLinks(v.onderwerp.trim(), LABEL.length + 1, chips);
  const label = { text: LABEL + (v.onderwerp.trim() ? " " + ond.tekst : ""), bold: [[0, LABEL.length]],
                  underline: [], kleur: null, links: ond.links, chips: ond.chips, opsomming: -1 };
  inhoud.push(label);
  const leeg = () => ({ text: "", bold: [], underline: [], kleur: null, links: [], opsomming: -1 });
  const kop = (t) => ({ text: t, bold: [[0, t.length]], underline: [], kleur: null, links: [], opsomming: -1 });
  const doelen = trimLeeg(lijnen(v.doelen));
  const verloop = trimLeeg(lijnen(v.verloop));
  if (doelen.length || v.hadDoelen) {
    inhoud.push(leeg(), kop("Doelen:"));
    doelen.forEach(l => inhoud.push(l.trim() ? lijnNaarRegel_(l) : leeg()));
  }
  if (verloop.length || v.hadVerloop) {
    inhoud.push(leeg(), kop("Verloop:"));
    verloop.forEach(l => inhoud.push(l.trim() ? lijnNaarRegel_(l) : leeg()));
  }
  return {
    vak: [{ text: v.vak.trim(), bold: [], underline: [], kleur: null, links: [], opsomming: -1 }],
    inhoud,
    materiaal: trimLeeg(lijnen(v.materiaal)).map(l => l.trim() ? lijnNaarRegel_(l) : leeg())
  };
}

// Welke cellen zijn gewijzigd?
export function gewijzigdeCellen(origineel, nieuw) {
  const uit = [];
  if (origineel.vak.trim() !== nieuw.vak.trim()) uit.push("vak");
  if (origineel.onderwerp.trim() !== nieuw.onderwerp.trim() ||
      trimLeeg(lijnen(origineel.doelen)).join("\n") !== trimLeeg(lijnen(nieuw.doelen)).join("\n") ||
      trimLeeg(lijnen(origineel.verloop)).join("\n") !== trimLeeg(lijnen(nieuw.verloop)).join("\n")) uit.push("inhoud");
  if (trimLeeg(lijnen(origineel.materiaal)).join("\n") !== trimLeeg(lijnen(nieuw.materiaal)).join("\n")) uit.push("materiaal");
  return uit;
}

// ---------- Google Docs-opdrachten om één cel te herschrijven ----------
// bereik = { start, end } van de celinhoud. stijlHerstellen = false voor de vakcel (opmaak behouden).
export function celVerzoeken(bereik, regels, { stijlHerstellen = true, kleuren = {} } = {}) {
  const start = bereik.start, end = bereik.end;
  const T = regels.map(r => r.text).join("\n");
  const reqs = [];
  const r = (s, e) => ({ startIndex: s, endIndex: e });
  if (end - 1 > start) reqs.push({ deleteContentRange: { range: r(start, end - 1) } });
  if (stijlHerstellen) reqs.push({ deleteParagraphBullets: { range: r(start, start + 1) } });
  if (T.length) reqs.push({ insertText: { location: { index: start }, text: T } });
  if (!stijlHerstellen) return reqs;

  const tEind = start + T.length;
  // inspringing weg en links uitlijnen (ook als de oude inhoud gecentreerd stond)
  reqs.push({ updateParagraphStyle: { range: r(start, tEind + 1), paragraphStyle: { alignment: "START" }, fields: "indentStart,indentFirstLine,alignment" } });
  // ook het laatste regeleinde van de cel, zodat er geen oude link of kleur aan blijft hangen
  reqs.push({ updateTextStyle: { range: r(start, tEind + 1), textStyle: {},
    fields: "bold,italic,underline,strikethrough,foregroundColor,link" } });

  let pos = start;
  const chipPosities = [];
  for (const regel of regels) {
    const n = regel.text.length;
    if (n) {
      for (const [s, e] of regel.bold) if (e > s) reqs.push({ updateTextStyle: { range: r(pos + s, pos + e), textStyle: { bold: true }, fields: "bold" } });
      for (const [s, e] of regel.underline) if (e > s) reqs.push({ updateTextStyle: { range: r(pos + s, pos + e), textStyle: { underline: true }, fields: "underline" } });
      if (regel.kleur) {
        const kleur = kleuren[regel.kleur] || STANDAARD_KLEUR[regel.kleur];
        const ks = regel.kleurStart || 0;
        if (n > ks) reqs.push({ updateTextStyle: { range: r(pos + ks, pos + n), textStyle: { foregroundColor: { color: { rgbColor: kleur } } }, fields: "foregroundColor" } });
      }
      for (const l of regel.links) {
        if (l.e > l.s) reqs.push({ updateTextStyle: { range: r(pos + l.s, pos + l.e),
          textStyle: { link: { url: l.url }, underline: true, foregroundColor: { color: { rgbColor: LINK_KLEUR } } },
          fields: "link,underline,foregroundColor" } });
      }
    }
    if (regel.opsomming >= 0) {
      const inspringing = 18 + 18 * regel.opsomming;
      reqs.push({ updateParagraphStyle: { range: r(pos, pos + n + 1),
        paragraphStyle: { indentStart: { magnitude: inspringing, unit: "PT" }, indentFirstLine: { magnitude: inspringing - 10, unit: "PT" } },
        fields: "indentStart,indentFirstLine" } });
    }
    for (const c of regel.chips || []) chipPosities.push({ index: pos + c.pos, url: c.url });
    pos += n + 1;
  }
  // Drive-chips als laatste, van achter naar voor (elke chip neemt één positie in)
  chipPosities.sort((a, b) => b.index - a.index);
  for (const c of chipPosities) reqs.push({ insertRichLink: { location: { index: c.index }, richLinkProperties: { uri: c.url } } });
  return reqs;
}

// ---------- Voorbeeld (zelfde vorm als een rij uit de parser) ----------
export function voorbeeldRij(v, rij) {
  const regels = veldenNaarRegels(v);
  const naarParser = (x) => ({ tekst: x.platteTekst != null ? x.platteTekst : x.text, md: x.md != null ? x.md : x.text, niveau: x.opsomming, kleur: x.kleur });
  const inhoud = regels.inhoud.map(naarParser);
  const materiaal = regels.materiaal.map(naarParser);
  const alle = inhoud.concat(materiaal);
  const metKleur = (k) => alle.filter(x => x.kleur === k).map(x => x.tekst.trim()).filter(Boolean);
  const links = regels.inhoud.concat(regels.materiaal).flatMap(x => x.links.map(l => l.url));
  return {
    ...rij,
    vak: v.vak.trim(),
    onderwerp: ontleedLinks(v.onderwerp.trim()).tekst,
    regels: inhoud,
    materiaalRegels: materiaal,
    materiaal: materiaal.map(x => x.md).filter(Boolean),
    groen: metKleur("groen"),
    rood: metKleur("rood"),
    links: [...new Set(links)]
  };
}
