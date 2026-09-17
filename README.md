# FIND A ACADEMIC PARTNER - FAAP · Parcerias Internacionais UEA (PPG × Universidades Estrangeiras)

Dashboard interativo que cruza os **Programas de Pós-Graduação (PPG)** da
**Universidade do Estado do Amazonas (UEA)** — e suas linhas de pesquisa
**oficiais** (nome + descrição, mantidas pela PROPESP/ARI) — com potenciais
parceiros de pesquisa no exterior. O critério de cruzamento é semântico
(Sentence-BERT): o texto da linha de pesquisa de cada PPG é comparado com
publicações de pesquisadores estrangeiros indexadas no OpenAlex, não mais com
o histórico de publicações de um professor isolado. O cruzamento é genérico
por país/universidade (coluna `foreign_country`), então múltiplas fontes
convivem na mesma base sem conflito — hoje: Alemanha (país inteiro), Gana,
Argélia, Moçambique, África do Sul (Johannesburg + Stellenbosch), Angola e 8
universidades do Reino Unido.

**🔗 Site publicado:** https://willpine1992.github.io/DASHBOARD-PROSPECC-AO-PPGxUNI.ESTR/
**🔗 Site publicado (conta de Internacionalização):** https://internacionalizacao-create.github.io/DASHBOARD-PROSPECC-AO-PPGxUNI.ESTR-/

## O que tem no dashboard

| Página | Conteúdo |
|---|---|
| **Painel** (`docs/index.html`) | Filtro em cascata **PPG → Linha de pesquisa** (selecionar um PPG agrupa todos os seus docentes e mostra só as linhas oficiais dele), gráfico Sankey linha de pesquisa × instituição estrangeira, mapa do país estrangeiro e ranking de pesquisadores estrangeiros. Cada docente aparece com o ícone de ORCID (quando cadastrado), que leva direto ao perfil público dele |
| **Mapa de Fluxo** (`docs/flowmap.html`) | Globo 3D arrastável/zoom com arcos de Manaus até cada instituição estrangeira; clicar num arco mostra as linhas de pesquisa e os docentes dos PPGs envolvidos, e permite abrir o perfil de qualquer um deles |
| **Perfil do pesquisador estrangeiro** (`docs/professor.html`) | Ao clicar num pesquisador estrangeiro: dados pessoais, linhas de pesquisa em comum, docentes UEA conectados, dados da instituição (com mini-mapa e info ao vivo via OpenAlex) e lista de publicações reais (ORCID) |
| **Perfil do docente UEA** (`docs/docente.html`) | Ao clicar num docente UEA: PPG(s), linhas de pesquisa oficiais do(s) PPG(s), pesquisadores estrangeiros conectados a elas, mini-mapa da UEA, links/ícones de ORCID, OpenAlex e Currículo Lattes (quando cadastrados na planilha) e publicações reais via ORCID |

Todo o site é **estático** (HTML/CSS/JS + um único JSON de dados, sem
backend) e roda inteiramente no navegador — publicado via GitHub Pages a
partir deste repositório.

## Estrutura do repositório

```
DASHBOARD PROSPECÇAO PPGxUNI.ESTR/
├── docs/                     # o dashboard publicado (GitHub Pages)
│   ├── index.html            # Página 1 — Painel
│   ├── flowmap.html          # Página 2 — Mapa de Fluxo
│   ├── professor.html        # Página 3 — Perfil do pesquisador estrangeiro
│   ├── docente.html          # Página 4 — Perfil do docente UEA
│   ├── css/style.css
│   ├── js/                   # common.js, charts.js, page1.js, flowmap.js, professor.js, docente.js, report.js
│   └── lib/                  # D3, d3-sankey, topojson (vendorizados, sem CDN)
│
├── data/
│   ├── dashboard.json        # ⭐ fonte única de dados do site:
│   │                          #    { ppgs, professores, linha_matches, institutions, manaus }
│   └── capes_notas.json      # conceito CAPES por PPG (Avaliação Quadrienal 2021-2024)
│
├── etl/                       # pipeline Python que gera data/dashboard.json
│   ├── linha_match.py         # match linha de pesquisa oficial × pesquisadores estrangeiros
│   │                          #    (Alemanha + Gana + Argélia + Moçambique + África do Sul ×2 +
│   │                          #    Angola + Reino Unido ×8), via OpenAlex + rerank semântico
│   │                          #    (MATCHING/rerank.py)
│   ├── geocode.py             # geocoding via Nominatim (cache local, usado nas instituições estrangeiras)
│   ├── export_dashboard_data.py  # gera data/dashboard.json (ppgs + professores + linha_matches)
│   └── export_csv.py           # exporta as tabelas em CSV (separador `|`) — legado
│
├── cache/                     # cache local de OpenAlex/Nominatim/matching (gitignored)
├── output/                    # linha_matches.json (gitignored)
└── index.html                 # redireciona a raiz do site para docs/index.html
```

