// Coffee! – leest een weekagenda (Google Docs of Word) en zet ze om naar dagen en lesuren.
//
// Resultaat: [{ titel, weekdag, rijen: [rij] }]
// rij (les):   { soort:"les", start, eind, uur, vak, onderwerp, doelen[], regels[], materiaal[], materiaalRegels[],
//                groen[], rood[], links[], bron? }
// rij (blok):  { soort:"blok"|"perm"|"vrij", start, eind, uur, titel, halfP, bewaking, regels[], groen[], rood[], links[] }
//               perm = permanentie (P of ½ P), vrij = LO (niet op school), bewaking = rode "bewaking" in het blok
// regels = [{ tekst, md, niveau, kleur }]  md = tekst met links als [tekst](url); niveau -1 = gewone tekst;
//          kleur = "groen" | "rood" | null
// bron (enkel Google Docs) = { vak, inhoud, materiaal }: { start, end } van elke cel, + tekst om wijzigingen te detecteren.

export const WEEKDAGEN = ["MAANDAG", "DINSDAG", "WOENSDAG", "DONDERDAG", "VRIJDAG", "ZATERDAG", "ZONDAG"];
const DAGEN = /^(MAANDAG|DINSDAG|WOENSDAG|DONDERDAG|VRIJDAG|ZATERDAG|ZONDAG)\b/i;
const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const STREEPJE = /^\s*[-–•]\s+/;

// Kleuren zoals ze in het document gebruikt worden (om bij het terugschrijven dezelfde te gebruiken)
export const gezieneKleuren = { groen: null, rood: null };

