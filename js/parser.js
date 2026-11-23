// Coffee! – leest een weekagenda (Google Docs of Word) en zet ze om naar dagen en lesuren.
//
// Resultaat: [{ titel, weekdag, rijen: [rij] }]
// rij (les):   { soort:"les",  start, eind, uur, vak, onderwerp, doelen[], regels[], materiaal[], groen[], rood[], links[] }
// rij (blok):  { soort:"blok"|"perm"|"vrij", start, eind, uur, titel, halfP, bewaking, regels[], groen[], rood[], links[] }
//               perm = permanentie (P of ½ P), vrij = LO (niet op school), bewaking = rode "bewaking" in het blok
// start/eind = minuten sinds middernacht (of null). regels = [{ tekst, niveau }] (niveau -1 = gewone tekst).

export const WEEKDAGEN = ["MAANDAG", "DINSDAG", "WOENSDAG", "DONDERDAG", "VRIJDAG", "ZATERDAG", "ZONDAG"];
const DAGEN = /^(MAANDAG|DINSDAG|WOENSDAG|DONDERDAG|VRIJDAG|ZATERDAG|ZONDAG)\b/i;
const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

// ---------- Kleuren ----------
function kleurUitRGB(r, g, b) {
  if (g > 0.45 && r < 0.6 && g > r + 0.15 && g > b + 0.15) return "groen";
  if (r > 0.6 && g < 0.35 && b < 0.35) return "rood";
  return null;
}
function kleurSoort(style) {
  const c = style && style.foregroundColor && style.foregroundColor.color && style.foregroundColor.color.rgbColor;
  return c ? kleurUitRGB(c.red || 0, c.green || 0, c.blue || 0) : null;
}
function kleurUitHex(hex) {
  if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return null;
  const n = parseInt(hex, 16);
  return kleurUitRGB((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255);
}

// ---------- Gemeenschappelijk ----------
// regels = [{ tekst, niveau, kleur: { groen, rood } }]
function maakCelInhoud(regels, links) {
  const gekleurd = (k) => regels.map(r => (r.kleur[k] || "").replace(/\s+/g, " ").trim()).filter(Boolean);
  // lege regels aan begin/einde weg
  const schoon = regels.map(r => ({ tekst: r.tekst.replace(/\s+$/, ""), niveau: r.niveau }));
  while (schoon.length && !schoon[0].tekst.trim()) schoon.shift();
  while (schoon.length && !schoon[schoon.length - 1].tekst.trim()) schoon.pop();
  return {
    tekst: regels.map(r => r.tekst).join("\n").trim(),
    regels: schoon,
    groen: gekleurd("groen"),
    rood: gekleurd("rood"),
    links: [...new Set(links)]
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

const LEEG = { tekst: "", regels: [], groen: [], rood: [], links: [] };

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
      const vak = cellen[1].inhoud.tekst.replace(/-\s*\n\s*/g, "").replace(/\s+/g, " ").trim();
      const inhoud = cellen[2] ? cellen[2].inhoud : LEEG;
      const materiaal = cellen[3] ? cellen[3].inhoud : LEEG;
      const m = inhoud.tekst.match(/Lesonderwerp:[ \t]*([^\n]*)/i);
      const onderwerp = (m ? m[1] : (inhoud.tekst.split("\n").find(l => l.trim()) || "")).trim();
      const dm = inhoud.tekst.match(/Doelen:[ \t]*([\s\S]*?)(?:\n\s*Verloop:|$)/i);
      const doelen = dm ? dm[1].split("\n").map(x => x.trim()).filter(Boolean) : [];
      dag.rijen.push({
        soort: "les", ...tijd, vak, onderwerp, doelen,
        regels: inhoud.regels,
        materiaal: materiaal.regels.map(r => r.tekst.trim()).filter(Boolean),
        groen: inhoud.groen.concat(materiaal.groen),
        rood: inhoud.rood.concat(materiaal.rood),
        links: [...new Set(inhoud.links.concat(materiaal.links))]
      });
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

// ---------- Google Docs (Docs API) ----------
function leesCel(cel) {
  const regels = [];
  const links = [];
  (function loop(content) {
    for (const el of content || []) {
      if (el.paragraph) {
        let tekst = "";
        const kleur = {};
        for (const pe of el.paragraph.elements || []) {
          const tr = pe.textRun;
          if (tr) {
            tekst += tr.content;
            const k = kleurSoort(tr.textStyle);
            if (k) kleur[k] = (kleur[k] || "") + tr.content;
            if (tr.textStyle && tr.textStyle.link && tr.textStyle.link.url) links.push(tr.textStyle.link.url);
          }
          if (pe.richLink && pe.richLink.richLinkProperties) {
            const rp = pe.richLink.richLinkProperties;
            tekst += rp.title || "";
            if (rp.uri) links.push(rp.uri);
          }
        }
        const niveau = el.paragraph.bullet ? (el.paragraph.bullet.nestingLevel || 0) : -1;
        regels.push({ tekst: tekst.replace(/\n$/, ""), niveau, kleur });
      } else if (el.table) {
        for (const rij of el.table.tableRows || []) for (const c of rij.tableCells || []) loop(c.content);
      }
    }
  })(cel.content);
  return maakCelInhoud(regels, links);
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
  let tekst = "";
  const kleur = {};
  const links = [];
  (function loop(el) {
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType !== 1) continue;
      const naam = n.localName;
      if (naam === "hyperlink") {
        const rid = n.getAttributeNS(R_NS, "id") || n.getAttribute("r:id");
        if (rid && rels[rid]) links.push(rels[rid]);
        loop(n);
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
        if (k) kleur[k] = (kleur[k] || "") + runTekst;
        tekst += runTekst;
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
  return { tekst, kleur, links, niveau };
}

function docxLoop(el, naam, cb) {
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType !== 1 || n.namespaceURI !== W_NS) continue;
    if (n.localName === naam) cb(n);
    else if (VERPAKKING.has(n.localName)) docxLoop(n, naam, cb);
  }
}

function docxCel(tc, rels) {
  const regels = [];
  const links = [];
  (function loop(el) {
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType !== 1 || n.namespaceURI !== W_NS) continue;
      if (n.localName === "p") {
        const r = docxParagraaf(n, rels);
        regels.push({ tekst: r.tekst, niveau: r.niveau, kleur: r.kleur });
        links.push(...r.links);
      } else if (n.localName === "tbl") {
        docxLoop(n, "tr", tr => docxLoop(tr, "tc", loop));
      } else if (VERPAKKING.has(n.localName)) {
        loop(n);
      }
    }
  })(tc);
  return maakCelInhoud(regels, links);
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