A base canônica de PPGs/linhas de pesquisa (nome + descrição oficial) e a
lista de docentes por PPG (com ORCID e ID Lattes) vivem fora deste repositório, em
`DATA BASE UEA/PPGS_LINHAS/` (pasta irmã) — ver o README de lá para como são
geradas a partir da planilha da UEA.

> `lattes_parser.py`, `db.py`, `run_etl.py`, `openalex_enrich.py` e
> `germany_match.py` (aquisição OpenAlex por keyword de professor) ficaram no
> histórico do repositório mas **não são mais usados** para montar
> `data/dashboard.json` — a lista de docentes por PPG deixou de vir de
> currículos Lattes e passou a vir inteiramente da planilha, ORCID e ID Lattes
> incluídos (ver Fases G e H do README de `DATA BASE UEA/PPGS_LINHAS/`).

> `cache/` e `output/` **não são versionados** (dados intermediários de
> matching, não pessoais). Só `data/dashboard.json` vai para o repositório
> público.

## Como atualizar os dados

```bash
cd "DATA BASE UEA/PPGS_LINHAS/etl"
python3 build_ppgs_linhas.py           # linhas de pesquisa oficiais (aba "PPGs")
python3 build_docentes.py              # docentes por PPG + ORCID + ID Lattes (aba "PPGxDocente")

cd "../../../DASHBOARD/DASHBOARD PROSPECÇAO PPGxUNI.ESTR"
python3 etl/linha_match.py             # cruza as linhas de pesquisa oficiais dos PPGs x estrangeiros
python3 etl/export_dashboard_data.py   # gera data/dashboard.json (ppgs + professores + matches)
```

`linha_match.py` depende de `MATCHING/` (Sentence-BERT) e `PADRONIZAÇAO/`
(tradução PT→EN offline via Argos Translate) — pastas irmãs deste
repositório, cada uma com seu próprio `.venv`. Reexecuções são rápidas graças
ao cache local (`cache/`) — só bate na internet para termos de busca novos.

Depois é só commitar e dar push: o GitHub Pages republica sozinho em ~1
minuto.

## Como rodar localmente

O dashboard precisa ser servido por HTTP (não abrir o `.html` direto, por
causa do CORS no `fetch` do JSON) e servido a partir da **raiz** deste
repositório, porque `docs/js/common.js` busca os dados em
`../data/dashboard.json`:

```bash
cd "DASHBOARD PROSPECÇAO PPGxUNI.ESTR"
python3 -m http.server 8000
```

Depois abra `http://localhost:8000/docs/index.html`.

## Fontes de dados

- **Planilha PPGs/Linhas de pesquisa (PROPESP/ARI)** — nome e descrição
  oficial de cada linha de pesquisa por PPG (fonte da comparação semântica)
- **Planilha PPGxDocente (PROPESP/ARI)** — nome, PPG, ORCID e ID Lattes de
  cada docente da UEA (fonte da seção "Docentes UEA" e dos links do perfil)
- **OpenAlex** — publicações de pesquisadores estrangeiros e de docentes da
  UEA (quando têm ORCID cadastrado na planilha), para o match e os perfis;
  nos perfis, a API de busca semântica (`search.semantic`, ver
  [help.openalex.org/api/semantic-search](https://help.openalex.org/api/semantic-search))
  também estima um "grau de afinidade" (barra horizontal, calculada aos
  poucos pros 8 primeiros conectados) entre a publicação mais recente de uma
  pessoa e as publicações da outra, filtrando por ORCID
- **Nominatim (OpenStreetMap)** — geocoding de instituições estrangeiras
- **ORCID** — perfil público usado como canal de contato tanto dos
  pesquisadores estrangeiros quanto dos docentes da UEA (não coletamos
  e-mail/telefone)
- **Lattes (CNPq)** — só o link/ID já cadastrado na planilha PPGxDocente, sem
  parsing de PDF

## Limitações conhecidas

- ORCID e ID Lattes de cada docente são preenchidos manualmente pela UEA na
  planilha — na maior parte dos docentes esses campos ainda estão vazios,
  então os ícones/links correspondentes e as publicações do perfil só
  aparecem pra quem já foi preenchido.
- Como o match agora é por linha de pesquisa do PPG (não por professor
  individual), todo docente de um PPG vê os mesmos pesquisadores estrangeiros
  conectados — não há (ainda) uma amarração fina de qual docente pesquisa
  exatamente qual linha dentro do PPG.
- Coordenadas de algumas instituições estrangeiras são aproximadas (nível de
  cidade), quando o nome não é resolvido pelo Nominatim.
