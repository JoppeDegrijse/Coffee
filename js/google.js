// Coffee! – aanmelden bij Google en praten met Drive en Docs.
import { verzamelDagen, verzamelDagenDocx, gezieneKleuren, WEEKDAGEN } from "./parser.js";
import { celVerzoeken, veldenNaarRegels } from "./bewerken.js";

const SCOPES = ["https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/documents"];
export const MAP_TYPE = "application/vnd.google-apps.folder";
export const DOC_TYPE = "application/vnd.google-apps.document";
export const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const TOKEN_SLEUTEL = "coffee_token";

let tokenClient = null;
let token = null;          // { access_token, verloopt }
let wachtend = null;       // { resolve, reject }

export class AanmeldFout extends Error {}
export class ConflictFout extends Error {}

// ---------- Aanmelden ----------
function wachtOpGoogle() {
  return new Promise((resolve) => {
    const kijk = () => (window.google && google.accounts && google.accounts.oauth2) ? resolve() : setTimeout(kijk, 100);
    kijk();
  });
}

export async function initAanmelden(clientId) {
  await wachtOpGoogle();
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPES.join(" "),
    callback: (resp) => {
      const w = wachtend; wachtend = null;
      if (!w) return;
      if (resp.error) return w.reject(new AanmeldFout(resp.error_description || resp.error));
      if (!google.accounts.oauth2.hasGrantedAllScopes(resp, ...SCOPES)) {
        return w.reject(new AanmeldFout("Je gaf niet alle toestemmingen. Vink zowel Drive als Docs aan."));
      }
      token = { access_token: resp.access_token, verloopt: Date.now() + (resp.expires_in - 120) * 1000 };
      try { sessionStorage.setItem(TOKEN_SLEUTEL, JSON.stringify(token)); } catch (e) { /* privémodus */ }
      w.resolve();
    },
    error_callback: (err) => {
      const w = wachtend; wachtend = null;
      if (!w) return;
      const uitleg = err && err.type === "popup_failed_to_open"
        ? "Het aanmeldvenster kon niet openen. Sta pop-ups toe voor deze pagina."
        : err && err.type === "popup_closed" ? "Het aanmeldvenster werd gesloten." : "Aanmelden mislukt.";
      w.reject(new AanmeldFout(uitleg));
    }
  });
  try {
    const t = JSON.parse(sessionStorage.getItem(TOKEN_SLEUTEL) || "null");
    if (t && t.verloopt > Date.now()) token = t;
  } catch (e) { /* geen bewaard token */ }
}

export function isAangemeld() { return !!token && token.verloopt > Date.now(); }

// Moet vanuit een klik gebeuren (Google opent een pop-up)
export function meldAan() {
  return new Promise((resolve, reject) => {
    wachtend = { resolve, reject };
    tokenClient.requestAccessToken({ prompt: "" });
  });
}

export function meldAf() {
  if (token) google.accounts.oauth2.revoke(token.access_token, () => {});
  token = null;
  sessionStorage.removeItem(TOKEN_SLEUTEL);
}

// ---------- API ----------
async function verzoek(url, opties = {}) {
  if (!isAangemeld()) throw new AanmeldFout("Je aanmelding is verlopen.");
  const r = await fetch(url, { ...opties, headers: { ...(opties.headers || {}), Authorization: "Bearer " + token.access_token } });
  if (r.status === 401) { token = null; sessionStorage.removeItem(TOKEN_SLEUTEL); throw new AanmeldFout("Je aanmelding is verlopen."); }
  if (!r.ok) {
    let detail = "";
    try { detail = (await r.json()).error.message; } catch (e) { /* geen JSON */ }
    const fout = new Error(detail || ("HTTP " + r.status));
    fout.status = r.status;
    throw fout;
  }
  return r;
}
const json = async (url, opties) => (await verzoek(url, opties)).json();

const DRIVE = "https://www.googleapis.com/drive/v3/";

