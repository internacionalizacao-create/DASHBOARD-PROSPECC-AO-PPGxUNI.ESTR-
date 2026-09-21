/* ==========================================================================
   FAAP Dashboard — geração de Relatório de Prospecção (HTML imprimível)

   Recebe o recorte JÁ FILTRADO pela página (mesmos filtros do painel: PPG,
   linha de pesquisa, país, instituição, professor…) e monta um documento
   HTML autônomo, aberto numa aba nova, pronto para "Salvar como PDF" via
   diálogo de impressão do navegador. Não depende de libs externas.

   Toda linha de pesquisa em `matches` é oficial de um PPG (nome + descrição
   da planilha da UEA) — não existe mais distinção "match real x match por
   palavra-chave".
   ========================================================================== */

function reportEsc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

/* ---------- ODS de cada linha de pesquisa ---------- */
// definido em generateProspectingReport (dados de data/ods.json); null = sem tags de ODS
let reportOds = null;

function reportOdsTags(linhaId) {
  if (!reportOds) return "";
  const c = reportOds.linhas[linhaId];
  if (!c) return "";
  return c.ods.map((o) => {
    const meta = reportOds.ods.find((x) => x.n === o.n);
    const tip = `ODS ${o.n} · ${meta.nome} (peso ${Math.round(o.peso * 100)}%)${c.fraca ? " · baixa confiança" : ""}`;
    return `<span class="tag tag--ods" style="background:${meta.cor}" title="${reportEsc(tip)}">ODS ${o.n}</span>`;
  }).join("");
}

function reportFmt(n) { return Number(n || 0).toLocaleString("pt-BR"); }

async function fetchLogoDataURI() {
  try {
    const svgText = await fetch("image/propespuea.svg").then((r) => r.text());
    return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgText)));
  } catch {
    return null;
  }
}

/* professores da UEA vinculados a algum PPG do conjunto informado */
function profsForPpgs(professores, ppgCodigos) {
  return professores.filter((p) => p.programas.some((c) => ppgCodigos.has(c)));
}

/* ---------- descrição legível dos filtros aplicados ---------- */
function describeReportFilters(filters, professorById, linhaById) {
  const chips = [];
  if (filters.ppgs.size) chips.push(`PPG: ${[...filters.ppgs].join(", ")}`);
  if (filters.linhaIds.size) {
    const titulos = [...filters.linhaIds].map((id) => linhaById.get(id)?.titulo || id);
    chips.push(`Linhas de pesquisa: ${titulos.join(", ")}`);
  }
  if (filters.pais) chips.push(`País: ${filters.pais}`);
  if (filters.instituicao) chips.push(`Instituição: ${filters.instituicao}`);
  if (filters.professorId) {
    const prof = professorById.get(filters.professorId);
    chips.push(`Professor: ${prof ? prof.nome : "#" + filters.professorId}`);
  }
  return chips;
}

/* ---------- agregações ---------- */
function aggregateForReport(matches) {
  const byCountry = new Map(); // pais -> { instituicoes:Set, ppgs:Set, conexoes }
  const byInstitution = new Map(); // instituicao -> { pais, ppgs:Set, estrangeiros:Set, conexoes }
  const byForeignResearcher = new Map(); // orcid|nome -> { nome, instituicao, pais, conexoes }

  for (const m of matches) {
    if (!byCountry.has(m.foreign_country)) {
      byCountry.set(m.foreign_country, { instituicoes: new Set(), ppgs: new Set(), conexoes: 0 });
    }
    const c = byCountry.get(m.foreign_country);
    c.instituicoes.add(m.foreign_institution);
    c.ppgs.add(m.ppg_codigo);
    c.conexoes += 1;

    if (!byInstitution.has(m.foreign_institution)) {
      byInstitution.set(m.foreign_institution, {
        pais: m.foreign_country, ppgs: new Set(), estrangeiros: new Set(), conexoes: 0,
      });
    }
    const inst = byInstitution.get(m.foreign_institution);
    inst.ppgs.add(m.ppg_codigo);
    inst.estrangeiros.add(m.foreign_author_orcid || m.foreign_author_name);
    inst.conexoes += 1;

    const fKey = m.foreign_author_orcid || m.foreign_author_name;
    if (!byForeignResearcher.has(fKey)) {
      byForeignResearcher.set(fKey, {
        nome: m.foreign_author_name, instituicao: m.foreign_institution, pais: m.foreign_country,
        conexoes: 0, ppgs: new Map(), // ppg_codigo -> conexões com esse PPG
      });
    }
    const fEntry = byForeignResearcher.get(fKey);
    fEntry.conexoes += 1;
    fEntry.ppgs.set(m.ppg_codigo, (fEntry.ppgs.get(m.ppg_codigo) || 0) + 1);
  }

  return { byCountry, byInstitution, byForeignResearcher };
}

