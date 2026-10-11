/**
 * script.js — Sales Dashboard
 *
 * Architecture:
 *  1. Load sales_data.json via fetch
 *  2. Populate filter dropdowns dynamically
 *  3. On filter change → filter data → re-render KPIs + all charts
 *
 * Chart instances are stored in a registry so they can be
 * destroyed and re-created on every filter update.
 */

/* ============================================================
   CONSTANTS & COLOR PALETTE
   ============================================================ */

/** Consistent palette used across all charts */
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

/** Ordered list of palette values for multi-series / categorical charts */
const COLOR_LIST = Object.values(PALETTE);

/** Soft transparent fills for bar / area charts */
const toRgba = (hex, alpha) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

/* ============================================================
   GLOBAL STATE
   ============================================================ */
let allData   = [];    // raw JSON records
let chartRefs = {};    // { chartId: Chart instance }

/* ============================================================
   LOADING OVERLAY
   ============================================================ */
function showLoading() {
  // Inject a simple loading overlay on first call
  if (!document.getElementById("loading-overlay")) {
    const el = document.createElement("div");
    el.id = "loading-overlay";
    el.innerHTML = `<div class="spinner"></div><span>Loading dashboard data…</span>`;
    document.body.prepend(el);
  }
}
function hideLoading() {
  const el = document.getElementById("loading-overlay");
  if (el) el.classList.add("hidden");
}

/* ============================================================
   DATA LOADING
   ============================================================ */
function loadData() {
  showLoading();
  // SALES_DATA is defined in data.js — no fetch/server needed
  if (typeof SALES_DATA === "undefined" || !Array.isArray(SALES_DATA)) {
    hideLoading();
    document.body.innerHTML = `
      <div class="flex flex-col items-center justify-center min-h-screen text-center p-8">
        <p class="text-2xl font-bold text-red-500 mb-2">⚠️ Data tidak ditemukan</p>
        <p class="text-gray-500 text-sm">Pastikan file <code>data.js</code> ada di folder yang sama dengan <code>index.html</code>.</p>
      </div>`;
    return;
  }
  allData = SALES_DATA;
  init();
}

/* ============================================================
   INITIALISATION — runs once after data is loaded
   ============================================================ */
function init() {
  populateFilters();
  attachFilterListeners();
  renderDashboard(allData); // initial render with all data
  hideLoading();
}

/* ============================================================
   FILTER HELPERS
   ============================================================ */

/**
 * Extract unique sorted values for a given field from allData
 * and append <option> elements to the target <select>.
 */
function populateSelect(selectId, field) {
  const select = document.getElementById(selectId);
  const values = [...new Set(allData.map(d => d[field]))].sort();
  values.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    select.appendChild(opt);
  });
}

function populateFilters() {
  populateSelect("filter-region",   "Region");
  populateSelect("filter-category", "Product_Category");
  populateSelect("filter-customer", "Customer_Type");
  populateSelect("filter-channel",  "Sales_Channel");
}

function attachFilterListeners() {
  const ids = ["filter-region", "filter-category", "filter-customer", "filter-channel"];
  ids.forEach(id => {
    document.getElementById(id).addEventListener("change", onFilterChange);
  });
  document.getElementById("btn-reset").addEventListener("click", resetFilters);
}

function getFilterValues() {
  return {
    region:   document.getElementById("filter-region").value,
    category: document.getElementById("filter-category").value,
    customer: document.getElementById("filter-customer").value,
    channel:  document.getElementById("filter-channel").value,
  };
}

/** Apply all active filters to the full dataset */
function applyFilters(data, filters) {
  return data.filter(d => {
    if (filters.region   !== "all" && d.Region           !== filters.region)   return false;
    if (filters.category !== "all" && d.Product_Category !== filters.category) return false;
    if (filters.customer !== "all" && d.Customer_Type    !== filters.customer) return false;
    if (filters.channel  !== "all" && d.Sales_Channel    !== filters.channel)  return false;
    return true;
  });
}

function onFilterChange() {
  const filters = getFilterValues();
  const filtered = applyFilters(allData, filters);
  updateActiveBadges(filters);
  renderDashboard(filtered);
}

