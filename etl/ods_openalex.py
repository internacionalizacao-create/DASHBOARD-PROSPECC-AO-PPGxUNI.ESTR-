"""
Força de cada universidade estrangeira por ODS, via OpenAlex (passo 1 de
PROJETOS DASHBOARDS/ODS/estrategia.txt).

Para cada fonte de etl/linha_match.py FONTES que tem institution_id, conta os
trabalhos da janela (mesmo from_year do matching: hoje - YEARS_BACK) classificados
em cada ODS pelo classificador do OpenAlex, com um único group_by por instituição:

    /works?filter=institutions.id:<ID>,from_publication_date:<ano>-01-01,
           sustainable_development_goals.score:>LIMIAR
          &group_by=sustainable_development_goals.id

+ 1 chamada com o mesmo filtro sem o limiar de ODS (total de trabalhos, que é o
denominador da participação percentual) + 1 chamada em /institutions/<ID> só
para pegar o display_name (é o nome que aparece em linha_matches, então é a
chave de junção com o dashboard). ~3 chamadas por instituição, ~33 para as 11 de
Singapura. Alemanha é filtrada por país e não entra (não é "universidade").

Consultas independentes do matching: cada busca do matching devolve no máximo 8
resultados por frase e portanto NÃO serve como medida de força.

Resultado em data/ods_openalex.json; depois rode etl/ods_classify.py de novo
para o bloco "openalex" entrar em data/ods.json (e a página ODS mostrar a
participação % e o índice de especialização).

Cache em cache/ods_openalex_cache.json: rodar de novo só refaz o que faltou.
Em HTTP 429 (créditos/cota) aborta sem gravar a chamada — nada é envenenado.

Uso:
    python3 etl/ods_openalex.py                 # todas as fontes com institution_id
    python3 etl/ods_openalex.py --pais Singapura
    python3 etl/ods_openalex.py --dry-run       # só lista as URLs, sem chamar a API
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from linha_match import API_KEY, CONTACT_EMAIL, FONTES, REPO_ROOT, YEARS_BACK  # noqa: E402

BASE = "https://api.openalex.org"
LIMIAR_SCORE_ODS = 0.4   # score mínimo do OpenAlex p/ contar o trabalho num ODS (multi-rótulo infla sem isso)
DELAY_S = 0.15
CACHE_PATH = REPO_ROOT / "cache" / "ods_openalex_cache.json"
OUTPUT_PATH = REPO_ROOT / "data" / "ods_openalex.json"


class CotaEsgotada(RuntimeError):
    pass


def _get(path: str, params: dict, cache: dict, dry_run: bool) -> dict | None:
    params = {**params, "mailto": CONTACT_EMAIL, "api_key": API_KEY}
    url = f"{BASE}/{path}?{urllib.parse.urlencode(params, safe=':>,')}"
    chave = url.replace(API_KEY, "KEY")
    if chave in cache:
        return cache[chave]
    if dry_run:
        print("  [dry-run]", chave, file=sys.stderr)
        return None
    try:
        with urllib.request.urlopen(url, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code in (402, 429):
            raise CotaEsgotada(f"OpenAlex HTTP {e.code} (créditos/cota). Nada gravado no cache para esta chamada.") from e
        print(f"  HTTP {e.code} em {chave}", file=sys.stderr)
        return None
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        print(f"  erro de rede em {chave}: {e}", file=sys.stderr)
        return None
    cache[chave] = data
    time.sleep(DELAY_S)
    return data


def coletar(fontes: list[dict], from_year: int, dry_run: bool) -> dict:
    cache = json.loads(CACHE_PATH.read_text(encoding="utf-8")) if CACHE_PATH.exists() else {}
    saida = {}
    try:
        for f in fontes:
            iid = f["institution_id"]
            print(f"{f['id']} ({iid})", file=sys.stderr)
            base = f"institutions.id:{iid},from_publication_date:{from_year}-01-01"
            inst = _get(f"institutions/{iid}", {"select": "id,display_name"}, cache, dry_run)
            total = _get("works", {"filter": base, "per-page": "1", "select": "id"}, cache, dry_run)
            por_ods = _get("works", {
                "filter": f"{base},sustainable_development_goals.score:>{LIMIAR_SCORE_ODS}",
                "group_by": "sustainable_development_goals.id",
            }, cache, dry_run)
            if not (inst and total and por_ods):
                continue
            ods = {}
            for g in por_ods.get("group_by", []):
                n = str(g["key"]).rsplit("/", 1)[-1]  # https://metadata.un.org/sdg/3 -> "3"
                if n.isdigit():
                    ods[n] = g["count"]
            saida[inst["display_name"]] = {
                "fonte": f["id"], "pais": f["pais"], "openalex_id": iid,
                "total_trabalhos": total["meta"]["count"], "ods": ods,
            }
    finally:
        if not dry_run:
            CACHE_PATH.parent.mkdir(exist_ok=True)
            CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    return saida


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pais", help="só as fontes desse país (ex.: Singapura)")
    ap.add_argument("--from-year", type=int, default=date.today().year - YEARS_BACK)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    fontes = [f for f in FONTES if f["institution_id"] and (not args.pais or f["pais"] == args.pais)]
    print(f"{len(fontes)} instituições, janela desde {args.from_year}", file=sys.stderr)
    try:
        instituicoes = coletar(fontes, args.from_year, args.dry_run)
    except CotaEsgotada as e:
        sys.exit(f"ERRO: {e}\nO que já foi coletado ficou em {CACHE_PATH}; rode de novo quando houver créditos.")
    if args.dry_run:
        return

    resultado = {
        "gerado_em": date.today().isoformat(),
        "from_year": args.from_year,
        "limiar_score_ods": LIMIAR_SCORE_ODS,
        "instituicoes": instituicoes,
    }
    OUTPUT_PATH.write_text(json.dumps(resultado, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"gravado {OUTPUT_PATH} ({len(instituicoes)} instituições). Rode etl/ods_classify.py para integrar em data/ods.json.",
          file=sys.stderr)


if __name__ == "__main__":
    main()