async function lijstAlles(q, velden) {
  const alles = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({
      q, pageSize: "200", fields: "nextPageToken,files(" + velden + ")",
      supportsAllDrives: "true", includeItemsFromAllDrives: "true", corpora: "allDrives"
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await json(DRIVE + "files?" + params);
    alles.push(...(res.files || []));
    pageToken = res.nextPageToken || "";
  } while (pageToken);
  return alles;
}

export async function gebruiker() {
  return (await json(DRIVE + "about?fields=user(displayName,emailAddress,photoLink)")).user;
}

export async function gedeeldeDrives() {
  return (await json(DRIVE + "drives?pageSize=100&fields=drives(id,name)")).drives || [];
}

export async function submappen(id) {
  const mappen = await lijstAlles("'" + id + "' in parents and mimeType = '" + MAP_TYPE + "' and trashed = false", "id,name");
  return mappen.sort((a, b) => a.name.localeCompare(b.name, "nl"));
}

const gelijk = (a, b) => a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();

// "Klimop / SCHOOLJAAR 26 - 27 / AGENDA / JOPPE" → map-id
export async function zoekPad(pad) {
  const delen = pad.split("/").map(d => d.trim()).filter(Boolean);
  if (!delen.length) throw new Error("Geef een pad op.");
  let huidig;
  const drives = await gedeeldeDrives();
  const drive = drives.find(d => gelijk(d.name, delen[0]));
  if (drive) huidig = drive.id;
  else if (gelijk(delen[0], "Mijn Drive") || gelijk(delen[0], "My Drive")) huidig = "root";
  else throw new Error("Geen gedeelde drive \"" + delen[0] + "\" gevonden. Wel: " + (drives.map(d => d.name).join(", ") || "geen") + ".");
  for (const deel of delen.slice(1)) {
    const kandidaten = await submappen(huidig);
    const volgende = kandidaten.find(m => gelijk(m.name, deel));
    if (!volgende) throw new Error("Map \"" + deel + "\" niet gevonden. Wel: " + (kandidaten.map(m => m.name).join(", ") || "geen mappen") + ".");
    huidig = volgende.id;
  }
  return { id: huidig, pad: delen.join(" / ") };
}

// Alle agenda-documenten in de agendamap en de maandmappen eronder
export async function agendaBestanden(mapId) {
  const maanden = await submappen(mapId);
  const bronnen = [{ id: mapId, name: "" }].concat(maanden);
  const perMap = await Promise.all(bronnen.map(async (m) => {
    const docs = await lijstAlles("'" + m.id + "' in parents and (mimeType = '" + DOC_TYPE + "' or mimeType = '" + DOCX_TYPE +
      "') and trashed = false", "id,name,modifiedTime,mimeType,webViewLink");
    return docs.map(d => Object.assign(d, { map: m.name, mapId: m.id }));
  }));
  return perMap.flat();
}

// Een week uitlezen (Google Docs of Word)
export async function leesWeekBestand(bestand) {
  if (bestand.mimeType === DOCX_TYPE) {
    if (!window.JSZip) await laadScript("https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js");
    const r = await verzoek(DRIVE + "files/" + bestand.id + "?alt=media&supportsAllDrives=true");
    const zip = await JSZip.loadAsync(await r.arrayBuffer());
    const documentXml = await zip.file("word/document.xml").async("string");
    const relsBestand = zip.file("word/_rels/document.xml.rels");
    return verzamelDagenDocx(documentXml, relsBestand ? await relsBestand.async("string") : "");
  }
  return verzamelDagen(await json("https://docs.googleapis.com/v1/documents/" + bestand.id));
}

function laadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error("Kon " + src + " niet laden"));
    document.head.appendChild(s);
  });
}

