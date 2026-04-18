// ─── Constants ───────────────────────────────────────────────────────────────

const MARKET_COLORS = {
  '台北一': '#10b981', // emerald
  '台北二': '#3b82f6', // blue
  '三重':   '#f59e0b', // amber
  '板橋':   '#a855f7', // purple
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
  yoy: null,
  cropsIndex: null,  // { items: [{crop, aliases, names, codes, category, tracked}, ...] }
};

// Fuse.js 搜尋實例（init 時建立）
let searchFuse = null;
// 目前 dropdown 高亮的索引
let searchActiveIdx = -1;

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
  const v = Date.now();
  const get = url => fetch(`${url}?v=${v}`).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
  const [history, digest, latest, yoy, cropsIndex] = await Promise.all([
    get('data/history.json'),
    get('data/weekly_digest.json'),
    get('data/latest.json'),
    get('data/yoy.json'),
    get('data/crops_index.json'),
  ]);
  return { history, digest, latest, yoy, cropsIndex };
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
        <!-- YoY 同月對比 -->
        <div id="yoy-sec-${CSS.escape(crop)}"
             class="mt-2 pt-2 border-t border-slate-100"></div>
        <!-- 零售估算區塊（由 renderRetailSection 動態填入） -->
        <div id="retail-sec-${CSS.escape(crop)}"
             class="mt-2 pt-2 border-t border-slate-100"></div>
        <div id="sparkline-${CSS.escape(crop)}" class="mt-3" style="height:44px;"></div>
      </div>
    `;
  }).join('');

  crops.forEach(crop => renderYoySection(crop));
  crops.forEach(crop => renderSparkline(crop, history));
  crops.forEach(crop => renderRetailSection(crop, cropWholesalePrices[crop]));

  document.querySelectorAll('.crop-card').forEach(card => {
    card.addEventListener('click', () => {
      openHistoryModal(card.dataset.crop);
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

// ─── Interpolation ────────────────────────────────────────────────────────────

/**
 * 將稀疏的 {date, mid_price} 序列填滿連續日期，
 * 缺值用線性插值補齊，讓折線圖不出現斷點。
 */
function interpolateSeries(rows, cutoff) {
  if (!rows.length) return [];

  const fmt    = d3.timeFormat('%Y-%m-%d');
  const parse  = d3.timeParse('%Y-%m-%d');
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));

  // 建立「查表」：date string → mid_price
  const known = new Map(sorted.map(r => [r.date, r.mid_price]));

  // 連續日曆天（從 cutoff 到最後一筆）
  const start = cutoff ? new Date(Math.max(parse(sorted[0].date), cutoff)) : parse(sorted[0].date);
  const end   = parse(sorted[sorted.length - 1].date);
  const allDates = d3.timeDays(start, d3.timeDay.offset(end, 1)).map(fmt);

  // 線性插值
  const result = [];
  for (let i = 0; i < allDates.length; i++) {
    const d = allDates[i];
    if (known.has(d)) {
      result.push({ date: d, mid_price: known.get(d) });
    } else {
      let pi = i - 1; while (pi >= 0 && !known.has(allDates[pi])) pi--;
      let ni = i + 1; while (ni < allDates.length && !known.has(allDates[ni])) ni++;
      let price;
      if (pi >= 0 && ni < allDates.length) {
        const p0 = known.get(allDates[pi]), p1 = known.get(allDates[ni]);
        price = p0 + (p1 - p0) * (i - pi) / (ni - pi);
      } else if (pi >= 0) {
        price = known.get(allDates[pi]);
      } else if (ni < allDates.length) {
        price = known.get(allDates[ni]);
      }
      if (price != null) result.push({ date: d, mid_price: price });
    }
  }
  return result;
}

// ─── YoY Section ──────────────────────────────────────────────────────────────

function renderYoySection(crop) {
  const el = document.getElementById(`yoy-sec-${CSS.escape(crop)}`);
  if (!el || !state.yoy) return;

  const now = new Date();
  const currentYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const mm = currentYM.slice(5); // "04"

  const getRow = ym => state.yoy.rows.find(r => r.crop === crop && r.year_month === ym);
  const currentRow = getRow(currentYM);

  // 保留現有核取狀態
  const years = [2025, 2024];
  const checked = {};
  years.forEach(y => {
    const cb = el.querySelector(`[data-year="${y}"]`);
    checked[y] = cb ? cb.checked : false;
  });

  // 核取方塊列
  const cbsHtml = years.map(y => `
    <label class="flex items-center gap-1 cursor-pointer select-none" onclick="event.stopPropagation()">
      <input type="checkbox" class="yoy-cb accent-emerald-500 cursor-pointer"
             data-crop="${crop}" data-year="${y}" ${checked[y] ? 'checked' : ''}>
      <span class="text-xs text-slate-400">${y}</span>
    </label>
  `).join('');

  // 比較列（只顯示已勾選的年份）
  let compareHtml = '';
  years.filter(y => checked[y]).forEach(y => {
    const prevRow = getRow(`${y}-${mm}`);
    if (!prevRow || !currentRow) return;
    const diff    = currentRow.avg_mid - prevRow.avg_mid;
    const pct     = (diff / prevRow.avg_mid * 100).toFixed(1);
    const sign    = diff >= 0 ? '+' : '';
    const color   = diff >= 0 ? 'text-emerald-600' : 'text-rose-500';
    const arrow   = diff >= 0 ? '▲' : '▼';
    compareHtml += `
      <div class="flex items-center justify-between mt-1.5">
        <span class="text-xs text-slate-400">${y} 年 ${mm} 月均</span>
        <span class="text-xs">
          <span class="text-slate-500">$${prevRow.avg_mid}</span>
          <span class="ml-1.5 font-semibold ${color}">${arrow} ${sign}${pct}%</span>
        </span>
      </div>`;
  });

  el.innerHTML = `
    <div class="flex items-center gap-2">
      <span class="text-xs text-slate-400 shrink-0">YoY 對比</span>
      <div class="flex gap-3 ml-auto">${cbsHtml}</div>
    </div>
    ${compareHtml}
  `;

  el.querySelectorAll('.yoy-cb').forEach(cb => {
    cb.addEventListener('change', e => {
      e.stopPropagation();
      renderYoySection(crop);
    });
  });
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

function renderSparkline(crop, history) {
  const el = document.getElementById(`sparkline-${CSS.escape(crop)}`);
  if (!el) return;

  const raw = (history.rows || [])
    .filter(r => r.crop === crop && r.market === '台北一' && r.mid_price != null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-30);

  if (raw.length < 2) return;
  const data = interpolateSeries(raw);

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

  const byMarketRaw = d3.group(filtered, r => r.market);

  // 插值：補齊各市場缺漏日期，確保曲線連續
  const byMarket = new Map();
  byMarketRaw.forEach((rows, market) => {
    byMarket.set(market, interpolateSeries(rows, cutoff));
  });

  const allDates  = [...byMarket.values()].flatMap(s => s.map(r => parseDate(r.date)));
  const allPrices = [...byMarket.values()].flatMap(s => s.map(r => r.mid_price));

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

  // Line + Area generators（插值後不需要 defined 過濾）
  const line = d3.line()
    .x(d => x(parseDate(d.date)))
    .y(d => y(d.mid_price))
    .curve(d3.curveMonotoneX);

  const area = d3.area()
    .x(d => x(parseDate(d.date)))
    .y0(height)
    .y1(d => y(d.mid_price))
    .curve(d3.curveMonotoneX);

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

// ─── History Modal ────────────────────────────────────────────────────────────

const hmState = { crop: null, view: 'monthly' };

function openHistoryModal(crop) {
  hmState.crop = crop;
  hmState.view = 'monthly';

  document.getElementById('hm-title').textContent =
    `${CROP_EMOJI[crop] || '🌿'} ${crop} 歷史行情`;

  // Tab reset
  document.querySelectorAll('.hm-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.view === 'monthly'));

  renderHmStats(crop);
  renderHmChart(crop);
  document.getElementById('history-modal').classList.remove('hidden');
}

function closeHistoryModal() {
  document.getElementById('history-modal').classList.add('hidden');
  d3.select('#hm-chart').selectAll('*').remove();
}

function renderHmStats(crop) {
  const el = document.getElementById('hm-stats');
  const now = new Date();
  const mm  = String(now.getMonth() + 1).padStart(2, '0');
  const getRow = y => state.yoy.rows.find(r => r.crop === crop && r.year_month === `${y}-${mm}`);

  const cur  = getRow(now.getFullYear());
  const y25  = getRow(2025);
  const y24  = getRow(2024);

  const pill = (label, row, base) => {
    if (!row || !base) return '';
    const pct  = ((base.avg_mid - row.avg_mid) / row.avg_mid * 100).toFixed(1);
    const up   = pct >= 0;
    const cls  = up ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600';
    return `
      <div class="flex flex-col items-start gap-0.5 rounded-xl px-3 py-2 ${cls}">
        <span class="text-xs opacity-70">${label}</span>
        <span class="text-sm font-bold">$${row.avg_mid}
          <span class="text-xs font-semibold ml-1">${up ? '▲' : '▼'} ${Math.abs(pct)}%</span>
        </span>
      </div>`;
  };

  el.innerHTML = `
    ${cur ? `<div class="flex flex-col items-start gap-0.5 rounded-xl px-3 py-2 bg-slate-100">
      <span class="text-xs text-slate-500">本月均價</span>
      <span class="text-sm font-bold text-slate-800">$${cur.avg_mid}</span>
    </div>` : ''}
    ${pill(`vs 去年 ${mm} 月`, y25, cur)}
    ${pill(`vs 前年 ${mm} 月`, y24, cur)}
  `;
}

function renderHmChart(crop) {
  const container = document.getElementById('hm-chart');
  d3.select(container).selectAll('*').remove();

  if (hmState.view === 'monthly') {
    renderHmMonthly(crop, container);
  } else {
    renderHmDaily(crop, container);
  }
}

function renderHmMonthly(crop, container) {
  const rows = (state.yoy.rows || [])
    .filter(r => r.crop === crop)
    .sort((a, b) => a.year_month.localeCompare(b.year_month));

  if (!rows.length) return;

  const margin = { top: 8, right: 16, bottom: 40, left: 50 };
  const W = container.clientWidth  || 600;
  const H = container.clientHeight || 240;
  const w = W - margin.left - margin.right;
  const h = H - margin.top  - margin.bottom;

  const svg = d3.select(container).append('svg').attr('width', W).attr('height', H);
  const g   = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const parseYM  = d3.timeParse('%Y-%m');
  const fmtTick  = d3.timeFormat('%y/%m');

  const x = d3.scaleTime()
    .domain(d3.extent(rows, r => parseYM(r.year_month)))
    .range([0, w]);

  const prices = rows.map(r => r.avg_mid);
  const pad    = (d3.max(prices) - d3.min(prices)) * 0.18 || d3.max(prices) * 0.15;
  const y = d3.scaleLinear()
    .domain([d3.min(prices) - pad, d3.max(prices) + pad])
    .range([h, 0]).nice();

  // Grid
  g.append('g').attr('class', 'grid')
    .call(d3.axisLeft(y).ticks(5).tickSize(-w).tickFormat(''))
    .select('.domain').remove();

  // Axes
  g.append('g').attr('class', 'axis').attr('transform', `translate(0,${h})`)
    .call(d3.axisBottom(x).ticks(d3.timeMonth.every(3)).tickFormat(fmtTick));
  g.append('g').attr('class', 'axis')
    .call(d3.axisLeft(y).ticks(5).tickFormat(d => `$${d}`));

  // 年份分隔線
  [2025, 2026].forEach(yr => {
    const xPos = x(new Date(yr, 0, 1));
    if (xPos > 0 && xPos < w) {
      g.append('line')
        .attr('x1', xPos).attr('x2', xPos)
        .attr('y1', 0).attr('y2', h)
        .attr('stroke', '#cbd5e1').attr('stroke-dasharray', '4 3').attr('stroke-width', 1);
      g.append('text')
        .attr('x', xPos + 4).attr('y', 12)
        .attr('fill', '#94a3b8').attr('font-size', '10px')
        .text(`${yr}`);
    }
  });

  // Gradient
  const gradId = 'hm-grad';
  const defs = svg.append('defs');
  const grad = defs.append('linearGradient').attr('id', gradId)
    .attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 1);
  grad.append('stop').attr('offset', '0%').attr('stop-color', '#10b981').attr('stop-opacity', 0.25);
  grad.append('stop').attr('offset', '100%').attr('stop-color', '#10b981').attr('stop-opacity', 0);

  const area = d3.area()
    .x(r => x(parseYM(r.year_month)))
    .y0(h).y1(r => y(r.avg_mid))
    .curve(d3.curveMonotoneX);
  const line = d3.line()
    .x(r => x(parseYM(r.year_month)))
    .y(r => y(r.avg_mid))
    .curve(d3.curveMonotoneX);

  g.append('path').datum(rows).attr('fill', `url(#${gradId})`).attr('d', area);

  const path = g.append('path').datum(rows)
    .attr('fill', 'none').attr('stroke', '#10b981')
    .attr('stroke-width', 2.5).attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round')
    .attr('d', line);

  const len = path.node().getTotalLength();
  path.attr('stroke-dasharray', `${len} ${len}`).attr('stroke-dashoffset', len)
    .transition().duration(1000).ease(d3.easeLinear).attr('stroke-dashoffset', 0);

  // Tooltip
  const tooltip  = d3.select('#chart-tooltip');
  const bisector = d3.bisector(r => parseYM(r.year_month)).center;

  svg.append('rect')
    .attr('width', w).attr('height', h)
    .attr('transform', `translate(${margin.left},${margin.top})`)
    .attr('fill', 'none').attr('pointer-events', 'all')
    .on('mousemove', function(event) {
      const [mx] = d3.pointer(event, this);
      const idx  = Math.max(0, Math.min(rows.length - 1, bisector(rows, x.invert(mx))));
      const r    = rows[idx];
      tooltip.style('opacity', 1)
        .style('left', `${event.clientX + 16}px`)
        .style('top',  `${event.clientY - 48}px`)
        .html(`
          <div style="font-weight:600;color:#334155;margin-bottom:4px;">${r.year_month}</div>
          <div style="color:#475569;">月均 <strong style="color:#059669;">$${r.avg_mid}</strong> 元/公斤</div>
          <div style="color:#94a3b8;font-size:11px;">交易量 ${(r.volume_kg/1000).toFixed(0)} 噸</div>
        `);
    })
    .on('mouseleave', () => tooltip.style('opacity', 0));
}