// ---------- Kleuren ----------
function kleurUitRGB(r, g, b) {
  if (g > 0.45 && r < 0.6 && g > r + 0.15 && g > b + 0.15) return "groen";
  if (r > 0.6 && g < 0.35 && b < 0.35) return "rood";
  return null;
}
function kleurSoort(style) {
  const c = style && style.foregroundColor && style.foregroundColor.color && style.foregroundColor.color.rgbColor;
  if (!c) return null;
  const k = kleurUitRGB(c.red || 0, c.green || 0, c.blue || 0);
  if (k && !gezieneKleuren[k]) gezieneKleuren[k] = { red: c.red || 0, green: c.green || 0, blue: c.blue || 0 };
  return k;
}
function kleurUitHex(hex) {
  if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return null;
  const n = parseInt(hex, 16);
  return kleurUitRGB((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255);
}

// ---------- Gemeenschappelijk ----------
// ruw = [{ tekst, md, niveau, kleurTekst: { groen, rood }, inspringing }]
function maakCelInhoud(ruw, links, bereik) {
  const gekleurd = (k) => ruw.map(r => (r.kleurTekst[k] || "").replace(/\s+/g, " ").trim()).filter(Boolean);
  const regels = ruw.map(r => {
    let tekst = r.tekst.replace(/\s+$/, ""), md = r.md.replace(/\s+$/, ""), niveau = r.niveau;
    // streepje als gewone tekst ("- iets") = opsomming
    if (niveau < 0 && STREEPJE.test(tekst)) {
      tekst = tekst.replace(STREEPJE, ""); md = md.replace(STREEPJE, "");
      niveau = r.inspringing >= 30 ? 1 : 0;
    }
    const kleur = (r.kleurTekst.rood || "").trim() ? "rood" : (r.kleurTekst.groen || "").trim() ? "groen" : null;
    return { tekst, md, niveau, kleur };
  });
  while (regels.length && !regels[0].tekst.trim()) regels.shift();
  while (regels.length && !regels[regels.length - 1].tekst.trim()) regels.pop();
  return {
    tekst: ruw.map(r => r.tekst).join("\n").trim(),
    regels,
    groen: gekleurd("groen"),
    rood: gekleurd("rood"),
    links: [...new Set(links)],
    bereik: bereik || null
  };
}

function minuten(u, m) { return parseInt(u, 10) * 60 + parseInt(m, 10); }

export function leesUren(tekst) {
  const m = [...tekst.matchAll(/(\d{1,2})[.:u](\d{2})/g)];
  const fmt = (x) => x[1].padStart(2, "0") + ":" + x[2];
  return {
    uur: m.length ? fmt(m[0]) + (m[1] ? "–" + fmt(m[1]) : "") : tekst.replace(/\s+/g, " ").trim(),
    start: m[0] ? minuten(m[0][1], m[0][2]) : null,
    eind: m[1] ? minuten(m[1][1], m[1][2]) : null
  };
}

const LEEG = { tekst: "", regels: [], groen: [], rood: [], links: [], bereik: null };

// rijen = [[{ span, inhoud }]]
function verwerkDagtabel(rijen, dag) {
  if (!rijen.length || !rijen[0].length) return false;
  if (!rijen[0][0].inhoud.tekst.toLowerCase().startsWith("uur")) return false;
  for (const cellen of rijen.slice(1)) {
    if (!cellen.length) continue;
    const tijd = leesUren(cellen[0].inhoud.tekst);
    const tweede = cellen[1];
    if (!tweede || tweede.span > 1 || cellen.length < 3) {
      const c = tweede ? tweede.inhoud : LEEG;
      const isP = /\(\s*(½|1\/2)?\s*P\s*\)/i.test(c.tekst);
      const halfP = /\(\s*(½|1\/2)\s*P\s*\)/i.test(c.tekst);
      const eersteRegel = c.tekst.split("\n")[0].trim();
      const isLO = /^LO\b/i.test(eersteRegel);
      // titel zonder "(P)" en zonder de rode herinnering (die verschijnt apart)
      let titel = eersteRegel.replace(/\s*\(\s*(½|1\/2)?\s*P\s*\)\s*/gi, " ");
      for (const r of c.rood) titel = titel.replace(r, "");
      titel = titel.replace(/[\s\-–:,]+$/, "").replace(/\s+/g, " ").trim() || eersteRegel;
      dag.rijen.push({ soort: isP ? "perm" : isLO ? "vrij" : "blok", ...tijd, titel,
                       halfP, bewaking: c.rood.some(r => /bewak/i.test(r)),
                       regels: c.regels.slice(1), groen: c.groen, rood: c.rood, links: c.links });
    } else {
      const vakCel = cellen[1].inhoud;
      const vak = vakCel.tekst.replace(/-\s*\n\s*/g, "").replace(/\s+/g, " ").trim();
      const inhoud = cellen[2] ? cellen[2].inhoud : LEEG;
      const materiaal = cellen[3] ? cellen[3].inhoud : LEEG;
      const m = inhoud.tekst.match(/Lesonderwerp:[ \t]*([^\n]*)/i);
      const onderwerp = (m ? m[1] : (inhoud.tekst.split("\n").find(l => l.trim()) || "")).trim();
      const dm = inhoud.tekst.match(/Doelen:[ \t]*([\s\S]*?)(?:\n\s*Verloop:|$)/i);
      const doelen = dm ? dm[1].split("\n").map(x => x.trim()).filter(Boolean) : [];
      const rij = {
        soort: "les", ...tijd, vak, onderwerp, doelen,
        regels: inhoud.regels,
        materiaalRegels: materiaal.regels,
        materiaal: materiaal.regels.map(r => r.md.trim()).filter(Boolean),
        groen: inhoud.groen.concat(materiaal.groen),
        rood: inhoud.rood.concat(materiaal.rood),
        links: [...new Set(inhoud.links.concat(materiaal.links))]
      };
      // IDEM = zelfde inhoud als de vorige les van dit vak (Coffee! vult die aan)
      const isIdem = (cel) => {
        const l = cel.regels.map(r => r.tekst.trim()).filter(Boolean);
        return l.some(x => /\bidem\b/i.test(x)) && l.every(x => /^(lesonderwerp:\s*)?idem\.?$/i.test(x) || /^(doelen|verloop):?$/i.test(x));
      };
      rij.idem = isIdem(inhoud);
      rij.materiaalIdem = isIdem(materiaal) || (rij.idem && !rij.materiaal.length);
      if (vakCel.bereik && inhoud.bereik && materiaal.bereik) {
        rij.bron = {
          vak: vakCel.bereik, inhoud: inhoud.bereik, materiaal: materiaal.bereik,
          tekst: [vakCel.tekst, inhoud.tekst, materiaal.tekst].join("␞")
        };
      }
      dag.rijen.push(rij);
    }
  }
  return true;
}

function nieuweDag(titel) {
  const m = titel.match(DAGEN);
  return { titel, weekdag: m ? WEEKDAGEN.indexOf(m[1].toUpperCase()) : -1, rijen: [] };
}

// Ontbrekende eindtijden aanvullen met de start van de volgende rij
function vulEindtijden(dagen) {
  for (const d of dagen) {
    d.rijen.forEach((r, i) => {
      if (r.eind == null && r.start != null) {
        const volgende = d.rijen.slice(i + 1).find(x => x.start != null);
        r.eind = volgende ? volgende.start : r.start + 50;
      }
    });
  }
  return dagen;
}

// Voegt opeenvolgende stukken met dezelfde link samen tot [tekst](url)
function mdToevoegen(md, stuk, url, vorigeUrl) {
  if (!url) return md + stuk;
  const schoon = stuk.replace(/\n$/, "");
  const einde = stuk.endsWith("\n") ? "\n" : "";
  const staart = "](" + url + ")";
  if (url === vorigeUrl && md.endsWith(staart)) return md.slice(0, -staart.length) + schoon + staart + einde;
  return md + "[" + schoon + staart + einde;
}

// ---------- Google Docs (Docs API) ----------
function leesCel(cel) {
  const ruw = [];
  const links = [];
  (function loop(content) {
    for (const el of content || []) {
      if (el.paragraph) {
        let tekst = "", md = "", vorigeUrl = null;
        const kleurTekst = {};
        for (const pe of el.paragraph.elements || []) {
          const tr = pe.textRun;
          if (tr) {
            // een link op enkel witruimte (bv. het regeleinde) telt niet
            const url = tr.content.trim() ? (tr.textStyle && tr.textStyle.link && tr.textStyle.link.url) : null;
            tekst += tr.content;
            md = mdToevoegen(md, tr.content, url, vorigeUrl);
            vorigeUrl = url || null;
            const k = kleurSoort(tr.textStyle);
            if (k) kleurTekst[k] = (kleurTekst[k] || "") + tr.content;
            if (url) links.push(url);
          }
          if (pe.richLink && pe.richLink.richLinkProperties) {
            const rp = pe.richLink.richLinkProperties;
            tekst += rp.title || "";
            md += rp.uri ? "[" + (rp.title || "link") + "](" + rp.uri + ")" : (rp.title || "");
            if (rp.uri) links.push(rp.uri);
            vorigeUrl = null;
          }
        }
        const ps = el.paragraph.paragraphStyle || {};
        const inspringing = (ps.indentStart && ps.indentStart.magnitude) || 0;
        const niveau = el.paragraph.bullet ? (el.paragraph.bullet.nestingLevel || 0) : -1;
        ruw.push({ tekst: tekst.replace(/\n$/, ""), md: md.replace(/\n$/, ""), niveau, kleurTekst, inspringing });
      } else if (el.table) {
        for (const rij of el.table.tableRows || []) for (const c of rij.tableCells || []) loop(c.content);
      }
    }
  })(cel.content);
  const inhoud = cel.content || [];
  const bereik = inhoud.length && inhoud[0].startIndex != null
    ? { start: inhoud[0].startIndex, end: inhoud[inhoud.length - 1].endIndex } : null;
  return maakCelInhoud(ruw, links, bereik);
}

export function verzamelDagen(doc) {
  const dagen = [];
  let huidigeDag = null;
  function bezoek(elementen) {
    for (const el of elementen || []) {
      if (el.paragraph) {
        const t = (el.paragraph.elements || []).map(pe => (pe.textRun && pe.textRun.content) || "").join("").trim();
        if (DAGEN.test(t) && t.split(/\s+/).length > 1) {
          huidigeDag = nieuweDag(t);
          dagen.push(huidigeDag);
        }
      } else if (el.table) {
        const rijen = (el.table.tableRows || []).map(r => (r.tableCells || []).map(c => ({
          span: (c.tableCellStyle && c.tableCellStyle.columnSpan) || 1, inhoud: leesCel(c)
        })));
        const doel = huidigeDag || nieuweDag("(dag onbekend)");
        if (verwerkDagtabel(rijen, doel) && !huidigeDag) { huidigeDag = doel; dagen.push(doel); }
      }
    }
  }
  bezoek(doc.body && doc.body.content);
  if (!dagen.length && doc.tabs) {
    (function tabs(lijst) {
      for (const t of lijst || []) {
        if (t.documentTab && t.documentTab.body) bezoek(t.documentTab.body.content);
        tabs(t.childTabs);
      }
    })(doc.tabs);
  }
  return vulEindtijden(dagen);
}

// ---------- Word (.docx) ----------
const kinderen = (el, naam) => Array.from(el.childNodes).filter(n => n.nodeType === 1 && n.namespaceURI === W_NS && n.localName === naam);
const wAttr = (el, naam) => el ? (el.getAttributeNS(W_NS, naam) || el.getAttribute("w:" + naam)) : null;
const VERPAKKING = new Set(["sdt", "sdtContent", "customXml", "smartTag", "ins"]);

function docxParagraaf(p, rels) {
  let tekst = "", md = "";
  const kleurTekst = {};
  const links = [];
  let inLink = false;
  (function loop(el) {
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType !== 1) continue;
      const naam = n.localName;
      if (naam === "hyperlink") {
        const rid = n.getAttributeNS(R_NS, "id") || n.getAttribute("r:id");
        const url = rid && rels[rid];
        if (url) links.push(url);
        const voor = tekst.length, wasInLink = inLink;
        inLink = true; loop(n); inLink = wasInLink;
        const stuk = tekst.slice(voor);
        if (!inLink) md += url ? "[" + stuk + "](" + url + ")" : stuk;
      } else if (naam === "r") {
        let runTekst = "";
        for (const c of Array.from(n.childNodes)) {
          if (c.nodeType !== 1) continue;
          if (c.localName === "t") runTekst += c.textContent;
          else if (c.localName === "tab") runTekst += "\t";
          else if (c.localName === "br" || c.localName === "cr") runTekst += "\n";
          else if (c.localName === "instrText") {
            const m = c.textContent.match(/HYPERLINK\s+"([^"]+)"/);
            if (m) links.push(m[1]);
          }
        }
        const rPr = kinderen(n, "rPr")[0];
        const kleurEl = rPr && kinderen(rPr, "color")[0];
        const k = kleurUitHex(wAttr(kleurEl, "val"));
        if (k) kleurTekst[k] = (kleurTekst[k] || "") + runTekst;
        tekst += runTekst;
        if (!inLink) md += runTekst;
      } else if (naam === "fldSimple") {
        const m = (wAttr(n, "instr") || "").match(/HYPERLINK\s+"([^"]+)"/);
        if (m) links.push(m[1]);
        loop(n);
      } else if (VERPAKKING.has(naam)) {
        loop(n);
      }
    }
  })(p);
  const pPr = kinderen(p, "pPr")[0];
  const numPr = pPr && kinderen(pPr, "numPr")[0];
  const ilvl = numPr && kinderen(numPr, "ilvl")[0];
  const niveau = numPr ? parseInt(wAttr(ilvl, "val") || "0", 10) : -1;
  return { tekst, md, kleurTekst, links, niveau, inspringing: 0 };
}

