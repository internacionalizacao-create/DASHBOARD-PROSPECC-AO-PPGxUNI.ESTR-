"""Gera data/dashboard.json a partir de: output/gerbras.db (professores UEA),
DATA BASE UEA/PPGS_LINHAS/output/ppgs_linhas.json (linhas de pesquisa oficiais por PPG)
e output/linha_matches.json (matches linha x pesquisador estrangeiro, ver etl/linha_match.py).

Schema novo (substitui o antigo researchers/edges por keyword de professor):
  ppgs           - [{codigo, nome, linhas: [{id, titulo, descricao}]}]
  professores    - [{id, nome, orcid, universidade, cidade, uf, programas: [codigo,...],
                      linhas_canonicas: [linha_id,...], n_publicacoes}]
  linha_matches  - [{linha_id, ppg_codigo, foreign_author_name, foreign_author_orcid,
                      foreign_author_openalex_id, foreign_institution, foreign_country,
                      score, sample_work_title, sample_work_doi}]
  institutions   - instituições estrangeiras distintas (agregado de linha_matches), geocodificadas
  manaus         - ponto fixo de origem (Manaus/AM)

Uso:
    python3 etl/export_dashboard_data.py
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import db
from geocode import Geocoder

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "output"

MANAUS = {"cidade": "Manaus", "uf": "AM", "pais": "Brasil", "lat": -3.1316333, "lon": -59.9825041}

LINHA_CANONICA_LIMIAR = 0.45

# Coordenadas conhecidas p/ instituições que o Nominatim não resolve pelo nome
# (associações "guarda-chuva", institutos sem tag OSM correspondente).
# Aproximação ao nível da cidade-sede.
MANUAL_INSTITUTION_COORDS: dict[str, tuple[float, float]] = {
    "Berlin Brandenburg Institute of Advanced Biodiversity Research": (52.5170, 13.3889),
    "Berlin Institute of Health at Charité - Universitätsmedizin Berlin": (52.5170, 13.3889),
    "Bernhard Nocht Institute for Tropical Medicine": (53.5511, 9.9937),
    "Boehringer Ingelheim (Germany)": (49.9694, 8.0656),
    "Center for Advancing Electronics Dresden": (51.0504, 13.7373),
    "Center for HIV and Hepatogastroenterology": (50.9375, 6.9603),
    "Centre for innovative process engineering": (53.0793, 8.8017),
    "Climate Analytics": (52.5170, 13.3889),
    "CureVac (Germany)": (48.5216, 9.0576),
    "Deutsches Archäologisches Institut, Zentrale": (52.5170, 13.3889),
    "Fraunhofer Institute for Solar Energy Systems": (47.9990, 7.8421),
    "Fraunhofer Institute for Telecommunications, Heinrich Hertz Institute": (52.5200, 13.4050),
    "GFZ Helmholtz Centre for Geosciences": (52.3906, 13.0645),
    "German Cancer Research Center": (49.4172, 8.6724),
    "German Center for Infection Research": (52.2872, 10.5423),
    "German Center for Lung Research": (50.5839, 8.6779),
    "German Centre for Cardiovascular Research": (52.5200, 13.4050),
    "German Institute of Food Technologies": (52.6733, 7.9601),
    "German Society of Surgery": (52.5170, 13.3889),
    "Hasso Plattner Institute": (52.3906, 13.0645),
    "Helmholtz Centre for Environmental Research": (51.3397, 12.3731),
    "Helmholtz Centre for Infection Research": (52.2872, 10.5423),
    "Hertie Institute for Clinical Brain Research": (48.5216, 9.0576),
    "Infektionsmedizinisches Centrum Hamburg": (53.5511, 9.9937),
    "Institute for New Media": (50.1109, 8.6821),
    "Kempten University of Applied Sciences": (47.7267, 10.3169),
    "Leibniz Association": (52.5170, 13.3889),
    "Leibniz Centre for Agricultural Landscape Research": (52.5167, 14.1333),
    "Leibniz Institute for Baltic Sea Research Warnemünde": (54.1810, 12.0894),
    "Leibniz Institute for Tropospheric Research": (51.3397, 12.3731),
    "Max Planck Institute for Biogeochemistry": (50.9279, 11.5892),
    "Max Planck Institute for Chemical Energy Conversion": (51.4059, 6.8628),
    "Max Planck Institute for Meteorology": (53.5570, 9.9880),
    "Max Planck Institute for the Science of Human History": (50.9279, 11.5892),
    "Max Planck Institute of Biophysics": (50.1109, 8.6821),
    "Max Planck Institute of Molecular Plant Physiology": (52.4009, 12.9704),
    "Merck KGaA, Darmstadt (Germany)": (49.8728, 8.6512),
    "NewClimate Institute": (50.9375, 6.9603),
    "Philipps University of Marburg": (50.8090, 8.7685),
    "Research Institute for Sustainability at GFZ": (52.3906, 13.0645),
    "RheinMain University of Applied Sciences": (50.0782, 8.2398),
    "TH Köln - University of Applied Sciences": (50.9375, 6.9603),
    "Teva Pharmaceuticals (Germany)": (48.4011, 9.9876),
    "University Hospital Bonn": (50.7226, 7.1006),
    "University Hospital Carl Gustav Carus": (51.0400, 13.7500),
    "University Hospital Leipzig": (51.3300, 12.3800),
    "University Hospital Münster": (51.9636, 7.6041),
    "University of Applied Sciences Mainz": (49.9929, 8.2473),
    "University of Bamberg": (49.8988, 10.9028),
    "University of Göttingen": (51.5413, 9.9158),
    "University of Lübeck": (53.8655, 10.6866),
    "University of Siegen": (50.9106, 8.0169),
    "University of Wuppertal": (51.2465, 7.1500),
    "Airbus (Germany)": (53.5350, 9.8350),
    "Amazon (Germany)": (48.1351, 11.5820),
    "Amgen (Germany)": (48.1351, 11.5820),
    "Baden-Wuerttemberg Cooperative State University": (48.7758, 9.1829),
    "Catholic University of Eichstätt-Ingolstadt": (48.8909, 11.1866),
    "Centre for European Economic Research": (49.4875, 8.4660),
    "Centre for Higher Education": (51.9068, 8.3799),
    "Deutsche Montan Technologie (Germany)": (51.4556, 7.0116),
    "European Forest Institute": (50.7374, 7.0982),
    "European University Viadrina": (52.3474, 14.5501),
    "Evonik (Germany)": (51.4556, 7.0116),
    "Federal Institute For Materials Research and Testing": (52.5170, 13.3889),
    "Federal Institute for Occupational Safety and Health": (51.5136, 7.4653),
    "Federal Institute for Risk Assessment": (52.5170, 13.3889),
    "GEOMAR Helmholtz Centre for Ocean Research Kiel": (54.3233, 10.1228),
    "GESIS - Leibniz Institute for the Social Sciences": (50.9375, 6.9603),
    "German Climate Computing Centre": (53.5511, 9.9937),
    "German Insurance Association": (52.5170, 13.3889),
    "Hologic (Germany)": (50.0782, 8.2398),
    "IZA - Institute of Labor Economics": (50.7374, 7.0982),
    "Ifo Institute for Economic Research": (48.1351, 11.5820),
    "Johner Institut (Germany)": (47.6779, 9.1732),
    "LOEWE Centre for Translational Biodiversity Genomics": (50.1109, 8.6821),
    "Leibniz Institute for Agricultural Engineering and Bioeconomy": (52.3906, 13.0645),
    "Leibniz Institute of Photonic Technology": (50.9279, 11.5892),
    "Martin Luther University Halle-Wittenberg": (51.4970, 11.9683),
    "Max Planck Institute for Biophysical Chemistry": (51.5413, 9.9158),
    "Max Planck Institute for Comparative Public Law and International Law": (49.4093, 8.6725),
    "Max Planck Institute for Evolutionary Biology": (54.1614, 10.4221),
    "Max Planck Institute for Social Anthropology": (51.4970, 11.9683),
    "Max Planck Institute for the Science of Light": (49.5897, 11.0040),
    "Max Planck Institute for the Study of Crime, Security and Law": (47.9990, 7.8421),
    "Munich Leukemia Laboratory (Germany)": (48.1351, 11.5820),
    "Munich School of Philosophy": (48.1351, 11.5820),
    "National Center for Tumor Diseases": (49.4093, 8.6725),
    "Research Institute for Farm Animal Biology (FBN)": (53.9350, 12.2900),
    "Robert Bosch (Germany)": (48.8143, 9.1862),
    "Total (Germany)": (52.5170, 13.3889),
    "Trier University of Applied Sciences": (49.6081, 7.1693),
    "University Hospital Schleswig-Holstein": (54.3233, 10.1228),
    "University Hospitals of the Ruhr-University of Bochum": (51.4818, 7.2162),
    "University of Algiers Benyoucef Benkhedda": (36.7538, 3.0588),
    "University of Koblenz and Landau": (50.3569, 7.5890),
    "University of Würzburg": (49.7913, 9.9534),
    "Zeppelin Universität gemeinnützige GmbH": (47.6558, 9.4794),
    "Zoological Research Museum Alexander Koenig": (50.7374, 7.0982),
}

GERMANY_CENTER = (51.1657, 10.4515)

COUNTRY_CENTER_FALLBACK: dict[str, tuple[float, float]] = {
    "Alemanha": GERMANY_CENTER,
    "Gana": (7.9465, -1.0232),
    "Angola": (-11.2027, 17.8739),
    "África do Sul": (-28.8166, 24.9916),
    "Argélia": (28.0339, 1.6596),
    "Moçambique": (-18.6657, 35.5296),
    "Reino Unido": (52.4862, -1.8904),
}

GERMAN_CITY_HINTS: dict[str, tuple[float, float]] = {
    "jena": (50.9279, 11.5892), "erlangen": (49.5897, 11.0040),
    "göttingen": (51.5413, 9.9158), "goettingen": (51.5413, 9.9158),
    "marburg": (50.8090, 8.7685), "bonn": (50.7226, 7.1006),
    "bamberg": (49.8988, 10.9028), "lübeck": (53.8655, 10.6866),
    "luebeck": (53.8655, 10.6866), "siegen": (50.9106, 8.0169),
    "wuppertal": (51.2465, 7.1500), "darmstadt": (49.8728, 8.6512),
    "dresden": (51.0504, 13.7373), "leipzig": (51.3397, 12.3731),
    "münster": (51.9636, 7.6041), "muenster": (51.9636, 7.6041),
    "mainz": (49.9929, 8.2473), "hamburg": (53.5511, 9.9937),
    "berlin": (52.5170, 13.3889), "köln": (50.9375, 6.9603),
    "koeln": (50.9375, 6.9603), "cologne": (50.9375, 6.9603),
    "potsdam": (52.3906, 13.0645), "tübingen": (48.5216, 9.0576),
    "tuebingen": (48.5216, 9.0576),
}


def resolve_institution_coords(inst: str, country: str, geocoder: Geocoder) -> tuple[float | None, float | None]:
    lat, lon = geocoder.geocode(inst, None, country)
    if lat is not None:
        return lat, lon
    if inst in MANUAL_INSTITUTION_COORDS:
        return MANUAL_INSTITUTION_COORDS[inst]
    if country == "Alemanha":
        low = inst.lower()
        for city, coords in GERMAN_CITY_HINTS.items():
            if city in low:
                return coords
    return COUNTRY_CENTER_FALLBACK.get(country, (None, None))


def _raiz_projetos_dashboards(inicio: Path) -> Path:
    for p in [inicio, *inicio.parents]:
        if (p / "MATCHING").is_dir() and (p / "PADRONIZAÇAO").is_dir():
            return p
    raise RuntimeError("Raiz PROJETOS DASHBOARDS (com MATCHING/ e PADRONIZAÇAO/) não encontrada")


def carregar_ppgs_linhas() -> dict:
    raiz = _raiz_projetos_dashboards(Path(__file__).resolve())
    path = raiz / "DATA BASE UEA" / "PPGS_LINHAS" / "output" / "ppgs_linhas.json"
    if not path.exists():
        return {"ppgs": []}
    return json.loads(path.read_text(encoding="utf-8"))


def carregar_linha_matches() -> list[dict]:
    path = OUTPUT_DIR / "linha_matches.json"
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def _linhas_lattes_por_researcher(conn) -> dict[int, list[str]]:
    """researcher_id (deste banco) -> títulos de linha de pesquisa LIVRES do
    Lattes desse mesmo pesquisador (DATA BASE UEA/LATTES/data/gerbras.db,
    casando pelo lattes_id). Usado só pra tentar amarrar o professor a UMA
    linha CANÔNICA do próprio PPG (ver export_professores) — não confundir
    com a extração livre em si, que não é a lista oficial do PPG."""
    import sqlite3

    raiz = _raiz_projetos_dashboards(Path(__file__).resolve())
    lattes_db_path = raiz / "DATA BASE UEA" / "LATTES" / "data" / "gerbras.db"
    if not lattes_db_path.exists():
        return {}

    lattes_id_por_researcher = dict(conn.execute(
        "SELECT id, lattes_id FROM researchers WHERE lattes_id IS NOT NULL"
    ).fetchall())
    if not lattes_id_por_researcher:
        return {}

    lattes_con = sqlite3.connect(lattes_db_path)
    titulos_por_id_lattes: dict[str, list[str]] = defaultdict(list)
    for id_lattes, titulo in lattes_con.execute(
        """SELECT p.id_lattes, l.titulo FROM pesquisadores p
           JOIN pesquisador_linha pl ON pl.pesquisador_id = p.id
           JOIN linhas_pesquisa l ON l.id = pl.linha_id"""
    ).fetchall():
        if titulo not in titulos_por_id_lattes[id_lattes]:
            titulos_por_id_lattes[id_lattes].append(titulo)
    lattes_con.close()

    return {
        rid: titulos_por_id_lattes[id_lattes]
        for rid, id_lattes in lattes_id_por_researcher.items()
        if id_lattes in titulos_por_id_lattes
    }


def _melhores_matches_pt(itens_a: list[dict], itens_b: list[dict], top_k: int, limiar: float) -> list[dict]:
    """Roda MATCHING/matcher.py::melhores_matches (Sentence-BERT, PT-PT — ambos
    os lados passam por padronizar_termo, que traduz PT->EN antes de comparar,
    então funciona igual comparando dois textos em português) via subprocess
    no venv de MATCHING/."""
    if not itens_a or not itens_b:
        return []
    raiz = _raiz_projetos_dashboards(Path(__file__).resolve())
    matching_python = raiz / "MATCHING" / ".venv" / "bin" / "python"

    codigo = (
        "import json, sys\n"
        "sys.path.insert(0, %r)\n"
        "sys.path.insert(0, %r)\n"
        "from matcher import melhores_matches\n"
        "from padronizar import padronizar_termo\n"
        "itens_a, itens_b, top_k, limiar = json.load(sys.stdin)\n"
        "for it in itens_a + itens_b:\n"
        "    it['termo_padronizado'] = padronizar_termo(it['termo'], it.get('idioma', 'pt'))\n"
        "res = melhores_matches(itens_a, itens_b, top_k=top_k, limiar=limiar)\n"
        "json.dump(res, sys.stdout, ensure_ascii=False)\n"
    ) % (str(raiz / "MATCHING"), str(raiz / "PADRONIZAÇAO"))

    proc = subprocess.run(
        [str(matching_python), "-c", codigo],
        input=json.dumps([itens_a, itens_b, top_k, limiar], ensure_ascii=False),
        capture_output=True, text=True,
    )
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        print(proc.stderr, file=sys.stderr)
        return []


def export_professores(conn, ppgs_por_codigo: dict[str, list[dict]]) -> list[dict]:
    rows = conn.execute(
        """SELECT id, nome, orcid, universidade, cidade, uf, pais, latitude, longitude, programa
           FROM researchers"""
    ).fetchall()

    n_pubs = dict(conn.execute(
        "SELECT researcher_id, COUNT(*) FROM publications GROUP BY researcher_id"
    ).fetchall())

    professores = []
    for rid, nome, orcid, universidade, cidade, uf, pais, lat, lon, programa in rows:
        programas = [p.strip() for p in (programa or "").split(",") if p.strip()]
        professores.append({
            "id": rid, "nome": nome, "orcid": orcid, "universidade": universidade,
            "cidade": cidade, "uf": uf, "pais": pais, "lat": lat, "lon": lon,
            "programas": programas,
            "linhas_canonicas": [],
            "n_publicacoes": n_pubs.get(rid, 0),
        })

    # tenta amarrar cada professor a uma linha canônica do(s) seu(s) PPG(s),
    # a partir das linhas livres extraídas do Lattes (ver _linhas_lattes_por_researcher)
    linhas_livres = _linhas_lattes_por_researcher(conn)
    itens_a = []
    a_por_rid: dict[str, tuple[int, str]] = {}
    for prof in professores:
        titulos = linhas_livres.get(prof["id"])
        if not titulos:
            continue
        candidatas_ids = {l["id"] for codigo in prof["programas"] for l in ppgs_por_codigo.get(codigo, [])}
        if not candidatas_ids:
            continue
        for i, titulo in enumerate(titulos):
            item_id = f"{prof['id']}|{i}"
            itens_a.append({"id": item_id, "termo": titulo, "idioma": "pt"})
            a_por_rid[item_id] = (prof["id"], titulo)

    if itens_a:
        todas_linhas = [
            {"id": l["id"], "termo": l["titulo"], "idioma": "pt"}
            for linhas in ppgs_por_codigo.values() for l in linhas
        ]
        resultados = _melhores_matches_pt(itens_a, todas_linhas, top_k=5, limiar=0.30)
        prof_por_id = {p["id"]: p for p in professores}
        linha_ppg_por_id = {
            l["id"]: codigo for codigo, linhas in ppgs_por_codigo.items() for l in linhas
        }
        for r in resultados:
            rid, _titulo = a_por_rid[r["id"]]
            prof = prof_por_id[rid]
            for cand in r.get("matches", []):
                if cand["score"] < LINHA_CANONICA_LIMIAR:
                    continue
                if linha_ppg_por_id.get(cand["id"]) not in prof["programas"]:
                    continue
                if cand["id"] not in prof["linhas_canonicas"]:
                    prof["linhas_canonicas"].append(cand["id"])

    return professores


def export_institutions(linha_matches: list[dict], geocoder: Geocoder) -> list[dict]:
    agg: dict[tuple[str, str], dict] = {}
    for m in linha_matches:
        inst, country = m.get("foreign_institution"), m.get("foreign_country")
        if not inst:
            continue
        key = (inst, country)
        bucket = agg.setdefault(key, {"n_matches": 0, "autores": set()})
        bucket["n_matches"] += 1
        if m.get("foreign_author_openalex_id"):
            bucket["autores"].add(m["foreign_author_openalex_id"])

    out = []
    for (inst, country), bucket in agg.items():
        lat, lon = resolve_institution_coords(inst, country, geocoder)
        out.append({
            "instituicao": inst, "pais": country, "lat": lat, "lon": lon,
            "n_matches": bucket["n_matches"], "n_researchers": len(bucket["autores"]),
        })
    return out


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = db.connect()
    geocoder = Geocoder()

    ppgs_linhas = carregar_ppgs_linhas()
    ppgs_por_codigo = {p["codigo"]: p["linhas"] for p in ppgs_linhas["ppgs"]}

    professores = export_professores(conn, ppgs_por_codigo)
    linha_matches = carregar_linha_matches()
    institutions = export_institutions(linha_matches, geocoder)

    dashboard = {
        "ppgs": [
            {"codigo": p["codigo"], "nome": p["nome"], "linhas": p["linhas"]}
            for p in ppgs_linhas["ppgs"]
        ],
        "professores": professores,
        "linha_matches": linha_matches,
        "institutions": institutions,
        "manaus": MANAUS,
    }
    (DATA_DIR / "dashboard.json").write_text(
        json.dumps(dashboard, ensure_ascii=False, indent=None), encoding="utf-8"
    )

    n_com_linha = sum(1 for p in professores if p["linhas_canonicas"])
    print(f"dashboard.json -> {len(dashboard['ppgs'])} PPGs, {len(professores)} professores "
          f"({n_com_linha} com linha canônica identificada), {len(linha_matches)} matches, "
          f"{len(institutions)} instituições estrangeiras")
    print(f"pasta de saída: {DATA_DIR}")

    conn.close()


if __name__ == "__main__":
    main()