function renderHmDaily(crop, container) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);

  const parseDate = d3.timeParse('%Y-%m-%d');
  const byMarket  = d3.group(
    (state.history.rows || []).filter(r =>
      r.crop === crop && r.mid_price != null && parseDate(r.date) >= cutoff),
    r => r.market
  );

  if (!byMarket.size) {
    d3.select(container).append('p')
      .attr('class', 'text-slate-400 text-sm text-center pt-16')
      .text('此時段無資料');
    return;
  }

  // 圖例 HTML（放在 SVG 外，避免與 X 軸重疊）
  const legendDiv = document.createElement('div');
  legendDiv.style.cssText = 'display:flex;gap:16px;padding:0 4px 6px;flex-wrap:wrap;';
  byMarket.forEach((_, market) => {
    const color = MARKET_COLORS[market] || '#64748b';
    legendDiv.insertAdjacentHTML('beforeend', `
      <div style="display:flex;align-items:center;gap:5px;font-size:12px;color:#64748b;">
        <span style="width:20px;height:3px;border-radius:2px;background:${color};display:inline-block;"></span>
        ${market}
      </div>`);
  });
  container.appendChild(legendDiv);

  const margin = { top: 8, right: 16, bottom: 30, left: 50 };
  const W = container.clientWidth  || 600;
  const H = (container.clientHeight || 240) - legendDiv.offsetHeight;
  const w = W - margin.left - margin.right;
  const h = H - margin.top  - margin.bottom;

  const svg = d3.select(container).append('svg').attr('width', W).attr('height', H);
  const g   = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const interpByMarket = new Map();
  byMarket.forEach((rows, market) =>
    interpByMarket.set(market, interpolateSeries(rows, cutoff)));

  const allDates  = [...interpByMarket.values()].flatMap(s => s.map(r => parseDate(r.date)));
  const allPrices = [...interpByMarket.values()].flatMap(s => s.map(r => r.mid_price));

  const x = d3.scaleTime().domain(d3.extent(allDates)).range([0, w]);
  const pad = (d3.max(allPrices) - d3.min(allPrices)) * 0.15 || d3.max(allPrices) * 0.15;
  const y = d3.scaleLinear()
    .domain([d3.min(allPrices) - pad, d3.max(allPrices) + pad])
    .range([h, 0]).nice();

  g.append('g').attr('class', 'grid')
    .call(d3.axisLeft(y).ticks(5).tickSize(-w).tickFormat(''))
    .select('.domain').remove();
  g.append('g').attr('class', 'axis').attr('transform', `translate(0,${h})`)
    .call(d3.axisBottom(x).ticks(8).tickFormat(d => `${d.getMonth()+1}/${d.getDate()}`));
  g.append('g').attr('class', 'axis')
    .call(d3.axisLeft(y).ticks(5).tickFormat(d => `$${d}`));

  const clipId = 'hm-daily-clip';
  svg.append('defs').append('clipPath').attr('id', clipId)
    .append('rect').attr('width', w).attr('height', h + 4);
  const chartG = g.append('g').attr('clip-path', `url(#${clipId})`);

  const line = d3.line()
    .x(r => x(parseDate(r.date))).y(r => y(r.mid_price))
    .curve(d3.curveMonotoneX);

  interpByMarket.forEach((data, market) => {
    const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
    const color  = MARKET_COLORS[market] || '#64748b';
    const path   = chartG.append('path').datum(sorted)
      .attr('fill', 'none').attr('stroke', color)
      .attr('stroke-width', 2).attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round')
      .attr('d', line);
    const len = path.node().getTotalLength();
    path.attr('stroke-dasharray', `${len} ${len}`).attr('stroke-dashoffset', len)
      .transition().duration(900).ease(d3.easeLinear).attr('stroke-dashoffset', 0);
  });
}

