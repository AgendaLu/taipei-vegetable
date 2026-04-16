// ─── Constants ───────────────────────────────────────────────────────────────

const MARKET_COLORS = {
  '台北一': '#10b981', // emerald
  '台北二': '#3b82f6', // blue
  '三重':   '#f59e0b', // amber
  '桃農':   '#a855f7', // purple
};

const CROP_EMOJI = { '青花菜': '🥦', '牛番茄': '🍅', '洋蔥': '🧅' };

// 批發 → 零售估算倍數
// 青花菜易損耗、運費高，加成最大；洋蔥耐放，加成最小
const RETAIL_MULTIPLIER = {
  '青花菜': 3.0,
  '牛番茄': 2.5,
  '洋蔥':   2.0,
};

// ─── App State ────────────────────────────────────────────────────────────────

const state = {
  crop: '青花菜',
  days: 30,
  history: null,
  digest: null,
  latest: null,
};

// ─── Data Loading ─────────────────────────────────────────────────────────────

async function loadData() {
  const [history, digest, latest] = await Promise.all([
    fetch('data/history.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),
    fetch('data/weekly_digest.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),
    fetch('data/latest.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),
  ]);
  return { history, digest, latest };
}

// ─── Summary Cards ────────────────────────────────────────────────────────────

function renderSummaryCards(latest, history) {
  const container = document.getElementById('summary-cards');
  const crops = latest.crops || [];

  container.innerHTML = crops.map(crop => {
    const rows = (latest.rows || []).filter(r => r.crop === crop);
    const avgPrice = rows.length ? d3.mean(rows, r => r.mid_price) : null;
    const validChanges = rows.filter(r => r.change_pct != null);
    const avgChange = validChanges.length ? d3.mean(validChanges, r => r.change_pct) : null;

    const priceStr  = avgPrice  != null ? `$${avgPrice.toFixed(1)}` : '—';
    const changeStr = avgChange != null
      ? `${avgChange >= 0 ? '+' : ''}${avgChange.toFixed(1)}%`
      : '—';
    const isUp   = avgChange != null && avgChange >  0.05;
    const isDown = avgChange != null && avgChange < -0.05;

    const badgeClass = isUp
      ? 'bg-emerald-50 text-emerald-700'
      : isDown
        ? 'bg-rose-50 text-rose-500'
        : 'bg-slate-100 text-slate-500';
    const arrow = isUp ? '▲' : isDown ? '▼' : '●';

    const multiplier  = RETAIL_MULTIPLIER[crop] || 2.5;
    const retailPrice = avgPrice != null ? Math.round(avgPrice * multiplier) : null;
    const retailStr   = retailPrice != null ? `約 $${retailPrice}` : '—';

    return `
      <div
        class="crop-card bg-white rounded-2xl border border-slate-200 shadow-sm p-5
               cursor-pointer hover:border-slate-300 transition-all duration-150"
        data-crop="${crop}"
      >
        <div class="flex items-start justify-between mb-3">
          <span class="text-2xl leading-none">${CROP_EMOJI[crop] || '🌿'}</span>
          <span class="text-xs px-2 py-0.5 rounded-full font-medium ${badgeClass}">
            ${arrow} ${changeStr}
          </span>
        </div>
        <div class="text-2xl font-bold tracking-tight">${priceStr}</div>
        <div class="text-sm text-slate-500 mt-0.5">
          ${crop} <span class="text-slate-400 text-xs">批發均價・元/公斤</span>
        </div>
        <div class="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between"
             title="批發價 × ${multiplier} 倍估算，含通路、損耗、人力成本，僅供參考">
          <span class="text-xs text-slate-400">估算零售</span>
          <span class="text-sm font-semibold text-slate-600">
            ${retailStr} <span class="text-xs font-normal text-slate-400">元/公斤</span>
          </span>
        </div>
        <div id="sparkline-${CSS.escape(crop)}" class="mt-3" style="height:44px;"></div>
      </div>
    `;
  }).join('');

  crops.forEach(crop => renderSparkline(crop, history));

  document.querySelectorAll('.crop-card').forEach(card => {
    card.addEventListener('click', () => {
      state.crop = card.dataset.crop;
      document.getElementById('crop-select').value = state.crop;
      updateCardSelection();
      renderTrendChart();
    });
  });

  updateCardSelection();
}

function updateCardSelection() {
  document.querySelectorAll('.crop-card').forEach(card => {
    card.classList.toggle('selected', card.dataset.crop === state.crop);
  });
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

function renderSparkline(crop, history) {
  const el = document.getElementById(`sparkline-${CSS.escape(crop)}`);
  if (!el) return;

  const data = (history.rows || [])
    .filter(r => r.crop === crop && r.market === '台北一' && r.mid_price != null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-30);

  if (data.length < 2) return;

  const W = el.clientWidth || 220;
  const H = 44;

  const svg = d3.select(el)
    .append('svg')
    .attr('width', '100%')
    .attr('height', H)
    .attr('viewBox', `0 0 ${W} ${H}`);

  const x = d3.scaleLinear().domain([0, data.length - 1]).range([0, W]);
  const extent = d3.extent(data, d => d.mid_price);
  const pad = (extent[1] - extent[0]) * 0.15 || 1;
  const y = d3.scaleLinear().domain([extent[0] - pad, extent[1] + pad]).range([H, 0]);

  const line = d3.line()
    .x((_, i) => x(i))
    .y(d => y(d.mid_price))
    .curve(d3.curveMonotoneX);

  const area = d3.area()
    .x((_, i) => x(i))
    .y0(H)
    .y1(d => y(d.mid_price))
    .curve(d3.curveMonotoneX);

  // Gradient fill
  const gradId = `spark-grad-${crop}`;
  const defs = svg.append('defs');
  const grad = defs.append('linearGradient')
    .attr('id', gradId)
    .attr('x1', 0).attr('y1', 0)
    .attr('x2', 0).attr('y2', 1);
  grad.append('stop').attr('offset', '0%').attr('stop-color', '#10b981').attr('stop-opacity', 0.25);
  grad.append('stop').attr('offset', '100%').attr('stop-color', '#10b981').attr('stop-opacity', 0);

  svg.append('path').datum(data).attr('fill', `url(#${gradId})`).attr('d', area);

  const path = svg.append('path')
    .datum(data)
    .attr('fill', 'none')
    .attr('stroke', '#10b981')
    .attr('stroke-width', 1.75)
    .attr('stroke-linejoin', 'round')
    .attr('stroke-linecap', 'round')
    .attr('d', line);

  // Draw-on animation
  const len = path.node().getTotalLength();
  path
    .attr('stroke-dasharray', `${len} ${len}`)
    .attr('stroke-dashoffset', len)
    .transition().duration(600).ease(d3.easeLinear)
    .attr('stroke-dashoffset', 0);
}

// ─── Trend Chart ─────────────────────────────────────────────────────────────

function renderTrendChart() {
  const container = document.getElementById('trend-chart');
  d3.select(container).selectAll('*').remove();

  const margin = { top: 8, right: 16, bottom: 36, left: 54 };
  const W = container.clientWidth;
  const H = container.clientHeight || 300;
  const width  = W - margin.left - margin.right;
  const height = H - margin.top  - margin.bottom;

  if (width <= 0 || height <= 0) return;

  // Filter data
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - state.days);

  const parseDate = d3.timeParse('%Y-%m-%d');

  const filtered = (state.history.rows || []).filter(r =>
    r.crop === state.crop &&
    r.mid_price != null &&
    parseDate(r.date) >= cutoff
  );

  if (!filtered.length) {
    d3.select(container)
      .append('p')
      .attr('class', 'text-slate-400 text-sm text-center pt-20')
      .text('此時段無資料');
    return;
  }

  const byMarket = d3.group(filtered, r => r.market);
  const allDates = filtered.map(r => parseDate(r.date));
  const allPrices = filtered.map(r => r.mid_price);

  // SVG
  const svg = d3.select(container)
    .append('svg')
    .attr('width', W)
    .attr('height', H);

  // Clip path
  svg.append('defs').append('clipPath')
    .attr('id', 'clip-trend')
    .append('rect').attr('width', width).attr('height', height + 4);

  const g = svg.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  // Scales
  const x = d3.scaleTime()
    .domain(d3.extent(allDates))
    .range([0, width]);

  const yPad = (d3.max(allPrices) - d3.min(allPrices)) * 0.15 || d3.max(allPrices) * 0.15;
  const y = d3.scaleLinear()
    .domain([d3.min(allPrices) - yPad, d3.max(allPrices) + yPad])
    .range([height, 0])
    .nice();

  // Grid
  g.append('g')
    .attr('class', 'grid')
    .call(d3.axisLeft(y).ticks(5).tickSize(-width).tickFormat(''))
    .select('.domain').remove();

  // X Axis
  const xTicks = state.days <= 30 ? 6 : state.days <= 60 ? 8 : 10;
  g.append('g')
    .attr('class', 'axis')
    .attr('transform', `translate(0,${height})`)
    .call(
      d3.axisBottom(x)
        .ticks(xTicks)
        .tickFormat(d => `${d.getMonth() + 1}/${d.getDate()}`)
    );

  // Y Axis
  g.append('g')
    .attr('class', 'axis')
    .call(d3.axisLeft(y).ticks(5).tickFormat(d => `$${d}`));

  // Y label
  g.append('text')
    .attr('transform', 'rotate(-90)')
    .attr('x', -(height / 2))
    .attr('y', -44)
    .attr('text-anchor', 'middle')
    .attr('fill', '#cbd5e1')
    .attr('font-size', '10px')
    .text('元 / 公斤');

  // Line + Area generators
  const line = d3.line()
    .x(d => x(parseDate(d.date)))
    .y(d => y(d.mid_price))
    .curve(d3.curveMonotoneX)
    .defined(d => d.mid_price != null);

  const area = d3.area()
    .x(d => x(parseDate(d.date)))
    .y0(height)
    .y1(d => y(d.mid_price))
    .curve(d3.curveMonotoneX)
    .defined(d => d.mid_price != null);

  const chartG = g.append('g').attr('clip-path', 'url(#clip-trend)');

  byMarket.forEach((data, market) => {
    const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
    const color = MARKET_COLORS[market] || '#64748b';

    // Per-market gradient
    const gradId = `trend-grad-${market}`;
    svg.select('defs').append('linearGradient')
      .attr('id', gradId)
      .attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 1)
      .call(g => {
        g.append('stop').attr('offset', '0%').attr('stop-color', color).attr('stop-opacity', 0.15);
        g.append('stop').attr('offset', '100%').attr('stop-color', color).attr('stop-opacity', 0);
      });

    chartG.append('path')
      .datum(sorted)
      .attr('fill', `url(#${gradId})`)
      .attr('d', area);

    const path = chartG.append('path')
      .datum(sorted)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', 2)
      .attr('stroke-linejoin', 'round')
      .attr('stroke-linecap', 'round')
      .attr('d', line);

    // Draw-on animation
    const len = path.node().getTotalLength();
    path
      .attr('stroke-dasharray', `${len} ${len}`)
      .attr('stroke-dashoffset', len)
      .transition().duration(900).ease(d3.easeLinear)
      .attr('stroke-dashoffset', 0);
  });

  // ── Crosshair & Tooltip ───────────────────────────────────────────────────

  const tooltip   = d3.select('#chart-tooltip');
  const bisector  = d3.bisector(d => parseDate(d.date)).center;

  const crosshair = g.append('line')
    .attr('stroke', '#cbd5e1')
    .attr('stroke-width', 1)
    .attr('stroke-dasharray', '4 2')
    .attr('y1', 0)
    .attr('y2', height)
    .style('opacity', 0)
    .style('pointer-events', 'none');

  svg.append('rect')
    .attr('width', width)
    .attr('height', height)
    .attr('transform', `translate(${margin.left},${margin.top})`)
    .attr('fill', 'none')
    .attr('pointer-events', 'all')
    .on('mousemove', function (event) {
      const [mx] = d3.pointer(event, this);
      const hoverDate = x.invert(mx);

      crosshair.attr('x1', mx).attr('x2', mx).style('opacity', 1);

      const lines = [];
      byMarket.forEach((data, market) => {
        const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
        const idx = Math.max(0, Math.min(sorted.length - 1, bisector(sorted, hoverDate)));
        if (sorted[idx]) {
          lines.push({
            market,
            price: sorted[idx].mid_price,
            color: MARKET_COLORS[market] || '#64748b',
          });
        }
      });

      const d = hoverDate;
      const dateStr = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;

      tooltip
        .style('opacity', 1)
        .style('left', `${event.clientX + 18}px`)
        .style('top',  `${event.clientY - 44}px`)
        .html(`
          <div style="font-weight:600;color:#334155;margin-bottom:6px;">${dateStr}</div>
          ${lines.map(l => `
            <div style="display:flex;align-items:center;gap:8px;color:#475569;">
              <span style="width:9px;height:9px;border-radius:50%;background:${l.color};flex-shrink:0;display:inline-block;"></span>
              <span>${l.market}</span>
              <span style="margin-left:auto;font-weight:600;color:#1e293b;">
                ${l.price != null ? `$${l.price.toFixed(1)}` : '—'}
              </span>
            </div>
          `).join('')}
        `);
    })
    .on('mouseleave', function () {
      crosshair.style('opacity', 0);
      tooltip.style('opacity', 0);
    });

  // ── Legend ────────────────────────────────────────────────────────────────

  const legendEl = document.getElementById('trend-legend');
  legendEl.innerHTML = '';
  byMarket.forEach((_, market) => {
    const color = MARKET_COLORS[market] || '#64748b';
    const item = document.createElement('div');
    item.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:13px;color:#64748b;';
    item.innerHTML = `
      <span style="width:24px;height:3px;border-radius:2px;background:${color};display:inline-block;"></span>
      ${market}
    `;
    legendEl.appendChild(item);
  });
}

// ─── Weekly Digest ────────────────────────────────────────────────────────────

function renderWeeklyDigest(digest) {
  const label = document.getElementById('digest-label');
  if (digest.this_week?.label) {
    label.textContent = `${digest.this_week.label}，對比前週`;
  }

  const items  = digest.items || [];
  const sorted = [...items].sort((a, b) => b.change_pct - a.change_pct);

  renderDigestBars('gainers-chart', sorted.filter(d => d.change_pct >= 0), 'emerald');
  renderDigestBars('losers-chart',  [...sorted.filter(d => d.change_pct < 0)].reverse(), 'rose');
}

function renderDigestBars(containerId, data, color) {
  const el = document.getElementById(containerId);
  d3.select(el).selectAll('*').remove();

  if (!data.length) {
    el.innerHTML = '<p style="font-size:13px;color:#94a3b8;">暫無資料</p>';
    return;
  }

  const BAR_H  = 38;
  const margin = { top: 2, right: 72, bottom: 2, left: 60 };
  const W      = el.clientWidth || 300;
  const H      = data.length * BAR_H + margin.top + margin.bottom;
  const width  = Math.max(W - margin.left - margin.right, 10);

  const fillColor = color === 'emerald' ? '#10b981' : '#f43f5e';
  const bgColor   = color === 'emerald' ? '#ecfdf5' : '#fff1f2';

  const svg = d3.select(el)
    .append('svg')
    .attr('width', W)
    .attr('height', H);

  const g = svg.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  const absMax = d3.max(data, d => Math.abs(d.change_pct)) || 1;
  const x = d3.scaleLinear().domain([0, absMax * 1.2]).range([0, width]);
  const y = d3.scaleBand()
    .domain(data.map(d => d.crop))
    .range([0, data.length * BAR_H])
    .padding(0.32);

  // Crop labels
  g.selectAll('.crop-lbl')
    .data(data)
    .join('text')
    .attr('class', 'crop-lbl')
    .attr('x', -8)
    .attr('y', d => y(d.crop) + y.bandwidth() / 2)
    .attr('dy', '0.35em')
    .attr('text-anchor', 'end')
    .attr('fill', '#475569')
    .attr('font-size', '13px')
    .text(d => d.crop);

  // Background track
  g.selectAll('.bar-bg')
    .data(data)
    .join('rect')
    .attr('class', 'bar-bg')
    .attr('x', 0)
    .attr('y', d => y(d.crop))
    .attr('width', width)
    .attr('height', y.bandwidth())
    .attr('rx', 5)
    .attr('fill', bgColor);

  // Foreground bar (animated)
  g.selectAll('.bar')
    .data(data)
    .join('rect')
    .attr('class', 'bar')
    .attr('x', 0)
    .attr('y', d => y(d.crop))
    .attr('height', y.bandwidth())
    .attr('rx', 5)
    .attr('fill', fillColor)
    .attr('width', 0)
    .transition().duration(750).ease(d3.easeCubicOut)
    .attr('width', d => x(Math.abs(d.change_pct)));

  // Value label
  g.selectAll('.val-lbl')
    .data(data)
    .join('text')
    .attr('class', 'val-lbl')
    .attr('x', d => x(Math.abs(d.change_pct)) + 8)
    .attr('y', d => y(d.crop) + y.bandwidth() / 2)
    .attr('dy', '0.35em')
    .attr('fill', fillColor)
    .attr('font-size', '13px')
    .attr('font-weight', '600')
    .text(d => `${d.change_pct >= 0 ? '+' : ''}${d.change_pct.toFixed(1)}%`);

  // Avg price label (secondary)
  g.selectAll('.price-lbl')
    .data(data)
    .join('text')
    .attr('class', 'price-lbl')
    .attr('x', d => x(Math.abs(d.change_pct)) + 8)
    .attr('y', d => y(d.crop) + y.bandwidth() / 2 + 14)
    .attr('fill', '#94a3b8')
    .attr('font-size', '10px')
    .text(d => `均 $${d.this_avg}`);
}

// ─── Event Handlers ───────────────────────────────────────────────────────────

function setupEventHandlers() {
  document.getElementById('crop-select').addEventListener('change', e => {
    state.crop = e.target.value;
    updateCardSelection();
    renderTrendChart();
  });

  document.querySelectorAll('.days-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.days = parseInt(btn.dataset.days, 10);
      document.querySelectorAll('.days-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderTrendChart();
    });
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  const loadingEl   = document.getElementById('loading');
  const appEl       = document.getElementById('app');
  const emptyEl     = document.getElementById('empty-state');

  try {
    const { history, digest, latest } = await loadData();
    state.history = history;
    state.digest  = digest;
    state.latest  = latest;

    if (!latest.trade_date) throw new Error('no-data');

    document.getElementById('updated-at').textContent =
      `資料日期：${latest.trade_date}`;

    loadingEl.classList.add('hidden');
    appEl.classList.remove('hidden');

    renderSummaryCards(latest, history);
    setupEventHandlers();
    renderTrendChart();
    renderWeeklyDigest(digest);

  } catch (err) {
    loadingEl.classList.add('hidden');
    emptyEl.classList.remove('hidden');
    emptyEl.classList.add('flex');
  }
}

// ─── Responsive resize ────────────────────────────────────────────────────────

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (state.history) renderTrendChart();
  }, 250);
});

document.addEventListener('DOMContentLoaded', init);
