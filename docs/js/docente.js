/* ==========================================================================
   GERBRAS Dashboard — Perfil do docente UEA (espelha professor.js, mas para
   o lado UEA: PPG(s) no lugar de instituição estrangeira, linhas oficiais do
   PPG no lugar de "linhas em comum", pesquisadores estrangeiros conectados
   via qualquer linha do PPG no lugar de "professores UEA conectados").
   ========================================================================== */
(async function () {
  const { ppgs, professores, linha_matches, ppgByCodigo, capesByCode, manaus } = await loadData();
  initThemeToggle();
  const ppgColorInfo = buildPPGColorScale(ppgs);

  const params = new URLSearchParams(location.search);
  const id = Number(params.get("id"));
  const docente = professores.find((p) => p.id === id);

  if (!docente) {
    document.querySelector("main").innerHTML =
      '<div class="empty-hint" style="padding:80px; font-size:14px;">Docente não encontrado. Volte ao painel e selecione novamente.</div>';
    return;
  }

  const linhasDoPPG = docente.programas.flatMap((codigo) => {
    const ppg = ppgByCodigo.get(codigo);
    return ppg ? ppg.linhas.map((l) => ({ ...l, ppg_codigo: codigo })) : [];
  });

  const matched = linha_matches.filter((m) => docente.programas.includes(m.ppg_codigo));

  const estrangeiros = new Map();
  for (const m of matched) {
    const key = m.foreign_author_orcid || m.foreign_author_name;
    if (!estrangeiros.has(key)) {
      estrangeiros.set(key, {
        nome: m.foreign_author_name,
        instituicao: m.foreign_institution,
        pais: m.foreign_country,
        oaId: (m.foreign_author_openalex_id || "").split("/").pop(),
        orcid: m.foreign_author_orcid,
        conexoes: 0,
      });
    }
    estrangeiros.get(key).conexoes += 1;
  }
  const estrangeirosOrdenados = [...estrangeiros.values()].sort((a, b) => b.conexoes - a.conexoes);

  renderPersonal();
  renderPPGs();
  renderPublications();
  wireBackButton();

  window.addEventListener("gerbras:themechange", () => {
    renderPersonal();
    renderInstitutionMap(document.getElementById("institution-map"), manaus.lat, manaus.lon, "UEA · Manaus");
  });

  /* ---------------- coluna 1: pessoal ---------------- */
  function renderPersonal() {
    d3.select("#topbar-stats").html(`
      <div class="topbar__stat" data-help="Número de linhas de pesquisa oficiais do(s) PPG(s) deste docente."><b>${fmt(linhasDoPPG.length)}</b><small>Linhas do PPG</small></div>
      <div class="topbar__stat" data-help="Número de pesquisadores estrangeiros conectados a alguma linha do(s) PPG(s) deste docente."><b>${fmt(estrangeirosOrdenados.length)}</b><small>Pesq. estrangeiros</small></div>
    `);

    d3.select("#p-avatar").style("background", colorFor(docente.nome)).text(initials(docente.nome));
    d3.select("#p-nome").text(docente.nome);
    d3.select("#p-sub").text(docente.programas.join(" · "));

    const badges = [];
    if (docente.orcid) {
      badges.push(`<a class="badge badge--link" href="https://orcid.org/${docente.orcid}" target="_blank" rel="noopener"><img class="badge-icon" src="image/orcid-icon.webp" alt="" />ORCID ${docente.orcid}</a>`);
      badges.push(`<a class="badge badge--link" href="https://openalex.org/works?filter=author.orcid:${docente.orcid}" target="_blank" rel="noopener"><img class="badge-icon" src="image/openalex-icon.png" alt="" />OpenAlex</a>`);
    }
    if (docente.lattes_id) {
      badges.push(`<a class="badge badge--link" href="http://lattes.cnpq.br/${docente.lattes_id}" target="_blank" rel="noopener"><img class="badge-icon" src="image/lattes-icon.png" alt="" />Currículo Lattes</a>`);
    }
    badges.push(`<span class="badge">Universidade do Estado do Amazonas</span>`);
    d3.select("#p-badges").html(badges.join(""));

    d3.select("#p-contact").html(
      `<p class="text-sm muted" style="margin:0;">Não coletamos e-mail ou telefone diretamente das fontes públicas. Use o ORCID acima como canal de contato/apresentação inicial, quando disponível.</p>`
    );

    d3.select("#p-linhas-hint").text(fmt(linhasDoPPG.length));
    d3.select("#p-linhas").html(
      linhasDoPPG.map((l) => `<span class="kw-tag" style="border-left:3px solid ${colorForPPG(l.ppg_codigo, ppgColorInfo)}" title="${(l.descricao || "").replace(/"/g, "&quot;")}">${l.titulo}</span>`).join("") ||
      '<div class="empty-hint">Sem linhas de pesquisa cadastradas.</div>'
    );

    d3.select("#p-profs-hint").text(fmt(estrangeirosOrdenados.length));
    const wrap = d3.select("#p-profs");
    if (!estrangeirosOrdenados.length) {
      wrap.html('<div class="empty-hint">Nenhum pesquisador estrangeiro conectado ainda.</div>');
    } else {
      const rows = wrap.selectAll(".pickrow").data(estrangeirosOrdenados, (d) => d.orcid || d.nome).join("div").attr("class", "pickrow");
      rows.html((d) => `<span class="dot" style="background:var(--accent)"></span><span class="label" title="${d.instituicao} · ${d.pais}">${d.nome}</span><span class="count">${d.conexoes}</span>`);
      rows.style("cursor", "pointer").on("click", (_, d) => {
        const q = new URLSearchParams({ oa: d.oaId, name: d.nome });
        location.href = `professor.html?${q.toString()}`;
      });
    }
  }

  /* ---------------- coluna 2: PPG(s) + mapa ---------------- */
  function capesConceitoBadge(codigo) {
    const p = capesByCode.get(codigo.normalize("NFC"));
    if (!p || p.conceito == null) return "";
    const label = String(p.conceito).replace(/"/g, "&quot;");
    if (label === "A") return `<small class="ppg-grade ppg-grade--pending" title="Conceito CAPES ainda não atribuído (curso novo)">A</small>`;
    return `<small class="ppg-grade" title="Conceito CAPES ${label} · Avaliação Quadrienal 2021-2024">${label}</small>`;
  }

  function renderPPGs() {
    const rows = docente.programas.map((codigo) => {
      const ppg = ppgByCodigo.get(codigo);
      const nome = ppg ? ppg.nome : codigo;
      const dot = `<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${colorForPPG(codigo, ppgColorInfo)}; margin-right:6px;"></span>`;
      return `<div class="info-row"><span>${dot}${codigo} ${capesConceitoBadge(codigo)}</span><span>${nome}</span></div>`;
    });
    d3.select("#i-ppgs").html(rows.join("") || '<div class="empty-hint">Sem PPG cadastrado.</div>');

    renderInstitutionMap(document.getElementById("institution-map"), manaus.lat, manaus.lon, "UEA · Manaus");
  }

  /* ---------------- coluna 3: publicações ---------------- */
  async function renderPublications() {
    const el = document.getElementById("pub-list");
    if (!docente.orcid) {
      el.innerHTML = '<div class="empty-hint">ORCID não cadastrado para este docente — publicações indisponíveis.</div>';
      d3.select("#pub-hint").text("");
      return;
    }

    try {
      const url = `https://api.openalex.org/works?filter=author.orcid:${docente.orcid}&sort=publication_date:desc&per-page=25&select=id,doi,title,publication_year,primary_location`;
      const data = await fetch(url).then((r) => r.json());
      const works = (data.results || []).map((w) => ({
        title: w.title,
        year: w.publication_year,
        source: (w.primary_location && w.primary_location.source && w.primary_location.source.display_name) || null,
        doi: w.doi ? w.doi.replace("https://doi.org/", "") : null,
      }));
      if (!works.length) {
        el.innerHTML = '<div class="empty-hint">Nenhuma publicação encontrada no OpenAlex para este ORCID.</div>';
        d3.select("#pub-hint").text("");
        return;
      }
      d3.select("#pub-hint").text(`${fmt(works.length)} via OpenAlex`);
      el.innerHTML = works.map(pubCardHtml).join("");
    } catch (e) {
      el.innerHTML = '<div class="empty-hint">Não foi possível carregar publicações agora.</div>';
    }
  }

  function pubCardHtml(p) {
    const meta = [];
    if (p.year) meta.push(p.year);
    if (p.source) meta.push(p.source);
    if (p.doi) meta.push(`<a href="https://doi.org/${p.doi}" target="_blank" rel="noopener">DOI ↗</a>`);
    return `<div class="pub-card"><div class="pub-card__title">${p.title || "(sem título)"}</div><div class="pub-card__meta">${meta.join(" · ")}</div></div>`;
  }

  /* ---------------- utilidades ---------------- */
  function initials(name) {
    const parts = name.trim().split(/\s+/);
    return ((parts[0]?.[0] || "") + (parts[parts.length - 1]?.[0] || "")).toUpperCase();
  }
  function colorFor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    return CAT_COLORS[hash % CAT_COLORS.length];
  }

  function wireBackButton() {
    d3.select("#btn-back").on("click", (ev) => {
      ev.preventDefault();
      if (document.referrer && document.referrer.includes(location.host)) history.back();
      else location.href = "index.html";
    });
  }
})();
