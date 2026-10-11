/**
 * script.js — Sales Dashboard (Full Feature Build)
 *
 * Features implemented:
 *  R1  — Multi-Dataset Upload & Switcher (FileReader, CSV parser, localStorage)
 *  R2  — Widget Customizer (toggle ON/OFF per chart, saved per user)
 *  R3  — Date Range Filter + Quick Presets (Q1–Q4, H1, H2)
 *  R4  — Profit Margin KPI + Grouped Bar + Cost vs Price Scatter
 *  R5  — Data Table View (sort, search, pagination, CSV export)
 *  R6  — Export CSV (data) + Export PNG (per chart)
 *  R7  — Role-Based Access: admin vs viewer (read from session)
 *  R8  — KPI Target Tracker (progress bars, color coding)
 *  R9  — Anomaly Detection (high-discount alert, anomaly scatter highlight)
 *  R10 — Drill-Down Cross-Filter (click chart segment → auto-filter)
 *  R11 — Sales Forecasting (linear regression overlay on Sales Trend)
 */

/* ============================================================
   COLOR PALETTE
   ============================================================ */
const PALETTE = {
  blue:    "#3b82f6",
  violet:  "#8b5cf6",
  emerald: "#10b981",
  amber:   "#f59e0b",
  rose:    "#f43f5e",
  cyan:    "#06b6d4",
  indigo:  "#6366f1",
  lime:    "#84cc16",
};
const COLOR_LIST = Object.values(PALETTE);

const toRgba = (hex, alpha) => {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
};

/* ============================================================
   GLOBAL STATE
   ============================================================ */
let allData        = [];      // active dataset records
let chartRefs      = {};      // { canvasId: Chart instance }
let currentFiltered = [];     // last filtered dataset (for table + export)
let tableSort      = { col: null, dir: 1 };
let tablePage      = 1;
const TABLE_PAGE_SIZE = 50;
let tableSearchTerm = "";
let pendingUpload  = null;    // { name, data } awaiting preview confirmation

/* ============================================================
   STORAGE KEYS
   ============================================================ */
const SK_DATASETS  = "sd_extra_datasets"; // localStorage: [{name, data}]
const SK_TARGETS   = "sd_targets";        // localStorage: {revenue, transactions, quantity}
const SK_WIDGETS   = "sd_widgets_";       // + username suffix

/* ============================================================
   WIDGET REGISTRY — all togglable chart widgets
   ============================================================ */
const WIDGET_REGISTRY = [
  { id: "widget-sales-trend",    label: "Sales Trend (Monthly)"        },
  { id: "widget-region",         label: "Revenue per Region"           },
  { id: "widget-category",       label: "Revenue per Category"         },
  { id: "widget-profit-margin",  label: "Profit Margin per Category"   },
  { id: "widget-sales-rep",      label: "Sales per Representative"     },
  { id: "widget-cost-price",     label: "Unit Cost vs Unit Price"      },
  { id: "widget-customer-type",  label: "Customer Type Distribution"   },
  { id: "widget-payment",        label: "Payment Method Usage"         },
  { id: "widget-channel",        label: "Sales Channel Distribution"   },
  { id: "widget-scatter",        label: "Discount vs Sales (Scatter)"  },
  { id: "widget-qty-category",   label: "Quantity Sold per Category"   },
  { id: "widget-top10",          label: "Top 10 Highest Sales"         },
];

/* ============================================================
   SESSION HELPERS
   ============================================================ */
function getSessionUser() {
  try {
    const s = JSON.parse(sessionStorage.getItem("sd_session") || "null");
    return s && typeof s.username === "string" ? s : null;
  } catch { return null; }
}
function isAdmin() {
  const s = getSessionUser();
  return s && (s.role === "admin" || s.username === "admin");
}

/* ============================================================
   LOADING OVERLAY
   ============================================================ */
function showLoading() {
  if (!document.getElementById("loading-overlay")) {
    const el = document.createElement("div");
    el.id = "loading-overlay";
    el.innerHTML = `<div class="spinner"></div><span>Loading…</span>`;
    document.body.prepend(el);
  } else {
    document.getElementById("loading-overlay").classList.remove("hidden");
  }
}
function hideLoading() {
  const el = document.getElementById("loading-overlay");
  if (el) el.classList.add("hidden");
}

/* ============================================================
   DATA LOADING (R1 — Dataset Manager)
   ============================================================ */
function loadData() {
  showLoading();
  if (typeof SALES_DATA === "undefined" || !Array.isArray(SALES_DATA)) {
    hideLoading();
    document.body.innerHTML = `<div class="flex flex-col items-center justify-center min-h-screen text-center p-8">
      <p class="text-2xl font-bold text-red-500 mb-2">⚠️ Data tidak ditemukan</p>
      <p class="text-gray-500 text-sm">Pastikan file <code>data.js</code> ada di folder yang sama.</p></div>`;
    return;
  }
  allData = SALES_DATA;
  init();
}

function init() {
  populateFilters();
  attachAllListeners();
  refreshDatasetSwitcher();
  renderDashboard(allData);
  hideLoading();
  // Set footer
  const fd = document.getElementById("footer-dataset");
  if (fd) fd.textContent = "sales_data.json";
}

/* ============================================================
   R1 — MULTI-DATASET UPLOAD & SWITCHER
   ============================================================ */

/** Parse a CSV string → array of objects */
function parseCSV(text) {
  const lines  = text.trim().split(/\r?\n/);
  const headers = lines[0].split(",").map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = line.split(",");
    const obj  = {};
    headers.forEach((h, i) => {
      const v = (vals[i] || "").trim();
      const n = parseFloat(v);
      obj[h] = isNaN(n) ? v : n;
    });
    return obj;
  });
}

/** Required fields for dashboard to work */
const REQUIRED_FIELDS = ["Sale_Date","Sales_Amount","Quantity_Sold","Product_Category","Region","Sales_Rep","Customer_Type","Sales_Channel","Discount","Unit_Cost","Unit_Price"];

function validateDataset(data) {
  if (!Array.isArray(data) || data.length === 0) return "Dataset is empty.";
  const keys = Object.keys(data[0]);
  const missing = REQUIRED_FIELDS.filter(f => !keys.includes(f));
  if (missing.length) return `Missing required fields: ${missing.join(", ")}`;
  return null;
}

function getSavedDatasets() {
  return JSON.parse(localStorage.getItem(SK_DATASETS) || "[]");
}
function saveDataset(name, data) {
  const arr = getSavedDatasets();
  const idx = arr.findIndex(d => d.name === name);
  if (idx >= 0) arr[idx].data = data; else arr.push({ name, data });
  localStorage.setItem(SK_DATASETS, JSON.stringify(arr));
}

