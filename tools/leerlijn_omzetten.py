# Gebruik: python3 leerlijn_omzetten.py mens_en_maatschappij.pdf wetenschap_techniek.pdf leerlijn.json
# (pdfplumber nodig). Het resultaat laad je in Coffee! bij Doelen; zet het NIET in deze repo.
"""Leerlijn WO (pdf) -> gestructureerde doelen (json) voor Coffee!

Opbouw van de pdf: tabel  nr | HOOFDDOELEN | nr | TUSSENDOELEN | SUGGESTIES INHOUD | OB | MB | BB
- gele rij = domein, groene rij = rubriek
- suggesties staan in blokken (gescheiden door horizontale lijnen); een grijs vakje in OB/MB/BB = voor die bouw
- groene tekst = verwijzing naar de methode, rode tekst = opmerking
"""
import json, re, sys
import pdfplumber

GRIJS, GEEL, GROEN, ORANJE = "0.749", "(1.0, 1.0, 0.0)", "(0.573, 0.816, 0.314)", "(0.929, 0.49, 0.192)"
TEKST_GROEN, TEKST_ROOD, TEKST_BLAUW = "(0.0, 0.69, 0.314)", "(1.0, 0.0, 0.0)", "(0.0, 0.439, 0.753)"
NIEUW_ITEM = re.compile(r"^\s*([-–•*+.]|→|)\s*")


def schoon(t):
    t = t.replace("", "→").replace("", "•").replace(" ", " ")
    t = re.sub(r"\s+", " ", t).strip()
    t = re.sub(r"\s+([.,;:!?])(?=\s|$)", r"\1", t)
    return t


def kolommen(pagina):
    ws = [w for w in pagina.extract_words() if w["top"] < 90]
    x = {}
    nrs = [w for w in ws if w["text"] == "nr."]
    for w in ws:
        if w["text"] in ("HOOFDDOELEN", "TUSSENDOELEN", "SUGGESTIES", "OB", "MB", "BB"):
            x[w["text"]] = w["x0"]
    return {"nr": nrs[0]["x0"], "hoofd": x["HOOFDDOELEN"], "nr2": nrs[1]["x0"], "tussen": x["TUSSENDOELEN"],
            "sug": x["SUGGESTIES"], "OB": x["OB"], "MB": x["MB"], "BB": x["BB"]}


def kolom_van(x0, k):
    grenzen = [("nr", k["hoofd"] - 4), ("hoofd", k["nr2"] - 4), ("nr2", k["tussen"] - 4), ("tussen", k["sug"] - 4), ("sug", k["OB"] - 16)]
    for naam, g in grenzen:
        if x0 < g:
            return naam
    return "niveau"


def lijnen_uit(woorden):
    """Woorden (zelfde kolom) groeperen tot lijnen."""
    woorden = sorted(woorden, key=lambda w: (round(w["top"]), w["x0"]))
    uit = []
    for w in woorden:
        if uit and abs(uit[-1]["top"] - w["top"]) < 3:
            uit[-1]["woorden"].append(w)
        else:
            uit.append({"top": w["top"], "bottom": w["bottom"], "woorden": [w]})
    for l in uit:
        l["woorden"].sort(key=lambda w: w["x0"])
        l["x0"] = l["woorden"][0]["x0"]
        l["tekst"] = schoon(" ".join(w["text"] for w in l["woorden"]))
        kleuren = [str(w["non_stroking_color"]) for w in l["woorden"]]
        l["kleur"] = max(set(kleuren), key=kleuren.count)
        l["bottom"] = max(w["bottom"] for w in l["woorden"])
    return uit


