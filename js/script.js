// -------------------------------------------------------------
// CONSTANTS / CONFIGURATION
// -------------------------------------------------------------
let debounceTimer;

const PRICE_THRESHOLD = 1000;
const DEBOUNCE_DELAY = 300;
const EXCHANGE_RATE_URL = 'https://budhi-halim.github.io/exchange-rate/data/today.json';

// -------------------------------------------------------------
// DATA FETCHING (last updated date & exchange rate)
// -------------------------------------------------------------
async function fetchLastUpdated() {
  try {
    const res = await fetch("data/last_updated.txt", { cache: "no-store" });
    if (!res.ok) return null;
    const txt = (await res.text()).trim();
    if (!txt) return null;
    const match = txt.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const year = match[1];
      const monthIndex = parseInt(match[2], 10) - 1;
      const day = parseInt(match[3], 10);
      const monthNames = [
        "January","February","March","April","May","June",
        "July","August","September","October","November","December"
      ];
      if (monthIndex >= 0 && monthIndex <= 11) {
        return `${day} ${monthNames[monthIndex]} ${year}`;
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function fetchExchangeRate() {
  try {
    const response = await fetch(EXCHANGE_RATE_URL);
    const data = await response.json();
    return data.tt_counter_selling_rate_buffered;
  } catch (error) {
    console.error('Failed to fetch exchange rate:', error);
    return null;
  }
}

// -------------------------------------------------------------
// UTILITY FUNCTIONS
// -------------------------------------------------------------
function formatWithCommas(str) {
  const parts = str.toString().split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

// -------------------------------------------------------------
// MAIN FUNCTION: loadProducts()
// - Loads product data
// - Applies filtering & sorting logic
// - Handles UI interactions (search, price filter, dark mode, etc.)
// -------------------------------------------------------------
async function loadProducts() {
  try {
    let rate = await fetchExchangeRate();
    const response = await fetch("data/products.json", { cache: "no-store" });
    const products = await response.json();
    renderTable(products, rate);

    const searchInput = document.getElementById("searchInput");
    const togglePriceFilter = document.getElementById("togglePriceFilter");
    const minPrice = document.getElementById("minPrice");
    const maxPrice = document.getElementById("maxPrice");
    const scrollTopBtn = document.getElementById("scrollTopBtn");
    const darkModeToggle = document.getElementById("darkModeToggle");
    const darkToggleContainer = document.querySelector(".darkmode-toggle");

    // -------------------------------------------------------------
    // FILTER FUNCTION
    // - Applies search text filter
    // - Applies price range filter when enabled
    // - Excludes items with price 0 or empty when price filter toggle is active
    // -------------------------------------------------------------
    function applyFilters() {
      const query = (searchInput.value || "").toLowerCase();
      const enablePrice = togglePriceFilter.checked;
      const min = parseFloat(minPrice.value) || 0;
      const max = parseFloat(maxPrice.value) || Infinity;

      let inputs = [];
      if (minPrice.value.trim() !== '') inputs.push(min);
      if (maxPrice.value.trim() !== '') inputs.push(max);

      // Determine search unit based on input threshold
      let searchUnit = null;
      if (inputs.length > 0) {
        const highest = Math.max(...inputs);
        searchUnit = (highest >= PRICE_THRESHOLD) ? 'IDR' : 'USD';
      }

      // Apply combined filtering logic
      const filtered = (products || []).filter((p) => {
        const name = (p.product_name || "").toString().toLowerCase();
        const code = (p.product_code || "").toString().toLowerCase();
        const matchText = name.includes(query) || code.includes(query);
        if (!matchText) return false;

        const priceStr = p.marketing_price || "";
        const price = parseFloat(priceStr) || 0;

        // Exclude zero or empty prices when price filter toggle is enabled
        if (enablePrice && (!priceStr || price === 0)) {
          return false;
        }

        if (!enablePrice) return true;

        // Apply numeric range filtering
        if (!rate) {
          return price >= min && price <= max;
        }

        if (searchUnit === null) {
          return price >= min && price <= max;
        }

        const threshold = PRICE_THRESHOLD;
        const isUSD = price < threshold;
        let convertedPrice;
        if (searchUnit === 'USD') {
          convertedPrice = isUSD ? price : price / rate;
        } else {
          convertedPrice = isUSD ? price * rate : price;
        }
        return convertedPrice >= min && convertedPrice <= max;
      });

      renderTable(filtered, rate);
    }

    // -------------------------------------------------------------
    // EVENT LISTENERS (search, price filter, scroll, dark mode)
    // -------------------------------------------------------------
    searchInput.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(applyFilters, DEBOUNCE_DELAY);
    });

    togglePriceFilter.addEventListener("change", () => {
      document
        .getElementById("priceRange")
        .classList.toggle("hidden", !togglePriceFilter.checked);
      applyFilters();
    });

    minPrice.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(applyFilters, DEBOUNCE_DELAY);
    });

    maxPrice.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(applyFilters, DEBOUNCE_DELAY);
    });

    window.addEventListener("scroll", () => {
      if (window.scrollY > window.innerHeight) {
        scrollTopBtn.classList.add("show");
      } else {
        scrollTopBtn.classList.remove("show");
      }
    });

    scrollTopBtn.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    // -------------------------------------------------------------
    // DARK MODE HANDLING
    // -------------------------------------------------------------
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
      const isToggleVisible =
        darkToggleContainer &&
        window.getComputedStyle(darkToggleContainer).display !== "none";

      if (!isToggleVisible) {
        document.body.classList.toggle("dark", isDark);
        if (darkModeToggle) darkModeToggle.checked = isDark;
      }
    }

    if (colorSchemeMedia.addEventListener) {
      colorSchemeMedia.addEventListener("change", applySystemPreference);
    } else if (colorSchemeMedia.addListener) {
      colorSchemeMedia.addListener(applySystemPreference);
    }

    window.addEventListener("resize", applySystemPreference);

    if (darkModeToggle) {
      darkModeToggle.addEventListener("change", () => {
        document.body.classList.toggle("dark", darkModeToggle.checked);
      });
    }
  } catch (err) {
    console.error("Failed to load products.json", err);
  }
}

