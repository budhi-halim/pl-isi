// -------------------------------------------------------------
// CONSTANTS / CONFIGURATION
// -------------------------------------------------------------
let debounceTimer;

const PRICE_THRESHOLD = 1000;
const DEBOUNCE_DELAY = 300;
const SHOW_DELAY_MS = 160;
const EXCHANGE_RATE_URL = 'https://budhi-halim.github.io/exchange-rate/data/today.json';
const LAST_PRODUCTION_URL = 'https://budhi-halim.github.io/general-database/data/last_production.json';

// -------------------------------------------------------------
// DATA FETCHING
// -------------------------------------------------------------
async function fetchLastUpdated() {
  try {
    const res = await fetch("data/last_updated.txt", { cache: "no-store" });
    if (!res.ok) return null;
    const txt = (await res.text()).trim();
    if (!txt) return null;
    const match = txt.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const [_, year, month, day] = match;
      const monthNames = [
        "January","February","March","April","May","June",
        "July","August","September","October","November","December"
      ];
      const idx = parseInt(month, 10) - 1;
      return `${parseInt(day)} ${monthNames[idx]} ${year}`;
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchExchangeRate() {
  try {
    const res = await fetch(EXCHANGE_RATE_URL);
    const data = await res.json();
    return data.tt_counter_selling_rate_buffered;
  } catch {
    return null;
  }
}

// -------------------------------------------------------------
// LAST PRODUCTION DATA
// -------------------------------------------------------------
function normalizeCode(code) {
  if (!code && code !== 0) return '';
  return code.toString().replace(/^\*/, '').trim().replace(/\s+/g, ' ');
}

function formatProductionDate(dateStr) {
  if (!dateStr) return dateStr;
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return dateStr;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10) - 1;
  const day = parseInt(m[3], 10);
  const monthNames = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December"
  ];
  return `${day} ${monthNames[month]} ${year}`;
}

async function loadLastProductionMap() {
  try {
    const res = await fetch(LAST_PRODUCTION_URL, { cache: "no-store" });
    if (!res.ok) return new Map();
    const arr = await res.json();
    const map = new Map();
    arr.forEach((item) => {
      const key = normalizeCode(item.product_code || '').toLowerCase();
      if (!key) return;
      const existing = map.get(key);
      if (!existing) map.set(key, item);
      else {
        const d1 = Date.parse(existing.date || '') || 0;
        const d2 = Date.parse(item.date || '') || 0;
        if (d2 >= d1) map.set(key, item);
      }
    });
    return map;
  } catch {
    return new Map();
  }
}

// -------------------------------------------------------------
// UTILITIES
// -------------------------------------------------------------
function formatWithCommas(str) {
  const parts = str.toString().split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

// -------------------------------------------------------------
// MAIN FUNCTION: loadProducts()
// -------------------------------------------------------------
async function loadProducts() {
  try {
    const rate = await fetchExchangeRate();
    const res = await fetch("data/products.json", { cache: "no-store" });
    const products = await res.json();
    const lastProductionMap = await loadLastProductionMap();

    renderTable(products, rate, lastProductionMap);

    const searchInput = document.getElementById("searchInput");
    const togglePriceFilter = document.getElementById("togglePriceFilter");
    const minPrice = document.getElementById("minPrice");
    const maxPrice = document.getElementById("maxPrice");
    const scrollTopBtn = document.getElementById("scrollTopBtn");
    const darkModeToggle = document.getElementById("darkModeToggle");
    const darkToggleContainer = document.querySelector(".darkmode-toggle");

    // Filter function
    function applyFilters() {
      const query = (searchInput.value || "").toLowerCase();
      const enablePrice = togglePriceFilter.checked;
      const min = parseFloat(minPrice.value) || 0;
      const max = parseFloat(maxPrice.value) || Infinity;

      const inputs = [];
      if (minPrice.value.trim() !== '') inputs.push(min);
      if (maxPrice.value.trim() !== '') inputs.push(max);

      let searchUnit = null;
      if (inputs.length > 0) {
        const highest = Math.max(...inputs);
        searchUnit = highest >= PRICE_THRESHOLD ? 'IDR' : 'USD';
      }

      const filtered = (products || []).filter((p) => {
        const name = (p.product_name || "").toLowerCase();
        const code = (p.product_code || "").toLowerCase();
        const matchText = name.includes(query) || code.includes(query);
        if (!matchText) return false;

        const priceStr = p.marketing_price || "";
        const price = parseFloat(priceStr) || 0;
        if (enablePrice && (!priceStr || price === 0)) return false;
        if (!enablePrice) return true;
        if (!rate) return price >= min && price <= max;

        const isUSD = price < PRICE_THRESHOLD;
        let converted;
        if (searchUnit === 'USD') converted = isUSD ? price : price / rate;
        else converted = isUSD ? price * rate : price;
        return converted >= min && converted <= max;
      });

      renderTable(filtered, rate, lastProductionMap);
    }

    // Search and price filter events
    searchInput.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(applyFilters, DEBOUNCE_DELAY);
    });

    togglePriceFilter.addEventListener("change", () => {
      document.getElementById("priceRange")
        .classList.toggle("hidden", !togglePriceFilter.checked);
      applyFilters();
    });

    [minPrice, maxPrice].forEach((el) =>
      el.addEventListener("input", () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(applyFilters, DEBOUNCE_DELAY);
      })
    );

    // Scroll-to-top button
    window.addEventListener("scroll", () => {
      scrollTopBtn.classList.toggle("show", window.scrollY > window.innerHeight);
    });

    scrollTopBtn.addEventListener("click", () =>
      window.scrollTo({ top: 0, behavior: "smooth" })
    );

    // Dark mode handling
    const colorSchemeMedia = window.matchMedia("(prefers-color-scheme: dark)");

    if (colorSchemeMedia.matches) {
      document.body.classList.add("dark");
      if (darkModeToggle) darkModeToggle.checked = true;
    } else {
      document.body.classList.remove("dark");
      if (darkModeToggle) darkModeToggle.checked = false;
    }

    function applySystemPreference() {
      const isDark = colorSchemeMedia.matches;
      const toggleVisible =
        darkToggleContainer &&
        window.getComputedStyle(darkToggleContainer).display !== "none";

      if (!toggleVisible) {
        document.body.classList.toggle("dark", isDark);
        if (darkModeToggle) darkModeToggle.checked = isDark;
      }
    }

    if (colorSchemeMedia.addEventListener)
      colorSchemeMedia.addEventListener("change", applySystemPreference);
    else if (colorSchemeMedia.addListener)
      colorSchemeMedia.addListener(applySystemPreference);

    window.addEventListener("resize", applySystemPreference);

    if (darkModeToggle)
      darkModeToggle.addEventListener("change", () =>
        document.body.classList.toggle("dark", darkModeToggle.checked)
      );

  } catch (err) {
    console.error("Failed to load products.json", err);
  }
}

