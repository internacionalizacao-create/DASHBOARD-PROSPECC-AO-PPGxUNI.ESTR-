/* ==========================================================================
   FAAP Dashboard — utilidades compartilhadas: dados, paleta, filtros

   Estrutura de dados (ver etl/export_dashboard_data.py):
     ppgs           - [{codigo, nome, linhas: [{id, titulo, descricao}]}]
     professores    - [{id, nome, orcid, lattes_id, programas: [codigo,...]}]  (docentes UEA,
                        direto de DATA BASE UEA/PPGS_LINHAS/output/docentes.json)
     linha_matches  - [{linha_id, ppg_codigo, foreign_author_name, foreign_author_orcid,
                         foreign_author_openalex_id, foreign_institution, foreign_country,
                         score, sample_work_title, sample_work_doi}]
     institutions   - [{instituicao, pais, lat, lon, n_matches, n_researchers}]
     manaus         - {cidade, uf, pais, lat, lon}

   Toda linha de pesquisa é oficial do PPG (nome + descrição vindos da
   planilha da UEA) — não existe mais "match por palavra-chave" como
   fallback: todo match em linha_matches já nasce ligado a uma linha
   canônica de um PPG.
   ========================================================================== */

let CAT_COLORS = [
  "#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948",
];
let OTHER_COLOR = CAT_COLORS[7];
const MAX_CATEGORICAL_INDIVIDUAL = 7;
const MAX_CATEGORICAL_TOTAL = 24;
const GOLDEN_ANGLE_DEG = 137.508;

function generateCategoricalColors(n) {
  if (n <= CAT_COLORS.length - 1) return CAT_COLORS.slice(0, n);
  const dark = getTheme() === "dark";
  const s = dark ? 62 : 68;
  const l = dark ? 64 : 47;
  const startHue = 205;
  const out = [];
  for (let i = 0; i < n; i++) {
    const hue = (startHue + i * GOLDEN_ANGLE_DEG) % 360;
    out.push(`hsl(${hue.toFixed(1)}, ${s}%, ${l}%)`);
  }
  return out;
}

let GREEN_SEQUENTIAL = ["#eaf7f0", "#c7ecda", "#96dab9", "#5fc192", "#2e9e6c", "#0f7a4d", "#0b5c3a"];
let CHART_MAP_FILL = "#eef5f1";
let CHART_MAP_BORDER = "#ffffff";
let CHART_NODE_NEUTRAL = "#0b3d2b";

/* ---------- tema claro/escuro ---------- */
const THEME_KEY = "faap-theme";

function readCssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function refreshThemeColors() {
  CAT_COLORS = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => readCssVar(`--cat-${i}`));
  OTHER_COLOR = CAT_COLORS[7];
  GREEN_SEQUENTIAL = [1, 2, 3, 4, 5, 6, 7].map((i) => readCssVar(`--chart-seq-${i}`));
  CHART_MAP_FILL = readCssVar("--chart-map-fill");
  CHART_MAP_BORDER = readCssVar("--chart-map-border");
  CHART_NODE_NEUTRAL = readCssVar("--chart-node-neutral");
}

function getTheme() {
  return document.documentElement.getAttribute("data-theme") ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);
  refreshThemeColors();
  const btn = document.getElementById("theme-toggle");
  if (btn) btn.setAttribute("aria-label", theme === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro");
  window.dispatchEvent(new CustomEvent("faap:themechange", { detail: { theme } }));
}

function toggleTheme() { applyTheme(getTheme() === "dark" ? "light" : "dark"); }