function refreshDatasetSwitcher() {
  const sel = document.getElementById("dataset-switcher");
  if (!sel) return;
  const saved = getSavedDatasets();
  sel.innerHTML = `<option value="__default__">sales_data.json</option>`;
  saved.forEach(ds => {
    const opt = document.createElement("option");
    opt.value = ds.name;
    opt.textContent = ds.name.length > 18 ? ds.name.slice(0,16)+"…" : ds.name;
    sel.appendChild(opt);
  });
  sel.classList.toggle("hidden", saved.length === 0);
}

function switchDataset(name) {
  showLoading();
  if (name === "__default__") {
    allData = SALES_DATA;
    document.getElementById("header-dataset-name").textContent = "Fiscal Year 2023";
    const fd = document.getElementById("footer-dataset");
    if (fd) fd.textContent = "sales_data.json";
  } else {
    const saved = getSavedDatasets().find(d => d.name === name);
    if (!saved) { hideLoading(); return; }
    allData = saved.data;
    document.getElementById("header-dataset-name").textContent = name;
    const fd = document.getElementById("footer-dataset");
    if (fd) fd.textContent = name;
  }
  // Re-populate dropdowns for new dataset
  repopulateFilters();
  renderDashboard(allData);
  hideLoading();
}

/** Show upload preview modal */
function showUploadPreview(name, data) {
  pendingUpload = { name, data };
  const modal   = document.getElementById("modal-preview");
  const infoEl  = document.getElementById("preview-info");
  const errEl   = document.getElementById("preview-error");
  const tbl     = document.getElementById("preview-table");
  const btnLoad = document.getElementById("btn-preview-load");

  const err = validateDataset(data);
  infoEl.textContent = `${name} — ${data.length} records, ${Object.keys(data[0] || {}).length} fields`;
  errEl.classList.add("hidden");
  btnLoad.disabled = false;

  // Build mini preview table (first 5 rows)
  const cols = Object.keys(data[0] || {});
  const preview5 = data.slice(0, 5);
  let html = `<thead class="bg-gray-50"><tr>${cols.map(c=>`<th class="px-2 py-1.5 text-left text-gray-500 font-semibold whitespace-nowrap">${c}</th>`).join("")}</tr></thead>`;
  html += `<tbody>${preview5.map(r=>`<tr class="border-t border-gray-100">${cols.map(c=>`<td class="px-2 py-1 text-gray-700 whitespace-nowrap">${r[c] ?? ""}</td>`).join("")}</tr>`).join("")}</tbody>`;
  tbl.innerHTML = html;

  if (err) {
    errEl.textContent = "⚠️ " + err;
    errEl.classList.remove("hidden");
    btnLoad.disabled = true;
  }
  modal.classList.remove("hidden");
}

/* ============================================================
   FILTER HELPERS
   ============================================================ */
const FILTER_IDS = ["filter-region","filter-category","filter-customer","filter-channel"];

function populateSelect(selectId, field) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const cur = select.value;
  // Keep only the "all" option, remove the rest
  while (select.options.length > 1) select.remove(1);
  const values = [...new Set(allData.map(d => d[field]))].sort();
  values.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v; opt.textContent = v;
    select.appendChild(opt);
  });
  // Restore selection if still valid
  if ([...select.options].some(o => o.value === cur)) select.value = cur;
}

function populateFilters() {
  populateSelect("filter-region",   "Region");
  populateSelect("filter-category", "Product_Category");
  populateSelect("filter-customer", "Customer_Type");
  populateSelect("filter-channel",  "Sales_Channel");
  // Set default date range from data
  const dates = allData.map(d => d.Sale_Date).sort();
  if (dates.length) {
    document.getElementById("filter-date-from").value = dates[0];
    document.getElementById("filter-date-to").value   = dates[dates.length-1];
  }
}

function repopulateFilters() {
  // Reset all dropdowns to "all" then refill
  FILTER_IDS.forEach(id => { const el = document.getElementById(id); if(el) el.value = "all"; });
  document.getElementById("filter-date-from").value = "";
  document.getElementById("filter-date-to").value   = "";
  populateFilters();
}

function getFilterValues() {
  return {
    region:   document.getElementById("filter-region")?.value   || "all",
    category: document.getElementById("filter-category")?.value || "all",
    customer: document.getElementById("filter-customer")?.value || "all",
    channel:  document.getElementById("filter-channel")?.value  || "all",
    dateFrom: document.getElementById("filter-date-from")?.value || "",
    dateTo:   document.getElementById("filter-date-to")?.value   || "",
  };
}

function applyFilters(data, f) {
  return data.filter(d => {
    if (f.region   !== "all" && d.Region           !== f.region)   return false;
    if (f.category !== "all" && d.Product_Category !== f.category) return false;
    if (f.customer !== "all" && d.Customer_Type    !== f.customer) return false;
    if (f.channel  !== "all" && d.Sales_Channel    !== f.channel)  return false;
    if (f.dateFrom && d.Sale_Date < f.dateFrom) return false;
    if (f.dateTo   && d.Sale_Date > f.dateTo)   return false;
    return true;
  });
}

function onFilterChange() {
  const f = getFilterValues();
  const filtered = applyFilters(allData, f);
  updateActiveBadges(f);
  renderDashboard(filtered);
}

function resetFilters() {
  FILTER_IDS.forEach(id => { const el = document.getElementById(id); if(el) el.value = "all"; });
  const dates = allData.map(d => d.Sale_Date).sort();
  document.getElementById("filter-date-from").value = dates[0] || "";
  document.getElementById("filter-date-to").value   = dates[dates.length-1] || "";
  // Clear active preset highlight
  document.querySelectorAll(".date-preset").forEach(b => b.classList.remove("bg-blue-100","border-blue-400","text-blue-700"));
  updateActiveBadges({ region:"all",category:"all",customer:"all",channel:"all",dateFrom:"",dateTo:"" });
  renderDashboard(allData);
}

/** R3 — Date Presets */
function applyDatePreset(preset) {
  const year = allData.length ? new Date(allData[0].Sale_Date).getFullYear() : new Date().getFullYear();
  const ranges = {
    q1:  [`${year}-01-01`, `${year}-03-31`],
    q2:  [`${year}-04-01`, `${year}-06-30`],
    q3:  [`${year}-07-01`, `${year}-09-30`],
    q4:  [`${year}-10-01`, `${year}-12-31`],
    h1:  [`${year}-01-01`, `${year}-06-30`],
    h2:  [`${year}-07-01`, `${year}-12-31`],
    all: [`${year}-01-01`, `${year}-12-31`],
  };
  const [from, to] = ranges[preset] || ["",""];
  document.getElementById("filter-date-from").value = from;
  document.getElementById("filter-date-to").value   = to;
  onFilterChange();
  // Highlight active preset
  document.querySelectorAll(".date-preset").forEach(b => {
    b.classList.toggle("bg-blue-100",   b.dataset.preset === preset);
    b.classList.toggle("border-blue-400", b.dataset.preset === preset);
    b.classList.toggle("text-blue-700", b.dataset.preset === preset);
  });
}

