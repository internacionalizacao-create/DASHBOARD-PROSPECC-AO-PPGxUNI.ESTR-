"""
Classifica as linhas de pesquisa oficiais da UEA nos 17 ODS (ONU) e monta
data/ods.json — a base da página docs/ods.html.

Passos (ver PROJETOS DASHBOARDS/ODS/estrategia.txt, passo 2 e parte do 3):
  1. Traduz título+descrição de cada linha para inglês (Argos, offline —
     mesmo PADRONIZAÇAO/padronizar.py usado no matching).
  2. Embeda linha e ODS com Sentence-BERT (all-MiniLM-L6-v2, o mesmo de
     MATCHING/) e compara por cosseno. Roda 100% offline, sem API.
  3. Cada linha fica com até MAX_ODS_POR_LINHA ODS: os que passam do limiar
     absoluto MIN_SIM e ficam a até MARGEM_TOP do melhor ODS da linha. O peso
     é a similaridade normalizada entre os ODS mantidos (soma 1).
  4. Cruza com linha_matches.json: para cada instituição estrangeira × ODS,
     quantos pesquisadores DISTINTOS tiveram match de score alto (>= SCORE_ALTO)
     com linhas da UEA daquele ODS. É a metade "tem gente concreta para
     contatar" do passo 3 — a metade "força da universidade no ODS" depende do
     OpenAlex e é preenchida por etl/ods_openalex.py (bloco "openalex").

Uso (precisa do venv do MATCHING, que tem torch/sentence-transformers/argos):

    MATCHING/.venv/bin/python etl/ods_classify.py
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DASHBOARDS_ROOT = REPO_ROOT.parents[1]

PPGS_LINHAS_PATH = DASHBOARDS_ROOT / "DATA BASE UEA" / "PPGS_LINHAS" / "output" / "ppgs_linhas.json"
DASHBOARD_JSON = REPO_ROOT / "data" / "dashboard.json"
OUTPUT_PATH = REPO_ROOT / "data" / "ods.json"
OPENALEX_PATH = REPO_ROOT / "data" / "ods_openalex.json"  # gerado por etl/ods_openalex.py

sys.path.insert(0, str(DASHBOARDS_ROOT / "PADRONIZAÇAO"))
sys.path.insert(0, str(DASHBOARDS_ROOT / "MATCHING"))

MIN_SIM = 0.20          # similaridade mínima (cosseno) para a linha "pertencer" a um ODS
MARGEM_TOP = 0.06       # só entram ODS a até essa distância do melhor da linha
MAX_ODS_POR_LINHA = 3
SCORE_ALTO = 0.50       # match "forte" no matching linha × pesquisador estrangeiro
MAX_CHARS_DESCRICAO = 500

# n, cor oficial, nome curto (igual ao da imagem), meta oficial, texto em inglês p/ o SBERT
ODS = [
    (1, "#E5243B", "Erradicação da pobreza",
     "Acabar com a pobreza em todas as suas formas, em todos os lugares.",
     "No poverty: end poverty in all its forms, social protection, vulnerable and low-income populations, "
     "basic services, resilience of the poor, deprivation and social vulnerability"),
    (2, "#DDA63A", "Fome zero e agricultura sustentável",
     "Acabar com a fome, alcançar a segurança alimentar e melhoria da nutrição e promover a agricultura sustentável.",
     "Zero hunger: end hunger, food security, nutrition, sustainable agriculture, small-scale farmers, crop "
     "productivity, agroecology, food systems, seeds, soil and livestock"),
    (3, "#4C9F38", "Saúde e bem-estar",
     "Assegurar uma vida saudável e promover o bem-estar para todas e todos, em todas as idades.",
     "Good health and well-being: healthy lives, infectious and neglected tropical diseases, malaria, "
     "mental health, maternal and child health, public health, medicine, drugs, vaccines, health care"),
    (4, "#C5192D", "Educação de qualidade",
     "Assegurar a educação inclusiva e equitativa e de qualidade, e promover oportunidades de aprendizagem ao longo da vida.",
     "Quality education: inclusive and equitable education, learning, teaching and teacher training, "
     "schools, curriculum, higher education, literacy, lifelong learning"),
    (5, "#FF3A21", "Igualdade de gênero",
     "Alcançar a igualdade de gênero e empoderar todas as mulheres e meninas.",
     "Gender equality: empower women and girls, discrimination and violence against women, gender roles, "
     "women in leadership and science, reproductive rights"),
    (6, "#26BDE2", "Água potável e saneamento",
     "Assegurar a disponibilidade e gestão sustentável da água e saneamento para todas e todos.",
     "Clean water and sanitation: drinking water, sanitation, wastewater treatment, water quality and "
     "pollution, water resources management, rivers, watersheds, hygiene"),
    (7, "#FCC30B", "Energia limpa e acessível",
     "Assegurar o acesso confiável, sustentável, moderno e a preço acessível à energia para todas e todos.",
     "Affordable and clean energy: renewable energy, solar, wind, hydropower, biomass and biofuels, "
     "energy efficiency, electricity access, energy storage, fuel"),
    (8, "#A21942", "Trabalho decente e crescimento econômico",
     "Promover o crescimento econômico sustentado, inclusivo e sustentável, emprego pleno e trabalho decente.",
     "Decent work and economic growth: economic growth, employment, labour, entrepreneurship, "
     "productivity, tourism, small businesses, finance, sustainable economy"),
    (9, "#FD6925", "Indústria, inovação e infraestrutura",
     "Construir infraestruturas resilientes, promover a industrialização inclusiva e sustentável e fomentar a inovação.",
     "Industry, innovation and infrastructure: resilient infrastructure, industrialization, technological "
     "innovation, scientific research and development, engineering, materials, computing, telecommunications"),
    (10, "#DD1367", "Redução das desigualdades",
     "Reduzir a desigualdade dentro dos países e entre eles.",
     "Reduced inequalities: social, economic and racial inequality, inclusion, indigenous and traditional "
     "peoples, migration, discrimination, marginalized communities, income distribution"),
    (11, "#FD9D24", "Cidades e comunidades sustentáveis",
     "Tornar as cidades e os assentamentos humanos inclusivos, seguros, resilientes e sustentáveis.",
     "Sustainable cities and communities: urban planning, housing, public transport, cultural and natural "
     "heritage, disaster risk reduction, urban air quality, waste management, public spaces"),
    (12, "#BF8B2E", "Consumo e produção responsáveis",
     "Assegurar padrões de produção e de consumo sustentáveis.",
     "Responsible consumption and production: sustainable production, natural resource efficiency, waste "
     "reduction, recycling and reuse, circular economy, chemicals management, sustainable supply chains"),
    (13, "#3F7E44", "Ação contra a mudança global do clima",
     "Tomar medidas urgentes para combater a mudança climática e seus impactos.",
     "Climate action: climate change mitigation and adaptation, greenhouse gas emissions, carbon cycle, "
     "global warming, climate modelling, extreme events, climate policy"),
    (14, "#0A97D9", "Vida na água",
     "Conservação e uso sustentável dos oceanos, dos mares e dos recursos marinhos.",
     "Life below water: oceans, seas and marine resources, fisheries and aquaculture, aquatic ecosystems, "
     "coral reefs, marine biodiversity, freshwater fish, ocean acidification"),
    (15, "#56C02B", "Vida terrestre",
     "Proteger, recuperar e promover o uso sustentável dos ecossistemas terrestres, gerir florestas e deter a perda de biodiversidade.",
     "Life on land: terrestrial ecosystems, forests, deforestation, biodiversity loss, conservation, "
     "wildlife and endangered species, land degradation, soil, ecology, Amazon rainforest"),
    (16, "#00689D", "Paz, justiça e instituições eficazes",
     "Promover sociedades pacíficas e inclusivas, proporcionar acesso à justiça e construir instituições eficazes.",
     "Peace, justice and strong institutions: rule of law, access to justice, violence and crime, corruption, "
     "governance, public policy and institutions, human rights, transparency"),
    (17, "#19486A", "Parcerias e meios de implementação",
     "Fortalecer os meios de implementação e revitalizar a parceria global para o desenvolvimento sustentável.",
     "Partnerships for the goals: international cooperation, global partnerships, technology transfer, "
     "capacity building, data and statistics, science-technology-innovation cooperation, development finance"),
]


def _texto_linha(linha: dict) -> str:
    desc = (linha.get("descricao") or "").replace("\n", " ").strip()
    # o texto "Área de Concentração ..." repetido em todas as linhas de um PPG
    # puxa todas para o mesmo ODS — fica de fora
    desc = desc.split("Área de Concentração")[0].strip()
    return f"{linha['titulo']}. {desc[:MAX_CHARS_DESCRICAO]}"


def classificar_linhas(ppgs: list[dict]) -> dict[str, dict]:
    from padronizar import traduzir
    from matcher import carregar_modelo, embed_termos
    from sentence_transformers import util

    linhas = [
        {**l, "ppg_codigo": p["codigo"], "ppg_nome": p["nome"]}
        for p in ppgs for l in p["linhas"]
    ]
    print(f"traduzindo {len(linhas)} linhas...", file=sys.stderr)
    textos_en = [traduzir(_texto_linha(l), "pt", "en") for l in linhas]

    modelo = carregar_modelo()
    emb_linhas = embed_termos(textos_en, modelo)
    emb_ods = embed_termos([o[4] for o in ODS], modelo)
    sims = util.cos_sim(emb_linhas, emb_ods).cpu().numpy()  # [linhas, 17]

    out = {}
    for i, linha in enumerate(linhas):
        ordem = sorted(range(len(ODS)), key=lambda j: -sims[i][j])
        melhor = float(sims[i][ordem[0]])
        mantidos = [
            j for j in ordem[:MAX_ODS_POR_LINHA]
            if sims[i][j] >= MIN_SIM and melhor - sims[i][j] <= MARGEM_TOP
        ]
        if not mantidos:  # nenhum passou do limiar absoluto: fica só o melhor, marcado como fraco
            mantidos = [ordem[0]]
        soma = sum(float(sims[i][j]) for j in mantidos)
        out[linha["id"]] = {
            "ppg_codigo": linha["ppg_codigo"],
            "titulo": linha["titulo"],
            "sims": [round(float(s), 3) for s in sims[i]],
            "ods": [
                {"n": ODS[j][0], "sim": round(float(sims[i][j]), 3), "peso": round(float(sims[i][j]) / soma, 3)}
                for j in mantidos
            ],
            "fraca": bool(melhor < MIN_SIM),
        }
    return out


def contatos_por_ods(matches: list[dict], classif: dict[str, dict]) -> dict[str, dict]:
    """instituição -> {"pais", "n_pesquisadores", "ods": {n: {"pesquisadores": k, "matches": m}}}"""
    pesq: dict[tuple, set] = defaultdict(set)
    n_match: dict[tuple, int] = defaultdict(int)
    total: dict[str, set] = defaultdict(set)
    pais: dict[str, str] = {}
    for m in matches:
        if (m.get("score") or 0) < SCORE_ALTO:
            continue
        c = classif.get(m["linha_id"])
        if not c:
            continue
        inst = m["foreign_institution"]
        pais[inst] = m["foreign_country"]
        autor = m.get("foreign_author_openalex_id") or m["foreign_author_name"]
        total[inst].add(autor)
        for o in c["ods"]:
            pesq[(inst, o["n"])].add(autor)
            n_match[(inst, o["n"])] += 1

    out: dict[str, dict] = {}
    for inst in total:
        out[inst] = {"pais": pais[inst], "n_pesquisadores": len(total[inst]), "ods": {}}
    for (inst, n), autores in pesq.items():
        out[inst]["ods"][str(n)] = {"pesquisadores": len(autores), "matches": n_match[(inst, n)]}
    return out


def main() -> None:
    ppgs = json.loads(PPGS_LINHAS_PATH.read_text(encoding="utf-8"))
    ppgs = ppgs["ppgs"] if isinstance(ppgs, dict) and "ppgs" in ppgs else ppgs
    dash = json.loads(DASHBOARD_JSON.read_text(encoding="utf-8"))

    classif = classificar_linhas(ppgs)
    contatos = contatos_por_ods(dash["linha_matches"], classif)

    openalex = None
    if OPENALEX_PATH.exists():
        openalex = json.loads(OPENALEX_PATH.read_text(encoding="utf-8"))

    resultado = {
        "gerado_em": __import__("datetime").date.today().isoformat(),
        "metodo": {
            "classificador": "Sentence-BERT all-MiniLM-L6-v2 (cosseno entre linha traduzida p/ EN e descrição do ODS)",
            "min_sim": MIN_SIM, "margem_top": MARGEM_TOP, "max_ods_por_linha": MAX_ODS_POR_LINHA,
            "score_alto_matching": SCORE_ALTO,
        },
        "ods": [
            {"n": n, "cor": cor, "nome": nome, "meta": meta, "imagem": f"image/ods/ods{n}.png"}
            for n, cor, nome, meta, _ in ODS
        ],
        "linhas": classif,
        "contatos": contatos,
        "openalex": openalex,  # None enquanto etl/ods_openalex.py não rodou
    }
    OUTPUT_PATH.write_text(json.dumps(resultado, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"gravado {OUTPUT_PATH} ({OUTPUT_PATH.stat().st_size // 1024} KB)", file=sys.stderr)

    # resumo p/ conferência humana
    cont = defaultdict(int)
    for c in classif.values():
        cont[c["ods"][0]["n"]] += 1
    for n, cor, nome, *_ in ODS:
        print(f"ODS {n:>2} {nome:<42} {cont[n]:>3} linhas (ODS principal)", file=sys.stderr)


if __name__ == "__main__":
    main()