function resetFilters() {
  ["filter-region", "filter-category", "filter-customer", "filter-channel"].forEach(id => {
    document.getElementById(id).value = "all";
  });
  updateActiveBadges({ region: "all", category: "all", customer: "all", channel: "all" });
  renderDashboard(allData);
}

/** Show active filter badges in the header */
function updateActiveBadges(filters) {
  const container = document.getElementById("active-filters");
  container.innerHTML = "";
  const labels = {
    region:   { label: "Region",   value: filters.region   },
    category: { label: "Category", value: filters.category },
    customer: { label: "Customer", value: filters.customer },
    channel:  { label: "Channel",  value: filters.channel  },
  };
  let hasActive = false;
  Object.values(labels).forEach(({ label, value }) => {
    if (value !== "all") {
      hasActive = true;
      const badge = document.createElement("span");
      badge.className = "filter-badge";
      badge.textContent = `${label}: ${value}`;
      container.appendChild(badge);
    }
  });
  if (!hasActive) {
    const all = document.createElement("span");
    all.className = "filter-badge";
    all.textContent = "All Data";
    container.appendChild(all);
  }
}

/* ============================================================
   KPI CALCULATIONS
   ============================================================ */
function renderKPIs(data) {
  const totalRevenue     = data.reduce((s, d) => s + d.Sales_Amount, 0);
  const totalTransactions = data.length;
  const totalQty         = data.reduce((s, d) => s + d.Quantity_Sold, 0);
  const avgDiscount      = data.length
    ? data.reduce((s, d) => s + d.Discount, 0) / data.length
    : 0;

  document.getElementById("kpi-revenue").textContent      = formatCurrency(totalRevenue);
  document.getElementById("kpi-transactions").textContent = totalTransactions.toLocaleString();
  document.getElementById("kpi-quantity").textContent     = totalQty.toLocaleString();
  document.getElementById("kpi-discount").textContent     = (avgDiscount * 100).toFixed(1) + "%";
  document.getElementById("kpi-txn-sub2").textContent     = totalTransactions.toLocaleString();
}

/* ============================================================
   UTILITY FUNCTIONS
   ============================================================ */

/** Format a number as compact currency (e.g. $1.23M) */
function formatCurrency(value) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000)     return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

/** Aggregate data: { key: sum(field) } */
function groupSum(data, keyField, valueField) {
  return data.reduce((acc, d) => {
    const k = d[keyField];
    acc[k] = (acc[k] || 0) + d[valueField];
    return acc;
  }, {});
}

/** Aggregate data: { key: count } */
function groupCount(data, keyField) {
  return data.reduce((acc, d) => {
    const k = d[keyField];
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
}

/**
 * Destroy an existing chart instance (if any) and create a new one.
 * Stores the new instance in chartRefs[canvasId].
 */
function createChart(canvasId, config) {
  if (chartRefs[canvasId]) {
    chartRefs[canvasId].destroy();
  }
  const ctx = document.getElementById(canvasId).getContext("2d");
  chartRefs[canvasId] = new Chart(ctx, config);
}

/** Shared default options for all charts */
const defaultOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      labels: {
        font: { family: "-apple-system, 'Segoe UI', system-ui, sans-serif", size: 12 },
        color: "#6b7280",
        boxWidth: 12,
        padding: 16,
      },
    },
    tooltip: {
      backgroundColor: "#1f2937",
      titleColor: "#f9fafb",
      bodyColor: "#d1d5db",
      cornerRadius: 8,
      padding: 10,
    },
  },
};

/* ============================================================
   CHART RENDERERS
   ============================================================ */