// -------------------------------------------------------------
// TABLE RENDERING
// - Renders product list into the HTML table
// - Converts prices between USD/IDR for display
// -------------------------------------------------------------
function renderTable(products, rate) {
  const tbody = document.querySelector("#productTable tbody");
  const noResults = document.getElementById("noResults");
  tbody.innerHTML = "";

  if (!products || products.length === 0) {
    noResults.classList.remove("hidden");
    return;
  } else {
    noResults.classList.add("hidden");
  }

  products.forEach((p, i) => {
    const priceStr = p.marketing_price || "";
    let displayPrice = formatWithCommas(priceStr);
    const price = parseFloat(priceStr);

    if (!isNaN(price) && price > 0 && rate) {
      const threshold = PRICE_THRESHOLD;
      const isUSD = price < threshold;

      if (isUSD) {
        const idr = price * rate;
        const ceiledIdr = Math.ceil(idr / 1000) * 1000;
        const ceiledIdrStr = formatWithCommas(ceiledIdr.toFixed(0));
        const originalFormatted = formatWithCommas(price.toString());
        displayPrice = `${originalFormatted} (${ceiledIdrStr})`;
      } else {
        const usd = price / rate;
        const ceiledUsd = Math.ceil(usd * 10) / 10;
        let usdStr = ceiledUsd.toFixed(1).replace(/\.0$/, '');
        const usdFormatted = formatWithCommas(usdStr);
        const originalFormatted = formatWithCommas(price.toString());
        displayPrice = `${originalFormatted} (${usdFormatted})`;
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
  });
}

// -------------------------------------------------------------
// INITIALIZATION (runs after DOM is fully loaded)
// -------------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  const lastUpdatedEl = document.getElementById("lastUpdated");
  const formatted = await fetchLastUpdated();
  if (formatted && lastUpdatedEl) {
    lastUpdatedEl.textContent = `Last updated: ${formatted}`;
  } else if (lastUpdatedEl) {
    lastUpdatedEl.textContent = "Last updated: Not available";
  }
  loadProducts();
});