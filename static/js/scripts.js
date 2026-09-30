// ===========================================================
// FAKE NEWS DETECTION DASHBOARD - FRONTEND LOGIC
// ===========================================================

const pageTitles = {
  "dashboard-tab": ["Dashboard Overview", "Monitor your fake news detection system"],
  "analyze-tab": ["Analyze News", "Paste an article to check if it's real or fake"],
  "history-tab": ["History", "All previously analyzed articles"],
  "statistics-tab": ["Statistics", "Deeper insights into detection results"],
  "dataset-tab": ["Dataset", "Information about the training dataset"],
  "performance-tab": ["Model Performance", "Detailed metrics of the trained model"],
  "alerts-tab": ["Alerts", "High risk fake news notifications"],
  "settings-tab": ["Settings", "Configure your dashboard preferences"],
  "about-tab": ["About", "About this project"],
};

// ---------------- TAB SWITCHING ----------------
document.querySelectorAll(".nav-item, .view-all").forEach(item => {
  item.addEventListener("click", (e) => {
    e.preventDefault();
    const tabId = item.getAttribute("data-tab");
    if (!tabId) return;

    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
    const navMatch = document.querySelector(`.nav-item[data-tab="${tabId}"]`);
    if (navMatch) navMatch.classList.add("active");

    document.querySelectorAll(".tab-content").forEach(t => t.classList.add("hidden"));
    document.getElementById(tabId).classList.remove("hidden");

    const [title, subtitle] = pageTitles[tabId] || ["Dashboard", ""];
    document.getElementById("page-title").innerText = title;
    document.getElementById("page-subtitle").innerText = subtitle;
  });
});