/* ----- 1. Sales Trend (Monthly Line Chart) ----- */
function renderSalesTrend(data) {
  // Group by YYYY-MM, then sort chronologically
  const monthly = {};
  data.forEach(d => {
    const month = d.Sale_Date.slice(0, 7); // "2023-01"
    monthly[month] = (monthly[month] || 0) + d.Sales_Amount;
  });

  const labels = Object.keys(monthly).sort();
  const values = labels.map(k => +monthly[k].toFixed(2));

  // Display as "Jan 2023"
  const displayLabels = labels.map(m => {
    const [year, mon] = m.split("-");
    return new Date(+year, +mon - 1, 1).toLocaleString("en", { month: "short", year: "2-digit" });
  });

  createChart("chart-sales-trend", {
    type: "line",
    data: {
      labels: displayLabels,
      datasets: [{
        label: "Monthly Revenue ($)",
        data: values,
        borderColor: PALETTE.blue,
        backgroundColor: toRgba(PALETTE.blue, 0.1),
        fill: true,
        tension: 0.4,
        pointRadius: 4,
        pointBackgroundColor: PALETTE.blue,
        borderWidth: 2,
      }],
    },
    options: {
      ...defaultOptions,
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: "#9ca3af", font: { size: 11 } },
        },
        y: {
          grid: { color: "#f3f4f6" },
          ticks: {
            color: "#9ca3af",
            font: { size: 11 },
            callback: v => formatCurrency(v),
          },
        },
      },
    },
  });
}

/* ----- 2. Revenue per Region (Polar Area Chart) ----- */
function renderRevenueByRegion(data) {
  const grouped = groupSum(data, "Region", "Sales_Amount");
  const labels  = Object.keys(grouped).sort();
  const values  = labels.map(k => +grouped[k].toFixed(2));

  // Semi-transparent fills from the dashboard palette, solid borders
  const bgColors     = COLOR_LIST.slice(0, labels.length).map(c => toRgba(c, 0.72));
  const borderColors = COLOR_LIST.slice(0, labels.length);

  createChart("chart-region", {
    type: "polarArea",
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: bgColors,
        borderColor: borderColors,
        borderWidth: 2,
        hoverBackgroundColor: COLOR_LIST.slice(0, labels.length).map(c => toRgba(c, 0.92)),
      }],
    },
    options: {
      ...defaultOptions,
      plugins: {
        ...defaultOptions.plugins,
        legend: {
          ...defaultOptions.plugins.legend,
          position: "bottom",
        },
        tooltip: {
          ...defaultOptions.plugins.tooltip,
          callbacks: {
            label: ctx => ` ${ctx.label}: ${formatCurrency(ctx.parsed.r)}`,
          },
        },
      },
      scales: {
        r: {
          ticks: {
            color: "#9ca3af",
            font: { size: 10 },
            backdropColor: "transparent",
            callback: v => formatCurrency(v),
          },
          grid: { color: "#e5e7eb" },
          angleLines: { color: "#e5e7eb" },
        },
      },
    },
  });
}

/* ----- 3. Revenue per Product Category (Horizontal Bar) ----- */
function renderRevenueByCategory(data) {
  const grouped = groupSum(data, "Product_Category", "Sales_Amount");
  const labels  = Object.keys(grouped).sort((a, b) => grouped[b] - grouped[a]);
  const values  = labels.map(k => +grouped[k].toFixed(2));

  createChart("chart-category", {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Revenue ($)",
        data: values,
        backgroundColor: COLOR_LIST.slice(0, labels.length).map(c => toRgba(c, 0.82)),
        borderColor: COLOR_LIST.slice(0, labels.length),
        borderWidth: 1.5,
        borderRadius: 6,
      }],
    },
    options: {
      ...defaultOptions,
      indexAxis: "y",
      plugins: {
        ...defaultOptions.plugins,
        legend: { display: false },
        tooltip: {
          ...defaultOptions.plugins.tooltip,
          callbacks: { label: ctx => ` ${formatCurrency(ctx.parsed.x)}` },
        },
      },
      scales: {
        x: {
          grid: { color: "#f3f4f6" },
          ticks: { color: "#9ca3af", font: { size: 11 }, callback: v => formatCurrency(v) },
        },
        y: { grid: { display: false }, ticks: { color: "#374151", font: { size: 12 } } },
      },
    },
  });
}