function updateActiveBadges(f) {
  const container = document.getElementById("active-filters");
  if (!container) return;
  container.innerHTML = "";
  const checks = [
    { label:"Region",   val: f.region   },
    { label:"Category", val: f.category },
    { label:"Customer", val: f.customer },
    { label:"Channel",  val: f.channel  },
    { label:"From",     val: f.dateFrom },
    { label:"To",       val: f.dateTo   },
  ];
  let any = false;
  checks.forEach(({ label, val }) => {
    if (val && val !== "all") {
      any = true;
      const b = document.createElement("span");
      b.className = "filter-badge";
      b.textContent = `${label}: ${val}`;
      container.appendChild(b);
    }
  });
  if (!any) {
    const b = document.createElement("span");
    b.className = "filter-badge";
    b.textContent = "All Data";
    container.appendChild(b);
  }
}

/* ============================================================
   R8 — KPI TARGETS
   ============================================================ */
function getTargets() {
  return JSON.parse(localStorage.getItem(SK_TARGETS) || "{}");
}
function saveTargets(t) {
  localStorage.setItem(SK_TARGETS, JSON.stringify(t));
}

function renderKPIProgress(elBar, elPct, elTarget, actual, target, formatFn) {
  const pct  = Math.min((actual / target) * 100, 100);
  const color = pct >= 100 ? "bg-emerald-500" : pct >= 80 ? "bg-amber-400" : "bg-red-400";
  elBar.className    = `h-full rounded-full transition-all duration-500 ${color}`;
  elBar.style.width  = pct.toFixed(1) + "%";
  elPct.textContent  = pct.toFixed(0) + "%";
  elTarget.textContent = "/ " + formatFn(target);
}

/* ============================================================
   KPI CALCULATIONS (R4 adds profit/margin)
   ============================================================ */
function renderKPIs(data) {
  const totalRevenue      = data.reduce((s, d) => s + d.Sales_Amount, 0);
  const totalTransactions = data.length;
  const totalQty          = data.reduce((s, d) => s + d.Quantity_Sold, 0);
  const avgDiscount       = data.length ? data.reduce((s, d) => s + d.Discount, 0) / data.length : 0;
  // R4 — Profit = Sales_Amount − (Unit_Cost × Quantity_Sold)
  const totalCost   = data.reduce((s, d) => s + (d.Unit_Cost * d.Quantity_Sold), 0);
  const grossProfit = totalRevenue - totalCost;
  const margin      = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

  document.getElementById("kpi-revenue").textContent      = formatCurrency(totalRevenue);
  document.getElementById("kpi-transactions").textContent = totalTransactions.toLocaleString();
  document.getElementById("kpi-quantity").textContent     = totalQty.toLocaleString();
  document.getElementById("kpi-discount").textContent     = (avgDiscount * 100).toFixed(1) + "%";
  document.getElementById("kpi-txn-sub2").textContent     = totalTransactions.toLocaleString();

  // R4 Profit KPIs
  const profitEl  = document.getElementById("kpi-profit");
  const marginEl  = document.getElementById("kpi-margin");
  if (profitEl) profitEl.textContent = formatCurrency(grossProfit);
  if (marginEl) {
    marginEl.textContent = margin.toFixed(1) + "% margin";
    marginEl.className   = `text-xs mt-1 font-semibold ${margin >= 20 ? "text-emerald-600" : margin >= 0 ? "text-amber-600" : "text-red-600"}`;
  }

  // R8 — Progress bars
  const targets = getTargets();
  const progPairs = [
    { wrapId:"kpi-revenue-progress", barId:"kpi-revenue-bar", pctId:"kpi-revenue-pct", tgtId:"kpi-revenue-target", actual: totalRevenue,      target: targets.revenue,      fmt: formatCurrency },
    { wrapId:"kpi-txn-progress",     barId:"kpi-txn-bar",     pctId:"kpi-txn-pct",     tgtId:"kpi-txn-target",     actual: totalTransactions,  target: targets.transactions, fmt: v => v.toLocaleString() },
    { wrapId:"kpi-qty-progress",     barId:"kpi-qty-bar",     pctId:"kpi-qty-pct",     tgtId:"kpi-qty-target",     actual: totalQty,            target: targets.quantity,     fmt: v => v.toLocaleString() },
  ];
  progPairs.forEach(({ wrapId, barId, pctId, tgtId, actual, target, fmt }) => {
    const wrap = document.getElementById(wrapId);
    if (!wrap) return;
    if (target && target > 0) {
      wrap.classList.remove("hidden");
      renderKPIProgress(
        document.getElementById(barId),
        document.getElementById(pctId),
        document.getElementById(tgtId),
        actual, target, fmt
      );
    } else {
      wrap.classList.add("hidden");
    }
  });
}

/* ============================================================
   UTILITY
   ============================================================ */
