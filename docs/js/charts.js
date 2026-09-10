/* ==========================================================================
   GERBRAS Dashboard — funções de gráfico (D3): Sankey, mapa, barras
   ========================================================================== */

/* ---------------- Sankey: linha de pesquisa (oficial do PPG) -> instituição estrangeira ---------------- */
const OTHER_INSTITUTIONS_LABEL = "Outras instituições";
const OTHER_LINHAS_LABEL = "Outras linhas de pesquisa";

const SANKEY_COLUMN_ORDER = ["linha", "instituicao"];
const SANKEY_COLUMN_DEFS = {
  linha: { label: "Linha de pesquisa", key: (m) => m.linha_titulo },
  instituicao: { label: "Instituição estrangeira", key: (m) => m.foreign_institution },
};

function buildSankeyGraph(matchSubset, opts) {
  // cada linha pertence a exatamente um PPG — usado pra colorir os nós de
  // "linha" pela cor do PPG dono (ver colorForPPG/buildPPGColorScale em common.js)
  const ppgByTitulo = new Map(matchSubset.map((m) => [m.linha_titulo, m.ppg_codigo]));

  const cols = SANKEY_COLUMN_ORDER.map((id) => {
    const def = SANKEY_COLUMN_DEFS[id];
    const maxN = id === "linha" ? opts.maxLinhas : opts.maxInstitutions;
    const otherLabel = id === "linha" ? OTHER_LINHAS_LABEL : OTHER_INSTITUTIONS_LABEL;
    const counts = countBy(matchSubset, def.key);
    const topList = topEntries(counts, maxN).map(([k]) => k);
    return { id, key: def.key, label: def.label, otherLabel, topSet: new Set(topList), topList };
  });

  const nodeRealTotal = new Map();
  const linkMap = new Map();
  // similaridade SBERT (linha oficial x publicação do candidato) — score já
  // vem calculado por linha_match.py, um valor por match
  const linkScoreAgg = new Map();
  const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);

  for (const m of matchSubset) {
    const vals = cols.map((c) => (c.topSet.has(c.key(m)) ? c.key(m) : c.otherLabel));
    vals.forEach((v, i) => bump(nodeRealTotal, i + "::" + v));
    const linkKey = vals[0] + "|||" + vals[1];
    bump(linkMap, linkKey);
    if (m.score != null) {
      const agg = linkScoreAgg.get(linkKey) || { sum: 0, n: 0 };
      agg.sum += m.score;
      agg.n += 1;
      linkScoreAgg.set(linkKey, agg);
    }
  }

  const nodes = [];
  const nodeIndex = new Map();
  cols.forEach((c, i) => {
    const order = [...c.topList, c.otherLabel].filter((n) => nodeRealTotal.has(i + "::" + n));
    order.forEach((name) => {
      nodeIndex.set(i + "::" + name, nodes.length);
      nodes.push({
        name, colId: c.id, colIndex: i,
        isFirst: i === 0, isLast: i === cols.length - 1,
        realValue: nodeRealTotal.get(i + "::" + name) || 0,
      });
    });
  });

  const OTHER_LINK_WEIGHT = 1;
  const links = [];
  const colA = cols[0], colB = cols[1];
  for (const [key, value] of linkMap.entries()) {
    const [a, b] = key.split("|||");
    const isOther = a === colA.otherLabel || b === colB.otherLabel;
    const scoreAgg = linkScoreAgg.get(key);
    links.push({
      source: nodeIndex.get("0::" + a),
      target: nodeIndex.get("1::" + b),
      value: isOther ? OTHER_LINK_WEIGHT : value,
      realValue: value,
      linha: a,
      tooltipLabel: a,
      avgSimilarity: scoreAgg ? scoreAgg.sum / scoreAgg.n : null,
      isOther,
    });
  }
  links.sort((a, b) => (a.isOther === b.isOther ? 0 : a.isOther ? -1 : 1));

  return { nodes, links, cols, ppgByTitulo };
}

