// Coffee! – je eigen gegevens (to-do's …): lokaal bijgehouden en bewaard in je Drive.
// Werk je op laptop en gsm, dan worden de versies samengevoegd (per to-do wint de laatste wijziging).
import * as G from "./google.js";
import * as T from "./todo.js";

const LOKAAL = "coffee_gegevens";
const t = { data: T.LEEG(), id: null, basisVersie: null, bezig: false, vuil: false, status: "", timer: null };
const luisteraars = new Set();

export const data = () => t.data;
export const status = () => t.status;
export function opWijziging(cb) { luisteraars.add(cb); return () => luisteraars.delete(cb); }
const meld = (wat) => luisteraars.forEach(cb => { try { cb(wat); } catch (e) { console.error(e); } });

function bewaarLokaal() {
  try { localStorage.setItem(LOKAAL, JSON.stringify({ data: t.data, id: t.id, basisVersie: t.basisVersie, vuil: t.vuil })); } catch (e) { /* vol of privé */ }
}

export async function laad() {
  let lokaal = null;
  try { lokaal = JSON.parse(localStorage.getItem(LOKAAL) || "null"); } catch (e) { /* leeg */ }
  if (lokaal) Object.assign(t, { data: lokaal.data || T.LEEG(), id: lokaal.id, basisVersie: lokaal.basisVersie, vuil: !!lokaal.vuil });
  try {
    const b = await G.gegevensBestand();
    if (b.id) {
      const op = await G.leesGegevens(b.id);
      const samen = t.vuil ? T.samenvoegen(op, t.data) : T.samenvoegen(t.data.todos.length && t.id === b.id ? t.data : T.LEEG(), op);
      t.data = samen; t.id = b.id; t.basisVersie = b.versie;
    } else {
      t.id = null; t.basisVersie = null;
      if (t.data.todos.length) t.vuil = true;
    }
    t.status = "ok";
  } catch (e) {
    t.status = "fout";
    console.warn("Gegevens laden mislukt", e);
  }
  bewaarLokaal();
  if (t.vuil) planBewaren();
  meld("geladen");
}

// Wijzig de gegevens: fn krijgt het gegevensobject en past het aan
export function wijzig(fn) {
  fn(t.data);
  t.vuil = true;
  bewaarLokaal();
  meld("gewijzigd");
  planBewaren();
}

function planBewaren(ms = 800) {
  clearTimeout(t.timer);
  t.timer = setTimeout(bewaar, ms);
}

async function bewaar() {
  if (t.bezig) return planBewaren();
  if (!G.isAangemeld()) { t.status = "offline"; meld("status"); return; }
  t.bezig = true; t.status = "bezig"; meld("status");
  try {
    if (t.id) {
      const versie = await G.gegevensVersie(t.id);
      if (versie !== t.basisVersie) t.data = T.samenvoegen(await G.leesGegevens(t.id), t.data);
    } else {
      const b = await G.gegevensBestand();   // misschien intussen op een ander toestel aangemaakt
      if (b.id) { t.data = T.samenvoegen(await G.leesGegevens(b.id), t.data); t.id = b.id; }
    }
    const teBewaren = T.opruimen(t.data);
    t.vuil = false;
    const r = await G.schrijfGegevens(t.id, teBewaren);
    t.id = r.id; t.basisVersie = r.versie; t.data = teBewaren;
    t.status = "ok";
  } catch (e) {
    t.vuil = true; t.status = "fout";
    console.warn("Bewaren mislukt", e);
    planBewaren(15000);
  } finally {
    t.bezig = false;
    bewaarLokaal();
    meld("status");
  }
}

// Controleren of er op een ander toestel iets veranderde (bv. als je Coffee! terug opent)
export async function ververs() {
  if (!t.id || t.vuil || t.bezig || !G.isAangemeld()) return false;
  try {
    const versie = await G.gegevensVersie(t.id);
    if (versie === t.basisVersie) return false;
    t.data = T.samenvoegen(t.data, await G.leesGegevens(t.id));
    t.basisVersie = versie;
    bewaarLokaal();
    meld("geladen");
    return true;
  } catch (e) { return false; }
}
