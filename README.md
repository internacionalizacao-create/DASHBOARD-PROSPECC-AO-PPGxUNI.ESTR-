# GERBRAS · Parcerias Internacionais UEA (PPG × Universidades Estrangeiras)

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

## O que tem no dashboard

| Página | Conteúdo |
|---|---|
| **Painel** (`docs/index.html`) | Filtro em cascata **PPG → Linha de pesquisa** (selecionar um PPG agrupa todos os seus professores e mostra só as linhas oficiais dele), gráfico Sankey linha de pesquisa × instituição estrangeira, mapa do país estrangeiro, ranking de linhas de pesquisa e de pesquisadores estrangeiros |
| **Mapa de Fluxo** (`docs/flowmap.html`) | Globo 3D arrastável/zoom com arcos de Manaus até cada instituição estrangeira; clicar num arco mostra as linhas de pesquisa e os professores dos PPGs envolvidos, e permite voltar ao painel já filtrado |
| **Perfil do pesquisador** (`docs/professor.html`) | Ao clicar num pesquisador estrangeiro: dados pessoais, linhas de pesquisa em comum, professores dos PPGs conectados, dados da instituição (com mini-mapa e info ao vivo via OpenAlex) e lista de publicações reais (ORCID) |

Todo o site é **estático** (HTML/CSS/JS + um único JSON de dados, sem
backend) e roda inteiramente no navegador — publicado via GitHub Pages a
partir deste repositório.

## Estrutura do repositório

```
DASHBOARD PROSPECÇAO PPGxUNI.ESTR/
├── docs/                     # o dashboard publicado (GitHub Pages)
│   ├── index.html            # Página 1 — Painel
│   ├── flowmap.html          # Página 2 — Mapa de Fluxo
│   ├── professor.html        # Página 3 — Perfil do pesquisador
│   ├── css/style.css
│   ├── js/                   # common.js, charts.js, page1.js, flowmap.js, professor.js, report.js
│   └── lib/                  # D3, d3-sankey, topojson (vendorizados, sem CDN)
│
├── data/
│   ├── dashboard.json        # ⭐ fonte única de dados do site:
│   │                          #    { ppgs, professores, linha_matches, institutions, manaus }
│   └── capes_notas.json      # conceito CAPES por PPG (Avaliação Quadrienal 2021-2024)
│
├── etl/                       # pipeline Python que gera data/dashboard.json
│   ├── lattes_parser.py      # extrai nome, ORCID, universidade, endereço dos PDFs Lattes
│   ├── geocode.py             # geocoding via Nominatim (cache local)
│   ├── openalex_enrich.py     # DOIs e keywords dos últimos 5 anos, via OpenAlex (perfil do professor)
│   ├── germany_match.py       # aquisição de candidatos OpenAlex — Alemanha (país inteiro)
│   ├── linha_match.py         # ⭐ NOVO: match linha de pesquisa oficial × pesquisadores
│   │                          #    estrangeiros (Alemanha + Gana + Argélia + Moçambique +
│   │                          #    África do Sul ×2 + Angola + Reino Unido ×8), via OpenAlex
│   │                          #    + rerank semântico (MATCHING/rerank.py)
│   ├── db.py                  # schema SQLite (researchers, publications, keywords, research_areas)
│   ├── run_etl.py              # orquestrador principal (Lattes -> banco de professores)
│   ├── export_dashboard_data.py  # gera data/dashboard.json (ppgs + professores + linha_matches)
│   └── export_csv.py           # exporta as tabelas em CSV (separador `|`)
│
├── cache/                     # cache local de OpenAlex/Nominatim/matching (gitignored)
├── output/                    # gerbras.db (SQLite) + linha_matches.json (gitignored)
└── index.html                 # redireciona a raiz do site para docs/index.html
```

A base canônica de PPGs/linhas de pesquisa (nome + descrição oficial) vive
fora deste repositório, em `DATA BASE UEA/PPGS_LINHAS/` (pasta irmã) — ver o
README de lá para como ela é gerada a partir da planilha da UEA.

> `cache/` e `output/` **não são versionados** — o banco SQLite carrega dados
> pessoais dos professores (ORCID, endereço) extraídos dos currículos Lattes.
> Só `data/dashboard.json` (agregado, sem dado pessoal sensível) vai para o
> repositório público. O `.gitignore` já cuida disso.

## Como atualizar os dados

Com Python 3 e o `pdftotext` (poppler, `brew install poppler`) instalados:

```bash
cd "DASHBOARD PROSPECÇAO PPGxUNI.ESTR"
python3 etl/run_etl.py                 # reprocessa os currículos Lattes -> banco de professores
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
- **Lattes (CNPq)** — identificação, ORCID, universidade/endereço, PPG e
  linhas de pesquisa (texto livre) de cada professor da UEA
- **OpenAlex** — publicações de pesquisadores estrangeiros (para o match) e
  do próprio professor da UEA (para o perfil), por ORCID
- **Nominatim (OpenStreetMap)** — geocoding de cidades e instituições
- **ORCID** — perfil público usado como canal de contato dos pesquisadores
  estrangeiros (não coletamos e-mail/telefone)

## Limitações conhecidas

- A planilha de linhas de pesquisa cita alguns PPGs que ainda não têm
  currículos Lattes coletados (PPGEEC, Rede PROFMAT, PROFSAÚDE, PPGSC) — para
  esses, a linha de pesquisa e os matches estrangeiros existem normalmente,
  mas o grupo de professores da UEA fica vazio até os currículos serem
  coletados.
- Nem toda linha de pesquisa livre extraída do Lattes de um professor é
  amarrada de volta à linha canônica do PPG (a similaridade semântica precisa
  passar de um limiar) — quando isso acontece, o professor continua listado
  no seu PPG, só sem a tag de linha específica.
- Coordenadas de algumas instituições estrangeiras são aproximadas (nível de
  cidade), quando o nome não é resolvido pelo Nominatim.
