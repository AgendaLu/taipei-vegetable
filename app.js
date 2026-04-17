// ─── Constants ───────────────────────────────────────────────────────────────

const MARKET_COLORS = {
  '台北一': '#10b981', // emerald
  '台北二': '#3b82f6', // blue
  '三重':   '#f59e0b', // amber
  '桃農':   '#a855f7', // purple
};

const CROP_EMOJI = { '青花菜': '🥦', '牛番茄': '🍅', '洋蔥': '🧅' };

// 批發 → 零售估算倍數（預設值，可被使用者回填校準）
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

// 儲存各品項當前批發均價，供 modal 和刪除後重繪使用
const cropWholesalePrices = {};

// ─── Local Storage ────────────────────────────────────────────────────────────

const STORAGE_KEY = 'taipei_veg_reports';

function getReports() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
}

function saveReport(report) {
  const reports = getReports();
  reports.unshift(report); // 最新的放最前
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
}

function deleteReport(id) {
  localStorage.setItem(STORAGE_KEY,
    JSON.stringify(getReports().filter(r => r.id !== id)));
}

function clearAllReports() {
  localStorage.removeItem(STORAGE_KEY);
}

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

    // 儲存批發均價供後續使用
    cropWholesalePrices[crop] = avgPrice;

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
        <!-- 零售估算區塊（由 renderRetailSection 動態填入） -->
        <div id="retail-sec-${CSS.escape(crop)}"
             class="mt-2 pt-2 border-t border-slate-100"></div>
        <div id="sparkline-${CSS.escape(crop)}" class="mt-3" style="height:44px;"></div>
      </div>
    `;
  }).join('');

  crops.forEach(crop => renderSparkline(crop, history));
  crops.forEach(crop => renderRetailSection(crop, cropWholesalePrices[crop]));

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

// ─── Retail Section ───────────────────────────────────────────────────────────

function renderRetailSection(crop, wholesalePrice) {
  const el = document.getElementById(`retail-sec-${CSS.escape(crop)}`);
  if (!el) return;

  const reports       = getReports().filter(r => r.crop === crop);
  const defaultMult   = RETAIL_MULTIPLIER[crop] || 2.5;
  const estDefault    = wholesalePrice != null ? Math.round(wholesalePrice * defaultMult) : null;
  const editBtn = `
    <button class="retail-edit-btn text-slate-300 hover:text-emerald-500 transition-colors
                   ml-1 leading-none" data-crop="${crop}" title="回填你的實際買價"
            style="font-size:13px;">✏</button>`;

  let html = '';

  if (reports.length === 0) {
    // 尚無回填：顯示預設估算 + 回填按鈕
    const valStr = estDefault != null ? `約 $${estDefault}` : '—';
    html = `
      <div class="flex items-center justify-between">
        <span class="text-xs text-slate-400">估算零售</span>
        <div class="flex items-center">
          <span class="text-sm font-semibold text-slate-600">${valStr}
            <span class="text-xs font-normal text-slate-400">元/公斤</span>
          </span>
          ${editBtn}
        </div>
      </div>
      <div class="text-right mt-0.5">
        <span class="text-xs text-slate-300">點 ✏ 回填你的實際買價</span>
      </div>
    `;
  } else {
    // 有回填資料：顯示校準後倍數與估算
    const validReports = reports.filter(r => r.multiplier != null);
    const avgMult   = validReports.reduce((s, r) => s + r.multiplier, 0) / validReports.length;
    const estCal    = wholesalePrice != null ? Math.round(wholesalePrice * avgMult) : null;
    const diffPct   = (estCal != null && estDefault != null)
      ? ((avgMult - defaultMult) / defaultMult * 100) : null;
    const diffStr   = diffPct != null
      ? `${diffPct >= 0 ? '+' : ''}${diffPct.toFixed(1)}%` : '';
    const diffColor = diffPct != null && diffPct > 0 ? 'text-rose-400' : 'text-emerald-500';
    const calStr    = estCal != null ? `約 $${estCal}` : '—';

    html = `
      <div class="flex items-center justify-between mb-0.5">
        <span class="text-xs text-slate-400">你的實測倍數</span>
        <span class="text-xs font-semibold text-emerald-600">
          ${avgMult.toFixed(2)}x
          ${diffStr ? `<span class="font-normal ${diffColor} text-xs">（${diffStr}）</span>` : ''}
        </span>
      </div>
      <div class="flex items-center justify-between">
        <span class="text-xs text-slate-400">校準零售估算</span>
        <div class="flex items-center">
          <span class="text-sm font-semibold text-slate-600">${calStr}
            <span class="text-xs font-normal text-slate-400">元/公斤</span>
          </span>
          ${editBtn}
        </div>
      </div>
      <div class="text-right mt-0.5">
        <span class="text-xs text-slate-400">${reports.length} 筆回填</span>
      </div>
    `;
  }

  el.innerHTML = html;

  el.querySelectorAll('.retail-edit-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation(); // 避免觸發卡片選取
      openRetailModal(crop, wholesalePrice);
    });
  });
}

// ─── Retail Input Modal ───────────────────────────────────────────────────────

const modalState = { crop: null, wholesale: null, marketType: '超市' };

function openRetailModal(crop, wholesalePrice) {
  modalState.crop      = crop;
  modalState.wholesale = wholesalePrice;
  modalState.marketType = '超市';

  document.getElementById('modal-crop-title').textContent =
    `${CROP_EMOJI[crop] || ''} ${crop}・回填零售價`;
  document.getElementById('modal-wholesale-ref').textContent =
    wholesalePrice != null
      ? `今日批發均價 $${wholesalePrice.toFixed(1)} 元/公斤（資料日期 ${state.latest?.trade_date ?? ''}）`
      : '';
  document.getElementById('modal-retail-input').value = '';

  // Reset market type buttons
  document.querySelectorAll('.market-type-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === '超市');
  });

  document.getElementById('retail-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('modal-retail-input').focus(), 80);
}

function closeRetailModal() {
  document.getElementById('retail-modal').classList.add('hidden');
}

function submitRetailReport() {
  const raw = document.getElementById('modal-retail-input').value.trim();
  const price = parseFloat(raw);

  if (!raw || isNaN(price) || price <= 0) {
    document.getElementById('modal-retail-input').focus();
    document.getElementById('modal-retail-input').classList.add('ring-2', 'ring-rose-300');
    setTimeout(() =>
      document.getElementById('modal-retail-input').classList.remove('ring-2', 'ring-rose-300'), 1000);
    return;
  }

  const today = new Date().toISOString().split('T')[0];
  saveReport({
    id:           Date.now(),
    crop:         modalState.crop,
    date:         today,
    wholesale_mid: modalState.wholesale,
    retail_price: price,
    multiplier:   modalState.wholesale ? parseFloat((price / modalState.wholesale).toFixed(4)) : null,
    market_type:  modalState.marketType,
  });

  closeRetailModal();
  renderRetailSection(modalState.crop, modalState.wholesale);
  renderReportsPanel();
}

function setupModalHandlers() {
  document.getElementById('modal-cancel')
    .addEventListener('click', closeRetailModal);

  // 點遮罩關閉
  document.getElementById('retail-modal')
    .addEventListener('click', e => {
      if (e.target === document.getElementById('retail-modal')) closeRetailModal();
    });

  document.getElementById('modal-submit')
    .addEventListener('click', submitRetailReport);

  document.getElementById('modal-retail-input')
    .addEventListener('keydown', e => { if (e.key === 'Enter') submitRetailReport(); });

  // Market type pills
  document.querySelectorAll('.market-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      modalState.marketType = btn.dataset.type;
      document.querySelectorAll('.market-type-btn').forEach(b =>
        b.classList.toggle('active', b === btn));
    });
  });

  // Clear all button
  document.getElementById('clear-reports-btn')
    .addEventListener('click', () => {
      if (!confirm('確定要清除全部回填記錄嗎？')) return;
      clearAllReports();
      refreshAllRetailSections();
      renderReportsPanel();
    });
}

// 重繪所有卡片的零售區塊（刪除/清除後呼叫）
function refreshAllRetailSections() {
  Object.entries(cropWholesalePrices).forEach(([crop, price]) => {
    renderRetailSection(crop, price);
  });
}

// ─── Reports Panel ────────────────────────────────────────────────────────────

function renderReportsPanel() {
  const reports = getReports();
  const section = document.getElementById('reports-section');
  const content = document.getElementById('reports-content');

  if (reports.length === 0) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');

  // 依品項分組
  const byCrop = {};
  reports.forEach(r => {
    if (!byCrop[r.crop]) byCrop[r.crop] = [];
    byCrop[r.crop].push(r);
  });

  content.innerHTML = Object.entries(byCrop).map(([crop, cropReports]) => {
    const validR      = cropReports.filter(r => r.multiplier != null);
    const avgMult     = validR.reduce((s, r) => s + r.multiplier, 0) / (validR.length || 1);
    const defaultMult = RETAIL_MULTIPLIER[crop] || 2.5;
    const diffPct     = ((avgMult - defaultMult) / defaultMult * 100);
    const diffStr     = `${diffPct >= 0 ? '+' : ''}${diffPct.toFixed(1)}%`;
    const diffColor   = diffPct > 0 ? 'text-rose-400' : 'text-emerald-500';

    const rows = cropReports.map(r => `
      <tr class="border-t border-slate-100 hover:bg-slate-50">
        <td class="py-2 pl-1 text-xs text-slate-500 whitespace-nowrap">${r.date}</td>
        <td class="py-2 text-xs text-slate-500 text-right">
          ${r.wholesale_mid != null ? `$${Number(r.wholesale_mid).toFixed(1)}` : '—'}
        </td>
        <td class="py-2 text-sm font-semibold text-slate-700 text-right">$${r.retail_price}</td>
        <td class="py-2 text-xs font-medium text-emerald-600 text-right">
          ${r.multiplier != null ? `${r.multiplier.toFixed(2)}x` : '—'}
        </td>
        <td class="py-2 text-xs text-slate-400 text-center">${r.market_type}</td>
        <td class="py-2 pr-1 text-center">
          <button class="delete-report-btn text-slate-300 hover:text-rose-400
                         transition-colors text-xs px-1"
                  data-id="${r.id}" title="刪除此筆">✕</button>
        </td>
      </tr>
    `).join('');

    return `
      <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 mb-4">
        <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
          <span class="font-semibold text-slate-800">
            ${CROP_EMOJI[crop] || '🌿'} ${crop}
          </span>
          <span class="text-xs text-slate-400">
            ${cropReports.length} 筆回填・你的倍數
            <span class="font-semibold text-emerald-600">${avgMult.toFixed(2)}x</span>
            vs 預設 ${defaultMult}x
            <span class="${diffColor} font-medium">（${diffStr}）</span>
          </span>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[360px]">
            <thead>
              <tr>
                <th class="text-left text-xs text-slate-400 font-medium pb-2 pl-1">日期</th>
                <th class="text-right text-xs text-slate-400 font-medium pb-2">批發均價</th>
                <th class="text-right text-xs text-slate-400 font-medium pb-2">實測零售</th>
                <th class="text-right text-xs text-slate-400 font-medium pb-2">倍數</th>
                <th class="text-center text-xs text-slate-400 font-medium pb-2">地點</th>
                <th></th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    `;
  }).join('');

  // 刪除單筆
  content.querySelectorAll('.delete-report-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      deleteReport(Number(btn.dataset.id));
      refreshAllRetailSections();
      renderReportsPanel();
    });
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
    setupModalHandlers();
    renderTrendChart();
    renderWeeklyDigest(digest);
    renderReportsPanel();

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