/* ---------- linhas de pesquisa, separadas por PPG ---------- */
function aggregateLinhasByPPG(matches) {
  const byPPG = new Map(); // ppg_codigo -> Map(linha_titulo -> { linhaId, n })
  for (const m of matches) {
    if (!byPPG.has(m.ppg_codigo)) byPPG.set(m.ppg_codigo, new Map());
    const mm = byPPG.get(m.ppg_codigo);
    const e = mm.get(m.linha_titulo) || { linhaId: m.linha_id, n: 0 };
    e.n += 1;
    mm.set(m.linha_titulo, e);
  }
  return byPPG;
}

function buildLinhasByPPGSection(matches) {
  const byPPG = aggregateLinhasByPPG(matches);
  const ppgEntries = [...byPPG.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));

  const blocks = ppgEntries.map(([ppg, linhaMap]) => {
    const entries = [...linhaMap.entries()].sort((a, b) => b[1].n - a[1].n);
    const rows = entries
      .map(([titulo, e]) => `<tr><td>${reportEsc(titulo)}${reportOdsTags(e.linhaId)}</td><td class="num">${reportFmt(e.n)}</td></tr>`).join("");

    return `
      <div class="ppg-block">
        <h3>${reportEsc(ppg)}</h3>
        <table class="report-table report-table--compact">
          <thead><tr><th>Linha de pesquisa</th><th class="num">Conexões</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join("");

  return `
    <section class="report-section">
      <h2>Linhas de pesquisa com conexão internacional, por PPG</h2>
      <p class="report-note">Para cada Programa de Pós-Graduação da UEA presente no recorte atual, as linhas de pesquisa oficiais com mais conexões internacionais identificadas.${reportOds ? " Ao lado de cada linha, o(s) ODS da ONU em que ela foi classificada (similaridade semântica; até 3 por linha)." : ""}</p>
      <div class="ppg-grid">${blocks || ""}</div>
      ${!blocks ? '<p class="report-note">Sem linhas de pesquisa com conexão para os filtros atuais.</p>' : ""}
    </section>`;
}

/* ---------- hierarquia Instituição estrangeira > Linha de pesquisa > Pesquisadores estrangeiros ---------- */
function aggregateInstitutionHierarchy(matches) {
  const byInst = new Map(); // instituicao -> { pais, ppgs:Set, estrangeiros:Set, conexoes, linhas:Map }

  for (const m of matches) {
    if (!byInst.has(m.foreign_institution)) {
      byInst.set(m.foreign_institution, {
        pais: m.foreign_country, ppgs: new Set(), estrangeiros: new Set(), conexoes: 0, linhas: new Map(),
      });
    }
    const inst = byInst.get(m.foreign_institution);
    inst.ppgs.add(m.ppg_codigo);
    inst.estrangeiros.add(m.foreign_author_orcid || m.foreign_author_name);
    inst.conexoes += 1;

    if (!inst.linhas.has(m.linha_titulo)) {
      inst.linhas.set(m.linha_titulo, { ppg_codigo: m.ppg_codigo, linha_id: m.linha_id, conexoes: 0, estrangeiros: new Map() });
    }
    const linha = inst.linhas.get(m.linha_titulo);
    linha.conexoes += 1;

    const fKey = m.foreign_author_orcid || m.foreign_author_name;
    if (!linha.estrangeiros.has(fKey)) {
      linha.estrangeiros.set(fKey, { nome: m.foreign_author_name, conexoes: 0, score: m.score });
    }
    linha.estrangeiros.get(fKey).conexoes += 1;
  }

  return byInst;
}

function buildInstitutionHierarchySection(matches) {
  const byInst = aggregateInstitutionHierarchy(matches);
  const instEntries = [...byInst.entries()].sort((a, b) => b[1].conexoes - a[1].conexoes);

  const blocks = instEntries.map(([instName, inst]) => {
    const linhaEntries = [...inst.linhas.entries()].sort((a, b) => b[1].conexoes - a[1].conexoes);

    const linhaBlocks = linhaEntries.map(([titulo, linha]) => {
      const foreignEntries = [...linha.estrangeiros.values()]
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
      const foreignChips = foreignEntries.map((f) => {
        const scoreTxt = f.score != null ? `similaridade ${f.score.toFixed(2)}` : "";
        return `<span class="chip" title="${reportEsc(scoreTxt)}">${reportEsc(f.nome)}</span>`;
      }).join("");

      return `
        <div class="linha-block">
          <h4>${reportEsc(titulo)} <span class="tag">${reportEsc(linha.ppg_codigo)}</span>${reportOdsTags(linha.linha_id)}</h4>
          <div class="prof-chips">${foreignChips || '<span class="report-note">Nenhum pesquisador identificado.</span>'}</div>
        </div>`;
    }).join("");

    return `
      <div class="inst-block">
        <h3>${reportEsc(instName)}</h3>
        <div class="inst-meta">${reportEsc(inst.pais)} · ${reportFmt(inst.ppgs.size)} PPG(s) envolvido(s) · ${reportFmt(inst.estrangeiros.size)} pesquisador(es) estrangeiro(s) · ${reportFmt(inst.conexoes)} conexões</div>
        ${linhaBlocks}
      </div>`;
  }).join("");

  return `
    <section class="report-section">
      <h2>Instituições estrangeiras</h2>
      <p class="report-note">Organizado por instituição estrangeira; dentro de cada uma, todas as linhas de pesquisa oficiais da UEA que deram match, e os pesquisadores estrangeiros daquela instituição conectados a cada linha.</p>
      ${blocks || `<p class="report-note">Sem dados para os filtros atuais.</p>`}
    </section>`;
}

/* ---------- montagem do HTML ---------- */
function buildReportHTML({ professores, matches, filters, professorById, linhaById, totals, logoDataURI }) {
  const agg = aggregateForReport(matches);
  const genDate = new Date().toLocaleString("pt-BR", { dateStyle: "long", timeStyle: "short" });
  const filterChips = describeReportFilters(filters, professorById, linhaById);

  const distinctForeign = agg.byForeignResearcher.size;
  const distinctCountries = agg.byCountry.size;
  const distinctInstitutions = agg.byInstitution.size;

  const countryRows = [...agg.byCountry.entries()]
    .sort((a, b) => b[1].conexoes - a[1].conexoes)
    .map(([pais, v]) => `
      <tr>
        <td>${reportEsc(pais)}</td>
        <td class="num">${reportFmt(v.instituicoes.size)}</td>
        <td class="num">${reportFmt(profsForPpgs(professores, v.ppgs).length)}</td>
        <td class="num">${reportFmt(v.conexoes)}</td>
      </tr>`).join("");

  const linhasByPPGSection = buildLinhasByPPGSection(matches);

  const foreignRankedRows = [...agg.byForeignResearcher.values()]
    .sort((a, b) => b.conexoes - a.conexoes)
    .map((f, i) => {
      const top3Ppgs = [...f.ppgs.entries()]
        .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([codigo]) => codigo).join(", ");
      return `
      <tr>
        <td class="num">${i + 1}</td>
        <td>${reportEsc(f.nome)}</td>
        <td>${reportEsc(f.instituicao)}</td>
        <td>${reportEsc(f.pais)}</td>
        <td>${reportEsc(top3Ppgs)}</td>
        <td class="num">${reportFmt(f.conexoes)}</td>
      </tr>`;
    }).join("");

  const institutionHierarchySection = buildInstitutionHierarchySection(matches);

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Relatório de Prospecção — Parcerias Internacionais UEA</title>
<style>
  :root {
    --ink-primary:#0b3d2b; --ink-secondary:#3a3a3c; --ink-muted:#7a8580;
    --border:#cdeedd; --border-strong:#9fd9bb; --accent:#1f8a5f; --wash:#f6faf8;
  }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Arial, sans-serif;
    color: var(--ink-secondary); margin: 0; padding: 32px 40px 60px; background: #fff;
    max-width: 980px; margin-inline: auto;
  }
  h1 { color: var(--ink-primary); font-size: 22px; margin: 0 0 4px; }
  h2 { color: var(--ink-primary); font-size: 15px; margin: 0 0 10px; border-bottom: 1px solid var(--border); padding-bottom: 6px; }
  h4 { color: var(--ink-primary); font-size: 13px; margin: 18px 0 6px; }
  h4 small { color: var(--ink-muted); font-weight: 400; margin-left: 6px; }
  .report-header { display: flex; align-items: center; gap: 16px; border-bottom: 2px solid var(--ink-primary); padding-bottom: 16px; margin-bottom: 20px; }
  .report-header img { height: 44px; }
  .report-header .meta { color: var(--ink-muted); font-size: 12px; margin-top: 4px; }
  .filter-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 24px; }
  .filter-chips span { background: var(--wash); border: 1px solid var(--border); color: var(--ink-primary);
    border-radius: 999px; padding: 3px 10px; font-size: 11.5px; }
  .filter-chips.is-empty span { color: var(--ink-muted); }
  .stat-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 26px; }
  .stat-card { background: var(--wash); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; text-align: center; }
  .stat-card b { display: block; font-size: 19px; color: var(--ink-primary); }
  .stat-card span { font-size: 10.5px; color: var(--ink-muted); }
  .report-section { margin-bottom: 28px; }
  .report-note { font-size: 12px; color: var(--ink-muted); margin: 0 0 12px; }
  table.report-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  table.report-table th, table.report-table td { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--border); }
  table.report-table th { color: var(--ink-muted); font-weight: 600; font-size: 10.5px; text-transform: uppercase; letter-spacing: .03em; }
  table.report-table td.num, table.report-table th.num { text-align: right; }
  table.report-table--compact td, table.report-table--compact th { padding: 4px 6px; font-size: 11.5px; }
  .tag { display: inline-block; font-size: 9.5px; color: var(--ink-muted); background: var(--wash); border: 1px solid var(--border);
    border-radius: 999px; padding: 1px 6px; margin-left: 4px; }
  .tag--ods { color: #fff; border-color: transparent; font-weight: 700;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .inst-block { break-inside: avoid; margin-bottom: 20px; padding-bottom: 14px; border-bottom: 1px solid var(--border); }
  .inst-block:last-child { border-bottom: none; }
  .inst-block h3 { color: var(--ink-primary); font-size: 14px; margin: 0 0 3px; }
  .inst-block .inst-meta { font-size: 11px; color: var(--ink-muted); margin-bottom: 10px; }
  .linha-block { break-inside: avoid; margin: 0 0 10px 16px; }
  .linha-block h4 { font-size: 12px; color: var(--ink-secondary); margin: 0 0 5px; font-weight: 700; }
  .ppg-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; }
  .ppg-block { break-inside: avoid; margin-bottom: 14px; }
  .ppg-block h3 { color: var(--ink-primary); font-size: 12.5px; margin: 0 0 6px; text-transform: uppercase; letter-spacing: .03em; }
  .prof-chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .prof-chips .chip { display: inline-block; font-size: 11px; color: var(--ink-primary); background: var(--wash);
    border: 1px solid var(--border); border-radius: 999px; padding: 2px 9px; }
  .report-footer { margin-top: 40px; padding-top: 14px; border-top: 1px solid var(--border); font-size: 10.5px; color: var(--ink-muted); }
  .print-bar { position: sticky; top: 0; background: #fff; padding: 10px 0 16px; display: flex; justify-content: flex-end; gap: 8px; }
  .print-bar button { font: inherit; font-size: 13px; padding: 8px 16px; border-radius: 8px; border: 1px solid var(--border-strong);
    background: var(--accent); color: #fff; cursor: pointer; }
  .print-bar button:hover { opacity: .9; }
  @media print {
    .print-bar { display: none; }
    body { padding: 0 6mm; max-width: none; }
    .inst-block, .linha-block, .ppg-block { page-break-inside: avoid; }
    @page { margin: 14mm; }
  }
</style>
</head>
<body>

<div class="print-bar">
  <button type="button" onclick="window.print()">Imprimir / Salvar como PDF</button>
</div>

<div class="report-header">
  ${logoDataURI ? `<img src="${logoDataURI}" alt="PROPESP UEA" />` : ""}
  <div>
    <h1>Relatório de Prospecção de Parcerias Internacionais</h1>
    <div class="meta">PPGs UEA × Mundo, por linha de pesquisa · gerado em ${reportEsc(genDate)}</div>
  </div>
</div>

<div class="filter-chips${filterChips.length ? "" : " is-empty"}">
  ${filterChips.length ? filterChips.map((c) => `<span>${reportEsc(c)}</span>`).join("") : "<span>Nenhum filtro aplicado — base completa do painel.</span>"}
</div>

<div class="stat-grid">
  <div class="stat-card"><b>${reportFmt(professores.length)}</b><span>Professores UEA (de ${reportFmt(totals.professores)})</span></div>
  <div class="stat-card"><b>${reportFmt(distinctInstitutions)}</b><span>Instituições estrangeiras (de ${reportFmt(totals.institutions)})</span></div>
  <div class="stat-card"><b>${reportFmt(distinctCountries)}</b><span>Países</span></div>
  <div class="stat-card"><b>${reportFmt(matches.length)}</b><span>Conexões</span></div>
  <div class="stat-card"><b>${reportFmt(distinctForeign)}</b><span>Pesquisadores estrangeiros</span></div>
</div>

<section class="report-section">
  <h2>Distribuição por país</h2>
  <table class="report-table">
    <thead><tr><th>País</th><th class="num">Instituições</th><th class="num">Professores UEA (PPGs envolvidos)</th><th class="num">Conexões</th></tr></thead>
    <tbody>${countryRows || `<tr><td colspan="4">Sem dados para os filtros atuais.</td></tr>`}</tbody>
  </table>
</section>

${linhasByPPGSection}

${institutionHierarchySection}

<section class="report-section">
  <h2>Pesquisadores estrangeiros mais conectados</h2>
  <table class="report-table">
    <thead><tr><th class="num">#</th><th>Nome</th><th>Instituição</th><th>País</th><th>PPGs mais conectados</th><th class="num">Conexões</th></tr></thead>
    <tbody>${foreignRankedRows || `<tr><td colspan="6">Sem dados para os filtros atuais.</td></tr>`}</tbody>
  </table>
</section>

<div class="report-footer">
  Gerado automaticamente pelo Painel de Parcerias Internacionais — PROPESP/UEA. Fonte dos matches: linha de pesquisa oficial de cada PPG (nome + descrição) × publicações de pesquisadores estrangeiros indexadas no OpenAlex, ranqueados por similaridade semântica (Sentence-BERT).
</div>

</body>
</html>`;
}

/* ---------- ponto de entrada usado pela página ----------
   window.open() PRECISA ser chamado de forma síncrona, dentro do próprio
   handler de clique — se rolar depois de um `await` (ex.: esperando o fetch
   da logo), a maioria dos navegadores não reconhece mais o gesto do usuário
   e bloqueia a aba silenciosamente (sem erro no console, sem cair no
   `if (!win)`). Por isso abrimos a aba (em branco, com uma mensagem de
   carregando) ANTES de qualquer await, e só depois preenchemos o conteúdo. */
function generateProspectingReport({ professores, matches, filters, professorById, linhaById, totals, odsData }) {
  reportOds = odsData || null;
  const win = window.open("", "_blank");
  if (!win) {
    alert("O navegador bloqueou a abertura da nova aba. Permita pop-ups para este site e tente novamente.");
    return;
  }
  win.document.write(
    '<!doctype html><meta charset="utf-8"><title>Gerando relatório…</title>' +
    '<body style="font-family:-apple-system,sans-serif;color:#3a3a3c;padding:40px;">Gerando relatório de prospecção…</body>'
  );

  const btn = document.getElementById("btn-report");
  if (btn) { btn.disabled = true; btn.textContent = "Gerando…"; }

  fetchLogoDataURI()
    .then((logoDataURI) => {
      const html = buildReportHTML({ professores, matches, filters, professorById, linhaById, totals, logoDataURI });
      win.document.open();
      win.document.write(html);
      win.document.close();
    })
    .catch((err) => {
      win.document.open();
      win.document.write(
        '<!doctype html><meta charset="utf-8"><title>Erro</title>' +
        '<body style="font-family:-apple-system,sans-serif;color:#b00020;padding:40px;">' +
        "Erro ao gerar o relatório: " + reportEsc(err && err.message ? err.message : String(err)) + "</body>"
      );
      win.document.close();
      console.error("generateProspectingReport falhou:", err);
    })
    .finally(() => {
      if (btn) { btn.disabled = false; btn.textContent = "Gerar relatório de prospecção"; }
    });
}

window.generateProspectingReport = generateProspectingReport;
