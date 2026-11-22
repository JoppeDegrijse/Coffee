// Coffee! – aanmelden bij Google en praten met Drive en Docs.
import { verzamelDagen, verzamelDagenDocx } from "./parser.js";

const SCOPES = ["https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/documents"];
export const MAP_TYPE = "application/vnd.google-apps.folder";
export const DOC_TYPE = "application/vnd.google-apps.document";
export const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const TOKEN_SLEUTEL = "coffee_token";

let tokenClient = null;
let token = null;          // { access_token, verloopt }
let wachtend = null;       // { resolve, reject }

export class AanmeldFout extends Error {}

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
