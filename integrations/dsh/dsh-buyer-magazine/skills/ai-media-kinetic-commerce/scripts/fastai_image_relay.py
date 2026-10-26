# -*- coding: utf-8 -*-
"""
OpenAI-Compatible FastAI Image Generation Relay Helper
Endpoint: https://www.fastaitoken.com/v1/images/generations
"""
import os
import requests

FASTAI_BASE_URL = os.getenv("FASTAI_BASE_URL", "https://www.fastaitoken.com/v1")
FASTAI_API_KEY = os.getenv("FASTAI_API_KEY", "YOUR_FASTAI_TOKEN")

def generate_editorial_plate(prompt: str, model: str = "gpt-image-1", size: str = "1024x1024") -> dict:
    headers = {
        "Authorization": f"Bearer {FASTAI_API_KEY}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": model,
        "prompt": prompt,
        "n": 1,
        "size": size
    }
    response = requests.post(f"{FASTAI_BASE_URL}/images/generations", json=payload, headers=headers, timeout=60)
    response.raise_for_status()
    return response.json()