function formatCurrency(v) {
  if (v >= 1_000_000) return `$${(v/1_000_000).toFixed(2)}M`;
  if (v >= 1_000)     return `$${(v/1_000).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
}

function groupSum(data, keyField, valueField) {
  return data.reduce((acc, d) => {
    const k = d[keyField]; acc[k] = (acc[k]||0) + d[valueField]; return acc;
  }, {});
}
function groupCount(data, keyField) {
  return data.reduce((acc, d) => {
    const k = d[keyField]; acc[k] = (acc[k]||0) + 1; return acc;
  }, {});
}

/** R11 — Linear regression → { slope, intercept } */
function linearRegression(points) {
  const n  = points.length;
  if (n < 2) return null;
  const sumX  = points.reduce((s, p) => s + p.x, 0);
  const sumY  = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0);
  const slope     = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

function createChart(canvasId, config) {
  if (chartRefs[canvasId]) chartRefs[canvasId].destroy();
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  chartRefs[canvasId] = new Chart(canvas.getContext("2d"), config);
}

const defaultOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      labels: { font: { family: "-apple-system,'Segoe UI',system-ui,sans-serif", size: 12 }, color: "#6b7280", boxWidth: 12, padding: 16 },
    },
    tooltip: { backgroundColor: "#1f2937", titleColor: "#f9fafb", bodyColor: "#d1d5db", cornerRadius: 8, padding: 10 },
  },
};

/* ============================================================
   R10 — DRILL-DOWN CROSS-FILTER HELPER
   ============================================================ */
/**
 * Attach click handler to a Chart.js chart that sets a filter
 * based on which bar/segment was clicked.
 * @param {string} chartId - canvas element id
 * @param {string} filterId - the <select> id to update
 * @param {string[]} labelsArray - labels array matching dataset order
 */
function attachDrillDown(chartId, filterId, labelsArray) {
  const canvas = document.getElementById(chartId);
  if (!canvas) return;
  canvas.addEventListener("click", (evt) => {
    const chart = chartRefs[chartId];
    if (!chart) return;
    const points = chart.getElementsAtEventForMode(evt, "nearest", { intersect: true }, false);
    if (!points.length) return;
    const idx   = points[0].index;
    const label = labelsArray[idx];
    if (!label) return;
    const sel = document.getElementById(filterId);
    if (!sel) return;
    // Toggle: if already filtered to this, reset to "all"
    sel.value = sel.value === label ? "all" : label;
    onFilterChange();
  });
}

/* ============================================================
   CHART RENDERERS
   ============================================================ */

/* ----- 1. Sales Trend — R11 forecast overlay ----- */
function renderSalesTrend(data) {
  const monthly = {};
  data.forEach(d => {
    const m = d.Sale_Date.slice(0,7);
    monthly[m] = (monthly[m]||0) + d.Sales_Amount;
  });
  const labels   = Object.keys(monthly).sort();
  const values   = labels.map(k => +monthly[k].toFixed(2));
  const dispLabels = labels.map(m => {
    const [y,mo] = m.split("-");
    return new Date(+y,+mo-1,1).toLocaleString("en",{month:"short",year:"2-digit"});
  });

  const datasets = [{
    label: "Monthly Revenue",
    data: values,
    borderColor: PALETTE.blue,
    backgroundColor: toRgba(PALETTE.blue, 0.1),
    fill: true, tension: 0.4, pointRadius: 4,
    pointBackgroundColor: PALETTE.blue, borderWidth: 2,
    order: 1,
  }];

  // R11 — Forecast if checkbox checked
  const showForecast = document.getElementById("toggle-forecast")?.checked;
  if (showForecast && values.length >= 3) {
    const pts  = values.map((y, x) => ({ x, y }));
    const reg  = linearRegression(pts);
    if (reg) {
      const forecastMonths = 3;
      const allX = [...pts.map(p => p.x)];
      for (let i = 1; i <= forecastMonths; i++) allX.push(pts.length - 1 + i);
      const trendData = allX.map(x => +( reg.slope * x + reg.intercept ).toFixed(2));
      // Extend display labels
      const lastDate = labels[labels.length-1];
      const extLabels = [...dispLabels];
      for (let i = 1; i <= forecastMonths; i++) {
        const d = new Date(lastDate + "-01");
        d.setMonth(d.getMonth() + i);
        extLabels.push(d.toLocaleString("en",{month:"short",year:"2-digit"}) + " ★");
      }
      datasets.push({
        label: "Forecast (Linear)",
        data: trendData,
        borderColor: PALETTE.rose,
        backgroundColor: "transparent",
        borderWidth: 2,
        borderDash: [6, 4],
        pointRadius: allX.map((_, i) => i < values.length ? 0 : 5),
        pointBackgroundColor: PALETTE.rose,
        tension: 0.1, fill: false, order: 0,
      });
      // Extend actual data with nulls
      datasets[0].data = [...values, ...Array(forecastMonths).fill(null)];
      createChart("chart-sales-trend", {
        type: "line",
        data: { labels: extLabels, datasets },
        options: {
          ...defaultOptions,
          scales: {
            x: { grid:{display:false}, ticks:{color:"#9ca3af",font:{size:11}} },
            y: { grid:{color:"#f3f4f6"}, ticks:{color:"#9ca3af",font:{size:11},callback:v=>formatCurrency(v)} },
          },
        },
      });
      return;
    }
  }

  createChart("chart-sales-trend", {
    type: "line",
    data: { labels: dispLabels, datasets },
    options: {
      ...defaultOptions,
      scales: {
        x: { grid:{display:false}, ticks:{color:"#9ca3af",font:{size:11}} },
        y: { grid:{color:"#f3f4f6"}, ticks:{color:"#9ca3af",font:{size:11},callback:v=>formatCurrency(v)} },
      },
    },
  });
}

/* ----- 2. Revenue per Region — R10 drill-down ----- */
function renderRevenueByRegion(data) {
  const grouped = groupSum(data, "Region", "Sales_Amount");
  const labels  = Object.keys(grouped).sort();
  const values  = labels.map(k => +grouped[k].toFixed(2));
  const bgColors     = COLOR_LIST.slice(0,labels.length).map(c=>toRgba(c,0.72));
  const borderColors = COLOR_LIST.slice(0,labels.length);

  createChart("chart-region", {
    type: "polarArea",
    data: { labels, datasets:[{ data:values, backgroundColor:bgColors, borderColor:borderColors, borderWidth:2, hoverBackgroundColor:COLOR_LIST.slice(0,labels.length).map(c=>toRgba(c,0.92)) }] },
    options: {
      ...defaultOptions,
      plugins: { ...defaultOptions.plugins, legend:{...defaultOptions.plugins.legend,position:"bottom"},
        tooltip:{...defaultOptions.plugins.tooltip,callbacks:{label:ctx=>` ${ctx.label}: ${formatCurrency(ctx.parsed.r)}`}} },
      scales: { r:{ ticks:{color:"#9ca3af",font:{size:10},backdropColor:"transparent",callback:v=>formatCurrency(v)}, grid:{color:"#e5e7eb"}, angleLines:{color:"#e5e7eb"} } },
    },
  });
  // R10 — drill-down on click
  attachDrillDown("chart-region", "filter-region", labels);
}

/* ----- 3. Revenue per Category — R10 drill-down ----- */
function renderRevenueByCategory(data) {
  const grouped = groupSum(data, "Product_Category", "Sales_Amount");
  const labels  = Object.keys(grouped).sort((a,b)=>grouped[b]-grouped[a]);
  const values  = labels.map(k => +grouped[k].toFixed(2));

  createChart("chart-category", {
    type: "bar",
    data: { labels, datasets:[{ label:"Revenue ($)", data:values,
      backgroundColor:COLOR_LIST.slice(0,labels.length).map(c=>toRgba(c,0.82)),
      borderColor:COLOR_LIST.slice(0,labels.length), borderWidth:1.5, borderRadius:6 }] },
    options: {
      ...defaultOptions, indexAxis:"y",
      plugins: { ...defaultOptions.plugins, legend:{display:false},
        tooltip:{...defaultOptions.plugins.tooltip,callbacks:{label:ctx=>` ${formatCurrency(ctx.parsed.x)}`}} },
      scales: {
        x:{ grid:{color:"#f3f4f6"}, ticks:{color:"#9ca3af",font:{size:11},callback:v=>formatCurrency(v)} },
        y:{ grid:{display:false}, ticks:{color:"#374151",font:{size:12}} },
      },
    },
  });
  attachDrillDown("chart-category", "filter-category", labels);
}

/* ----- 4. R4 — Profit Margin per Category (Grouped Bar) ----- */
function renderProfitMargin(data) {
  const cats = [...new Set(data.map(d=>d.Product_Category))].sort();
  const revenues = cats.map(c => {
    const rows = data.filter(d=>d.Product_Category===c);
    return +rows.reduce((s,d)=>s+d.Sales_Amount,0).toFixed(2);
  });
  const costs = cats.map(c => {
    const rows = data.filter(d=>d.Product_Category===c);
    return +rows.reduce((s,d)=>s+(d.Unit_Cost*d.Quantity_Sold),0).toFixed(2);
  });
  const profits = cats.map((_,i) => +(revenues[i]-costs[i]).toFixed(2));

  createChart("chart-profit-margin", {
    type: "bar",
    data: {
      labels: cats,
      datasets: [
        { label:"Revenue", data:revenues, backgroundColor:toRgba(PALETTE.blue,0.75), borderColor:PALETTE.blue, borderWidth:1.5, borderRadius:4 },
        { label:"Cost",    data:costs,    backgroundColor:toRgba(PALETTE.rose,0.6),  borderColor:PALETTE.rose, borderWidth:1.5, borderRadius:4 },
        { label:"Profit",  data:profits,  backgroundColor:toRgba(PALETTE.emerald,0.8), borderColor:PALETTE.emerald, borderWidth:1.5, borderRadius:4 },
      ],
    },
    options: {
      ...defaultOptions,
      plugins: { ...defaultOptions.plugins,
        tooltip:{...defaultOptions.plugins.tooltip,callbacks:{label:ctx=>` ${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}`}} },
      scales: {
        x:{ grid:{display:false}, ticks:{color:"#374151",font:{size:12}} },
        y:{ grid:{color:"#f3f4f6"}, ticks:{color:"#9ca3af",font:{size:11},callback:v=>formatCurrency(v)} },
      },
    },
  });
}

/* ----- 5. Sales per Rep ----- */
function renderSalesPerRep(data) {
  const grouped = groupSum(data, "Sales_Rep", "Sales_Amount");
  const labels  = Object.keys(grouped).sort((a,b)=>grouped[b]-grouped[a]);
  const values  = labels.map(k=>+grouped[k].toFixed(2));

  createChart("chart-sales-rep", {
    type:"bar",
    data:{ labels, datasets:[{ label:"Revenue ($)", data:values,
      backgroundColor:labels.map((_,i)=>toRgba(COLOR_LIST[i%COLOR_LIST.length],0.8)),
      borderColor:labels.map((_,i)=>COLOR_LIST[i%COLOR_LIST.length]), borderWidth:1.5, borderRadius:6 }] },
    options:{
      ...defaultOptions,
      plugins:{ ...defaultOptions.plugins, legend:{display:false},
        tooltip:{...defaultOptions.plugins.tooltip,callbacks:{label:ctx=>` ${formatCurrency(ctx.parsed.y)}`}} },
      scales:{
        x:{ grid:{display:false}, ticks:{color:"#374151",font:{size:12}} },
        y:{ grid:{color:"#f3f4f6"}, ticks:{color:"#9ca3af",font:{size:11},callback:v=>formatCurrency(v)} },
      },
    },
  });
}

/* ----- 6. R4 — Unit Cost vs Unit Price Scatter ----- */
function renderCostVsPrice(data) {
  const categories = [...new Set(data.map(d=>d.Product_Category))].sort();
  const datasets = categories.map((cat, i) => {
    const rows  = data.filter(d=>d.Product_Category===cat);
    const pts   = rows.map(d=>({ x:+d.Unit_Cost.toFixed(2), y:+d.Unit_Price.toFixed(2) }));
    const color = COLOR_LIST[i%COLOR_LIST.length];
    return { label:cat, data:pts, backgroundColor:toRgba(color,0.55), borderColor:color, borderWidth:1, pointRadius:4, pointHoverRadius:6 };
  });

  createChart("chart-cost-price", {
    type:"scatter",
    data:{ datasets },
    options:{
      ...defaultOptions,
      plugins:{ ...defaultOptions.plugins,
        tooltip:{...defaultOptions.plugins.tooltip,callbacks:{
          label:ctx=>` ${ctx.dataset.label} — Cost: ${formatCurrency(ctx.parsed.x)} | Price: ${formatCurrency(ctx.parsed.y)}`
        }}
      },
      scales:{
        x:{ title:{display:true,text:"Unit Cost ($)",color:"#9ca3af",font:{size:11}}, grid:{color:"#f3f4f6"}, ticks:{color:"#9ca3af",font:{size:11},callback:v=>formatCurrency(v)} },
        y:{ title:{display:true,text:"Unit Price ($)",color:"#9ca3af",font:{size:11}}, grid:{color:"#f3f4f6"}, ticks:{color:"#9ca3af",font:{size:11},callback:v=>formatCurrency(v)} },
      },
    },
  });
}

/* ----- 7. Customer Type ----- */
function renderCustomerType(data) {
  const grouped = groupCount(data, "Customer_Type");
  const labels  = Object.keys(grouped);
  const values  = labels.map(k=>grouped[k]);
  createChart("chart-customer-type", {
    type:"pie", data:{ labels, datasets:[{ data:values, backgroundColor:[PALETTE.blue,PALETTE.emerald], borderWidth:2, borderColor:"#fff", hoverOffset:6 }] },
    options:{ ...defaultOptions, plugins:{ ...defaultOptions.plugins, legend:{...defaultOptions.plugins.legend,position:"bottom"} } },
  });
  attachDrillDown("chart-customer-type","filter-customer",labels);
}

/* ----- 8. Payment Method ----- */
function renderPaymentMethod(data) {
  const grouped = groupCount(data, "Payment_Method");
  const labels  = Object.keys(grouped).sort();
  const values  = labels.map(k=>grouped[k]);
  createChart("chart-payment", {
    type:"doughnut", data:{ labels, datasets:[{ data:values, backgroundColor:[PALETTE.violet,PALETTE.amber,PALETTE.cyan], borderWidth:2, borderColor:"#fff", hoverOffset:6 }] },
    options:{ ...defaultOptions, cutout:"58%", plugins:{ ...defaultOptions.plugins, legend:{...defaultOptions.plugins.legend,position:"bottom"} } },
  });
}

/* ----- 9. Sales Channel ----- */
function renderSalesChannel(data) {
  const grouped = groupCount(data, "Sales_Channel");
  const labels  = Object.keys(grouped);
  const values  = labels.map(k=>grouped[k]);
  createChart("chart-channel", {
    type:"pie", data:{ labels, datasets:[{ data:values, backgroundColor:[PALETTE.indigo,PALETTE.rose], borderWidth:2, borderColor:"#fff", hoverOffset:6 }] },
    options:{ ...defaultOptions, plugins:{ ...defaultOptions.plugins, legend:{...defaultOptions.plugins.legend,position:"bottom"} } },
  });
  attachDrillDown("chart-channel","filter-channel",labels);
}

/* ----- 10. R9 — Discount vs Sales Scatter with anomaly highlight ----- */
function renderScatter(data) {
  const ANOMALY_DISCOUNT = 0.25; // R9 threshold
  const normal   = [], anomaly = [];
  data.forEach(d => {
    const pt = { x:+(d.Discount*100).toFixed(1), y:+d.Sales_Amount.toFixed(2) };
    (d.Discount >= ANOMALY_DISCOUNT ? anomaly : normal).push(pt);
  });

  // Update anomaly note
  const noteEl = document.getElementById("anomaly-scatter-note");
  if (noteEl) noteEl.textContent = anomaly.length ? `(${anomaly.length} anomalies)` : "";

  createChart("chart-scatter", {
    type:"scatter",
    data:{ datasets:[
      { label:"Normal",  data:normal,  backgroundColor:toRgba(PALETTE.violet,0.45), borderColor:PALETTE.violet,  borderWidth:1, pointRadius:4, pointHoverRadius:6 },
      { label:"High Discount ≥25%", data:anomaly, backgroundColor:toRgba(PALETTE.rose,0.7), borderColor:PALETTE.rose, borderWidth:1.5, pointRadius:5, pointHoverRadius:8 },
    ]},
    options:{
      ...defaultOptions,
      plugins:{ ...defaultOptions.plugins,
        tooltip:{...defaultOptions.plugins.tooltip,callbacks:{label:ctx=>` Discount:${ctx.parsed.x}% | Revenue:${formatCurrency(ctx.parsed.y)}`}} },
      scales:{
        x:{ title:{display:true,text:"Discount (%)",color:"#9ca3af",font:{size:11}}, grid:{color:"#f3f4f6"}, ticks:{color:"#9ca3af",font:{size:11},callback:v=>`${v}%`} },
        y:{ title:{display:true,text:"Sales Amount ($)",color:"#9ca3af",font:{size:11}}, grid:{color:"#f3f4f6"}, ticks:{color:"#9ca3af",font:{size:11},callback:v=>formatCurrency(v)} },
      },
    },
  });
}

/* ----- 11. Top 10 ----- */
function renderTop10(data) {
  const top10  = [...data].sort((a,b)=>b.Sales_Amount-a.Sales_Amount).slice(0,10);
  const labels = top10.map(d=>`#${d.Product_ID} · ${d.Sales_Rep} · ${d.Product_Category}`);
  const values = top10.map(d=>+d.Sales_Amount.toFixed(2));
  const bgColors = values.map((_,i)=>toRgba(PALETTE.emerald,Math.max(0.9-i*0.07,0.3)));

  createChart("chart-top10", {
    type:"bar",
    data:{ labels, datasets:[{ label:"Sales Amount ($)", data:values, backgroundColor:bgColors, borderColor:PALETTE.emerald, borderWidth:1.5, borderRadius:6 }] },
    options:{
      ...defaultOptions, indexAxis:"y",
      plugins:{ ...defaultOptions.plugins, legend:{display:false},
        tooltip:{...defaultOptions.plugins.tooltip,callbacks:{label:ctx=>` ${formatCurrency(ctx.parsed.x)}`}} },
      scales:{
        x:{ grid:{color:"#f3f4f6"}, ticks:{color:"#9ca3af",font:{size:11},callback:v=>formatCurrency(v)} },
        y:{ grid:{display:false}, ticks:{color:"#374151",font:{size:11}} },
      },
    },
  });
}