function renderSankey(el, matchSubset, ppgColorInfo, opts = {}) {
  const container = d3.select(el);
  container.selectAll("*").remove();
  const width = el.clientWidth, height = el.clientHeight;

  if (!matchSubset.length || width < 10 || height < 10) {
    container.append("div").attr("class", "empty-hint").text("Nenhuma parceria potencial para os filtros selecionados.");
    return;
  }

  const maxInst = opts.maxInstitutions || 24;
  const maxLinhas = opts.maxLinhas || 22;
  const graph = buildSankeyGraph(matchSubset, { maxInstitutions: maxInst, maxLinhas });

  const HEADER_H = 30;
  const sankeyLayout = d3.sankey()
    .nodeId((d) => d.index)
    .nodeWidth(10)
    .nodePadding(10)
    .nodeSort((a, b) => (b.value || 0) - (a.value || 0))
    .extent([[150, HEADER_H], [width - 165, height - 6]]);

  const graphNodes = graph.nodes.map((d, i) => ({ ...d, index: i }));
  const graphLinks = graph.links.map((d) => ({ ...d }));
  const { nodes, links } = sankeyLayout({ nodes: graphNodes, links: graphLinks });

  const svg = container.append("svg").attr("width", width).attr("height", height);

  // cor de um nó/link de "linha" = cor do PPG dono dela (mesma cor usada na
  // checklist de PPGs e na lista de linhas — ver buildPPGColorScale/colorForPPG
  // em common.js); o balde "Outras linhas de pesquisa" fica neutro (mistura PPGs)
  const colorForName = (name) => {
    if (name === OTHER_LINHAS_LABEL) return OTHER_COLOR;
    const ppg = graph.ppgByTitulo.get(name);
    return ppg ? colorForPPG(ppg, ppgColorInfo) : OTHER_COLOR;
  };
  const colorForNode = (d) => (d.colId === "linha" ? colorForName(d.name) : CHART_NODE_NEUTRAL);
  const colorForLink = (linha) => (linha == null ? CHART_NODE_NEUTRAL : colorForName(linha));

  const headerG = svg.append("g").attr("class", "sankey-col-headers");
  graph.cols.forEach((c, i) => {
    const colNodes = nodes.filter((n) => n.colIndex === i);
    if (!colNodes.length) return;
    const cx = (d3.min(colNodes, (n) => n.x0) + d3.max(colNodes, (n) => n.x1)) / 2;
    headerG.append("text")
      .attr("class", "sankey-col-title")
      .attr("x", cx).attr("y", HEADER_H - 12).attr("text-anchor", "middle")
      .text(c.label);
  });

  const linkG = svg.append("g").attr("fill", "none");
  const linkPaths = linkG.selectAll("path")
    .data(links)
    .join("path")
    .attr("class", "sankey-link")
    .attr("d", d3.sankeyLinkHorizontal())
    .attr("stroke", (d) => colorForLink(d.linha))
    .attr("stroke-opacity", (d) => (d.isOther ? 0.22 : 0.42))
    .attr("stroke-width", (d) => Math.max(d.isOther ? 0.6 : 1.2, d.width));

  const nodeG = svg.append("g");
  const nodeSel = nodeG.selectAll("g")
    .data(nodes)
    .join("g")
    .attr("class", "sankey-node");

  nodeSel.append("rect")
    .attr("x", (d) => d.x0)
    .attr("y", (d) => d.y0)
    .attr("width", (d) => d.x1 - d.x0)
    .attr("height", (d) => Math.max(2, d.y1 - d.y0))
    .attr("rx", 3)
    .attr("fill", colorForNode);

  nodeSel.filter((d) => d.isFirst || d.isLast).append("text")
    .attr("x", (d) => (d.isFirst ? d.x0 - 8 : d.x1 + 8))
    .attr("y", (d) => (d.y0 + d.y1) / 2)
    .attr("dy", "0.35em")
    .attr("text-anchor", (d) => (d.isFirst ? "end" : "start"))
    .text((d) => truncateLabel(d.name, d.isFirst ? 26 : 30));

  nodeSel.append("title").text((d) => `${d.name}\n${fmt(d.realValue)} conexão(ões)`);

  function dim(predicateLink, predicateNode) {
    linkPaths.classed("is-dim", predicateLink);
    nodeSel.classed("is-dim", predicateNode);
  }

  const isClickable = (d) =>
    (d.colId === "linha" && d.name !== OTHER_LINHAS_LABEL) ||
    (d.colId === "instituicao" && d.name !== OTHER_INSTITUTIONS_LABEL);
  const activeLinhas = opts.activeLinhaTitulos || new Set();
  nodeSel.classed("is-selected", (d) =>
    (d.colId === "linha" && activeLinhas.has(d.name)) ||
    (d.colId === "instituicao" && !!opts.activeInstituicao && d.name === opts.activeInstituicao)
  );

  linkPaths
    .on("mousemove", function (ev, d) {
      dim((l) => l !== d, (n) => n !== d.source && n !== d.target);
      showTooltip(ev.clientX, ev.clientY,
        `<b>${d.tooltipLabel}</b><br>${truncateLabel(d.target.name, 40)}<br>${fmt(d.realValue)} conexão(ões)` +
        (d.avgSimilarity != null ? `<br>Similaridade (SBERT): ${d.avgSimilarity.toFixed(2)}` : ""));
      opts.onLinkHover && opts.onLinkHover(d);
    })
    .on("mouseleave", function () { dim(() => false, () => false); hideTooltip(); opts.onLinkHover && opts.onLinkHover(null); });

  nodeSel
    .style("cursor", (d) => (isClickable(d) ? "pointer" : "default"))
    .on("click", (ev, d) => {
      if (!isClickable(d)) return;
      if (d.colId === "linha") opts.onLinhaClick && opts.onLinhaClick(d.name);
      else if (d.colId === "instituicao") opts.onInstituicaoClick && opts.onInstituicaoClick(d.name);
    })
    .on("mousemove", function (ev, d) {
      dim((l) => l.source !== d && l.target !== d, (n) => n !== d);
      showTooltip(ev.clientX, ev.clientY, `<b>${d.name}</b><br>${fmt(d.realValue)} conexão(ões)`);
    })
    .on("mouseleave", function () { dim(() => false, () => false); hideTooltip(); opts.onLinkHover && opts.onLinkHover(null); });
}

