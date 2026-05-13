#!/usr/bin/env python3
import argparse
import difflib
import json
import sys
import urllib.error
import urllib.request


def normalize_base_url(base_url: str) -> str:
    base = base_url.rstrip("/")
    if base.endswith("/v1"):
        return base
    return base + "/v1"


def fetch_models(base_url: str, api_key: str) -> list[str]:
    url = normalize_base_url(base_url) + "/models"
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    data = payload.get("data", [])
    ids = []
    for item in data:
        if isinstance(item, dict) and isinstance(item.get("id"), str):
            ids.append(item["id"])
    return sorted(set(ids))


def unique(items: list[str]) -> list[str]:
    seen = set()
    out = []
    for item in items:
        if item not in seen:
            out.append(item)
            seen.add(item)
    return out


def suggest(model: str, available: list[str]) -> tuple[list[str], list[str]]:
    direct = []
    fuzzy = []
    available_set = set(available)
    lower_map = {item.lower(): item for item in available}
    model_lower = model.lower()

    if model_lower in lower_map and lower_map[model_lower] != model:
        direct.append(lower_map[model_lower])

    if "/" in model:
        suffix = model.split("/")[-1]
        if suffix in available_set:
            direct.append(suffix)
        suffix_lower = suffix.lower()
        if suffix_lower in lower_map:
            direct.append(lower_map[suffix_lower])

    prefix_matches = [item for item in available if item.startswith(model + "-")]
    direct.extend(prefix_matches)

    close_matches = difflib.get_close_matches(model, available, n=5, cutoff=0.6)
    fuzzy.extend(close_matches)

    return unique(direct), unique(fuzzy)


def classify(models: list[str], available: list[str]) -> dict:
    available_set = set(available)
    result = {
        "valid": [],
        "replaceable": [],
        "ambiguous": [],
        "invalid": [],
    }

    for model in models:
        if model in available_set:
            result["valid"].append({"model": model})
            continue

        direct, fuzzy = suggest(model, available)
        if len(direct) == 1:
            result["replaceable"].append(
                {"model": model, "replacement": direct[0], "suggestions": direct}
            )
        else:
            suggestions = unique(direct + fuzzy)
            if suggestions:
                result["ambiguous"].append(
                    {"model": model, "suggestions": suggestions}
                )
            else:
                result["invalid"].append({"model": model, "suggestions": []})

    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate model IDs against a live OpenAI-compatible /v1/models endpoint."
    )
    parser.add_argument("--base-url", required=True, help="Gateway base URL")
    parser.add_argument("--api-key", required=True, help="Gateway API key")
    parser.add_argument(
        "--models",
        nargs="*",
        default=[],
        help="Model IDs to validate",
    )
    parser.add_argument(
        "--stdin-models",
        action="store_true",
        help="Also read newline-delimited model IDs from stdin",
    )
    parser.add_argument(
        "--format",
        choices=("json", "text"),
        default="json",
        help="Output format",
    )
    return parser.parse_args()


def render_text(report: dict) -> str:
    lines = []
    lines.append(f"base_url: {report['base_url']}")
    lines.append(f"available_models: {report['available_model_count']}")
    lines.append("")
    for section in ("valid", "replaceable", "ambiguous", "invalid"):
        lines.append(section + ":")
        items = report["results"][section]
        if not items:
            lines.append("  - none")
            continue
        for item in items:
            if "replacement" in item:
                lines.append(f"  - {item['model']} -> {item['replacement']}")
            elif item.get("suggestions"):
                lines.append(
                    f"  - {item['model']} (suggestions: {', '.join(item['suggestions'])})"
                )
            else:
                lines.append(f"  - {item['model']}")
    return "\n".join(lines)


def main() -> int:
    args = parse_args()
    models = list(args.models)
    if args.stdin_models:
        models.extend(line.strip() for line in sys.stdin if line.strip())
    models = unique([model for model in models if model])

    try:
        available = fetch_models(args.base_url, args.api_key)
    except urllib.error.HTTPError as exc:
        sys.stderr.write(f"HTTP error while fetching /models: {exc.code}\n")
        return 2
    except Exception as exc:
        sys.stderr.write(f"Failed to fetch /models: {exc}\n")
        return 2

    report = {
        "base_url": normalize_base_url(args.base_url),
        "available_model_count": len(available),
        "checked_model_count": len(models),
        "results": classify(models, available),
    }

    if args.format == "json":
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(render_text(report))

    if report["results"]["invalid"] or report["results"]["ambiguous"]:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
