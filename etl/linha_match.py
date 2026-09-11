"""Match de LINHA DE PESQUISA (nome + descrição oficial do PPG) x pesquisadores
estrangeiros, via OpenAlex + rerank semântico (Sentence-BERT).

Substitui o critério antigo (keywords OpenAlex do histórico de publicações de UM
professor) por um critério por linha: o texto oficial da linha (título + descrição,
de DATA BASE UEA/PPGS_LINHAS/output/ppgs_linhas.json) vira a "assinatura" comparada
contra o `sample_title` de cada candidato estrangeiro — o mesmo mecanismo de
MATCHING/rerank.py já usado pelos scripts *_match.py por país, só trocando a origem
do texto de busca. Um match de linha vale para TODOS os professores daquele PPG,
não para um professor isolado.

Fontes (mesmos alvos já usados pelos scripts *_match.py existentes, reaproveitando
os arquivos de cache já populados de cada um — só adiciona chaves novas):
  Alemanha (país inteiro), Gana (University of Ghana), Argélia (Univ. of Algiers),
  Moçambique (Eduardo Mondlane), África do Sul (Johannesburg + Stellenbosch),
  Angola (Katyavala Bwila), Reino Unido (8 universidades).

Uso:
    ./etl_venv_or_system_python3 etl/linha_match.py [--limit N] [--fontes ALE,GHA,...]
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent  # .../DASHBOARD PROSPECÇAO PPGxUNI.ESTR
DASHBOARDS_ROOT = REPO_ROOT.parents[1]  # .../PROJETOS DASHBOARDS

PPGS_LINHAS_PATH = DASHBOARDS_ROOT / "DATA BASE UEA" / "PPGS_LINHAS" / "output" / "ppgs_linhas.json"
OUTPUT_PATH = REPO_ROOT / "output" / "linha_matches.json"

PADRONIZACAO_PY = DASHBOARDS_ROOT / "PADRONIZAÇAO" / ".venv" / "bin" / "python"
PADRONIZACAO_SCRIPT = DASHBOARDS_ROOT / "PADRONIZAÇAO" / "padronizar.py"
MATCHING_PY = DASHBOARDS_ROOT / "MATCHING" / ".venv" / "bin" / "python"
RERANK_SCRIPT = DASHBOARDS_ROOT / "MATCHING" / "rerank.py"

OPENALEX_URL = "https://api.openalex.org/works"
CONTACT_EMAIL = "oticapinheiro.admin@gmail.com"
API_KEY = "e20KHEj9oLRTjzBsp4QFI9"
REQUEST_DELAY_S = 0.12
RESULTS_PER_KEYWORD = 8
YEARS_BACK = 5

TOP_MATCHES_PER_LINHA = MAX_CANDIDATOS_POR_LINHA = 60  # sem corte artificial: todos os candidatos rankeados entram
MAX_FRASES_POR_LINHA = 5

GENERIC_KEYWORDS_STOPLIST = {
    "biology", "chemistry", "physics", "medicine", "geography", "ecology",
    "geology", "mathematics", "engineering", "sociology", "psychology",
    "computer science", "environmental science", "materials science",
    "genetics", "biochemistry", "political science", "economics",
    "environmental chemistry", "agronomy", "botany", "pathology",
    "immunology", "microbiology", "philosophy", "history", "art",
    "humanities", "research", "study", "studies", "analysis", "development",
    "education", "health", "science", "sciences", "technology", "society",
    "process", "processes", "management", "public",
}

# Mesmos alvos dos scripts WEBSCRAPING/*/etl/*_match.py e etl/germany_match.py —
# reaproveita o cache de cada um (arquivo já populado por aquisições anteriores).
FONTES = [
    {"id": "ALE", "pais": "Alemanha", "country_code": "DE", "institution_id": None,
     "cache": REPO_ROOT / "cache" / "germany_match_cache.json"},
    {"id": "GHA", "pais": "Gana", "country_code": None, "institution_id": "I138690464",
     "cache": DASHBOARDS_ROOT / "WEBSCRAPING" / "GHANA" / "cache" / "ghana_match_cache.json"},
    {"id": "DZA", "pais": "Argélia", "country_code": None, "institution_id": "I192268740",
     "cache": DASHBOARDS_ROOT / "WEBSCRAPING" / "ARGELIA" / "cache" / "ualger_match_cache.json"},
    {"id": "MOZ", "pais": "Moçambique", "country_code": None, "institution_id": "I16904388",
     "cache": DASHBOARDS_ROOT / "WEBSCRAPING" / "MOÇAMBIQUE " / "cache" / "uem_match_cache.json"},
    {"id": "ZAF-UJ", "pais": "África do Sul", "country_code": None, "institution_id": "I24027795",
     "cache": DASHBOARDS_ROOT / "WEBSCRAPING" / "ÁFRICA DO SUL" / "cache" / "uj_match_cache.json"},
    {"id": "ZAF-SUN", "pais": "África do Sul", "country_code": None, "institution_id": "I26092322",
     "cache": DASHBOARDS_ROOT / "WEBSCRAPING" / "ÁFRICA DO SUL" / "Universidade de Stellenbosch " / "cache" / "stellenbosch_match_cache.json"},
    {"id": "AGO", "pais": "Angola", "country_code": None, "institution_id": "I4210120595",
     "cache": DASHBOARDS_ROOT / "WEBSCRAPING" / "ANGOLA" / "Universidade Katyavala Bwila" / "cache" / "katyavala_match_cache.json"},
    {"id": "GBR-BHM", "pais": "Reino Unido", "country_code": None, "institution_id": "I79619799",
     "cache": DASHBOARDS_ROOT / "WEBSCRAPING" / "REINO UNIDO" / "University of Birmingham" / "cache" / "birmingham_match_cache.json"},
    {"id": "GBR-WAR", "pais": "Reino Unido", "country_code": None, "institution_id": "I39555362",
     "cache": DASHBOARDS_ROOT / "WEBSCRAPING" / "REINO UNIDO" / "University of Warwick" / "cache" / "warwick_match_cache.json"},
    {"id": "GBR-COV", "pais": "Reino Unido", "country_code": None, "institution_id": "I73417466",
     "cache": DASHBOARDS_ROOT / "WEBSCRAPING" / "REINO UNIDO" / "Coventry University" / "cache" / "coventry_match_cache.json"},
    {"id": "GBR-ICL", "pais": "Reino Unido", "country_code": None, "institution_id": "I47508984",
     "cache": DASHBOARDS_ROOT / "WEBSCRAPING" / "REINO UNIDO" / "Imperial College London" / "cache" / "imperial_match_cache.json"},
    {"id": "GBR-KCL", "pais": "Reino Unido", "country_code": None, "institution_id": "I183935753",
     "cache": DASHBOARDS_ROOT / "WEBSCRAPING" / "REINO UNIDO" / "King's College London" / "cache" / "kcl_match_cache.json"},
    {"id": "GBR-CAM", "pais": "Reino Unido", "country_code": None, "institution_id": "I241749",
     "cache": DASHBOARDS_ROOT / "WEBSCRAPING" / "REINO UNIDO" / "University of Cambridge" / "cache" / "cambridge_match_cache.json"},
    {"id": "GBR-QMUL", "pais": "Reino Unido", "country_code": None, "institution_id": "I166337079",
     "cache": DASHBOARDS_ROOT / "WEBSCRAPING" / "REINO UNIDO" / "Queen Mary University of London" / "cache" / "qmul_match_cache.json"},
    {"id": "GBR-STA", "pais": "Reino Unido", "country_code": None, "institution_id": "I16835326",
     "cache": DASHBOARDS_ROOT / "WEBSCRAPING" / "REINO UNIDO" / "University of St Andrews" / "cache" / "standrews_match_cache.json"},
]


class ForeignMatcher:
    """Generaliza GermanyMatcher/GhanaMatcher/etc: filtra por country_code OU por
    institution_id (nunca os dois), reaproveitando o cache em disco de cada fonte."""

    def __init__(self, cache_path: Path, country_code: str | None, institution_id: str | None):
        self.cache_path = cache_path
        self.country_code = country_code
        self.institution_id = institution_id
        self._cache: dict[str, list[dict]] = {}
        if self.cache_path.exists():
            self._cache = json.loads(self.cache_path.read_text(encoding="utf-8"))

    def _save(self) -> None:
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        self.cache_path.write_text(
            json.dumps(self._cache, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def candidates_for_keyword(self, keyword: str, from_year: int) -> list[dict]:
        chave_filtro = self.country_code or self.institution_id
        cache_key = f"{keyword.lower()}|{chave_filtro}|{from_year}"
        if cache_key in self._cache:
            return self._cache[cache_key]
        candidates = self._fetch(keyword, from_year)
        self._cache[cache_key] = candidates
        self._save()
        return candidates

    def _fetch(self, keyword: str, from_year: int) -> list[dict]:
        filtro = (
            f"institutions.country_code:{self.country_code}"
            if self.country_code
            else f"institutions.id:{self.institution_id}"
        )
        params = {
            "search": keyword,
            "filter": f"{filtro},from_publication_date:{from_year}-01-01",
            "per-page": str(RESULTS_PER_KEYWORD),
            "select": "id,doi,title,publication_year,authorships",
            "mailto": CONTACT_EMAIL,
            "api_key": API_KEY,
        }
        url = f"{OPENALEX_URL}?{urllib.parse.urlencode(params)}"
        try:
            with urllib.request.urlopen(url, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, ValueError):
            return []
        time.sleep(REQUEST_DELAY_S)

        out = []
        for w in data.get("results", []):
            doi = w.get("doi")
            if doi:
                doi = doi.replace("https://doi.org/", "")
            for a in w.get("authorships", []):
                institutions = a.get("institutions") or []
                if self.country_code:
                    alvo = [i for i in institutions if i.get("country_code") == self.country_code]
                else:
                    alvo = [
                        i for i in institutions
                        if i.get("id", "").rsplit("/", 1)[-1] == self.institution_id
                    ]
                if not alvo:
                    continue
                author = a.get("author") or {}
                orcid = author.get("orcid")
                if orcid:
                    orcid = orcid.replace("https://orcid.org/", "")
                out.append({
                    "openalex_id": author.get("id"),
                    "nome": author.get("display_name"),
                    "orcid": orcid,
                    "instituicao": alvo[0]["display_name"],
                    "sample_title": w.get("title"),
                    "sample_doi": doi,
                })
        return out


def carregar_linhas() -> list[dict]:
    data = json.loads(PPGS_LINHAS_PATH.read_text(encoding="utf-8"))
    linhas = []
    for ppg in data["ppgs"]:
        for linha in ppg["linhas"]:
            linhas.append({
                "linha_id": linha["id"],
                "ppg_codigo": ppg["codigo"],
                "titulo": linha["titulo"],
                "descricao": linha["descricao"],
            })
    return linhas


def derivar_frases_pt(titulo: str, descricao: str | None) -> list[str]:
    """Frases curtas (3-10 palavras) derivadas da descrição, pra diversificar a
    busca OpenAlex além do título isolado (descrições costumam ter várias
    sub-ideias separadas por ; ou .)."""
    texto = descricao or ""
    partes = re.split(r"[;.]", texto)
    frases = []
    for p in partes:
        p = p.strip(" ,:-")
        n_palavras = len(p.split())
        if 3 <= n_palavras <= 12:
            frases.append(p)
    return [titulo] + frases[:MAX_FRASES_POR_LINHA]


def traduzir_em_lote(termos_pt: list[str]) -> dict[str, str]:
    """Uma única chamada ao padronizar.py --traduzir pra todos os termos de
    todas as linhas de uma vez (evita 1 subprocess por termo)."""
    unicos = sorted(set(t for t in termos_pt if t.strip()))
    if not unicos:
        return {}
    with tempfile.TemporaryDirectory() as tmp:
        entrada = Path(tmp) / "entrada.json"
        entrada.write_text(json.dumps(unicos, ensure_ascii=False), encoding="utf-8")
        proc = subprocess.run(
            [str(PADRONIZACAO_PY), str(PADRONIZACAO_SCRIPT), "--traduzir", "pt", "en", str(entrada)],
            capture_output=True, text=True, check=True,
        )
    return json.loads(proc.stdout)


def limpar_frase_busca(frase_en: str) -> str | None:
    frase = frase_en.strip().lower()
    if not frase or frase in GENERIC_KEYWORDS_STOPLIST:
        return None
    return frase_en.strip()


def rerank_semantico_em_lote(itens: list[dict], top_n: int) -> list[list[dict]]:
    if not itens:
        return []
    with tempfile.TemporaryDirectory() as tmp:
        entrada = Path(tmp) / "entrada.json"
        entrada.write_text(json.dumps(itens, ensure_ascii=False), encoding="utf-8")
        proc = subprocess.run(
            [str(MATCHING_PY), str(RERANK_SCRIPT), "--batch", str(entrada), str(top_n)],
            capture_output=True, text=True,
        )
    # torch/libomp às vezes aborta no teardown do processo (SIGABRT) DEPOIS de já
    # ter escrito o JSON completo em stdout — checa se o stdout é válido antes de
    # tratar como erro, em vez de confiar só no returncode.
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        print(proc.stderr, file=sys.stderr)
        raise RuntimeError(f"rerank.py --batch falhou (returncode={proc.returncode}) sem stdout JSON válido")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None, help="processa só as N primeiras linhas (debug)")
    ap.add_argument("--fontes", type=str, default=None, help="lista de ids de FONTES separada por vírgula (default: todas)")
    ap.add_argument("--from-year", type=int, default=date.today().year - YEARS_BACK)
    args = ap.parse_args()

    linhas = carregar_linhas()
    if args.limit:
        linhas = linhas[: args.limit]

    fontes = FONTES
    if args.fontes:
        ids = set(args.fontes.split(","))
        fontes = [f for f in FONTES if f["id"] in ids]

    print(f"[linha_match] {len(linhas)} linhas de pesquisa, {len(fontes)} fontes estrangeiras")

    # 1) tradução em lote (título + descrição inteira + frases derivadas)
    print("[linha_match] traduzindo título+descrição de cada linha (PT->EN, offline, Argos)...")
    termos_pt: list[str] = []
    frases_por_linha: dict[str, list[str]] = {}
    combinado_por_linha: dict[str, str] = {}
    for linha in linhas:
        frases = derivar_frases_pt(linha["titulo"], linha["descricao"])
        frases_por_linha[linha["linha_id"]] = frases
        termos_pt.extend(frases)
        combinado = linha["titulo"] + (f". {linha['descricao']}" if linha["descricao"] else "")
        combinado_por_linha[linha["linha_id"]] = combinado
        termos_pt.append(combinado)

    traducoes = traduzir_em_lote(termos_pt)

    linha_por_id = {}
    for linha in linhas:
        frases_en = []
        for f in frases_por_linha[linha["linha_id"]]:
            en = traducoes.get(f, f)
            limpo = limpar_frase_busca(en)
            if limpo and limpo not in frases_en:
                frases_en.append(limpo)
        combinado_en = traducoes.get(combinado_por_linha[linha["linha_id"]], combinado_por_linha[linha["linha_id"]])
        linha_por_id[linha["linha_id"]] = {
            **linha,
            "frases_busca_en": frases_en,
            "rerank_keywords": list(dict.fromkeys(frases_en + [combinado_en])),
        }

    # 2) aquisição de candidatos por fonte + linha
    todos_matches: list[dict] = []
    for fonte in fontes:
        print(f"\n[linha_match] fonte: {fonte['id']} ({fonte['pais']})")
        matcher = ForeignMatcher(fonte["cache"], fonte["country_code"], fonte["institution_id"])

        fila = []
        for linha in linhas:
            info = linha_por_id[linha["linha_id"]]
            candidatos_por_id: dict[str, dict] = {}
            for frase in info["frases_busca_en"]:
                for cand in matcher.candidates_for_keyword(frase, args.from_year):
                    if not cand.get("openalex_id") or not cand.get("nome"):
                        continue
                    candidatos_por_id.setdefault(cand["openalex_id"], cand)
            candidatos = list(candidatos_por_id.values())[:MAX_CANDIDATOS_POR_LINHA]
            fila.append({
                "linha_id": linha["linha_id"], "ppg_codigo": linha["ppg_codigo"],
                "keywords": info["rerank_keywords"], "candidatos": candidatos,
            })
            print(f"  {linha['linha_id']} ({linha['titulo'][:40]}) -> {len(candidatos)} candidatos brutos")

        print(f"[linha_match] rankeando {len(fila)} linhas via Sentence-BERT (MATCHING/rerank.py --batch)...")
        ranqueados = rerank_semantico_em_lote(
            [{"keywords": f["keywords"], "candidatos": f["candidatos"]} for f in fila],
            TOP_MATCHES_PER_LINHA,
        )

        for f, matches in zip(fila, ranqueados):
            for m in matches:
                todos_matches.append({
                    "linha_id": f["linha_id"],
                    "ppg_codigo": f["ppg_codigo"],
                    "foreign_author_name": m.get("nome"),
                    "foreign_author_orcid": m.get("orcid"),
                    "foreign_author_openalex_id": m.get("openalex_id"),
                    "foreign_institution": m.get("instituicao"),
                    "foreign_country": fonte["pais"],
                    "score": m.get("score"),
                    "sample_work_title": m.get("sample_title"),
                    "sample_work_doi": m.get("sample_doi"),
                })

        # grava progressivamente após cada fonte — uma fonte que falhe no meio
        # (rede/timeout) não derruba o trabalho já feito nas fontes anteriores.
        OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT_PATH.write_text(json.dumps(todos_matches, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[linha_match] progresso salvo em {OUTPUT_PATH} ({len(todos_matches)} matches até agora)")

    linhas_com_match = len({m["linha_id"] for m in todos_matches})
    print("\n========== RESUMO ==========")
    print(f"Linhas de pesquisa processadas : {len(linhas)}")
    print(f"Linhas com ao menos 1 match     : {linhas_com_match}")
    print(f"Total de matches gravados       : {len(todos_matches)}")
    print(f"Arquivo                         : {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