// ---------- Schrijven ----------
const postJson = (url, body) => json(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const DOCS = "https://docs.googleapis.com/v1/documents/";

// Schrijft gewijzigde cellen van één lesuur terug. plaats = { dagIndex, rijIndex }, verwacht = rij.bron.tekst,
// velden = invulvelden, cellen = welke cellen ("vak", "inhoud", "materiaal")
export async function schrijfLes(bestand, plaats, verwacht, velden, cellen) {
  try {
    await schrijfLesMet(bestand, plaats, verwacht, velden, cellen, true);
  } catch (e) {
    // lukt een Drive-chip niet (bv. geen toegang tot dat bestand), dan als gewone link
    if (e instanceof ConflictFout || e instanceof AanmeldFout || e.status !== 400) throw e;
    await schrijfLesMet(bestand, plaats, verwacht, velden, cellen, false);
  }
}

async function schrijfLesMet(bestand, plaats, verwacht, velden, gekozen, chips) {
  const alle = veldenNaarRegels(velden, { chips });
  const regels = {};
  gekozen.forEach(k => { regels[k] = alle[k]; });
  const doc = await json(DOCS + bestand.id);
  const dagen = verzamelDagen(doc);
  const dag = dagen[plaats.dagIndex];
  const rij = dag && dag.rijen[plaats.rijIndex];
  if (!rij || !rij.bron || rij.bron.tekst !== verwacht) {
    throw new ConflictFout("Dit lesuur werd intussen in Google Docs aangepast.");
  }
  // van achter naar voor, zodat de posities van eerdere cellen kloppen
  const cellen = ["vak", "inhoud", "materiaal"].filter(k => regels[k]).sort((a, b) => rij.bron[b].start - rij.bron[a].start);
  const requests = cellen.flatMap(k => celVerzoeken(rij.bron[k], regels[k], { stijlHerstellen: k !== "vak", kleuren: gezieneKleuren }));
  if (!requests.length) return;
  await postJson(DOCS + bestand.id + ":batchUpdate", { requests, writeControl: { requiredRevisionId: doc.revisionId } });
}

// ---------- Drive doorzoeken (voor @-koppelingen) ----------
export async function zoekBestanden(term) {
  const veilig = term.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  // enkel je eigen Drive (niet de gedeelde drives van school)
  const params = new URLSearchParams({
    q: "name contains '" + veilig + "' and 'me' in owners and trashed = false and mimeType != '" + MAP_TYPE + "'",
    pageSize: "15", fields: "files(id,name,mimeType,webViewLink,iconLink,modifiedTime)",
    corpora: "user", includeItemsFromAllDrives: "false", supportsAllDrives: "true"
  });
  const res = await json(DRIVE + "files?" + params);
  return (res.files || []).sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
}

// ---------- Nieuwe week uit het sjabloon ----------
const MAANDNAMEN = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];

export async function maakNieuweWeek(mapId, maandag, sjabloon) {
  const maand = MAANDNAMEN[maandag.getMonth()];
  const naam = "Week " + maandag.getDate() + " " + maand;
  // maandmap zoeken of aanmaken (zelfde schrijfwijze als de bestaande mappen)
  const mappen = await submappen(mapId);
  let maandMap = mappen.find(m => m.name.toLowerCase().includes(maand));
  if (!maandMap) {
    const hoofdletter = mappen.some(m => /^[A-Z]/.test(m.name)) && !mappen.some(m => /^[a-z]/.test(m.name));
    const mapNaam = hoofdletter ? maand.charAt(0).toUpperCase() + maand.slice(1) : maand;
    maandMap = await postJson(DRIVE + "files?supportsAllDrives=true&fields=id,name",
      { name: mapNaam, mimeType: MAP_TYPE, parents: [mapId] });
  }
  // bestaat de week al?
  const bestaand = await lijstAlles("'" + maandMap.id + "' in parents and trashed = false", "id,name");
  if (bestaand.some(b => b.name.trim().toLowerCase() === naam.toLowerCase())) {
    throw new Error("\"" + naam + "\" bestaat al in de map " + maandMap.name + ".");
  }
  const kopie = await postJson(DRIVE + "files/" + sjabloon.id + "/copy?supportsAllDrives=true&fields=id,name,mimeType,modifiedTime,webViewLink",
    { name: naam, mimeType: DOC_TYPE, parents: [maandMap.id] });
  // dagtitels invullen: "MAANDAG 1 OKTOBER" → "MAANDAG 30 NOVEMBER"
  const doc = await json(DOCS + kopie.id);
  const requests = [];
  for (const dag of verzamelDagen(doc)) {
    if (dag.weekdag < 0) continue;
    const datum = new Date(maandag); datum.setDate(datum.getDate() + dag.weekdag);
    const nieuw = WEEKDAGEN[dag.weekdag] + " " + datum.getDate() + " " + MAANDNAMEN[datum.getMonth()].toUpperCase();
    if (dag.titel !== nieuw) requests.push({ replaceAllText: { containsText: { text: dag.titel, matchCase: true }, replaceText: nieuw } });
  }
  if (requests.length) await postJson(DOCS + kopie.id + ":batchUpdate", { requests });
  return Object.assign(kopie, { map: maandMap.name, mapId: maandMap.id });
}

// Naam van een Drive-bestand uit een geplakte link (null als het geen Drive-link is of niet lukt)
export async function driveNaam(url) {
  const m = url.match(/\/d\/([\w-]{10,})/) || url.match(/[?&]id=([\w-]{10,})/) || url.match(/folders\/([\w-]{10,})/);
  if (!m) return null;
  try { return (await json(DRIVE + "files/" + m[1] + "?fields=name&supportsAllDrives=true")).name; } catch (e) { return null; }
}