/* ----- 4. Sales per Sales Representative (Bar) ----- */
function renderSalesPerRep(data) {
  const grouped = groupSum(data, "Sales_Rep", "Sales_Amount");
  const labels  = Object.keys(grouped).sort((a, b) => grouped[b] - grouped[a]);
  const values  = labels.map(k => +grouped[k].toFixed(2));

  createChart("chart-sales-rep", {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Revenue ($)",
        data: values,
        backgroundColor: labels.map((_, i) => toRgba(COLOR_LIST[i % COLOR_LIST.length], 0.8)),
        borderColor: labels.map((_, i) => COLOR_LIST[i % COLOR_LIST.length]),
        borderWidth: 1.5,
        borderRadius: 6,
      }],
    },
    options: {
      ...defaultOptions,
      plugins: {
        ...defaultOptions.plugins,
        legend: { display: false },
        tooltip: {
          ...defaultOptions.plugins.tooltip,
          callbacks: { label: ctx => ` ${formatCurrency(ctx.parsed.y)}` },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#374151", font: { size: 12 } } },
        y: {
          grid: { color: "#f3f4f6" },
          ticks: { color: "#9ca3af", font: { size: 11 }, callback: v => formatCurrency(v) },
        },
      },
    },
  });
}

/* ----- 5. Customer Type Distribution (Pie) ----- */
function renderCustomerType(data) {
  const grouped = groupCount(data, "Customer_Type");
  const labels  = Object.keys(grouped);
  const values  = labels.map(k => grouped[k]);

  createChart("chart-customer-type", {
    type: "pie",
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: [PALETTE.blue, PALETTE.emerald],
        borderWidth: 2,
        borderColor: "#fff",
        hoverOffset: 6,
      }],
    },
    options: {
      ...defaultOptions,
      plugins: {
        ...defaultOptions.plugins,
        legend: { ...defaultOptions.plugins.legend, position: "bottom" },
      },
    },
  });
}

/* ----- 6. Payment Method Usage (Doughnut) ----- */
function renderPaymentMethod(data) {
  const grouped = groupCount(data, "Payment_Method");
  const labels  = Object.keys(grouped).sort();
  const values  = labels.map(k => grouped[k]);

  createChart("chart-payment", {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: [PALETTE.violet, PALETTE.amber, PALETTE.cyan],
        borderWidth: 2,
        borderColor: "#fff",
        hoverOffset: 6,
      }],
    },
    options: {
      ...defaultOptions,
      cutout: "58%",
      plugins: {
        ...defaultOptions.plugins,
        legend: { ...defaultOptions.plugins.legend, position: "bottom" },
      },
    },
  });
}

/* ----- 7. Sales Channel Distribution (Pie) ----- */
function renderSalesChannel(data) {
  const grouped = groupCount(data, "Sales_Channel");
  const labels  = Object.keys(grouped);
  const values  = labels.map(k => grouped[k]);

  createChart("chart-channel", {
    type: "pie",
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: [PALETTE.indigo, PALETTE.rose],
        borderWidth: 2,
        borderColor: "#fff",
        hoverOffset: 6,
      }],
    },
    options: {
      ...defaultOptions,
      plugins: {
        ...defaultOptions.plugins,
        legend: { ...defaultOptions.plugins.legend, position: "bottom" },
      },
    },
  });
}