/* ----- 12. Qty per Category ----- */
function renderQtyPerCategory(data) {
  const grouped = groupSum(data,"Product_Category","Quantity_Sold");
  const labels  = Object.keys(grouped).sort((a,b)=>grouped[b]-grouped[a]);
  const values  = labels.map(k=>grouped[k]);

  createChart("chart-qty-category", {
    type:"bar",
    data:{ labels, datasets:[{ label:"Units Sold", data:values,
      backgroundColor:labels.map((_,i)=>toRgba(COLOR_LIST[i%COLOR_LIST.length],0.75)),
      borderColor:labels.map((_,i)=>COLOR_LIST[i%COLOR_LIST.length]), borderWidth:1.5, borderRadius:6 }] },
    options:{
      ...defaultOptions,
      plugins:{ ...defaultOptions.plugins, legend:{display:false},
        tooltip:{...defaultOptions.plugins.tooltip,callbacks:{label:ctx=>` ${ctx.parsed.y.toLocaleString()} units`}} },
      scales:{
        x:{ grid:{display:false}, ticks:{color:"#374151",font:{size:12}} },
        y:{ grid:{color:"#f3f4f6"}, ticks:{color:"#9ca3af",font:{size:11},callback:v=>v.toLocaleString()} },
      },
    },
  });
}

