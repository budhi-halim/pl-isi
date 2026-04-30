// -------------------------------------------------------------
// IMPORTS
// -------------------------------------------------------------
import { ParseError, searchStrings } from "./advanced_search.js";

// -------------------------------------------------------------
// CONSTANTS / CONFIGURATION
// -------------------------------------------------------------
let debounceTimer;

const PRICE_THRESHOLD = 1000;
const DEBOUNCE_DELAY = 300;
const SHOW_DELAY_MS = 160;
const EXCHANGE_RATE_URL = 'https://budhi-halim.github.io/exchange-rate/data/today.json';
const LAST_PRODUCTION_URL = 'https://budhi-halim.github.io/general-database/data/last_production.json';
const PRODUCT_TAGS_URL = 'data/product_tags.json';

const COPY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 8.25V6a2.25 2.25 0 0 0-2.25-2.25H6A2.25 2.25 0 0 0 3.75 6v8.25A2.25 2.25 0 0 0 6 16.5h2.25m8.25-8.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-7.5A2.25 2.25 0 0 1 8.25 18v-1.5m8.25-8.25h-6a2.25 2.25 0 0 0-2.25 2.25v6" /></svg>`;
const CHECK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>`;

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
// LAST PRODUCTION & TAG DATA
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

async function loadProductTagsData() {
  try {
    const res = await fetch(PRODUCT_TAGS_URL, { cache: "no-store" });
    if (!res.ok) return { map: new Map(), rawList: [] };
    const arr = await res.json();
    const map = new Map();
    const rawList = arr.map(t => t.tag.toLowerCase());

    arr.forEach(tagGroup => {
      const { tag, icon, products } = tagGroup;
      products.forEach(pCode => {
        const code = normalizeCode(pCode).toLowerCase();
        if (!map.has(code)) map.set(code, []);
        map.get(code).push({ tag, icon });
      });
    });
    return { map, rawList };
  } catch {
    return { map: new Map(), rawList: [] };
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
    const tagsData = await loadProductTagsData();
    const tagsMap = tagsData.map;
    const rawTagsList = tagsData.rawList;

    renderTable(products, rate, lastProductionMap, tagsMap);

    const searchInput = document.getElementById("searchInput");
    const togglePriceFilter = document.getElementById("togglePriceFilter");
    const minPrice = document.getElementById("minPrice");
    const maxPrice = document.getElementById("maxPrice");
    const scrollTopBtn = document.getElementById("scrollTopBtn");
    const darkModeToggle = document.getElementById("darkModeToggle");
    const darkToggleContainer = document.querySelector(".darkmode-toggle");

    // Filter function
    function applyFilters() {
      const rawQuery = searchInput.value || "";
      
      // Dynamic Tag Resolution
      const hashRegex = /(?:^|\s)#([a-zA-Z0-9]+)/g;
      let match;
      const foundPrefixes = [];
      while ((match = hashRegex.exec(rawQuery)) !== null) {
        foundPrefixes.push(match[1].toLowerCase());
      }

      let queryIsInvalid = false;
      const resolvedTags = [];

      for (const prefix of foundPrefixes) {
        const matches = rawTagsList.filter(t => t.startsWith(prefix));
        if (matches.length === 1) {
          resolvedTags.push(matches[0]);
        } else {
          // If 0 matches or >1 ambiguous matches, query is invalid
          queryIsInvalid = true;
          break;
        }
      }

      // Clean query for Advanced Search
      const cleanQuery = rawQuery.replace(/(?:^|\s)#[a-zA-Z0-9]+/g, '').trim().replace(/\s+/g, ' ').toLowerCase();

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

      let filtered = [];
      if (!queryIsInvalid) {
        try {
          filtered = (products || []).filter((p) => {
            const codeForTags = normalizeCode(p.product_code || "").toLowerCase();
            const pTags = tagsMap.get(codeForTags) || [];
            const pTagNames = pTags.map(t => t.tag.toLowerCase());

            // 1. Tag Match Intersect
            if (resolvedTags.length > 0) {
              const hasAllTags = resolvedTags.every(rt => pTagNames.includes(rt));
              if (!hasAllTags) return false;
            }

            // 2. String Match
            if (cleanQuery) {
              const searchableText = `${p.product_name || ""} ${p.product_code || ""}`.trim();
              const searchResults = searchStrings(cleanQuery, [searchableText]);
              const matchesSearch = searchResults.length > 0;
              if (!matchesSearch) return false;
            }

            // 3. Price Filter
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

        } catch (err) {
          if (err instanceof ParseError) {
            queryIsInvalid = true;
            filtered = []; 
          } else {
            throw err;
          }
        }
      }

      renderTable(filtered, rate, lastProductionMap, tagsMap, queryIsInvalid);
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
function renderTable(products, rate, lastProductionMap, tagsMap, queryIsInvalid = false) {
  const tbody = document.querySelector("#productTable tbody");
  const noResults = document.getElementById("noResults");
  const invalidQuery = document.getElementById("invalidQuery");
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

  // Show popup at coordinates
  function showPopupAt(x, y, html, isClient = false) {
    if (!popup) return;
    popup.innerHTML = html;

    const clientX = isClient ? x : x - window.scrollX;
    const clientY = isClient ? y : y - window.scrollY;
    const margin = 8;

    popup.style.left = `${clientX + window.scrollX}px`;
    popup.style.top = `${clientY + window.scrollY}px`;
    popup.style.visibility = 'hidden';

    popup.classList.add('show');
    const rect = popup.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    const spaceBelow = window.innerHeight - clientY - margin;
    const spaceAbove = clientY - margin;
    let finalClientTop;
    if (spaceBelow >= height) {
      finalClientTop = clientY;
    } else if (spaceAbove >= height) {
      finalClientTop = Math.max(margin, clientY - height);
    } else {
      if (spaceBelow >= spaceAbove) {
        finalClientTop = Math.max(margin, window.innerHeight - margin - height);
      } else {
        finalClientTop = margin;
      }
    }

    let finalClientLeft = clientX;
    if (finalClientLeft + width > window.innerWidth - margin) {
      finalClientLeft = Math.max(margin, window.innerWidth - margin - width);
    }
    if (finalClientLeft < margin) finalClientLeft = margin;

    const pageLeft = finalClientLeft + window.scrollX;
    const pageTop = finalClientTop + window.scrollY;
    popup.style.left = `${pageLeft}px`;
    popup.style.top = `${pageTop}px`;

    popup.style.visibility = '';
    popup.setAttribute('aria-hidden', 'false');
    popup.classList.add('show');
  }

  function getRowFromPoint(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    if (!el || !el.closest) return null;
    return el.closest("#productTable tbody tr");
  }

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

  if (queryIsInvalid) {
    invalidQuery.classList.remove("hidden");
    noResults.classList.add("hidden");
    return;
  } else {
    invalidQuery.classList.add("hidden");
  }

  if (!products || products.length === 0) {
    noResults.classList.remove("hidden");
    return;
  }

  noResults.classList.add("hidden");

  // Render rows
  products.forEach((p, i) => {
    const code = normalizeCode(p.product_code || "").toLowerCase();
    
    // Tag generation (Removed title attribute to avoid browser hover popup)
    const pTags = tagsMap?.get(code) || [];
    const tagsHtml = pTags.map(t => `<span class="tag-badge">${t.icon}</span>`).join('');

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
    // Removed title attribute from copy button to avoid browser hover popup
    row.innerHTML = `
      <td>${i + 1}</td>
      <td>${p.product_name || ""} ${tagsHtml}</td>
      <td>
        <span style="vertical-align: middle;">${p.product_code || ""}</span>
        <button class="copy-btn">${COPY_SVG}</button>
      </td>
      <td>${displayPrice}</td>
    `;
    tbody.appendChild(row);

    // Copy Button Logic
    const copyBtn = row.querySelector('.copy-btn');
    if (copyBtn) {
      const handleCopy = (ev) => {
        ev.stopPropagation(); // Prevent popup showing on click/tap
        navigator.clipboard.writeText(p.product_code || "").then(() => {
          copyBtn.innerHTML = CHECK_SVG;
          copyBtn.classList.add('copied-success');
          setTimeout(() => {
            copyBtn.innerHTML = COPY_SVG;
            copyBtn.classList.remove('copied-success');
          }, 1500);
        }).catch(err => console.error('Copy failed', err));
      };
      copyBtn.addEventListener('click', handleCopy);
      copyBtn.addEventListener('touchend', (ev) => {
        ev.stopPropagation(); // Explicitly kill touchend for mobile row triggers
      });
    }

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