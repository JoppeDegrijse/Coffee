"""Werkt de lijst bestanden en de versie in sw.js bij. Uitvoeren vóór elke publicatie:
    python3 tools/sw_bijwerken.py
"""
import hashlib, json, pathlib, re
wortel = pathlib.Path(__file__).resolve().parent.parent
bestanden = ["./", "index.html", "manifest.webmanifest"]
for patroon in ["css/*.css", "js/*.js", "js/vendor/*.js", "fonts/*.woff2", "icons/*.png"]:
    bestanden += sorted(str(p.relative_to(wortel)) for p in wortel.glob(patroon))
h = hashlib.sha256()
for b in bestanden:
    if b != "./":
        h.update(b.encode()); h.update((wortel / b).read_bytes())
versie = h.hexdigest()[:12]
sw = (wortel / "sw.js").read_text()
sw = re.sub(r'const VERSIE = "[^"]*";', 'const VERSIE = "' + versie + '";', sw)
sw = re.sub(r"const BESTANDEN = .*?;\n", "const BESTANDEN = " + json.dumps(bestanden) + ";\n", sw, flags=re.S)
(wortel / "sw.js").write_text(sw)
print("sw.js bijgewerkt:", versie, len(bestanden), "bestanden")