/* ============================================================
   R9 — ANOMALY DETECTION
   ============================================================ */
function detectAnomalies(data) {
  const DISCOUNT_THRESHOLD = 0.25;
  const highDiscount  = data.filter(d => d.Discount >= DISCOUNT_THRESHOLD);
  const negMargin     = data.filter(d => (d.Sales_Amount - d.Unit_Cost * d.Quantity_Sold) < 0);
  const banner        = document.getElementById("anomaly-banner");
  const textEl        = document.getElementById("anomaly-text");
  if (!banner || !textEl) return;

  const messages = [];
  if (highDiscount.length)  messages.push(`${highDiscount.length} transactions with discount ≥25%`);
  if (negMargin.length)     messages.push(`${negMargin.length} transactions with negative gross margin`);

  if (messages.length) {
    textEl.textContent = "⚠ Anomalies detected: " + messages.join(" · ");
    banner.classList.remove("hidden");
  } else {
    banner.classList.add("hidden");
  }
}

/* ============================================================
   R2 — WIDGET CUSTOMIZER
   ============================================================ */
function getWidgetPrefs() {
  const user = getSessionUser();
  const key  = SK_WIDGETS + (user?.username || "default");
  const saved = JSON.parse(localStorage.getItem(key) || "null");
  if (saved) return saved;
  // Default: all visible
  return Object.fromEntries(WIDGET_REGISTRY.map(w => [w.id, true]));
}
function saveWidgetPrefs(prefs) {
  const user = getSessionUser();
  const key  = SK_WIDGETS + (user?.username || "default");
  localStorage.setItem(key, JSON.stringify(prefs));
}
function applyWidgetVisibility(prefs) {
  WIDGET_REGISTRY.forEach(({ id }) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("hidden", prefs[id] === false);
  });
}
function openCustomizeModal() {
  const prefs = getWidgetPrefs();
  const list  = document.getElementById("widget-toggle-list");
  list.innerHTML = "";
  WIDGET_REGISTRY.forEach(({ id, label }) => {
    const row  = document.createElement("label");
    row.className = "flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-50 cursor-pointer";
    const cb   = document.createElement("input");
    cb.type    = "checkbox";
    cb.checked = prefs[id] !== false;
    cb.dataset.widget = id;
    cb.className = "w-4 h-4 rounded accent-violet-600";
    const span = document.createElement("span");
    span.textContent = label;
    span.className   = "text-sm text-gray-700";
    row.appendChild(cb); row.appendChild(span);
    list.appendChild(row);
  });
  document.getElementById("modal-customize").classList.remove("hidden");
}

