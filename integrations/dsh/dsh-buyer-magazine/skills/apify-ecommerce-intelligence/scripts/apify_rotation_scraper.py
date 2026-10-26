# -*- coding: utf-8 -*-
"""
4-Key Apify API Token Rotation Pool & Corporate DNA Extractor
"""
import os
import requests

APIFY_TOKENS = [
    os.getenv("APIFY_TOKEN_1", "apify_api_key_slot_1"),
    os.getenv("APIFY_TOKEN_2", "apify_api_key_slot_2"),
    os.getenv("APIFY_TOKEN_3", "apify_api_key_slot_3"),
    os.getenv("APIFY_TOKEN_4", "apify_api_key_slot_4"),
]

def scrape_corporate_dna(target_url: str) -> dict:
    for idx, token in enumerate(APIFY_TOKENS):
        if not token or token.startswith("apify_api_key_slot"):
            continue
        try:
            resp = requests.post(
                "https://api.apify.com/v2/acts/apify~website-content-crawler/run-sync-get-dataset-items",
                params={"token": token},
                json={"startUrls": [{"url": target_url}], "maxCrawlPages": 3},
                timeout=45
            )
            if resp.status_code == 200:
                return {"status": "ok", "source": f"apify_key_{idx+1}", "data": resp.json()}
        except Exception:
            continue

    # Fallback: Jina Reader Markdown Extraction
    jina_resp = requests.get(f"https://r.jina.ai/{target_url}", timeout=30)
    return {"status": "fallback_jina", "markdown": jina_resp.text}
