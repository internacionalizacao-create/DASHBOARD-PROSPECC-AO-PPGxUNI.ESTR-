/* ==========================================================================
   FAAP Dashboard — Página ODS: 17 ODS da ONU × linhas de pesquisa da UEA

   Dados: ../data/ods.json (gerado por etl/ods_classify.py)
     ods       - [{n, cor, nome, meta, imagem}]
     linhas    - {linha_id: {ppg_codigo, titulo, ods: [{n, sim, peso}], fraca}}
     contatos  - {instituicao: {pais, n_pesquisadores, ods: {n: {pesquisadores, matches}}}}
     openalex  - null (créditos OpenAlex pendentes) ou
                 {from_year, limiar_score_ods,
                  instituicoes: {nome: {pais, total_trabalhos, ods: {n: trabalhos}}}}
   ========================================================================== */
(async function () {
  const D = await fetch("../data/ods.json", { cache: "no-cache" }).then((r) => r.json());
  initThemeToggle();

  const { ods: ODS, linhas: LINHAS, contatos: CONTATOS, openalex: OA } = D;
  const OA_INST = OA ? OA.instituicoes : null;
  const N_LINHAS = Object.keys(LINHAS).length;
  const MIN_TRABALHOS_ESTAVEL = 500; // abaixo disso a participação % por ODS é ruidosa (estrategia.txt)
  const TOP_MATRIZ = 25;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const odsByN = new Map(ODS.map((o) => [o.n, o]));
  const pct = (x, d = 1) => (x * 100).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }) + "%";

  /* ---------- linhas por ODS ---------- */
  const linhasPorOds = new Map(ODS.map((o) => [o.n, []]));
  for (const [id, l] of Object.entries(LINHAS)) {
    l.ods.forEach((o, i) => linhasPorOds.get(o.n).push({ id, ...l, peso: o.peso, sim: o.sim, principal: i === 0 }));
  }
  for (const arr of linhasPorOds.values()) arr.sort((a, b) => b.peso - a.peso || b.sim - a.sim);
  // peso do ODS no conjunto das linhas da UEA (soma dos pesos / nº de linhas) — usado na pontuação temática
  const pesoUEA = new Map(ODS.map((o) => [o.n, linhasPorOds.get(o.n).reduce((s, l) => s + l.peso, 0) / N_LINHAS]));

  /* ---------- estado ---------- */
  const params = new URLSearchParams(location.search);
  let selected = odsByN.has(+params.get("ods")) ? +params.get("ods") : null;
  let pais = params.get("pais") || "";
  let metric = "contatos";

  /* ---------- barra de estatísticas ---------- */
  const nInst = Object.keys(CONTATOS).length;
  const nFracas = Object.values(LINHAS).filter((l) => l.fraca).length;
  document.getElementById("topbar-stats").innerHTML = `
    <div class="topbar__stat" data-help="Os 17 Objetivos de Desenvolvimento Sustentável da Agenda 2030 da ONU."><b>17</b><small>ODS</small></div>
    <div class="topbar__stat" data-help="Linhas de pesquisa oficiais dos PPGs da UEA classificadas em ODS por similaridade semântica."><b>${fmt(N_LINHAS)}</b><small>Linhas UEA classificadas</small></div>
    <div class="topbar__stat" data-help="Linhas cuja melhor similaridade ficou abaixo do limiar de confiança (${D.metodo.min_sim.toString().replace(".", ",")}). Aparecem marcadas como 'baixa confiança' nas listas."><b>${fmt(nFracas)}</b><small>Baixa confiança</small></div>
    <div class="topbar__stat" data-help="Instituições estrangeiras com pelo menos um pesquisador de match forte (score ≥ ${D.metodo.score_alto_matching.toString().replace(".", ",")}) com linhas da UEA."><b>${fmt(nInst)}</b><small>Instituições com contatos</small></div>
    <div class="topbar__stat" data-help="${OA ? "Dados de produção por ODS do OpenAlex carregados (janela desde " + OA.from_year + ")." : "A contagem de trabalhos por ODS de cada universidade depende de consultas ao OpenAlex (etl/ods_openalex.py), ainda não executadas por falta de créditos de API."}"><b>${OA ? "OK" : "Pendente"}</b><small>OpenAlex por ODS</small></div>
  `;

  /* ---------- filtro de país ---------- */
  const paises = [...new Set([
    ...Object.values(CONTATOS).map((c) => c.pais),
    ...(OA_INST ? Object.values(OA_INST).map((c) => c.pais) : []),
  ])].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const selPais = document.getElementById("ods-pais");
  for (const p of paises) selPais.insertAdjacentHTML("beforeend", `<option value="${esc(p)}">${esc(p)}</option>`);
  if (!paises.includes(pais)) pais = "";
  selPais.value = pais;
  selPais.addEventListener("change", () => { pais = selPais.value; syncURL(); renderDetail(); renderMatrix(); });

  /* ---------- grade dos 17 ODS + logo ---------- */
  const grid = document.getElementById("ods-grid");
  grid.innerHTML = ODS.map((o) => {
    const n = linhasPorOds.get(o.n).length;
    return `<button type="button" class="ods-tile" data-ods="${o.n}" aria-pressed="false"
        aria-label="ODS ${o.n} – ${esc(o.nome)}, ${n} linhas da UEA" title="ODS ${o.n} · ${esc(o.nome)}">
        <img src="${o.imagem}" alt="ODS ${o.n} – ${esc(o.nome)}" loading="lazy" />
        <span class="ods-tile__count">${n}</span>
      </button>`;
  }).join("") +
    // a logo "Objetivos de Desenvolvimento Sustentável" fica logo depois do ODS 17
    `<div class="ods-logo"><img src="image/ods/ods.png" alt="Objetivos de Desenvolvimento Sustentável – ONU" /></div>`;
  grid.addEventListener("click", (e) => {
    const b = e.target.closest(".ods-tile");
    if (b) select(+b.dataset.ods);
  });

  function select(n) {
    selected = selected === n ? null : n;
    syncURL();
    renderGrid();
    renderDetail();
    renderMatrix();
  }

  function syncURL() {
    const q = new URLSearchParams();
    if (selected) q.set("ods", selected);
    if (pais) q.set("pais", pais);
    history.replaceState(null, "", q.toString() ? "?" + q : location.pathname);
  }

  function renderGrid() {
    grid.querySelectorAll(".ods-tile").forEach((b) => {
      const on = +b.dataset.ods === selected;
      b.classList.toggle("is-selected", on);
      b.setAttribute("aria-pressed", on);
    });
  }

  /* ---------- métricas por instituição ---------- */
  // participação do ODS n na produção da instituição (OpenAlex)
  function shareOA(inst, n) {
    const r = OA_INST && OA_INST[inst];
    return r && r.total_trabalhos ? (r.ods[n] || 0) / r.total_trabalhos : null;
  }
  // índice de especialização: participação / média das participações das universidades do mesmo país
  const mediaPaisOds = new Map();
  if (OA_INST) {
    for (const p of new Set(Object.values(OA_INST).map((r) => r.pais))) {
      const insts = Object.entries(OA_INST).filter(([, r]) => r.pais === p).map(([k]) => k);
      for (const o of ODS) {
        mediaPaisOds.set(p + "|" + o.n, insts.reduce((s, i) => s + shareOA(i, o.n), 0) / insts.length);
      }
    }
  }
  function espOA(inst, n) {
    const s = shareOA(inst, n);
    const m = mediaPaisOds.get(OA_INST[inst].pais + "|" + n);
    return s == null || !m ? null : s / m;
  }
  // pontuação temática: Σ_ods (peso do ODS nas linhas da UEA) × (índice de especialização da universidade)
  function pontuacaoTematica(inst) {
    return ODS.reduce((s, o) => s + pesoUEA.get(o.n) * (espOA(inst, o.n) || 0), 0);
  }
  const contatosDe = (inst, n) => (CONTATOS[inst] && CONTATOS[inst].ods[n] ? CONTATOS[inst].ods[n].pesquisadores : 0);
  const paisOk = (p) => !pais || p === pais;

  /* ---------- painel de detalhe ---------- */
  function renderDetail() {
    const el = document.getElementById("ods-detail");
    if (!selected) {
      el.innerHTML = `<div class="ods-detail__empty">
          <img src="image/ods/ods.png" alt="" />
          <p>Selecione um ODS para ver as linhas de pesquisa da UEA associadas e as universidades estrangeiras com pesquisadores nessas linhas.</p>
        </div>`;
      return;
    }
    const o = odsByN.get(selected);
    const linhas = linhasPorOds.get(selected);

    const rankContatos = Object.entries(CONTATOS)
      .filter(([, c]) => paisOk(c.pais))
      .map(([inst, c]) => ({ inst, pais: c.pais, v: contatosDe(inst, selected) }))
      .filter((r) => r.v > 0)
      .sort((a, b) => b.v - a.v || a.inst.localeCompare(b.inst))
      .slice(0, 10);
    const maxC = rankContatos.length ? rankContatos[0].v : 1;

    let blocoOA;
    if (OA_INST) {
      const rankOA = Object.entries(OA_INST)
        .filter(([, r]) => paisOk(r.pais))
        .map(([inst, r]) => ({ inst, pais: r.pais, share: shareOA(inst, selected), esp: espOA(inst, selected), estavel: r.total_trabalhos >= MIN_TRABALHOS_ESTAVEL }))
        .sort((a, b) => (b.esp || 0) - (a.esp || 0))
        .slice(0, 10);
      blocoOA = rankOA.length ? `<h3 class="ods-h3">Força na produção científica (OpenAlex)</h3>
        <ol class="ods-rank">${rankOA.map((r) => `
          <li title="${r.estavel ? "" : "Amostra pequena: participação instável"}">
            <span class="ods-rank__name">${esc(r.inst)}${r.estavel ? "" : ' <em class="ods-warn">⚠ amostra pequena</em>'}<small>${esc(r.pais)}</small></span>
            <span class="ods-rank__val"><b>${r.esp == null ? "—" : r.esp.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + "×"}</b><small>${r.share == null ? "" : pct(r.share)} da produção</small></span>
          </li>`).join("")}</ol>` : "";
    } else {
      blocoOA = `<div class="ods-pending"><b>Força da universidade neste ODS: aguardando OpenAlex.</b>
        Depende da contagem de trabalhos por ODS de cada instituição (participação % e índice de especialização),
        que ainda não foi coletada por falta de créditos de API. Quando houver, basta rodar
        <code>etl/ods_openalex.py</code> e <code>etl/ods_classify.py</code>.</div>`;
    }

    el.innerHTML = `
      <div class="ods-detail__head" style="--ods-cor:${o.cor}">
        <img src="${o.imagem}" alt="" />
        <div>
          <div class="ods-detail__kicker">ODS ${o.n}</div>
          <h2>${esc(o.nome)}</h2>
          <p>${esc(o.meta)}</p>
        </div>
        <button type="button" class="ods-detail__close" id="ods-close" aria-label="Limpar seleção">×</button>
      </div>

      <h3 class="ods-h3">Linhas de pesquisa da UEA <span class="muted">(${linhas.length})</span></h3>
      ${linhas.length ? `<ul class="ods-linhas">${linhas.map((l) => `
        <li>
          <span class="ods-chip">${esc(l.ppg_codigo)}</span>
          <span class="ods-linhas__t">${esc(l.titulo)}${l.fraca ? ' <em class="ods-warn" title="Similaridade abaixo do limiar de confiança">baixa confiança</em>' : ""}</span>
          <span class="ods-linhas__p" title="Peso do ODS na linha (similaridade ${l.sim.toString().replace(".", ",")})">${l.principal ? "principal · " : ""}${pct(l.peso, 0)}</span>
        </li>`).join("")}</ul>` : `<div class="empty-hint">Nenhuma linha da UEA foi classificada neste ODS.</div>`}

      <h3 class="ods-h3">Universidades com pesquisadores nessas linhas${pais ? ` <span class="muted">· ${esc(pais)}</span>` : ""}</h3>
      ${rankContatos.length ? `<ol class="ods-rank">${rankContatos.map((r) => `
        <li>
          <span class="ods-rank__name">${esc(r.inst)}<small>${esc(r.pais)}</small></span>
          <span class="ods-rank__bar"><i style="width:${(r.v / maxC) * 100}%;background:${o.cor}"></i></span>
          <span class="ods-rank__val"><b>${fmt(r.v)}</b><small>pesquisadores</small></span>
        </li>`).join("")}</ol>` : `<div class="empty-hint">Sem pesquisadores de match forte neste recorte.</div>`}

      ${blocoOA}`;
    document.getElementById("ods-close").addEventListener("click", () => select(selected));
  }

  /* ---------- matriz universidade × ODS ---------- */
  const selMetric = document.getElementById("ods-metric");
  selMetric.innerHTML = `
    <option value="contatos">Pesquisadores com match forte</option>
    <option value="share" ${OA ? "" : "disabled"}>Participação no ODS (OpenAlex)${OA ? "" : " — pendente"}</option>
    <option value="esp" ${OA ? "" : "disabled"}>Índice de especialização (OpenAlex)${OA ? "" : " — pendente"}</option>`;
  selMetric.addEventListener("change", () => { metric = selMetric.value; renderMatrix(); });

  function renderMatrix() {
    const usaOA = metric !== "contatos";
    const fonte = usaOA ? OA_INST : CONTATOS;
    let linhas = Object.entries(fonte).filter(([, r]) => paisOk(r.pais)).map(([inst, r]) => {
      const cells = ODS.map((o) => {
        if (metric === "contatos") return contatosDe(inst, o.n);
        return metric === "share" ? shareOA(inst, o.n) : espOA(inst, o.n);
      });
      const total = metric === "contatos" ? r.n_pesquisadores : (metric === "esp" ? pontuacaoTematica(inst) : r.total_trabalhos);
      return { inst, pais: r.pais, cells, total, pequena: usaOA && r.total_trabalhos < MIN_TRABALHOS_ESTAVEL };
    });
    const sortIdx = selected ? selected - 1 : null;
    linhas.sort((a, b) => (sortIdx != null ? (b.cells[sortIdx] || 0) - (a.cells[sortIdx] || 0) : 0) || b.total - a.total);
    const cortado = !pais && linhas.length > TOP_MATRIZ ? linhas.length - TOP_MATRIZ : 0;
    if (cortado) linhas = linhas.slice(0, TOP_MATRIZ);

    const notes = {
      contatos: "Pesquisadores distintos da instituição com match forte (score ≥ " + D.metodo.score_alto_matching.toString().replace(".", ",") + ") com linhas da UEA classificadas no ODS. É a parte “tem gente concreta para contatar”; não mede a força da universidade no tema.",
      share: "Percentual dos trabalhos da instituição (desde " + (OA && OA.from_year) + ") que o OpenAlex classifica no ODS (score ≥ " + (OA && OA.limiar_score_ods) + "). Multi-rótulo: um trabalho pode contar em vários ODS.",
      esp: "Participação do ODS na produção da universidade dividida pela média das universidades do mesmo país (1× = na média; > 1× = especializada). A última coluna é a pontuação temática: Σ (peso do ODS nas linhas da UEA × especialização).",
    };
    document.getElementById("ods-matrix-note").textContent =
      notes[metric] + (cortado ? ` Mostrando as ${TOP_MATRIZ} primeiras de ${linhas.length + cortado} instituições; use o filtro de país para ver as demais.` : "");

    const vals = linhas.flatMap((l) => l.cells).filter((v) => v != null);
    const max = Math.max(...vals, 0) || 1;
    const fmtCell = (v) => {
      if (v == null || v === 0) return "";
      if (metric === "contatos") return fmt(v);
      if (metric === "share") return (v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
      return v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
    };
    const totalLabel = { contatos: "Total", share: "Trabalhos", esp: "Pontuação" }[metric];
    const fmtTotal = (v) => (metric === "esp" ? v.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : fmt(v));

    if (!linhas.length) {
      document.getElementById("ods-matrix").innerHTML = `<div class="empty-hint">Sem dados para este recorte.</div>`;
      return;
    }
    document.getElementById("ods-matrix").innerHTML = `
      <table class="ods-matrix">
        <thead><tr>
          <th class="ods-matrix__inst">Instituição</th>
          ${ODS.map((o) => `<th class="ods-matrix__ods${o.n === selected ? " is-selected" : ""}" data-ods="${o.n}" title="ODS ${o.n} · ${esc(o.nome)}">
              <img src="${o.imagem}" alt="ODS ${o.n}" /></th>`).join("")}
          <th class="ods-matrix__total">${totalLabel}</th>
        </tr></thead>
        <tbody>${linhas.map((l) => `
          <tr${l.pequena ? ' class="is-small" title="Poucos trabalhos indexados: resultado instável"' : ""}>
            <th class="ods-matrix__inst" scope="row">${esc(l.inst)}${l.pequena ? ' <em class="ods-warn">⚠</em>' : ""}<small>${esc(l.pais)}</small></th>
            ${l.cells.map((v, i) => {
              const a = v ? Math.round(Math.sqrt(v / max) * 100) : 0;
              return `<td class="${ODS[i].n === selected ? "is-selected" : ""}" style="${a ? `--a:${a}%` : ""}"${v ? ` title="ODS ${ODS[i].n}: ${fmtCell(v)}"` : ""}>${fmtCell(v)}</td>`;
            }).join("")}
            <td class="ods-matrix__total">${fmtTotal(l.total)}</td>
          </tr>`).join("")}</tbody>
      </table>`;
    document.querySelectorAll(".ods-matrix__ods").forEach((th) =>
      th.addEventListener("click", () => select(+th.dataset.ods)));
  }

  renderGrid();
  renderDetail();
  renderMatrix();
})();