function initThemeToggle() {
  refreshThemeColors();
  const theme = getTheme();
  const btn = document.getElementById("theme-toggle");
  if (btn) {
    btn.setAttribute("aria-label", theme === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro");
    btn.addEventListener("click", toggleTheme);
  }
  initHelpTooltips();
}

async function loadData() {
  const opts = { cache: "no-cache" };
  const [{ ppgs, professores, linha_matches, institutions, manaus }, capesNotas] = await Promise.all([
    fetch("../data/dashboard.json", opts).then((r) => r.json()),
    fetch("../data/capes_notas.json", opts).then((r) => r.json()),
  ]);

  const institutionByName = new Map(institutions.map((i) => [i.instituicao, i]));
  const professorById = new Map(professores.map((p) => [p.id, p]));
  const ppgByCodigo = new Map(ppgs.map((p) => [p.codigo, p]));

  const linhaById = new Map();
  for (const ppg of ppgs) {
    for (const linha of ppg.linhas) {
      linhaById.set(linha.id, { ...linha, ppg_codigo: ppg.codigo, ppg_nome: ppg.nome });
    }
  }

  // anexa o título/PPG da linha em cada match, pra não precisar resolver o
  // linha_id toda hora nos gráficos (que exibem o título como rótulo)
  for (const m of linha_matches) {
    const linha = linhaById.get(m.linha_id);
    m.linha_titulo = linha ? linha.titulo : m.linha_id;
  }

  const capesByCode = new Map(capesNotas.programas.map((p) => [p.codigo.normalize("NFC"), p]));

  return {
    ppgs, professores, linha_matches, institutions, manaus,
    institutionByName, professorById, ppgByCodigo, linhaById,
    capesByCode, capesOpcoes: capesNotas.opcoes,
  };
}

/* ---------- Avaliação CAPES por PPG ---------- */
function ppgMatchesCapesFilters(codigo, capesByCode, filters) {
  const p = capesByCode.get(codigo.normalize("NFC"));
  if (!p) return !(filters.nivel || filters.modalidade || filters.situacao || filters.conceito);
  if (filters.conceito && String(p.conceito) !== filters.conceito) return false;
  if (filters.nivel || filters.modalidade || filters.situacao) {
    const ok = p.cursos.some((c) =>
      (!filters.nivel || c.nivel === filters.nivel) &&
      (!filters.modalidade || c.modalidade === filters.modalidade) &&
      (!filters.situacao || c.situacao === filters.situacao)
    );
    if (!ok) return false;
  }
  return true;
}

/* ---------- estado de filtros, compartilhado via querystring ---------- */
function readFiltersFromURL() {
  const p = new URLSearchParams(location.search);
  return {
    ppgs: new Set((p.get("ppgs") || "").split(",").filter(Boolean)),
    linhaIds: new Set((p.get("linhas") || "").split(",").filter(Boolean)),
    pais: p.get("pais") || "",
    instituicao: p.get("instituicao") || "",
    professorId: p.get("professor") ? Number(p.get("professor")) : null,
    q: p.get("q") || "",
    nivel: p.get("nivel") || "",
    modalidade: p.get("modalidade") || "",
    situacao: p.get("situacao") || "",
    conceito: p.get("conceito") || "",
  };
}

function filtersToURL(filters) {
  const p = new URLSearchParams();
  if (filters.ppgs.size) p.set("ppgs", [...filters.ppgs].join(","));
  if (filters.linhaIds.size) p.set("linhas", [...filters.linhaIds].join(","));
  if (filters.pais) p.set("pais", filters.pais);
  if (filters.instituicao) p.set("instituicao", filters.instituicao);
  if (filters.professorId) p.set("professor", filters.professorId);
  if (filters.q) p.set("q", filters.q);
  if (filters.nivel) p.set("nivel", filters.nivel);
  if (filters.modalidade) p.set("modalidade", filters.modalidade);
  if (filters.situacao) p.set("situacao", filters.situacao);
  if (filters.conceito) p.set("conceito", filters.conceito);
  return p.toString();
}

function applyProfessorFilters(professores, filters, capesByCode) {
  const capesActive = capesByCode && (filters.nivel || filters.modalidade || filters.situacao || filters.conceito);
  return professores.filter((p) => {
    if (filters.ppgs.size && !p.programas.some((c) => filters.ppgs.has(c))) return false;
    if (filters.professorId && p.id !== filters.professorId) return false;
    if (capesActive && !p.programas.some((c) => ppgMatchesCapesFilters(c, capesByCode, filters))) return false;
    return true;
  });
}

function applyLinhaMatchFilters(linhaMatches, filters) {
  return linhaMatches.filter((m) => {
    if (filters.ppgs.size && !filters.ppgs.has(m.ppg_codigo)) return false;
    if (filters.linhaIds.size && !filters.linhaIds.has(m.linha_id)) return false;
    if (filters.pais && m.foreign_country !== filters.pais) return false;
    if (filters.instituicao && m.foreign_institution !== filters.instituicao) return false;
    return true;
  });
}

/* ---------- agregações ---------- */
function countBy(arr, keyFn) {
  const m = new Map();
  for (const item of arr) {
    const k = keyFn(item);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

function topEntries(map, n) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

/* cor própria pra cada PPG — fixa (não recalculada a cada filtro), pra que a
   mesma linha de pesquisa tenha sempre a mesma cor em qualquer gráfico/lista,
   e a cor do PPG na checklist bata com a cor das linhas dele em todo o resto
   do painel. Ordem alfabética do código do PPG garante uma atribuição estável
   entre execuções (mesmo conjunto de PPGs -> mesmas cores, sempre). */
function buildPPGColorScale(ppgs) {
  const codigos = [...ppgs].map((p) => p.codigo).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const palette = generateCategoricalColors(codigos.length);
  const scale = new Map();
  codigos.forEach((c, i) => scale.set(c, palette[i]));
  return { scale, codigos };
}
function colorForPPG(codigo, colorInfo) {
  return colorInfo.scale.get(codigo) || OTHER_COLOR;
}

/* ---------- tooltip global ---------- */
let tooltipEl = null;
function ensureTooltip() {
  if (!tooltipEl) {
    tooltipEl = document.createElement("div");
    tooltipEl.className = "viz-tooltip";
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}
function showTooltip(x, y, html) {
  const el = ensureTooltip();
  el.innerHTML = html;
  el.style.left = x + "px";
  el.style.top = y + "px";
  el.classList.add("is-visible");
}
function moveTooltip(x, y) {
  if (tooltipEl) { tooltipEl.style.left = x + "px"; tooltipEl.style.top = y + "px"; }
}
function hideTooltip() {
  if (tooltipEl) tooltipEl.classList.remove("is-visible");
}

/* ---------- tooltip de ajuda: hover parado por 3s sobre [data-help] ---------- */
const HELP_HOLD_MS = 3000;
let helpTooltipEl = null;
let helpTimer = null;
let helpActiveTarget = null;

function ensureHelpTooltip() {
  if (!helpTooltipEl) {
    helpTooltipEl = document.createElement("div");
    helpTooltipEl.className = "help-tooltip";
    document.body.appendChild(helpTooltipEl);
  }
  return helpTooltipEl;
}

function positionHelpTooltip(x, y) {
  const el = helpTooltipEl;
  if (!el) return;
  const pad = 16;
  const rect = el.getBoundingClientRect();
  let left = x + pad;
  let top = y + pad;
  if (left + rect.width > window.innerWidth - 8) left = x - rect.width - pad;
  if (top + rect.height > window.innerHeight - 8) top = y - rect.height - pad;
  el.style.left = Math.max(8, left) + "px";
  el.style.top = Math.max(8, top) + "px";
}

function showHelpTooltip(text, x, y) {
  const el = ensureHelpTooltip();
  el.textContent = text;
  el.classList.add("is-visible");
  positionHelpTooltip(x, y);
}

function hideHelpTooltip() {
  clearTimeout(helpTimer);
  helpTimer = null;
  helpActiveTarget = null;
  if (helpTooltipEl) helpTooltipEl.classList.remove("is-visible");
}

function initHelpTooltips() {
  let lastX = 0, lastY = 0;
  document.addEventListener("mousemove", (ev) => { lastX = ev.clientX; lastY = ev.clientY; }, { passive: true });

  document.addEventListener("mouseover", (ev) => {
    const target = ev.target.closest("[data-help]");
    if (!target || target === helpActiveTarget) return;
    hideHelpTooltip();
    helpActiveTarget = target;
    helpTimer = setTimeout(() => {
      showHelpTooltip(target.getAttribute("data-help"), lastX, lastY);
    }, HELP_HOLD_MS);
  });

  document.addEventListener("mouseout", (ev) => {
    const target = ev.target.closest("[data-help]");
    if (!target || (ev.relatedTarget && target.contains(ev.relatedTarget))) return;
    hideHelpTooltip();
  });

  window.addEventListener("scroll", hideHelpTooltip, true);
  window.addEventListener("blur", hideHelpTooltip);
}

/* ---------- afinidade semântica entre publicações, via OpenAlex ----------
   Usa a API de busca semântica do OpenAlex (search.semantic — só texto, até
   2000 caracteres, no máx. 50 resultados, limite de 1 req/s:
   https://help.openalex.org/api/semantic-search) pra estimar o quão
   relacionado é o corpo de publicações de duas pessoas: pega o título da
   publicação mais recente de uma (o "texto de busca") e filtra os
   resultados pelo ORCID da outra — o relevance_score do melhor resultado
   vira o "grau de afinidade" exibido como barra horizontal. Não é uma
   métrica oficial de similaridade entre pessoas (a API não oferece isso
   diretamente) — é uma aproximação via busca semântica de texto único
   restrita a um autor. */
const OPENALEX_SEMANTIC_DELAY_MS = 1100;

async function relevanciaSemanticaOpenAlex(textoBusca, orcidAlvo) {
  if (!textoBusca || !orcidAlvo) return null;
  const params = new URLSearchParams({
    "search.semantic": textoBusca.slice(0, 2000),
    filter: `author.orcid:${orcidAlvo}`,
    "per-page": "1",
    select: "id,relevance_score",
  });
  try {
    const data = await fetch(`https://api.openalex.org/works?${params.toString()}`).then((r) => r.json());
    const w = data.results && data.results[0];
    return w && w.relevance_score != null ? w.relevance_score : null;
  } catch {
    return null;
  }
}

/* roda sequencialmente (respeitando o limite de 1 req/s da API), só pros
   primeiros `limite` itens de `itens` que tiverem ORCID (via `obterOrcid`) —
   chama onScore(item, score, maiorScoreAteAgora) a cada resultado, pra quem
   estiver ouvindo atualizar a barra daquele item aos poucos. */
async function calcularAfinidadeSemantica(itens, textoBusca, obterOrcid, limite, onScore) {
  if (!textoBusca) return;
  const alvo = itens.filter((it) => obterOrcid(it)).slice(0, limite);
  let maxScore = 0;
  for (const item of alvo) {
    const score = await relevanciaSemanticaOpenAlex(textoBusca, obterOrcid(item));
    if (score != null) {
      maxScore = Math.max(maxScore, score);
      onScore(item, score, maxScore);
    }
    await new Promise((r) => setTimeout(r, OPENALEX_SEMANTIC_DELAY_MS));
  }
}

function fmt(n) { return n.toLocaleString("pt-BR"); }

function debounce(fn, ms) {
  let t;
  return function (...args) {
    const ctx = this;
    clearTimeout(t);
    t = setTimeout(() => fn.apply(ctx, args), ms);
  };
}