def ontleed(pad, leerlijn_id):
    pdf = pdfplumber.open(pad)
    k = kolommen(pdf.pages[0])
    gebeurtenissen = []  # (pagina, top, soort, data)
    blokken = []         # suggestieblokken
    for pi, p in enumerate(pdf.pages):
        rects = p.rects
        koprijen = [r for r in rects if str(r.get("non_stroking_color")) in (GEEL, GROEN, ORANJE) and r["height"] > 6 and r["x0"] < k["hoofd"]]
        # dubbele (binnen/buiten) rechthoeken samenvoegen
        rijen = []
        for r in sorted(koprijen, key=lambda r: r["top"]):
            if rijen and abs(rijen[-1]["top"] - r["top"]) < 3:
                continue
            rijen.append(r)
        grijs = [r for r in rects if str(r.get("non_stroking_color")) == GRIJS and r["height"] > 3 and r["x0"] > k["OB"] - 20]
        lijnen_h = sorted({round(r["top"]) for r in rects if r["height"] < 2 and r["x0"] < k["sug"] + 10 and r["x1"] > k["sug"] + 50 and r["width"] > 50}
                          | {round(r["bottom"]) for r in rects if r["height"] < 2 and r["x0"] < k["sug"] + 10 and r["x1"] > k["sug"] + 50 and r["width"] > 50})
        woorden = p.extract_words(extra_attrs=["non_stroking_color", "fontname"], keep_blank_chars=False)
        start = 100 if pi == 0 else 0
        woorden = [w for w in woorden if w["top"] > (k_kop(p) if pi == 0 else 0)]
        # koprijen
        in_kop = set()
        for r in rijen:
            ws = [w for w in woorden if w["top"] >= r["top"] - 1 and w["bottom"] <= r["bottom"] + 1]
            for w in ws:
                in_kop.add(id(w))
            alles = schoon(" ".join(w["text"] for w in sorted(ws, key=lambda w: w["x0"])))
            links = schoon(" ".join(w["text"] for w in sorted(ws, key=lambda w: w["x0"]) if str(w["non_stroking_color"]) != TEKST_ROOD))
            noot = schoon(" ".join(w["text"] for w in sorted(ws, key=lambda w: w["x0"]) if str(w["non_stroking_color"]) == TEKST_ROOD))
            if "→" in alles:
                links, noot = [x.strip() for x in alles.split("→", 1)]
            kleur = str(r["non_stroking_color"])
            soort = "domein" if kleur == GEEL else "rubriek" if kleur == GROEN else "subrubriek"
            if links and links != "De leerlingen kunnen:":
                gebeurtenissen.append((pi, r["top"], soort, {"naam": links.rstrip(" →"), "noot": noot}))
        # rijen "Extra tussendoelen voor ..." (tussendoelen zonder hoofddoel)
        for w in woorden:
            if w["text"] == "Extra" and w["x0"] < k["hoofd"] and id(w) not in in_kop:
                rij = [v for v in woorden if abs(v["top"] - w["top"]) < 3]
                for v in rij:
                    in_kop.add(id(v))
                gebeurtenissen.append((pi, w["top"] - 4, "extra", {"tekst": schoon(" ".join(v["text"] for v in sorted(rij, key=lambda v: v["x0"])))}))
        rest = [w for w in woorden if id(w) not in in_kop]
        per_kolom = {}
        for w in rest:
            per_kolom.setdefault(kolom_van(w["x0"], k), []).append(w)
        for kol, ws in per_kolom.items():
            for l in lijnen_uit(ws):
                if kol == "nr" and re.fullmatch(r"\d+", l["tekst"]):
                    # een nummer start de tabelrij: tekst ernaast kan iets hoger staan
                    gebeurtenissen.append((pi, l["top"] - 4, "hoofddoel", {"nr": l["tekst"]}))
                elif kol == "nr2" and re.fullmatch(r"\d+[a-z]", l["tekst"]):
                    gebeurtenissen.append((pi, l["top"] - 4, "tussendoel", {"nr": l["tekst"]}))
                elif kol in ("hoofd", "tussen"):
                    gebeurtenissen.append((pi, l["top"], kol + "tekst", l))
                elif kol == "sug":
                    gebeurtenissen.append((pi, l["top"], "sug", l))
                elif kol == "nr" and l["tekst"] in ("nr.",):
                    pass
        # suggestieblokken per pagina: tussen horizontale lijnen
        for a, b in zip(lijnen_h, lijnen_h[1:]):
            if b - a < 6:
                continue
            bouw = []
            for niv in ("OB", "MB", "BB"):
                for r in grijs:
                    midden = (r["x0"] + r["x1"]) / 2
                    if abs(midden - (k[niv] + 10)) < 20 and min(r["bottom"], b) - max(r["top"], a) > 0.5 * (b - a):
                        bouw.append(niv)
                        break
            blokken.append({"pagina": pi, "top": a, "bottom": b, "bouw": bouw})

    gebeurtenissen.sort(key=lambda g: (g[0], g[1], {"domein": 0, "rubriek": 1, "subrubriek": 1, "extra": 2, "hoofddoel": 2, "tussendoel": 3}.get(g[2], 4)))

    structuur = []
    domein = rubriek = doel = tussen = None
    ouder_rubriek = None

    def nieuwe_rubriek(naam, noot=""):
        nonlocal rubriek
        rubriek = {"naam": naam, "noot": noot, "doelen": []}
        domein["rubrieken"].append(rubriek)

    def blok_van(pi, top):
        for b in blokken:
            if b["pagina"] == pi and b["top"] - 1 <= top < b["bottom"]:
                return b
        return None

    huidige_blokken = {}  # id(blok) -> suggestieblok in doel

    for pi, top, soort, d in gebeurtenissen:
        if soort == "domein":
            naam = d["naam"]
            delen = re.split(r"\s+[-–]\s+", naam, maxsplit=1)
            domein = {"naam": delen[-1].strip(), "vol": naam, "noot": d["noot"], "rubrieken": []}
            structuur.append(domein)
            rubriek = doel = tussen = None
            ouder_rubriek = None
        elif soort == "rubriek":
            nieuwe_rubriek(d["naam"], d["noot"])
            ouder_rubriek = rubriek
            doel = tussen = None
        elif soort == "subrubriek":
            groep = ouder_rubriek["naam"] if ouder_rubriek else ""
            if ouder_rubriek is not None and not ouder_rubriek["doelen"] and ouder_rubriek in domein["rubrieken"]:
                domein["rubrieken"].remove(ouder_rubriek)
            nieuwe_rubriek(d["naam"], d["noot"])
            if groep:
                rubriek["groep"] = groep
            doel = tussen = None
        elif soort == "extra":
            if rubriek is None:
                nieuwe_rubriek("")
            doel = {"nr": "", "extra": True, "regels": [{"tekst": d["tekst"], "top": 0, "bottom": 1}], "tussendoelen": [], "suggesties": []}
            rubriek["doelen"].append(doel)
            tussen = None
        elif soort == "hoofddoel":
            if rubriek is None:
                nieuwe_rubriek("")
            doel = {"nr": d["nr"], "regels": [], "tussendoelen": [], "suggesties": []}
            rubriek["doelen"].append(doel)
            tussen = None
        elif soort == "tussendoel":
            if doel is None:
                continue
            tussen = {"nr": d["nr"], "regels": [], "suggesties": []}
            doel["tussendoelen"].append(tussen)
        elif soort == "hoofdtekst" and doel is not None:
            doel["regels"].append(d)
        elif soort == "tussentekst" and tussen is not None:
            tussen["regels"].append(d)
        elif soort == "sug" and doel is not None:
            b = blok_van(pi, top)
            sleutel = id(b) if b else ("los", pi)
            houder = tussen if tussen is not None else doel
            sb = huidige_blokken.get(sleutel)
            if sb is None or sb["houder"] is not houder:
                bouw = b["bouw"] if b else []
                # aansluitend blok met dezelfde bouw (over een paginagrens) samenvoegen
                vorige = houder["suggesties"][-1] if houder["suggesties"] else None
                if vorige is not None and vorige["bouw"] == bouw and b is not None and b["top"] < 60 and vorige.get("_pagina") == pi - 1:
                    sb = {"blok": vorige, "houder": houder}
                else:
                    nieuw = {"bouw": bouw, "lijnen": [], "_pagina": pi}
                    houder["suggesties"].append(nieuw)
                    sb = {"blok": nieuw, "houder": houder}
                huidige_blokken[sleutel] = sb
            sb["blok"]["lijnen"].append(d)
            sb["blok"]["_pagina"] = pi
    return {"id": leerlijn_id, "domeinen": [afwerken_domein(dm) for dm in structuur]}