/* ----- 8. Discount vs Sales (Scatter Plot) ----- */
function renderScatter(data) {
  // Build one point per record: { x: discount%, y: sales_amount }
  const points = data.map(d => ({
    x: +(d.Discount * 100).toFixed(1),
    y: +d.Sales_Amount.toFixed(2),
  }));

  createChart("chart-scatter", {
    type: "scatter",
    data: {
      datasets: [{
        label: "Transaction",
        data: points,
        backgroundColor: toRgba(PALETTE.violet, 0.55),
        borderColor: PALETTE.violet,
        borderWidth: 1,
        pointRadius: 5,
        pointHoverRadius: 7,
      }],
    },
    options: {
      ...defaultOptions,
      plugins: {
        ...defaultOptions.plugins,
        legend: { display: false },
        tooltip: {
          ...defaultOptions.plugins.tooltip,
          callbacks: {
            label: ctx => ` Discount: ${ctx.parsed.x}% | Revenue: ${formatCurrency(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          title: {
            display: true,
            text: "Discount (%)",
            color: "#9ca3af",
            font: { size: 11 },
          },
          grid: { color: "#f3f4f6" },
          ticks: { color: "#9ca3af", font: { size: 11 }, callback: v => `${v}%` },
        },
        y: {
          title: {
            display: true,
            text: "Sales Amount ($)",
            color: "#9ca3af",
            font: { size: 11 },
          },
          grid: { color: "#f3f4f6" },
          ticks: { color: "#9ca3af", font: { size: 11 }, callback: v => formatCurrency(v) },
        },
      },
    },
  });
}

/* ----- 9. Top 10 Highest Sales (Horizontal Bar) ----- */
function renderTop10(data) {
  // Sort descending by Sales_Amount and take top 10
  const top10 = [...data]
    .sort((a, b) => b.Sales_Amount - a.Sales_Amount)
    .slice(0, 10);

  // Label: "ProductID | Rep | Category"
  const labels = top10.map(d => `#${d.Product_ID} · ${d.Sales_Rep} · ${d.Product_Category}`);
  const values = top10.map(d => +d.Sales_Amount.toFixed(2));

  // Gradient fill from high to lower value
  const bgColors = values.map((_, i) => {
    const alpha = 0.9 - i * 0.07;
    return toRgba(PALETTE.emerald, Math.max(alpha, 0.3));
  });

  createChart("chart-top10", {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Sales Amount ($)",
        data: values,
        backgroundColor: bgColors,
        borderColor: PALETTE.emerald,
        borderWidth: 1.5,
        borderRadius: 6,
      }],
    },
    options: {
      ...defaultOptions,
      indexAxis: "y",
      plugins: {
        ...defaultOptions.plugins,
        legend: { display: false },
        tooltip: {
          ...defaultOptions.plugins.tooltip,
          callbacks: { label: ctx => ` ${formatCurrency(ctx.parsed.x)}` },
        },
      },
      scales: {
        x: {
          grid: { color: "#f3f4f6" },
          ticks: { color: "#9ca3af", font: { size: 11 }, callback: v => formatCurrency(v) },
        },
        y: {
          grid: { display: false },
          ticks: { color: "#374151", font: { size: 11 } },
        },
      },
    },
  });
}

/* ----- 10. Quantity Sold per Category (Bar) ----- */
function renderQtyPerCategory(data) {
  const grouped = groupSum(data, "Product_Category", "Quantity_Sold");
  const labels  = Object.keys(grouped).sort((a, b) => grouped[b] - grouped[a]);
  const values  = labels.map(k => grouped[k]);

  createChart("chart-qty-category", {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Units Sold",
        data: values,
        backgroundColor: labels.map((_, i) => toRgba(COLOR_LIST[i % COLOR_LIST.length], 0.75)),
        borderColor: labels.map((_, i) => COLOR_LIST[i % COLOR_LIST.length]),
        borderWidth: 1.5,
        borderRadius: 6,
      }],
    },
    options: {
      ...defaultOptions,
      plugins: {
        ...defaultOptions.plugins,
        legend: { display: false },
        tooltip: {
          ...defaultOptions.plugins.tooltip,
          callbacks: { label: ctx => ` ${ctx.parsed.y.toLocaleString()} units` },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#374151", font: { size: 12 } } },
        y: {
          grid: { color: "#f3f4f6" },
          ticks: { color: "#9ca3af", font: { size: 11 }, callback: v => v.toLocaleString() },
        },
      },
    },
  });
}

/* ============================================================
   MASTER RENDER — calls all KPI + chart renderers
   ============================================================ */
function renderDashboard(data) {
  renderKPIs(data);
  renderSalesTrend(data);
  renderRevenueByRegion(data);
  renderRevenueByCategory(data);
  renderSalesPerRep(data);
  renderCustomerType(data);
  renderPaymentMethod(data);
  renderSalesChannel(data);
  renderScatter(data);
  renderTop10(data);
  renderQtyPerCategory(data);
}

/* ============================================================
   ENTRY POINT
   ============================================================ */
document.addEventListener("DOMContentLoaded", loadData);
