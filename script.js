let debounceTimer;

async function fetchLastUpdated() {
  try {
    const res = await fetch("last_updated.txt", { cache: "no-store" });
    if (!res.ok) return null;
    const txt = (await res.text()).trim();
    if (!txt) return null;
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(txt) ? txt : null;
    if (iso) {
      const parts = iso.split("-");
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const d = new Date(Date.UTC(year, month, day));
      const monthNames = [
        "January","February","March","April","May","June",
        "July","August","September","October","November","December"
      ];
      return `${day} ${monthNames[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    } else {
      return txt;
    }
  } catch (e) {
    return null;
  }
}

async function loadProducts() {
  try {
    const response = await fetch("products.json", { cache: "no-store" });
    const products = await response.json();
    renderTable(products);

    const searchInput = document.getElementById("searchInput");
    const togglePriceFilter = document.getElementById("togglePriceFilter");
    const minPrice = document.getElementById("minPrice");
    const maxPrice = document.getElementById("maxPrice");
    const scrollTopBtn = document.getElementById("scrollTopBtn");
    const darkModeToggle = document.getElementById("darkModeToggle");
    const darkToggleContainer = document.querySelector(".darkmode-toggle");

    function applyFilters() {
      const query = searchInput.value.toLowerCase();
      const enablePrice = togglePriceFilter.checked;
      const min = parseFloat(minPrice.value) || 0;
      const max = parseFloat(maxPrice.value) || Infinity;

      const filtered = products.filter((p) => {
        const matchText =
          (p.product_name && p.product_name.toLowerCase().includes(query)) ||
          (p.product_code && p.product_code.toLowerCase().includes(query));

        if (!matchText) return false;

        if (enablePrice) {
          const price = parseFloat(p.marketing_price) || 0;
          if (price === 0 || price < min || price > max) return false;
        }
        return true;
      });

      renderTable(filtered);
    }

    searchInput.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(applyFilters, 300);
    });

    togglePriceFilter.addEventListener("change", () => {
      document
        .getElementById("priceRange")
        .classList.toggle("hidden", !togglePriceFilter.checked);
      applyFilters();
    });
    minPrice.addEventListener("input", applyFilters);
    maxPrice.addEventListener("input", applyFilters);

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

function renderTable(products) {
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
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${i + 1}</td>
      <td>${p.product_name || ""}</td>
      <td>${p.product_code || ""}</td>
      <td>${p.marketing_price || ""}</td>
    `;
    tbody.appendChild(row);
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  const lastUpdatedEl = document.getElementById("lastUpdated");
  const formatted = await fetchLastUpdated();
  if (formatted && lastUpdatedEl) {
    lastUpdatedEl.textContent = `Last updated: ${formatted}`;
  }
  loadProducts();
});