def k_kop(p):
    for w in p.extract_words():
        if w["text"] == "kunnen:":
            return w["bottom"] + 1
    return 90


def tekst_en_toelichting(regels):
    """Doeltekst = eerste alinea; wat na een witregel komt is toelichting."""
    if not regels:
        return "", ""
    alineas = [[regels[0]]]
    for a, b in zip(regels, regels[1:]):
        hoogte = a["bottom"] - a["top"]
        if b["top"] - a["bottom"] > hoogte * 0.9 and b["top"] > a["top"]:
            alineas.append([b])
        else:
            alineas[-1].append(b)
    def plak(ls):
        uit = []
        for l in ls:
            t = l["tekst"]
            if uit and not re.match(r"^[-–•*]\s", t) and not uit[-1].endswith(":"):
                if uit[-1].endswith("-") and not uit[-1].endswith(" -"):
                    uit[-1] = uit[-1][:-1] + t
                else:
                    uit[-1] += " " + t
            else:
                uit.append(t)
        return "\n".join(uit)
    return plak(alineas[0]), "\n\n".join(plak(a) for a in alineas[1:])


def items_uit(lijnen):
    if not lijnen:
        return []
    basis = min(l["x0"] for l in lijnen)
    items = []
    for l in lijnen:
        t = l["tekst"]
        if not t:
            continue
        inspring = l["x0"] - basis
        begint = bool(re.match(r"^([-–•*+.]|→|\d+[.)])\s|^→", t)) or l["kleur"] in (TEKST_GROEN, TEKST_ROOD) and (not items or items[-1]["_kleur"] != l["kleur"])
        nieuw = begint or not items or inspring < 2 and not items[-1]["t"].rstrip().endswith((",", "-")) and (t[:1].isupper() or t.endswith(":"))
        if not begint and items and inspring >= 2:
            nieuw = False
        if nieuw:
            soort = "methode" if l["kleur"] == TEKST_GROEN else "noot" if l["kleur"] == TEKST_ROOD else None
            item = {"t": re.sub(r"^[-–•*]\s*", "", t), "_kleur": l["kleur"], "n": 1 if inspring > 12 else 0}
            if soort:
                item["s"] = soort
            items.append(item)
        else:
            vorige = items[-1]["t"]
            if vorige.endswith("-") and not vorige.endswith(" -") and not vorige.endswith("--"):
                items[-1]["t"] = vorige[:-1] + t
            else:
                items[-1]["t"] = vorige + " " + t
    for i in items:
        i.pop("_kleur", None)
        i["t"] = schoon(i["t"])
        if not i["n"]:
            del i["n"]
    return [i for i in items if i["t"]]