// ---------------- ANALYZE NEWS (called from Dashboard & Analyze tabs) ----------------
async function analyzeNews(context) {
  const inputEl = document.getElementById(context === "dash" ? "dash-input" : "analyze-input");
  const text = inputEl.value.trim();

  if (!text) {
    alert("Please paste some news text first.");
    return;
  }

  const btn = event.target;
  const originalText = btn.innerHTML;
  btn.innerHTML = "Analyzing...";
  btn.disabled = true;

  try {
    const res = await fetch("/api/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();

    if (data.error) {
      alert(data.error);
      return;
    }

    renderResult(context, data);
    loadDashboardData(); // refresh stats, history, charts
  } catch (err) {
    alert("Something went wrong. Make sure the Flask server is running.");
    console.error(err);
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

function renderResult(context, data) {
  const boxId = context === "dash" ? "dash-result-box" : "analyze-result-box";
  const iconId = context === "dash" ? "dash-result-icon" : "analyze-result-icon";
  const labelId = context === "dash" ? "dash-result-label" : "analyze-result-label";
  const descId = context === "dash" ? "dash-result-desc" : "analyze-result-desc";
  const confValId = context === "dash" ? "dash-confidence-value" : "analyze-confidence-value";
  const confBarId = context === "dash" ? "dash-confidence-bar" : "analyze-confidence-bar";
  const reasonsId = context === "dash" ? "dash-reasons-list" : "analyze-reasons-list";

  const box = document.getElementById(boxId);
  box.classList.remove("hidden");
  box.classList.toggle("fake", !data.is_real);

  document.getElementById(iconId).innerText = data.is_real ? "✅" : "🚫";
  document.getElementById(labelId).innerText = data.is_real ? "REAL NEWS" : "FAKE NEWS";
  document.getElementById(descId).innerText = data.is_real
    ? "This article is likely to be real."
    : "This article is likely to be fake.";
  document.getElementById(confValId).innerText = data.confidence + "%";
  document.getElementById(confBarId).style.width = data.confidence + "%";

  const list = document.getElementById(reasonsId);
  list.innerHTML = "";
  data.reasons.forEach(r => {
    const li = document.createElement("li");
    li.innerText = r;
    list.appendChild(li);
  });

  const emptyState = document.getElementById("dash-empty-state");
  if (context === "dash" && emptyState) emptyState.classList.add("hidden");
}

// ---------------- LOAD DASHBOARD DATA (stats, history, metrics, charts) ----------------
let lineChartInstance, donutChartInstance, statsBarInstance, statsDonutInstance;

async function loadDashboardData() {
  const [statsRes, historyRes, metricsRes] = await Promise.all([
    fetch("/api/stats").then(r => r.json()),
    fetch("/api/history").then(r => r.json()),
    fetch("/api/metrics").then(r => r.json()),
  ]);

  // ---- Stat cards ----
  document.getElementById("stat-total").innerText = statsRes.total;
  document.getElementById("stat-real").innerText = statsRes.real_count;
  document.getElementById("stat-fake").innerText = statsRes.fake_count;
  document.getElementById("stat-accuracy").innerText = statsRes.accuracy + "%";
  document.getElementById("stat-real-pct").innerText = statsRes.real_pct + "% of total";
  document.getElementById("stat-fake-pct").innerText = statsRes.fake_pct + "% of total";
  document.getElementById("stat-total-change").innerText = "Live session data";

  // ---- Model performance metrics (dashboard + performance tab) ----
    // ---- Model performance metrics (dashboard card) ----
  document.getElementById("m-accuracy").innerText = metricsRes.accuracy + "%";
  document.getElementById("m-precision").innerText = metricsRes.precision + "%";
  document.getElementById("m-recall").innerText = metricsRes.recall + "%";
  document.getElementById("m-f1").innerText = metricsRes.f1_score + "%";
  renderSparklines(metricsRes);

  // ---- Full Model Performance tab ----
  renderPerformanceTab(metricsRes, statsRes);
  // ---- Dataset tab ----
  const dsFake = document.getElementById("ds-fake");
  const dsReal = document.getElementById("ds-real");
  const dsModel = document.getElementById("ds-model");
  if (dsFake) dsFake.innerText = metricsRes.total_fake_samples ?? "N/A";
  if (dsReal) dsReal.innerText = metricsRes.total_real_samples ?? "N/A";
  if (dsModel) dsModel.innerText = metricsRes.model_name;

  // ---- Recent articles table (dashboard) ----
  const recentBody = document.getElementById("recent-articles-body");
  if (historyRes.length === 0) {
    recentBody.innerHTML = `<tr><td colspan="4" class="muted">No articles analyzed yet.</td></tr>`;
  } else {
    recentBody.innerHTML = historyRes.slice(0, 4).map(rowHtml).join("");
  }

  // ---- Full history table ----
  const historyBody = document.getElementById("history-table-body");
  if (historyBody) {
    historyBody.innerHTML = historyRes.length
      ? historyRes.map(fullRowHtml).join("")
      : `<tr><td colspan="5" class="muted">No history yet.</td></tr>`;
  }

  // ---- Alerts table (confidence > 85 and FAKE) ----
  const alertsBody = document.getElementById("alerts-table-body");
  if (alertsBody) {
    const alerts = historyRes.filter(h => h.label === "FAKE" && h.confidence > 85);
    alertsBody.innerHTML = alerts.length
      ? alerts.map(fullRowHtml).join("")
      : `<tr><td colspan="4" class="muted">No high-risk alerts yet.</td></tr>`;
  }

  renderCharts(statsRes, historyRes);
}

function rowHtml(item) {
  const badgeClass = item.label === "FAKE" ? "fake" : "real";
  return `<tr>
    <td><span class="badge ${badgeClass}">${item.label}</span></td>
    <td>"${item.title}"</td>
    <td class="date">${item.date}</td>
    <td class="conf">${item.confidence}%</td>
  </tr>`;
}

function fullRowHtml(item) {
  const badgeClass = item.label === "FAKE" ? "fake" : "real";
  return `<tr>
    <td><span class="badge ${badgeClass}">${item.label}</span></td>
    <td>"${item.title}"</td>
    <td>${item.category}</td>
    <td class="date">${item.date}</td>
    <td class="conf">${item.confidence}%</td>
  </tr>`;
}

// ---------------- CHARTS ----------------
function renderCharts(stats, history) {
  const days = [...Array(7)].map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  });

  // Simple demo trend: distribute current real/fake counts across the week
  const realTrend = days.map((_, i) => Math.round((stats.real_count / 7) * (i + 1) / 2 + Math.random() * 3));
  const fakeTrend = days.map((_, i) => Math.round((stats.fake_count / 7) * (i + 1) / 2 + Math.random() * 3));

  const lineCtx = document.getElementById("lineChart");
  if (lineCtx) {
    if (lineChartInstance) lineChartInstance.destroy();
    lineChartInstance = new Chart(lineCtx, {
      type: "line",
      data: {
        labels: days,
        datasets: [
          { label: "Real News", data: realTrend, borderColor: "#1c6e4a", backgroundColor: "transparent", tension: 0.4 },
          { label: "Fake News", data: fakeTrend, borderColor: "#dc2626", backgroundColor: "transparent", tension: 0.4 },
        ],
      },
      options: { responsive: true, plugins: { legend: { position: "top" } } },
    });
  }

  const categoryLabels = Object.keys(stats.category_counts || {});
  const categoryValues = Object.values(stats.category_counts || {});
  const colors = ["#3b82f6", "#f97316", "#22c55e", "#14b8a6", "#8b5cf6"];

  const donutCtx = document.getElementById("donutChart");
  if (donutCtx) {
    if (donutChartInstance) donutChartInstance.destroy();
    donutChartInstance = new Chart(donutCtx, {
      type: "doughnut",
      data: { labels: categoryLabels, datasets: [{ data: categoryValues, backgroundColor: colors, borderWidth: 0 }] },
      options: { plugins: { legend: { display: false } }, cutout: "65%" },
    });
  }

  const legendEl = document.getElementById("donut-legend");
  if (legendEl) {
    const total = categoryValues.reduce((a, b) => a + b, 0) || 1;
    legendEl.innerHTML = categoryLabels.map((label, i) => {
      const pct = ((categoryValues[i] / total) * 100).toFixed(1);
      return `<li><span class="dot" style="background:${colors[i]}"></span>${label}<span class="pct">${pct}%</span></li>`;
    }).join("");
  }

  // Statistics tab charts
  const statsBarCtx = document.getElementById("statsBarChart");
  if (statsBarCtx) {
    if (statsBarInstance) statsBarInstance.destroy();
    statsBarInstance = new Chart(statsBarCtx, {
      type: "bar",
      data: { labels: ["Real News", "Fake News"], datasets: [{ data: [stats.real_count, stats.fake_count], backgroundColor: ["#1c6e4a", "#dc2626"] }] },
      options: { plugins: { legend: { display: false } } },
    });
  }

  const statsDonutCtx = document.getElementById("statsDonutChart");
  if (statsDonutCtx) {
    if (statsDonutInstance) statsDonutInstance.destroy();
    statsDonutInstance = new Chart(statsDonutCtx, {
      type: "doughnut",
      data: { labels: categoryLabels, datasets: [{ data: categoryValues, backgroundColor: colors, borderWidth: 0 }] },
      options: { plugins: { legend: { position: "bottom" } } },
    });
  }
}
// ---------------- ZIGZAG SPARKLINES (dashboard Model Performance cards) ----------------
let sparklineInstances = {};

function renderSparklines(metrics) {
  const sparkConfigs = [
    { id: "spark-accuracy", value: metrics.accuracy },
    { id: "spark-precision", value: metrics.precision },
    { id: "spark-recall", value: metrics.recall },
    { id: "spark-f1", value: metrics.f1_score },
  ];

  sparkConfigs.forEach(cfg => {
    const canvas = document.getElementById(cfg.id);
    if (!canvas) return;

    // Generate a jagged/zigzag trend of 10 points that ends near the real metric value
    const points = [];
    let current = cfg.value - 6;
    for (let i = 0; i < 10; i++) {
      current += (Math.random() - 0.5) * 6;   // zigzag up/down randomly
      points.push(Math.max(0, Math.min(100, current)));
    }
    points[points.length - 1] = cfg.value; // end exactly at the real value

    if (sparklineInstances[cfg.id]) sparklineInstances[cfg.id].destroy();
    sparklineInstances[cfg.id] = new Chart(canvas, {
      type: "line",
      data: {
        labels: points.map((_, i) => i),
        datasets: [{
          data: points,
          borderColor: "#1c6e4a",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,          // tension 0 = sharp zigzag lines, not smooth curves
          fill: false,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { x: { display: false }, y: { display: false } },
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
      },
    });
  });
}

// ---------------- MODEL PERFORMANCE TAB ----------------
let radarChartInstance, summaryDonutInstance;

function performanceTag(value) {
  if (value >= 90) return { text: "✅ Excellent Performance", cls: "" };
  if (value >= 75) return { text: "⚠️ Good Performance", cls: "warn" };
  return { text: "❌ Needs Improvement", cls: "bad" };
}

function renderPerformanceTab(metrics, stats) {
  const perfOverview = document.getElementById("perf-accuracy");
  if (!perfOverview) return; // tab not on page (safety check)

  const items = [
    { key: "accuracy", value: metrics.accuracy },
    { key: "precision", value: metrics.precision },
    { key: "recall", value: metrics.recall },
    { key: "f1", value: metrics.f1_score },
  ];

  items.forEach(item => {
    document.getElementById(`perf-${item.key}`).innerText = item.value + "%";
    document.getElementById(`perf-${item.key}-bar`).style.width = item.value + "%";
    const tag = performanceTag(item.value);
    const tagEl = document.getElementById(`perf-${item.key}-tag`);
    tagEl.innerText = tag.text;
    tagEl.className = "perf-tag " + tag.cls;
  });

  // ---- Radar chart ----
    // ---- Radar chart ----
  const radarCtx = document.getElementById("radarChart");
  if (radarCtx) {
    if (radarChartInstance) radarChartInstance.destroy();
    radarChartInstance = new Chart(radarCtx, {
      type: "radar",
      data: {
        labels: ["Accuracy", "Precision", "Recall", "F1 Score"],
        datasets: [{
          data: [metrics.accuracy, metrics.precision, metrics.recall, metrics.f1_score],
          backgroundColor: "rgba(28,110,74,0.15)",
          borderColor: "#1c6e4a",
          borderWidth: 2,
          pointBackgroundColor: "#1c6e4a",
          pointRadius: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: 24 },              // extra space so labels don't get cut off
        plugins: { legend: { display: false } },
        scales: {
          r: {
            min: 0,
            max: 100,
            ticks: { stepSize: 25, backdropColor: "transparent", font: { size: 10 } },
            pointLabels: { font: { size: 13, weight: "600" } },   // Accuracy/Precision/Recall/F1 labels
            grid: { color: "#dfe5e2" },
          },
        },
      },
    });
  }

  const radarLegend = document.getElementById("radar-legend");
  if (radarLegend) {
    radarLegend.innerHTML = items.map(item => {
      const label = item.key === "f1" ? "F1 Score" : item.key.charAt(0).toUpperCase() + item.key.slice(1);
      return `<li><span class="dot" style="background:#1c6e4a"></span>${label}<span class="pct badge real">${item.value}%</span></li>`;
    }).join("");
  }

  // ---- Callout box ----
  const avg = (metrics.accuracy + metrics.precision + metrics.recall + metrics.f1_score) / 4;
  const calloutTitle = document.getElementById("callout-title");
  const calloutDesc = document.getElementById("callout-desc");
  if (avg >= 90) {
    calloutTitle.innerText = "Outstanding Performance!";   // icon already shown separately in .callout-icon
    calloutDesc.innerText = "Your model is performing exceptionally well across all metrics.";
  } else if (avg >= 75) {
    calloutTitle.innerText = "Good Performance";
    calloutDesc.innerText = "Your model is performing well, with some room for improvement.";
  } else {
    calloutTitle.innerText = "Needs Improvement";
    calloutDesc.innerText = "Consider more training data or tuning to improve results.";
  }
  const calloutIconEl = document.querySelector(".callout-icon");
  if (calloutIconEl) calloutIconEl.innerText = avg >= 90 ? "🏆" : avg >= 75 ? "👍" : "⚠️";

  // ---- Summary donut ----
  const summaryDonutCtx = document.getElementById("summaryDonut");
  if (summaryDonutCtx) {
    if (summaryDonutInstance) summaryDonutInstance.destroy();
    summaryDonutInstance = new Chart(summaryDonutCtx, {
      type: "doughnut",
      data: {
        datasets: [{
          data: [metrics.accuracy, 100 - metrics.accuracy],
          backgroundColor: ["#1c6e4a", "#e8ebee"],
          borderWidth: 0,
        }],
      },
      options: { cutout: "78%", plugins: { legend: { display: false }, tooltip: { enabled: false } } },
    });
  }
  document.getElementById("summary-score").innerText = metrics.accuracy + "%";

  const starCount = metrics.accuracy >= 95 ? 5 : metrics.accuracy >= 90 ? 4 : metrics.accuracy >= 80 ? 3 : metrics.accuracy >= 70 ? 2 : 1;
  document.getElementById("summary-stars").innerText = "⭐".repeat(starCount) + "☆".repeat(5 - starCount);

  // ---- Summary list ----
  const total = stats.total || 0;
  const correct = Math.round((total * metrics.accuracy) / 100);
  const incorrect = total - correct;

  document.getElementById("summary-list").innerHTML = `
    <li><span class="s-label">📈 Total Predictions</span><span class="s-value">${total}</span></li>
    <li><span class="s-label">✅ Correct Predictions</span><span class="s-value green">${correct}</span></li>
    <li><span class="s-label">❌ Incorrect Predictions</span><span class="s-value red">${incorrect}</span></li>
    <li><span class="s-label">🗂️ Dataset Used</span><span class="s-value">Fake News Dataset</span></li>
    <li><span class="s-label">⚙️ Algorithm</span><span class="s-value">${metrics.model_name || "N/A"}</span></li>
    <li><span class="s-label">🔧 Feature Engineering</span><span class="s-value">TF-IDF Vectorization</span></li>
  `;

  // ---- Algorithm details banner ----
  const algoText = document.getElementById("algo-details-text");
  if (algoText) {
    algoText.innerText = `${metrics.model_name || "N/A"} trained on TF-IDF vectorized text features with optimized hyperparameters for maximum performance.`;
  }
}
// ---------------- SETTINGS SLIDER ----------------
const thresholdSlider = document.getElementById("threshold-slider");
if (thresholdSlider) {
  thresholdSlider.addEventListener("input", (e) => {
    document.getElementById("threshold-value").innerText = e.target.value + "%";
  });
}

// ---------------- INITIAL LOAD ----------------
loadDashboardData();

