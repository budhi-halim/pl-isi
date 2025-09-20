#!/usr/bin/env python3
"""
Product scraper: collects catalog, fetches marketing prices, writes products.json and last_updated.txt
"""

import os
import sys
import json
import requests
import itertools
import string
from datetime import datetime

# Endpoints
LOGIN_URL = "http://apps.islandsunindonesia.com:81/islandsun/index.php/login"
PRODUCT_URL = "http://apps.islandsunindonesia.com:81/islandsun/samplerequest/getAjaxproduct/null"
PRICE_URL = "http://apps.islandsunindonesia.com:81/islandsun/samplerequest/getMarketingPrice"

def _parse_code_and_name(text: str):
    parts = [p.strip() for p in text.split("/") if p.strip()]
    if not parts:
        return "", text.strip()
    code = parts[0]
    name = " / ".join(parts[1:]) if len(parts) > 1 else text.strip()
    return code, name

def login():
    username = os.getenv("ISLANDSUN_USERNAME")
    password = os.getenv("ISLANDSUN_PASSWORD")
    if not username or not password:
        print("ERROR: Environment variables ISLANDSUN_USERNAME and ISLANDSUN_PASSWORD must be provided.", file=sys.stderr)
        sys.exit(2)

    s = requests.Session()
    try:
        s.post(LOGIN_URL, data={"user": username}, timeout=15)
        resp = s.post(LOGIN_URL, data={"user": username, "password": password}, timeout=15)
        resp.raise_for_status()
        print("[LOGIN] Logged in successfully.")
        return s
    except Exception as e:
        print(f"[LOGIN] Failed: {e}", file=sys.stderr)
        sys.exit(3)

def fetch_products_for_term(session, term):
    try:
        resp = session.post(PRODUCT_URL, data={"param": term}, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        return data if isinstance(data, list) else []
    except Exception:
        return []

def collect_full_catalog(session):
    alphabet = "0123456789" + string.ascii_lowercase
    terms = [''.join(p) for p in itertools.product(alphabet, repeat=2)]
    catalog = {}
    total_terms = len(terms)

    print("[CATALOG] Collecting products...")
    for idx, term in enumerate(terms, start=1):
        items = fetch_products_for_term(session, term)
        for item in items:
            key = (str(item.get("id", "")).strip(), str(item.get("text", "")).strip())
            if key not in catalog and key[0] and key[1]:
                catalog[key] = {"id": key[0], "text": key[1]}
        print(f"\r[CATALOG] Term {idx}/{total_terms} | Unique={len(catalog)}", end="")
    print()
    print(f"[CATALOG] Finished. Terms={total_terms}, Unique entries={len(catalog)}")
    return list(catalog.values())

def fetch_price(session, pid):
    try:
        resp = session.post(PRICE_URL, data={"id": str(pid)}, timeout=15)
        if resp.status_code == 200:
            price = resp.text.strip()
            return price if price else ""
    except Exception:
        return ""
    return ""

def enrich_with_prices(session, catalog):
    id_to_price = {}
    enriched = []
    total = len(catalog)
    print("[PRICES] Fetching marketing prices...")
    for idx, product in enumerate(catalog, start=1):
        pid = product["id"]
        text = product["text"]

        if pid not in id_to_price:
            id_to_price[pid] = fetch_price(session, pid)
        price = id_to_price[pid]

        code, name = _parse_code_and_name(text)

        enriched.append({
            "product_name": name,
            "product_code": code,
            "marketing_price": price,
        })

        print(f"\r[PRICES] {idx}/{total} products processed", end="")
    print()
    return enriched

def save_json(products):
    products_sorted = sorted(products, key=lambda x: (x["product_name"], x["product_code"]))
    with open("products.json", "w", encoding="utf-8") as f:
        json.dump(products_sorted, f, ensure_ascii=False, indent=2)
    print("[DONE] Saved products.json")
    return products_sorted

def write_last_updated_file(date_obj):
    iso_date = date_obj.strftime("%Y-%m-%d")
    with open("last_updated.txt", "w", encoding="utf-8") as f:
        f.write(iso_date)
    print(f"[DONE] Saved last_updated.txt ({iso_date})")

def main():
    session = login()
    catalog = collect_full_catalog(session)
    products = enrich_with_prices(session, catalog)
    save_json(products)
    write_last_updated_file(datetime.now().date())
    print("[ALL DONE]")

if __name__ == "__main__":
    main()