/* ============================================================
   R5 — DATA TABLE
   ============================================================ */
const TABLE_COLS = ["Sale_Date","Sales_Rep","Region","Product_Category","Sales_Amount","Quantity_Sold","Unit_Cost","Unit_Price","Discount","Customer_Type","Payment_Method","Sales_Channel"];
const COL_LABELS = { Sale_Date:"Date", Sales_Rep:"Rep", Region:"Region", Product_Category:"Category", Sales_Amount:"Revenue ($)", Quantity_Sold:"Qty", Unit_Cost:"Unit Cost", Unit_Price:"Unit Price", Discount:"Discount", Customer_Type:"Customer", Payment_Method:"Payment", Sales_Channel:"Channel" };

function renderTable(data) {
  currentFiltered = data;
  const head = document.getElementById("data-table-head");
  const body = document.getElementById("data-table-body");
  if (!head || !body) return;

  // Build header once
  if (!head.children.length) {
    const tr = document.createElement("tr");
    TABLE_COLS.forEach(col => {
      const th = document.createElement("th");
      th.textContent = COL_LABELS[col] || col;
      th.className   = "px-3 py-2 text-left cursor-pointer select-none whitespace-nowrap hover:text-blue-600 transition-colors";
      th.dataset.col  = col;
      th.addEventListener("click", () => {
        if (tableSort.col === col) tableSort.dir *= -1;
        else { tableSort.col = col; tableSort.dir = 1; }
        tablePage = 1;
        renderTableBody();
      });
      tr.appendChild(th);
    });
    head.appendChild(tr);
  }
  tablePage = 1;
  renderTableBody();
}

function getTableData() {
  let rows = [...currentFiltered];
  // Search
  if (tableSearchTerm) {
    const q = tableSearchTerm.toLowerCase();
    rows = rows.filter(r => TABLE_COLS.some(c => String(r[c]||"").toLowerCase().includes(q)));
  }
  // Sort
  if (tableSort.col) {
    rows.sort((a,b) => {
      const av = a[tableSort.col]; const bv = b[tableSort.col];
      if (typeof av === "number") return (av - bv) * tableSort.dir;
      return String(av).localeCompare(String(bv)) * tableSort.dir;
    });
  }
  return rows;
}

