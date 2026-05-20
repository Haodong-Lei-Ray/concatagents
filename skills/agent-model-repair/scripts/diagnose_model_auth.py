#!/usr/bin/env python3
import argparse
import json
from typing import Dict, List

import requests


def check_openai(base_url: str, api_key: str) -> Dict:
    url = base_url.rstrip("/") + "/models"
    try:
        r = requests.get(
            url,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=20,
        )
        return {
            "status_code": r.status_code,
            "ok": r.status_code == 200,
            "error": None if r.status_code == 200 else (r.text[:200] or "non-200"),
        }
    except Exception as exc:
        return {"status_code": None, "ok": False, "error": repr(exc)}


def check_anthropic(base_url: str, api_key: str, model: str) -> Dict:
    url = base_url.rstrip("/") + "/v1/messages"
    payload = {
        "model": model,
        "max_tokens": 8,
        "messages": [{"role": "user", "content": "ping"}],
    }
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    try:
        r = requests.post(url, headers=headers, json=payload, timeout=30)
        return {
            "status_code": r.status_code,
            "ok": r.status_code == 200,
            "error": None if r.status_code == 200 else (r.text[:200] or "non-200"),
        }
    except Exception as exc:
        return {"status_code": None, "ok": False, "error": repr(exc)}


def classify_openai(results: List[Dict]) -> Dict:
    working = [x for x in results if x["result"]["ok"]]
    invalid = [x for x in results if x["result"]["status_code"] == 401]
    broken = [x for x in results if not x["result"]["ok"] and x["result"]["status_code"] != 401]
    return {"working": working, "invalid": invalid, "broken": broken}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Diagnose model auth availability for agent stacks.")
    p.add_argument("--openai-base-url", required=True, help="OpenAI-compatible base URL, e.g. http://host/v1")
    p.add_argument("--openai-key", action="append", default=[], help="Candidate OpenAI-compatible API key (repeatable)")
    p.add_argument("--anthropic-base-url", help="Anthropic-compatible base URL")
    p.add_argument("--anthropic-key", help="Anthropic-compatible API key")
    p.add_argument("--anthropic-model", default="MiniMax-M2.7", help="Model for anthropic probe")
    return p.parse_args()


def main() -> int:
    args = parse_args()

    openai_checks = []
    for key in args.openai_key:
        res = check_openai(args.openai_base_url, key)
        openai_checks.append(
            {
                "key_masked": f"{key[:6]}...{key[-4:]}" if len(key) > 12 else "***",
                "result": res,
            }
        )

    anthropic_check = None
    if args.anthropic_base_url and args.anthropic_key:
        res = check_anthropic(args.anthropic_base_url, args.anthropic_key, args.anthropic_model)
        anthropic_check = {
            "base_url": args.anthropic_base_url,
            "model": args.anthropic_model,
            "key_masked": f"{args.anthropic_key[:6]}...{args.anthropic_key[-4:]}" if len(args.anthropic_key) > 12 else "***",
            "result": res,
        }

    openai_summary = classify_openai(openai_checks)
    report = {
        "openai_base_url": args.openai_base_url,
        "openai": {
            "checks": openai_checks,
            "working_count": len(openai_summary["working"]),
            "invalid_count": len(openai_summary["invalid"]),
            "broken_count": len(openai_summary["broken"]),
        },
        "anthropic": anthropic_check,
        "recommendation": {
            "openai": (
                "use first working key, remove expired 401 keys from active env"
                if openai_summary["working"]
                else "no working key found, check endpoint/network or rotate key"
            ),
            "anthropic": (
                "path healthy" if (anthropic_check and anthropic_check["result"]["ok"]) else "path not healthy or not provided"
            ),
        },
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