function truncateLabel(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }

/* ---------------- Mapa: países estrangeiros com match ---------------- */
let _worldCache = null;
async function getWorld() {
  if (!_worldCache) {
    const topo = await fetch("lib/countries-110m.json").then((r) => r.json());
    _worldCache = topojson.feature(topo, topo.objects.countries);
  }
  return _worldCache;
}

/* ---------------- Mini-mapa: localização de uma instituição ---------------- */
async function renderInstitutionMap(el, lat, lon, label) {
  const container = d3.select(el);
  container.selectAll("*").remove();
  const width = el.clientWidth, height = el.clientHeight;
  if (width < 10 || height < 10) return;

  const world = await getWorld();
  const pad = 5;
  const bbox = {
    type: "Polygon",
    coordinates: [[[lon - pad, lat - pad], [lon + pad, lat - pad], [lon + pad, lat + pad], [lon - pad, lat + pad], [lon - pad, lat - pad]]],
  };
  const projection = d3.geoMercator().fitExtent([[10, 10], [width - 10, height - 10]], bbox);
  const path = d3.geoPath(projection);

  const svg = container.append("svg").attr("width", width).attr("height", height);
  svg.append("g").selectAll("path.country")
    .data(world.features)
    .join("path")
    .attr("class", "map-country")
    .attr("fill", CHART_MAP_FILL)
    .attr("stroke", CHART_MAP_BORDER)
    .attr("stroke-width", 1)
    .attr("d", path);

  const xy = projection([lon, lat]);
  const g = svg.append("g").attr("transform", `translate(${xy[0]},${xy[1]})`);
  g.append("circle").attr("r", 7).attr("fill", CHART_NODE_NEUTRAL).attr("stroke", CHART_MAP_BORDER).attr("stroke-width", 2);
  g.append("circle").attr("r", 7).attr("fill", "none").attr("stroke", CHART_NODE_NEUTRAL).attr("stroke-width", 1.4).attr("opacity", 0.5)
    .append("animate").attr("attributeName", "r").attr("values", "7;20;7").attr("dur", "2.4s").attr("repeatCount", "indefinite");

  if (label) {
    svg.append("text").attr("x", xy[0]).attr("y", xy[1] - 14).attr("text-anchor", "middle")
      .attr("class", "bar-label").style("font-weight", 800)
      .text(truncateLabel(label, 30));
  }
}

async function renderCountryMap(el, matchSubset) {
  const container = d3.select(el);
  container.selectAll("*").remove();
  const width = el.clientWidth, height = el.clientHeight;
  if (width < 10 || height < 10) return;

  const world = await getWorld();
  const counts = countBy(matchSubset, (m) => m.foreign_country);
  const maxV = d3.max([...counts.values()]) || 1;
  const colorScale = d3.scaleQuantize().domain([0, maxV]).range(GREEN_SEQUENTIAL);

  const countryNameToCount = new Map();
  for (const [pt, v] of counts) countryNameToCount.set(normalizeCountry(pt), v);

  const svg = container.append("svg").attr("width", width).attr("height", height);

  const matchedFeatures = world.features.filter((f) => countryNameToCount.has(normalizeCountry(f.properties.name)));
  const frame = matchedFeatures.length
    ? { type: "FeatureCollection", features: matchedFeatures }
    : { type: "Sphere" };
  const projection = d3.geoMercator().fitExtent([[10, 10], [width - 10, height - 10]], frame);
  const path = d3.geoPath(projection);

  svg.append("path").attr("class", "map-sphere").attr("d", path({ type: "Sphere" }));
  svg.append("path").attr("class", "map-graticule").attr("d", path(d3.geoGraticule10()));

  svg.selectAll("path.country")
    .data(world.features)
    .join("path")
    .attr("class", "map-country")
    .attr("d", path)
    .attr("fill", (d) => {
      const v = countryNameToCount.get(normalizeCountry(d.properties.name));
      return v ? colorScale(v) : CHART_MAP_FILL;
    })
    .attr("stroke", CHART_MAP_BORDER)
    .attr("stroke-width", 1)
    .on("mousemove", (ev, d) => {
      const v = countryNameToCount.get(normalizeCountry(d.properties.name));
      if (!v) return;
      showTooltip(ev.clientX, ev.clientY, `<b>${d.properties.name}</b><br>${fmt(v)} conexão(ões)`);
    })
    .on("mouseleave", hideTooltip);
}

function normalizeCountry(name) {
  const map = {
    Germany: "Alemanha", Ghana: "Gana", Angola: "Angola", Algeria: "Argélia",
    Mozambique: "Moçambique", "South Africa": "África do Sul", "United Kingdom": "Reino Unido",
  };
  return map[name] || name;
}