def afwerken_doel(d, leerlijn_id=None):
    tekst, toel = tekst_en_toelichting(d.pop("regels"))
    d["tekst"] = tekst
    if toel:
        d["toelichting"] = toel
    sugs = []
    for s in d["suggesties"]:
        items = items_uit(s["lijnen"])
        if items:
            sugs.append({"bouw": s["bouw"], "items": items})
    d["suggesties"] = sugs
    for t in d.get("tussendoelen", []):
        afwerken_doel(t)
    if "tussendoelen" in d and not d["tussendoelen"]:
        del d["tussendoelen"]
    if not d["suggesties"]:
        del d["suggesties"]
    return d


def afwerken_domein(dm):
    for r in dm["rubrieken"]:
        for d in r["doelen"]:
            afwerken_doel(d)
        if not r.get("noot"):
            r.pop("noot", None)
    if not dm.get("noot"):
        dm.pop("noot", None)
    return dm


if __name__ == "__main__":
    mm = ontleed(sys.argv[1], "MM")
    wtn = ontleed(sys.argv[2], "WTN")
    mm["naam"] = "Mens en maatschappij"
    wtn["naam"] = "Wetenschap en techniek"
    uit = {"soort": "coffee-leerlijn", "versie": 1, "titel": "Leerlijn WO 2026 – 2027", "schooljaar": "2026-2027",
           "leerlijnen": [mm, wtn]}
    json.dump(uit, open(sys.argv[3], "w"), ensure_ascii=False, indent=1)
    for ll in uit["leerlijnen"]:
        print("==", ll["naam"])
        for dm in ll["domeinen"]:
            print(" #", dm["naam"], "|", dm.get("noot", ""))
            for r in dm["rubrieken"]:
                print("   -", (r.get("groep", "") + " › " if r.get("groep") else "") + r["naam"], "|", r.get("noot", ""), [d["nr"] or "extra:" + ",".join(t["nr"] for t in d.get("tussendoelen", [])) for d in r["doelen"]])