function docxLoop(el, naam, cb) {
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType !== 1 || n.namespaceURI !== W_NS) continue;
    if (n.localName === naam) cb(n);
    else if (VERPAKKING.has(n.localName)) docxLoop(n, naam, cb);
  }
}

function docxCel(tc, rels) {
  const ruw = [];
  const links = [];
  (function loop(el) {
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType !== 1 || n.namespaceURI !== W_NS) continue;
      if (n.localName === "p") {
        const r = docxParagraaf(n, rels);
        ruw.push(r);
        links.push(...r.links);
      } else if (n.localName === "tbl") {
        docxLoop(n, "tr", tr => docxLoop(tr, "tc", loop));
      } else if (VERPAKKING.has(n.localName)) {
        loop(n);
      }
    }
  })(tc);
  return maakCelInhoud(ruw, links, null);
}

export function verzamelDagenDocx(documentXml, relsXml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(documentXml, "application/xml");
  const rels = {};
  if (relsXml) {
    const rd = parser.parseFromString(relsXml, "application/xml");
    for (const r of Array.from(rd.getElementsByTagName("Relationship"))) {
      if (/hyperlink$/.test(r.getAttribute("Type") || "")) rels[r.getAttribute("Id")] = r.getAttribute("Target");
    }
  }
  const body = doc.getElementsByTagNameNS(W_NS, "body")[0];
  const dagen = [];
  let huidigeDag = null;
  (function bezoek(el) {
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType !== 1 || n.namespaceURI !== W_NS) continue;
      if (n.localName === "p") {
        const t = docxParagraaf(n, rels).tekst.trim();
        if (DAGEN.test(t) && t.split(/\s+/).length > 1) {
          huidigeDag = nieuweDag(t);
          dagen.push(huidigeDag);
        }
      } else if (n.localName === "tbl") {
        const rijen = [];
        docxLoop(n, "tr", tr => {
          const cellen = [];
          docxLoop(tr, "tc", tc => {
            const tcPr = kinderen(tc, "tcPr")[0];
            const gs = tcPr && kinderen(tcPr, "gridSpan")[0];
            cellen.push({ span: parseInt(wAttr(gs, "val") || "1", 10), inhoud: docxCel(tc, rels) });
          });
          rijen.push(cellen);
        });
        const doel = huidigeDag || nieuweDag("(dag onbekend)");
        if (verwerkDagtabel(rijen, doel) && !huidigeDag) { huidigeDag = doel; dagen.push(doel); }
      } else if (VERPAKKING.has(n.localName)) {
        bezoek(n);
      }
    }
  })(body);
  return vulEindtijden(dagen);
}