// -------------------------------------------------------------
// TABLE RENDERING
// -------------------------------------------------------------
function renderTable(products, rate, lastProductionMap) {
  const tbody = document.querySelector("#productTable tbody");
  const noResults = document.getElementById("noResults");
  tbody.innerHTML = "";

  // Popup creation
  let popup = document.getElementById("lastProdPopup");
  if (!popup) {
    popup = document.createElement("div");
    popup.id = "lastProdPopup";
    popup.className = "last-prod-popup";
    popup.setAttribute("aria-hidden", "true");
    document.body.appendChild(popup);
  }

  let hoverRow = null;
  let showTimer = null;
  let lastMouseMoveTime = 0;
  let lastMouseClientX = 0;
  let lastMouseClientY = 0;

  const clearShowTimer = () => {
    if (showTimer) {
      clearTimeout(showTimer);
      showTimer = null;
    }
  };

  const hidePopup = () => {
    if (!popup) return;
    popup.classList.add("no-transition");
    popup.classList.remove("show");
    popup.setAttribute("aria-hidden", "true");
    void popup.offsetHeight;
    popup.classList.remove("no-transition");
  };

  // Show popup at coordinates, prefer below the point but place above if not enough space
  function showPopupAt(x, y, html, isClient = false) {
    if (!popup) return;
    popup.innerHTML = html;

    // Determine client coordinates
    const clientX = isClient ? x : x - window.scrollX;
    const clientY = isClient ? y : y - window.scrollY;
    const margin = 8;

    // Prepare initial invisible placement so we can measure
    popup.style.left = `${clientX + window.scrollX}px`;
    popup.style.top = `${clientY + window.scrollY}px`;
    popup.style.visibility = 'hidden';

    // Temporarily add show to allow accurate measurement of final size/transform
    popup.classList.add('show');
    const rect = popup.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    // Decide vertical placement: prefer below, fallback above, otherwise clamp center
    const spaceBelow = window.innerHeight - clientY - margin;
    const spaceAbove = clientY - margin;
    let finalClientTop;
    if (spaceBelow >= height) {
      finalClientTop = clientY;
    } else if (spaceAbove >= height) {
      finalClientTop = Math.max(margin, clientY - height);
    } else {
      // not enough space either side: clamp so popup fits in viewport
      if (spaceBelow >= spaceAbove) {
        finalClientTop = Math.max(margin, window.innerHeight - margin - height);
      } else {
        finalClientTop = margin;
      }
    }

    // Horizontal placement: clamp within viewport
    let finalClientLeft = clientX;
    if (finalClientLeft + width > window.innerWidth - margin) {
      finalClientLeft = Math.max(margin, window.innerWidth - margin - width);
    }
    if (finalClientLeft < margin) finalClientLeft = margin;

    // Convert to page coords and set
    const pageLeft = finalClientLeft + window.scrollX;
    const pageTop = finalClientTop + window.scrollY;
    popup.style.left = `${pageLeft}px`;
    popup.style.top = `${pageTop}px`;

    // Reveal
    popup.style.visibility = '';
    popup.setAttribute('aria-hidden', 'false');
    popup.classList.add('show');
  }

  // Helper: find a table row under client coordinates
  function getRowFromPoint(clientX, clientY) {
    // elementFromPoint works in client coords
    const el = document.elementFromPoint(clientX, clientY);
    if (!el || !el.closest) return null;
    return el.closest("#productTable tbody tr");
  }

  // Global mousemove: update movement timestamp, detect row under pointer via elementFromPoint,
  // hide popup on motion and schedule show only if pointer is over a valid row.
  document.addEventListener("mousemove", (ev) => {
    lastMouseMoveTime = Date.now();
    lastMouseClientX = ev.clientX;
    lastMouseClientY = ev.clientY;

    const possibleRow = getRowFromPoint(ev.clientX, ev.clientY);
    if (!possibleRow) {
      hoverRow = null;
      hidePopup();
      clearShowTimer();
      return;
    }

    // pointer is over a row; schedule show after stationary period
    hoverRow = possibleRow;
    hidePopup();
    clearShowTimer();
    showTimer = setTimeout(() => {
      if (!hoverRow) return;
      if (Date.now() - lastMouseMoveTime >= SHOW_DELAY_MS) {
        showPopupAt(lastMouseClientX, lastMouseClientY, hoverRow._lastProdContentHtml, true);
      }
    }, SHOW_DELAY_MS);
  });

  document.addEventListener("click", (ev) => {
    if (!popup.contains(ev.target)) hidePopup();
  });

  document.addEventListener(
    "touchstart",
    (ev) => {
      if (!popup.contains(ev.target)) hidePopup();
    },
    { passive: true }
  );

  document.addEventListener("scroll", hidePopup, { passive: true });
  document.addEventListener("keydown", hidePopup);

  if (!products || products.length === 0) {
    noResults.classList.remove("hidden");
    return;
  }
  noResults.classList.add("hidden");

  // Render rows
  products.forEach((p, i) => {
    const priceStr = p.marketing_price || "";
    let displayPrice = formatWithCommas(priceStr);
    const price = parseFloat(priceStr);

    if (!isNaN(price) && price > 0 && rate) {
      const isUSD = price < PRICE_THRESHOLD;
      if (isUSD) {
        const idr = Math.ceil((price * rate) / 1000) * 1000;
        displayPrice = `${formatWithCommas(price)} (${formatWithCommas(idr)})`;
      } else {
        const usd = Math.ceil((price / rate) * 10) / 10;
        displayPrice = `${formatWithCommas(price)} (${formatWithCommas(usd)})`;
      }
    }

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${i + 1}</td>
      <td>${p.product_name || ""}</td>
      <td>${p.product_code || ""}</td>
      <td>${displayPrice}</td>
    `;
    tbody.appendChild(row);

    const code = normalizeCode(p.product_code || "").toLowerCase();
    const last = lastProductionMap?.get(code);
    const dateText = last?.date ? formatProductionDate(last.date) : null;
    const custText = last?.customer || null;
    const html =
      dateText || custText
        ? `<div class="lp-title">Last Production</div>
           <div class="lp-date">${dateText || "No data"}</div>
           <div class="lp-customer">${custText || ""}</div>`
        : `<div class="lp-title">Last Production</div>
           <div class="lp-none">No data</div>`;
    row._lastProdContentHtml = html;

    // Mouse hover (desktop)
    row.addEventListener("mouseenter", (ev) => {
      hoverRow = row;
      if (Date.now() - lastMouseMoveTime >= SHOW_DELAY_MS)
        showPopupAt(ev.clientX, ev.clientY, html, true);
      else {
        clearShowTimer();
        showTimer = setTimeout(() => {
          if (!hoverRow) return;
          if (Date.now() - lastMouseMoveTime >= SHOW_DELAY_MS)
            showPopupAt(lastMouseClientX, lastMouseClientY, html, true);
        }, SHOW_DELAY_MS);
      }
    });

    row.addEventListener("mouseleave", () => {
      hoverRow = null;
      clearShowTimer();
      hidePopup();
    });

    // Touch (tap-to-show)
    row.addEventListener(
      "touchend",
      (ev) => {
        if (ev.changedTouches && ev.changedTouches.length > 0) {
          const t = ev.changedTouches[0];
          hidePopup();
          showPopupAt(t.pageX, t.pageY, html);
        }
      },
      { passive: true }
    );
  });
}

// -------------------------------------------------------------
// INITIALIZATION
// -------------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  const el = document.getElementById("lastUpdated");
  const txt = await fetchLastUpdated();
  if (el) el.textContent = txt ? `Last updated: ${txt}` : "Last updated: Not available";
  loadProducts();
});