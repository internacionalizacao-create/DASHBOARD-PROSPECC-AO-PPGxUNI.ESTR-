/* ==========================================================================
   FAAP Dashboard — Página 1: orquestração de filtros e gráficos

   Cascata de filtro: PPG (agrupa todos os professores daquele PPG) -> Linha
   de pesquisa oficial daquele(s) PPG(s). Os matches (linha_matches) já
   pertencem a uma linha canônica — não a um professor isolado — então o
   mesmo conjunto de parcerias vale para todos os professores do PPG/linha.
   ========================================================================== */
(async function () {
  const { ppgs, professores, linha_matches, institutions, manaus, professorById, linhaById, capesByCode, capesOpcoes } = await loadData();

  let filters = readFiltersFromURL();
  let profSearchText = filters.q || "";

  /* ---- se chegamos de um link do Flow Map / perfil (?professor=ID), deriva
     o filtro de PPG a partir do professor ---- */
  if (filters.professorId && filters.ppgs.size === 0) {
    const prof = professorById.get(filters.professorId);
    if (prof) filters.ppgs = new Set(prof.programas);
  }

  const ALL_PPGS = ppgs.map((p) => p.codigo).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const ALL_PAISES = [...new Set(linha_matches.map((m) => m.foreign_country))].sort();
  // cor fixa por PPG (mesma cor em toda parte: checklist, lista de linhas,
  // Sankey) — calculada uma vez só, não muda com o filtro ativo
  const ppgColorInfo = buildPPGColorScale(ppgs);

  function linhasDisponiveis() {
    const codigos = filters.ppgs.size ? [...filters.ppgs] : ALL_PPGS;
    return codigos.flatMap((c) => {
      const ppg = ppgs.find((p) => p.codigo === c);
      return ppg ? ppg.linhas.map((l) => ({ ...l, ppg_codigo: c })) : [];
    });
  }

  function populateSelect(sel, options, current) {
    const el = d3.select(sel);
    el.selectAll("option:not(:first-child)").remove();
    el.selectAll(null)
      .data(options)
      .join("option")
      .attr("value", (d) => d)
      .text((d) => d);
    el.property("value", options.includes(current) ? current : "");
  }

  populateSelect("#filter-pais", ALL_PAISES, filters.pais);
  populateSelect("#filter-nivel", capesOpcoes.niveis, filters.nivel);
  populateSelect("#filter-modalidade", capesOpcoes.modalidades, filters.modalidade);
  populateSelect("#filter-situacao", capesOpcoes.situacoes, filters.situacao);
  populateSelect("#filter-conceito", capesOpcoes.conceitos.map(String), filters.conceito);

  /* ---- topbar stats ---- */
  d3.select("#topbar-stats").html(`
    <div class="topbar__stat" data-help="Número de Programas de Pós-Graduação da UEA na base."><b>${fmt(ppgs.length)}</b><small>PPGs</small></div>
    <div class="topbar__stat" data-help="Número de docentes da UEA na base, agrupados por PPG."><b>${fmt(professores.length)}</b><small>Docentes UEA</small></div>
    <div class="topbar__stat" data-help="Número de instituições estrangeiras distintas com pelo menos um pesquisador com linha de pesquisa semelhante a alguma linha oficial de um PPG da UEA."><b>${fmt(institutions.length)}</b><small>Instituições estrangeiras</small></div>
    <div class="topbar__stat" data-help="Número total de pares (linha de pesquisa do PPG, pesquisador estrangeiro) identificados como possível parceria, considerando os filtros ativos."><b>${fmt(linha_matches.length)}</b><small>Conexões</small></div>
  `);

  /* ---- eventos ---- */
  d3.select("#filter-pais").on("change", function () {
    filters.pais = this.value;
    if (filters.instituicao && filters.pais) {
      const stillValid = linha_matches.some(
        (m) => m.foreign_institution === filters.instituicao && m.foreign_country === filters.pais
      );
      if (!stillValid) filters.instituicao = "";
    }
    syncURL(); render();
  });
  d3.select("#prof-search").property("value", profSearchText).on("input", debounce(function (ev) {
    profSearchText = ev.target.value;
    renderProfessorList();
  }, 120));
  d3.select("#filter-nivel").on("change", function () { filters.nivel = this.value; syncURL(); render(); });
  d3.select("#filter-modalidade").on("change", function () { filters.modalidade = this.value; syncURL(); render(); });
  d3.select("#filter-situacao").on("change", function () { filters.situacao = this.value; syncURL(); render(); });
  d3.select("#filter-conceito").on("change", function () { filters.conceito = this.value; syncURL(); render(); });

  d3.select("#btn-clear-filters").on("click", () => {
    filters = {
      ppgs: new Set(), linhaIds: new Set(), pais: "", instituicao: "", professorId: null, q: "",
      nivel: "", modalidade: "", situacao: "", conceito: "",
    };
    profSearchText = "";
    d3.select("#prof-search").property("value", "");
    populateSelect("#filter-pais", ALL_PAISES, "");
    populateSelect("#filter-nivel", capesOpcoes.niveis, "");
    populateSelect("#filter-modalidade", capesOpcoes.modalidades, "");
    populateSelect("#filter-situacao", capesOpcoes.situacoes, "");
    populateSelect("#filter-conceito", capesOpcoes.conceitos.map(String), "");
    syncURL(); render();
  });
  d3.select("#btn-report").on("click", () => {
    generateProspectingReport({
      professores: currentFilteredProfessores,
      matches: currentMatchesForReport,
      filters, professorById, linhaById,
      totals: { professores: professores.length, institutions: institutions.length },
    });
  });

  window.addEventListener("resize", debounce(render, 200));
  window.addEventListener("faap:themechange", render);
  initThemeToggle();

  function syncURL() {
    const qs = filtersToURL(filters);
    history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));
  }

  function togglePPG(codigo) {
    filters.ppgs.has(codigo) ? filters.ppgs.delete(codigo) : filters.ppgs.add(codigo);
    // uma linha selecionada que não pertence mais a nenhum PPG ativo some do filtro
    if (filters.ppgs.size) {
      const codigosAtivos = filters.ppgs;
      for (const id of [...filters.linhaIds]) {
        const linha = linhaById.get(id);
        if (!linha || !codigosAtivos.has(linha.ppg_codigo)) filters.linhaIds.delete(id);
      }
    }
    syncURL(); render();
  }
  function toggleLinha(linhaId) {
    filters.linhaIds.has(linhaId) ? filters.linhaIds.delete(linhaId) : filters.linhaIds.add(linhaId);
    syncURL(); render();
  }
  function toggleLinhaByTitulo(titulo) {
    const linha = linhasDisponiveis().find((l) => l.titulo === titulo);
    if (linha) toggleLinha(linha.id);
  }
  function toggleInstituicao(inst) {
    filters.instituicao = filters.instituicao === inst ? "" : inst;
    syncURL(); render();
  }

  /* ---- estado corrente derivado, preenchido a cada render() ---- */
  let currentFilteredProfessores = [];
  let currentMatchesForReport = [];

  function render() {
    currentFilteredProfessores = applyProfessorFilters(professores, filters, capesByCode);
    const linhasAtuais = linhasDisponiveis();
    const linhaIdsAtuais = new Set(linhasAtuais.map((l) => l.id));

    // matches para os painéis/gráficos: respeita PPG + linha + país + instituição
    const matchesForCharts = applyLinhaMatchFilters(linha_matches, filters)
      .filter((m) => linhaIdsAtuais.has(m.linha_id));
    currentMatchesForReport = matchesForCharts;

    renderPPGChecklist();
    renderLinhasList(linhasAtuais, matchesForCharts);
    renderProfessorList();
    renderForeignRanking(matchesForCharts);

    renderSankey(document.getElementById("sankey-chart"), matchesForCharts, ppgColorInfo, {
      onLinhaClick: toggleLinhaByTitulo,
      onInstituicaoClick: toggleInstituicao,
      activeLinhaTitulos: new Set([...filters.linhaIds].map((id) => linhaById.get(id)?.titulo).filter(Boolean)),
      activeInstituicao: filters.instituicao,
      onLinkHover: updateSbertCard,
    });
    updateSbertCard(null);
    renderCountryMap(document.getElementById("map-chart"), matchesForCharts);

    d3.select("#sankey-hint").text(`${fmt(matchesForCharts.length)} conexões`);
    d3.select("#prof-count-hint").text(`${fmt(currentFilteredProfessores.length)} / ${fmt(professores.length)}`);
  }

  function capesConceitoBadge(codigo) {
    const p = capesByCode.get(codigo.normalize("NFC"));
    if (!p || p.conceito == null) return "";
    const label = String(p.conceito).replace(/"/g, "&quot;");
    const nome = (p.nome || "").replace(/"/g, "&quot;");
    if (label === "A") {
      return `<small class="ppg-grade ppg-grade--pending" title="Conceito CAPES ainda não atribuído (curso novo) · ${nome}">A</small>`;
    }
    return `<small class="ppg-grade" title="Conceito CAPES ${label} · Avaliação Quadrienal 2021-2024 · ${nome}">${label}</small>`;
  }

  function renderPPGChecklist() {
    const capesActive = filters.nivel || filters.modalidade || filters.situacao || filters.conceito;

    const rows = d3.select("#filter-ppg-list")
      .selectAll(".checkrow")
      .data(ALL_PPGS, (d) => d)
      .join("label")
      .attr("class", "checkrow");

    rows
      .classed("checkrow--dim", (d) => capesActive && !ppgMatchesCapesFilters(d, capesByCode, filters))
      .html((d) => `
        <input type="checkbox" ${filters.ppgs.has(d) ? "checked" : ""} />
        <span class="dot" style="background:${colorForPPG(d, ppgColorInfo)}"></span>
        <span>${d}</span>${capesConceitoBadge(d)}`);
    rows.select("input").on("change", (_, d) => togglePPG(d));

    d3.select("#ppg-count-hint").text(filters.ppgs.size ? `${filters.ppgs.size} selecionado(s)` : "");
  }

  function updateSbertCard(link) {
    const scoreEl = document.getElementById("sbert-score");
    const fillEl = document.getElementById("sbert-fill");
    const pairEl = document.getElementById("sbert-pair");
    const hintEl = document.getElementById("sbert-hint");
    if (!scoreEl) return;

    if (!link || link.avgSimilarity == null) {
      scoreEl.textContent = "—";
      scoreEl.style.color = "";
      fillEl.style.width = "0%";
      hintEl.textContent = "";
      pairEl.innerHTML = "Passe o mouse sobre uma conexão entre <b>Linha de pesquisa</b> e <b>Instituição estrangeira</b>.";
      return;
    }

    const sim = Math.max(0, Math.min(1, link.avgSimilarity));
    scoreEl.textContent = sim.toFixed(3).replace(".", ",");
    scoreEl.style.color = sim >= 0.3 ? "var(--ink-primary)" : "var(--ink-muted)";
    fillEl.style.width = `${(sim * 100).toFixed(1)}%`;
    hintEl.textContent = `${fmt(link.realValue)} conexão(ões)`;
    pairEl.innerHTML = `<b>${link.tooltipLabel}</b> ↔ ${link.target.name}`;
  }

  function renderLinhasList(linhasAtuais, matchSubset) {
    const counts = countBy(matchSubset, (m) => m.linha_id);

    const linhasOrdenadas = [...linhasAtuais].sort((a, b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0));

    const wrap = d3.select("#linhas-list");
    if (!linhasOrdenadas.length) { wrap.html('<div class="empty-hint">Nenhuma linha de pesquisa para os filtros atuais.</div>'); return; }

    const rows = wrap.selectAll(".pickrow").data(linhasOrdenadas, (d) => d.id).join("div")
      .attr("class", (d) => "pickrow" + (filters.linhaIds.has(d.id) ? " is-active" : ""));
    rows.attr("title", (d) => d.descricao || d.titulo);
    rows.html((d) => `
      <span class="dot" style="background:${colorForPPG(d.ppg_codigo, ppgColorInfo)}"></span>
      <span class="label">${d.titulo}</span><span class="count">${fmt(counts.get(d.id) || 0)}</span>`);
    rows.on("click", (_, d) => toggleLinha(d.id));
  }

  function renderProfessorList() {
    const filtered = currentFilteredProfessores.filter((p) =>
      !profSearchText || p.nome.toLowerCase().includes(profSearchText.toLowerCase())
    ).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

    const wrap = d3.select("#prof-list");
    if (!filtered.length) { wrap.html('<div class="empty-hint">Nenhum docente encontrado.</div>'); return; }

    const rows = wrap.selectAll(".pickrow").data(filtered, (d) => d.id).join("div")
      .attr("class", "pickrow");
    rows.html((d) => `
      <span class="dot" style="background:var(--accent)"></span>
      <span class="label" title="${d.nome} · ${d.programas.join(', ')}">${d.nome}</span>
      ${d.orcid
        ? `<a class="orcid-link" href="https://orcid.org/${d.orcid}" target="_blank" rel="noopener" title="Perfil ORCID de ${d.nome}"><img src="image/orcid-icon.webp" alt="ORCID" class="orcid-icon" /></a>`
        : `<span class="orcid-link orcid-link--empty" title="ORCID não cadastrado"></span>`}`);
    rows.select(".orcid-link").on("click", (ev) => ev.stopPropagation());
    rows.style("cursor", "pointer").on("click", (_, d) => { location.href = `docente.html?id=${d.id}`; });
  }

  function renderForeignRanking(matchSubset) {
    const byAuthor = new Map();
    for (const m of matchSubset) {
      const key = m.foreign_author_orcid || m.foreign_author_name;
      if (!byAuthor.has(key)) {
        byAuthor.set(key, {
          nome: m.foreign_author_name, instituicao: m.foreign_institution,
          oaId: (m.foreign_author_openalex_id || "").split("/").pop(), count: 0,
        });
      }
      byAuthor.get(key).count += 1;
    }
    const ranked = [...byAuthor.values()].sort((a, b) => b.count - a.count).slice(0, 12);

    const wrap = d3.select("#foreign-ranking");
    if (!ranked.length) { wrap.html('<div class="empty-hint">Sem pesquisadores para os filtros atuais.</div>'); return; }

    const rows = wrap.selectAll(".rank").data(ranked, (d) => d.nome).join("div").attr("class", "rank");
    rows.style("cursor", "pointer").on("click", (_, d) => {
      const q = new URLSearchParams({ oa: d.oaId, name: d.nome });
      location.href = `professor.html?${q.toString()}`;
    });
    rows.html((d, i) => `
      <span class="rank__pos">${i + 1}</span>
      <span class="rank__name" title="${d.nome} · ${d.instituicao}">${d.nome}</span>
      <span class="rank__val">${d.count}</span>`);
  }

  render();
})();