function renderTableBody() {
  const body  = document.getElementById("data-table-body");
  if (!body) return;
  const rows  = getTableData();
  const total = rows.length;
  const start = (tablePage-1)*TABLE_PAGE_SIZE;
  const page  = rows.slice(start, start+TABLE_PAGE_SIZE);

  body.innerHTML = "";
  page.forEach((r, ri) => {
    const tr = document.createElement("tr");
    tr.className = ri%2===0 ? "bg-white hover:bg-gray-50" : "bg-gray-50/50 hover:bg-gray-100/60";
    TABLE_COLS.forEach(col => {
      const td  = document.createElement("td");
      td.className = "px-3 py-1.5 whitespace-nowrap";
      let val = r[col];
      if (col === "Sales_Amount" || col === "Unit_Cost" || col === "Unit_Price") val = formatCurrency(+val);
      else if (col === "Discount") val = (+val*100).toFixed(0)+"%";
      td.textContent = val ?? "—";
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });

  const totalPages = Math.ceil(total/TABLE_PAGE_SIZE);
  document.getElementById("table-info").textContent       = `Showing ${Math.min(start+1,total)}–${Math.min(start+TABLE_PAGE_SIZE,total)} of ${total.toLocaleString()} records`;
  document.getElementById("table-page-info").textContent  = `Page ${tablePage} / ${totalPages}`;
  document.getElementById("btn-page-prev").disabled        = tablePage <= 1;
  document.getElementById("btn-page-next").disabled        = tablePage >= totalPages;
}

/* ============================================================
   R6 — EXPORT
   ============================================================ */

/** Export current filtered data as CSV download */
function exportCSV(data) {
  const rows = [TABLE_COLS.join(",")];
  data.forEach(r => rows.push(TABLE_COLS.map(c => {
    const v = String(r[c] ?? "");
    return v.includes(",") ? `"${v}"` : v;
  }).join(",")));
  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = "sales_export.csv";
  a.click(); URL.revokeObjectURL(url);
}

/** Export a single chart as PNG */
function exportChartPNG(canvasId) {
  const chart = chartRefs[canvasId];
  if (!chart) return;
  const a   = document.createElement("a");
  a.href    = chart.toBase64Image();
  a.download = canvasId + ".png";
  a.click();
}

/** Print PDF via browser print dialog */
function exportPDF() {
  window.print();
}

/* ============================================================
   MASTER RENDER
   ============================================================ */
function renderDashboard(data) {
  currentFiltered = data;
  renderKPIs(data);
  renderSalesTrend(data);
  renderRevenueByRegion(data);
  renderRevenueByCategory(data);
  renderProfitMargin(data);
  renderSalesPerRep(data);
  renderCostVsPrice(data);
  renderCustomerType(data);
  renderPaymentMethod(data);
  renderSalesChannel(data);
  renderScatter(data);
  renderTop10(data);
  renderQtyPerCategory(data);
  detectAnomalies(data);
  renderTable(data);
  // Apply saved widget visibility
  applyWidgetVisibility(getWidgetPrefs());
}

/* ============================================================
   ATTACH ALL LISTENERS
   ============================================================ */
function attachAllListeners() {

  // ── Filters ──
  [...FILTER_IDS, "filter-date-from", "filter-date-to"].forEach(id => {
    document.getElementById(id)?.addEventListener("change", onFilterChange);
  });
  document.getElementById("btn-reset")?.addEventListener("click", resetFilters);

  // R3 — Date presets
  document.querySelectorAll(".date-preset").forEach(btn => {
    btn.addEventListener("click", () => applyDatePreset(btn.dataset.preset));
  });

  // ── View toggle (Charts / Table) ──
  document.getElementById("btn-view-chart")?.addEventListener("click", () => {
    document.getElementById("view-charts").classList.remove("hidden");
    document.getElementById("view-table").classList.add("hidden");
    document.getElementById("btn-view-chart").classList.add("active");
    document.getElementById("btn-view-table").classList.remove("active");
  });
  document.getElementById("btn-view-table")?.addEventListener("click", () => {
    document.getElementById("view-charts").classList.add("hidden");
    document.getElementById("view-table").classList.remove("hidden");
    document.getElementById("btn-view-chart").classList.remove("active");
    document.getElementById("btn-view-table").classList.add("active");
    renderTable(currentFiltered);
  });

  // ── R2 Widget Customizer ──
  document.getElementById("btn-customize")?.addEventListener("click", openCustomizeModal);
  document.getElementById("btn-customize-close")?.addEventListener("click", () => document.getElementById("modal-customize").classList.add("hidden"));
  document.getElementById("btn-widget-save")?.addEventListener("click", () => {
    const prefs = {};
    document.querySelectorAll("#widget-toggle-list input[type=checkbox]").forEach(cb => {
      prefs[cb.dataset.widget] = cb.checked;
    });
    saveWidgetPrefs(prefs);
    applyWidgetVisibility(prefs);
    document.getElementById("modal-customize").classList.add("hidden");
  });
  document.getElementById("btn-widget-reset")?.addEventListener("click", () => {
    const prefs = Object.fromEntries(WIDGET_REGISTRY.map(w=>[w.id,true]));
    saveWidgetPrefs(prefs);
    applyWidgetVisibility(prefs);
    // Re-check all in modal
    document.querySelectorAll("#widget-toggle-list input[type=checkbox]").forEach(cb => cb.checked = true);
  });

  // ── R8 Target Modal ──
  document.getElementById("btn-set-targets")?.addEventListener("click", () => {
    const t = getTargets();
    document.getElementById("target-revenue").value      = t.revenue      || "";
    document.getElementById("target-transactions").value = t.transactions || "";
    document.getElementById("target-quantity").value     = t.quantity     || "";
    document.getElementById("modal-target").classList.remove("hidden");
  });
  document.getElementById("btn-target-close")?.addEventListener("click", () => document.getElementById("modal-target").classList.add("hidden"));
  document.getElementById("btn-target-save")?.addEventListener("click", () => {
    const t = {
      revenue:      parseFloat(document.getElementById("target-revenue").value)      || 0,
      transactions: parseFloat(document.getElementById("target-transactions").value) || 0,
      quantity:     parseFloat(document.getElementById("target-quantity").value)     || 0,
    };
    saveTargets(t);
    document.getElementById("modal-target").classList.add("hidden");
    renderDashboard(currentFiltered);
  });
  document.getElementById("btn-target-clear")?.addEventListener("click", () => {
    localStorage.removeItem(SK_TARGETS);
    document.getElementById("modal-target").classList.add("hidden");
    renderDashboard(currentFiltered);
  });

  // ── R6 Export ──
  document.getElementById("btn-export-csv")?.addEventListener("click", () => exportCSV(currentFiltered));
  document.getElementById("btn-export-pdf")?.addEventListener("click", exportPDF);
  document.getElementById("btn-table-export")?.addEventListener("click", () => exportCSV(currentFiltered));

  // Per-chart PNG export buttons
  document.querySelectorAll(".chart-export-btn").forEach(btn => {
    btn.addEventListener("click", () => exportChartPNG(btn.dataset.chart));
  });

  // ── R1 Upload ──
  document.getElementById("upload-csv")?.addEventListener("change", e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      let data;
      try {
        if (file.name.endsWith(".json")) data = JSON.parse(ev.target.result);
        else data = parseCSV(ev.target.result);
        showUploadPreview(file.name, data);
      } catch(err) {
        alert("Failed to parse file: " + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = ""; // allow re-upload same file
  });

  document.getElementById("btn-preview-load")?.addEventListener("click", () => {
    if (!pendingUpload) return;
    saveDataset(pendingUpload.name, pendingUpload.data);
    allData = pendingUpload.data;
    document.getElementById("header-dataset-name").textContent = pendingUpload.name;
    const fd = document.getElementById("footer-dataset");
    if (fd) fd.textContent = pendingUpload.name;
    pendingUpload = null;
    document.getElementById("modal-preview").classList.add("hidden");
    refreshDatasetSwitcher();
    document.getElementById("dataset-switcher").value = allData === SALES_DATA ? "__default__" : getSavedDatasets().slice(-1)[0]?.name;
    repopulateFilters();
    renderDashboard(allData);
  });
  document.getElementById("btn-preview-cancel")?.addEventListener("click", () => {
    pendingUpload = null;
    document.getElementById("modal-preview").classList.add("hidden");
  });
  document.getElementById("btn-preview-close")?.addEventListener("click", () => {
    pendingUpload = null;
    document.getElementById("modal-preview").classList.add("hidden");
  });

  // Dataset switcher dropdown
  document.getElementById("dataset-switcher")?.addEventListener("change", e => switchDataset(e.target.value));

  // ── R9 Anomaly banner close ──
  document.getElementById("btn-anomaly-close")?.addEventListener("click", () => {
    document.getElementById("anomaly-banner").classList.add("hidden");
  });

  // ── R11 Forecast toggle ──
  document.getElementById("toggle-forecast")?.addEventListener("change", () => renderSalesTrend(currentFiltered));

  // ── R5 Table search & pagination ──
  document.getElementById("table-search")?.addEventListener("input", e => {
    tableSearchTerm = e.target.value;
    tablePage = 1;
    renderTableBody();
  });
  document.getElementById("btn-page-prev")?.addEventListener("click", () => { if (tablePage > 1) { tablePage--; renderTableBody(); } });
  document.getElementById("btn-page-next")?.addEventListener("click", () => { tablePage++; renderTableBody(); });
}

/* ============================================================
   ENTRY POINT
   ============================================================ */
document.addEventListener("DOMContentLoaded", loadData);