function setupHistoryModal() {
  document.getElementById('hm-close').addEventListener('click', closeHistoryModal);
  document.getElementById('history-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('history-modal')) closeHistoryModal();
  });
  document.querySelectorAll('.hm-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      hmState.view = tab.dataset.view;
      document.querySelectorAll('.hm-tab').forEach(t =>
        t.classList.toggle('active', t === tab));
      renderHmChart(hmState.crop);
    });
  });
}

// ─── Search (Fuse.js autocomplete) ────────────────────────────────────────────

/**
 * 建立 Fuse 索引。權重：主名稱 > 別稱 > 官方全名 > 代號。
 * threshold ~ 0.35 對中文是較自然的模糊程度（0 = 精確，1 = 極寬鬆）。
 */
function buildFuse(items) {
  return new Fuse(items, {
    keys: [
      { name: 'crop',    weight: 0.5  },
      { name: 'aliases', weight: 0.3  },
      { name: 'names',   weight: 0.15 },
      { name: 'codes',   weight: 0.05 },
    ],
    threshold: 0.35,
    ignoreLocation: true,
    minMatchCharLength: 1,
    includeScore:   true,
    includeMatches: true,
  });
}

function setupSearch() {
  const items = state.cropsIndex?.items || [];
  if (!items.length) return;

  searchFuse = buildFuse(items);

  const input    = document.getElementById('search-input');
  const dropdown = document.getElementById('search-dropdown');
  const clearBtn = document.getElementById('search-clear');

  const runSearch = () => {
    const q = input.value.trim();
    searchActiveIdx = -1;

    // 清除按鈕顯示
    clearBtn.classList.toggle('hidden', q.length === 0);

    if (!q) { hideSearchDropdown(); return; }

    const results = searchFuse.search(q, { limit: 12 });
    renderSearchDropdown(results, q);
  };

  input.addEventListener('input', runSearch);
  input.addEventListener('focus', () => { if (input.value.trim()) runSearch(); });

  // 鍵盤導航
  input.addEventListener('keydown', e => {
    const items = dropdown.querySelectorAll('.search-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!items.length) return;
      searchActiveIdx = Math.min(searchActiveIdx + 1, items.length - 1);
      updateSearchActive();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      searchActiveIdx = Math.max(searchActiveIdx - 1, 0);
      updateSearchActive();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (searchActiveIdx >= 0 && items[searchActiveIdx]) {
        items[searchActiveIdx].click();
      } else {
        // 無高亮：直接選第一筆；若完全無結果，走 not-found fallback
        const q = input.value.trim();
        if (!q) return;
        const res = searchFuse.search(q, { limit: 1 });
        if (res.length) {
          selectCrop(res[0].item, q);
        } else {
          // Fuse threshold 較嚴，再用最寬鬆設定找最接近一筆
          const loose = new Fuse(state.cropsIndex.items, {
            keys: ['crop', 'aliases', 'names'],
            threshold: 1.0, ignoreLocation: true, includeScore: true,
          }).search(q, { limit: 1 });
          if (loose.length) openNotFoundDialog(q, loose[0].item);
          else openNotFoundDialog(q, null);
        }
      }
    } else if (e.key === 'Escape') {
      input.blur();
      hideSearchDropdown();
    }
  });

  // 清除
  clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.classList.add('hidden');
    hideSearchDropdown();
    input.focus();
  });

  // 點擊外部關閉下拉
  document.addEventListener('click', e => {
    if (!e.target.closest('#search-wrap')) hideSearchDropdown();
  });

  // Not-found dialog handlers
  document.getElementById('nf-close').addEventListener('click', closeNotFoundDialog);
  document.getElementById('notfound-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('notfound-modal')) closeNotFoundDialog();
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/**
 * 在 label 內把 Fuse 的 indices 高亮成 <mark>。
 * indices: [[start, end], ...]（inclusive）
 */
function highlight(label, indices) {
  if (!indices || !indices.length) return escapeHtml(label);
  let out = '';
  let cursor = 0;
  indices.forEach(([s, e]) => {
    if (s > cursor) out += escapeHtml(label.slice(cursor, s));
    out += '<mark>' + escapeHtml(label.slice(s, e + 1)) + '</mark>';
    cursor = e + 1;
  });
  if (cursor < label.length) out += escapeHtml(label.slice(cursor));
  return out;
}

function renderSearchDropdown(results, query) {
  const dropdown = document.getElementById('search-dropdown');

  if (!results.length) {
    dropdown.innerHTML = `
      <div class="search-empty">
        查無「${escapeHtml(query)}」<br>
        <span class="text-xs text-slate-400">按 Enter 看最接近的建議</span>
      </div>`;
    dropdown.classList.remove('hidden');
    return;
  }

  dropdown.innerHTML = results.map((r, i) => {
    const it = r.item;
    // 找出命中欄位並做高亮（優先 crop > aliases > names）
    const cropMatch   = r.matches?.find(m => m.key === 'crop');
    const aliasMatch  = r.matches?.find(m => m.key === 'aliases');
    const nameMatch   = r.matches?.find(m => m.key === 'names');

    const titleHtml = cropMatch
      ? highlight(it.crop, cropMatch.indices)
      : escapeHtml(it.crop);

    let subBits = [it.category];
    if (aliasMatch) {
      const alias = it.aliases[aliasMatch.refIndex] || '';
      subBits.push('別稱：' + highlight(alias, aliasMatch.indices));
    } else if (nameMatch) {
      const name = it.names[nameMatch.refIndex] || '';
      subBits.push(highlight(name, nameMatch.indices));
    } else if (it.aliases.length) {
      subBits.push('別稱：' + escapeHtml(it.aliases.slice(0, 2).join('、')));
    }

    const badge = it.tracked
      ? '<span class="si-badge">有行情</span>'
      : '<span class="si-badge muted">未追蹤</span>';

    return `
      <div class="search-item ${i === 0 ? 'active' : ''}"
           data-crop="${escapeHtml(it.crop)}"
           data-idx="${i}"
           role="option">
        <div class="flex-1 min-w-0">
          <div class="si-title">${titleHtml}</div>
          <div class="si-sub">${subBits.join('　')}</div>
        </div>
        ${badge}
      </div>`;
  }).join('');

  searchActiveIdx = 0;

  dropdown.querySelectorAll('.search-item').forEach(el => {
    el.addEventListener('click', () => {
      const cropName = el.dataset.crop;
      const item = state.cropsIndex.items.find(x => x.crop === cropName);
      if (item) selectCrop(item, query);
    });
    el.addEventListener('mouseenter', () => {
      searchActiveIdx = Number(el.dataset.idx);
      updateSearchActive();
    });
  });

  dropdown.classList.remove('hidden');
}

function updateSearchActive() {
  const items = document.querySelectorAll('#search-dropdown .search-item');
  items.forEach((el, i) => el.classList.toggle('active', i === searchActiveIdx));
  const active = items[searchActiveIdx];
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function hideSearchDropdown() {
  document.getElementById('search-dropdown').classList.add('hidden');
  searchActiveIdx = -1;
}

/**
 * 選擇一個品項：
 * - tracked（有資料）：切換 state.crop + 重繪走勢圖 + 標示卡片
 * - 未追蹤：跳出未追蹤提示，引導之後再加入
 */
function selectCrop(item, query) {
  const input    = document.getElementById('search-input');
  const clearBtn = document.getElementById('search-clear');

  hideSearchDropdown();
  input.value = '';
  clearBtn.classList.add('hidden');
  input.blur();

  if (item.tracked) {
    state.crop = item.crop;
    // 同步 <select> 的值（若存在該 option）
    const sel = document.getElementById('crop-select');
    if (sel && Array.from(sel.options).some(o => o.value === item.crop)) {
      sel.value = item.crop;
    }
    updateCardSelection();
    renderTrendChart();
    // 滑到走勢圖區
    document.getElementById('trend-chart')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    openNotFoundDialog(query || item.crop, item, { reason: 'untracked' });
  }
}

// ─── Not-Found Dialog ────────────────────────────────────────────────────────

function openNotFoundDialog(query, suggestion, opts = {}) {
  const modal = document.getElementById('notfound-modal');
  const titleEl   = document.getElementById('nf-query');
  const titleWrap = titleEl.parentElement;      // <h3>
  const hintEl    = titleWrap.nextElementSibling; // <p>

  const nameEl   = document.getElementById('nf-suggestion-name');
  const subEl    = document.getElementById('nf-suggestion-sub');
  const badgeEl  = document.getElementById('nf-suggestion-badge');
  const btn      = document.getElementById('nf-suggestion');
  const closeBtn = document.getElementById('nf-close');

  const isUntracked = opts.reason === 'untracked';

  // 標題文案依情境切換
  if (isUntracked) {
    titleWrap.innerHTML = `「<span class="text-amber-500">${escapeHtml(suggestion.crop)}</span>」目前尚未追蹤`;
    hintEl.textContent  = '這個品項在字典裡，但我們還沒收錄每日批發行情。';
  } else {
    titleWrap.innerHTML = `查無 <span class="text-rose-500">「${escapeHtml(query)}」</span>`;
    hintEl.textContent  = suggestion ? '我們找到最相近的品項：' : '找不到相關品項';
  }

  if (!suggestion) {
    nameEl.textContent = '（沒有找到相似品項）';
    subEl.textContent  = '試試其他關鍵字，例如「花椰」、「番茄」、「洋蔥」';
    badgeEl.textContent = '';
    btn.disabled = true;
    btn.classList.add('opacity-50', 'pointer-events-none');
    closeBtn.textContent = '關閉';
  } else {
    btn.disabled = false;
    btn.classList.remove('opacity-50', 'pointer-events-none');
    nameEl.textContent = suggestion.crop;
    const aliasStr = suggestion.aliases?.length
      ? `別稱：${suggestion.aliases.slice(0, 3).join('、')}　` : '';
    subEl.textContent = `${aliasStr}${suggestion.category}`;

    if (isUntracked || !suggestion.tracked) {
      badgeEl.textContent = '目前無行情';
      badgeEl.className = 'si-badge muted';
      btn.onclick = () => {
        // 未追蹤：引導使用者到「新增品項追蹤流程」的說明
        subEl.innerHTML = '若想追蹤此品項，請編輯 <code class="bg-slate-100 px-1 rounded text-xs">etl/crops.yaml</code> 加上 <code class="bg-slate-100 px-1 rounded text-xs">tracked: true</code> 後執行 backfill。';
        badgeEl.textContent = '';
      };
      closeBtn.textContent = '了解，關閉';
    } else {
      badgeEl.textContent = '是這個 →';
      badgeEl.className = 'text-xs font-semibold text-emerald-600';
      btn.onclick = () => {
        closeNotFoundDialog();
        selectCrop(suggestion, query);
      };
      closeBtn.textContent = '都不是，重新搜尋';
    }
  }

  modal.classList.remove('hidden');
}

function closeNotFoundDialog() {
  document.getElementById('notfound-modal').classList.add('hidden');
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
    const { history, digest, latest, yoy, cropsIndex } = await loadData();
    state.history    = history;
    state.digest     = digest;
    state.latest     = latest;
    state.yoy        = yoy;
    state.cropsIndex = cropsIndex;

    if (!latest.trade_date) throw new Error('no-data');

    document.getElementById('updated-at').textContent =
      `資料日期：${latest.trade_date}`;

    loadingEl.classList.add('hidden');
    appEl.classList.remove('hidden');

    renderSummaryCards(latest, history);
    setupEventHandlers();
    setupModalHandlers();
    setupHistoryModal();
    setupSearch();
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
