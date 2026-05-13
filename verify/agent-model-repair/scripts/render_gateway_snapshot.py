#!/usr/bin/env python3
"""
Render the「网关与密钥快照表」from reference.md as Markdown (or JSON).

- OpenAI-compatible: GET <base>/models, list up to 5 model IDs (prioritize configured defaults).
- Anthropic-compatible: no standard list here; model column uses env hints + probe model.
- Optional --save-api-keys: write discovered real base_url + api_key to api-key.json (see --help).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

try:
    import requests
except ImportError as exc:  # pragma: no cover
    print("requires: pip install requests", file=sys.stderr)
    raise SystemExit(2) from exc

try:
    import yaml  # type: ignore
except ImportError:
    yaml = None  # type: ignore


def mask_key(key: str) -> str:
    if not key:
        return ""
    k = key.strip()
    if len(k) <= 10:
        return "***"
    return f"{k[:6]}...{k[-4:]}"


def parse_export_block(text: str) -> Dict[str, str]:
    """Parse lines like export FOO="bar" or export FOO=bar."""
    out: Dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("export ") or line.startswith("#"):
            continue
        rest = line[len("export ") :].strip()
        m = re.match(r"([A-Za-z_][A-Za-z0-9_]*)=(.*)$", rest)
        if not m:
            continue
        name, raw = m.group(1), m.group(2).strip()
        if (raw.startswith('"') and raw.endswith('"')) or (raw.startswith("'") and raw.endswith("'")):
            raw = raw[1:-1]
        out[name] = raw
    return out


def parse_dotenv(text: str) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        k, v = line.split("=", 1)
        k, v = k.strip(), v.strip().strip('"').strip("'")
        out[k] = v
    return out


def load_hermes(path: Path) -> Dict[str, str]:
    if not path.is_file():
        return {}
    raw = path.read_text(encoding="utf-8", errors="replace")
    if yaml:
        try:
            data = yaml.safe_load(raw)
            if isinstance(data, dict) and isinstance(data.get("model"), dict):
                m = data["model"]
                return {
                    "HERMES_DEFAULT_MODEL": str(m.get("default") or ""),
                    "HERMES_BASE_URL": str(m.get("base_url") or ""),
                    "HERMES_API_KEY": str(m.get("api_key") or ""),
                }
        except Exception:
            pass
    # minimal fallback
    out: Dict[str, str] = {}
    for key, pat in (
        ("HERMES_DEFAULT_MODEL", r"^\s*default:\s*(.+)\s*$"),
        ("HERMES_BASE_URL", r"^\s*base_url:\s*(.+)\s*$"),
        ("HERMES_API_KEY", r"^\s*api_key:\s*(.+)\s*$"),
    ):
        for line in raw.splitlines():
            m = re.match(pat, line)
            if m:
                out[key] = m.group(1).strip().strip('"').strip("'")
                break
    return out


def discover_env(home: Path) -> Dict[str, str]:
    merged: Dict[str, str] = {}
    env_path = home / ".openclaw" / ".env"
    if env_path.is_file():
        merged.update(parse_dotenv(env_path.read_text(encoding="utf-8", errors="replace")))
    bashrc = home / ".bashrc"
    if bashrc.is_file():
        merged.update(parse_export_block(bashrc.read_text(encoding="utf-8", errors="replace")))
    hermes = load_hermes(home / ".hermes" / "config.yaml")
    for k, v in hermes.items():
        if v:
            merged[k] = v
    if hermes.get("HERMES_BASE_URL"):
        merged.setdefault("OPENAI_BASE_URL", hermes["HERMES_BASE_URL"])
    if hermes.get("HERMES_API_KEY"):
        merged.setdefault("OPENAI_API_KEY", hermes["HERMES_API_KEY"])
    if hermes.get("HERMES_DEFAULT_MODEL"):
        merged.setdefault("HERMES_DEFAULT_MODEL", hermes["HERMES_DEFAULT_MODEL"])
    return merged


def fetch_openai_model_ids(base_url: str, api_key: str, timeout: float) -> Tuple[List[str], Optional[str]]:
    url = base_url.rstrip("/") + "/models"
    try:
        r = requests.get(
            url,
            headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"},
            timeout=timeout,
        )
        if r.status_code != 200:
            return [], f"HTTP {r.status_code}: {r.text[:120]}"
        data = r.json()
        ids: List[str] = []
        for item in data.get("data") or []:
            if isinstance(item, dict) and isinstance(item.get("id"), str):
                ids.append(item["id"])
        return sorted(set(ids)), None
    except Exception as exc:
        return [], repr(exc)


def pick_models(
    catalog: List[str],
    preferred: List[str],
    max_n: int = 5,
) -> Tuple[str, int]:
    """Return comma-separated up to max_n ids; rough +N hint when catalog is larger than max_n."""
    picked: List[str] = []
    for p in preferred:
        p = (p or "").strip()
        if not p or p in picked:
            continue
        picked.append(p)
        if len(picked) >= max_n:
            extra = max(0, len(catalog) - max_n) if catalog else 0
            return ", ".join(picked), extra
    for mid in catalog:
        if mid not in picked:
            picked.append(mid)
        if len(picked) >= max_n:
            return ", ".join(picked), max(0, len(catalog) - max_n)
    return ", ".join(picked), max(0, len(catalog) - max_n) if catalog else 0


def anthropic_probe_ok(base_url: str, api_key: str, model: str, timeout: float) -> bool:
    url = base_url.rstrip("/") + "/v1/messages"
    payload = {
        "model": model,
        "max_tokens": 4,
        "messages": [{"role": "user", "content": "ping"}],
    }
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    try:
        r = requests.post(url, headers=headers, json=payload, timeout=timeout)
        return r.status_code == 200
    except Exception:
        return False


def anthropic_model_hints(env: Dict[str, str]) -> List[str]:
    keys = [
        "ANTHROPIC_MODEL",
        "ANTHROPIC_SMALL_FAST_MODEL",
        "ANTHROPIC_DEFAULT_HAIKU_MODEL",
        "ANTHROPIC_CUSTOM_MODEL_OPTION",
        "ANTHROPIC_DEFAULT_OPUS_MODEL",
        "ANTHROPIC_DEFAULT_SONNET_MODEL",
    ]
    out: List[str] = []
    for k in keys:
        v = (env.get(k) or "").strip()
        if v and v not in out:
            out.append(v)
    return out[:5]


def row_key(url: str, key: str) -> Tuple[str, str]:
    return (url.rstrip("/"), key)


def harness_for_row(label: str, env: Dict[str, str], url: str, key: str) -> str:
    """Which harness components consume this gateway row (best-effort from discover)."""
    if label == "hermes-custom":
        return "Hermes"
    if label == "anthropic-compatible":
        return "Claude Code"
    if label == "manual-openai":
        ob = (env.get("OPENAI_BASE_URL") or "").strip()
        ok = (env.get("OPENAI_API_KEY") or "").strip()
        if ob and ok and row_key(ob, ok) == row_key(url, key):
            return harness_for_row("openai-compatible", env, url, key)
        return "（手动行）"
    # openai-compatible
    parts = ["OpenClaw"]
    hb = (env.get("HERMES_BASE_URL") or "").strip()
    hk = (env.get("HERMES_API_KEY") or "").strip()
    if hb and hk and row_key(hb, hk) == row_key(url, key):
        parts.append("Hermes")
    return ", ".join(parts)


def build_rows_from_discover(
    home: Path,
    anthropic_probe_model: str,
    timeout: float,
) -> Tuple[List[Dict[str, str]], List[str], Dict[str, str]]:
    env = discover_env(home)
    notes: List[str] = []
    rows: List[Dict[str, str]] = []
    seen: set[Tuple[str, str]] = set()

    ob = (env.get("OPENAI_BASE_URL") or "").strip()
    ok = (env.get("OPENAI_API_KEY") or "").strip()
    if ob and ok:
        catalog, err = fetch_openai_model_ids(ob, ok, timeout)
        preferred = []
        for k in ("HERMES_DEFAULT_MODEL",):
            v = (env.get(k) or "").strip()
            if v:
                preferred.append(v)
        models, extra = pick_models(catalog, preferred, 5)
        if extra:
            notes.append(f"OpenAI catalog has more than shown; trimmed to 5 (+{extra} omitted).")
        if err:
            notes.append(f"OpenAI-compatible {ob}: {err}")
        rows.append(
            {
                "label": "openai-compatible",
                "harness": harness_for_row("openai-compatible", env, ob, ok),
                "api_key_masked": mask_key(ok),
                "models": models or ("(catalog fetch failed)" if err else ""),
                "url": ob,
            }
        )
        seen.add(row_key(ob, ok))

    hb = (env.get("HERMES_BASE_URL") or "").strip()
    hk = (env.get("HERMES_API_KEY") or "").strip()
    hd = (env.get("HERMES_DEFAULT_MODEL") or "").strip()
    if hb and hk and row_key(hb, hk) not in seen:
        catalog, err = fetch_openai_model_ids(hb, hk, timeout)
        preferred = [hd] if hd else []
        models, extra = pick_models(catalog, preferred, 5)
        if extra:
            notes.append(f"Hermes catalog trim +{extra}.")
        if err:
            notes.append(f"Hermes gateway {hb}: {err}")
        rows.append(
            {
                "label": "hermes-custom",
                "harness": harness_for_row("hermes-custom", env, hb, hk),
                "api_key_masked": mask_key(hk),
                "models": models or ("(catalog fetch failed)" if err else ""),
                "url": hb,
            }
        )
        seen.add(row_key(hb, hk))

    ab = (env.get("ANTHROPIC_BASE_URL") or "").strip()
    ak = (env.get("ANTHROPIC_API_KEY") or env.get("ANTHROPIC_AUTH_TOKEN") or "").strip()
    if ab and ak:
        hints = anthropic_model_hints(env)
        probe = anthropic_probe_model
        if probe not in hints:
            hints = [probe] + hints
        hints = hints[:5]
        models = ", ".join(hints)
        if not anthropic_probe_ok(ab, ak, probe, timeout):
            notes.append(f"Anthropic-compatible probe failed for model={probe!r} at {ab}")
        rows.append(
            {
                "label": "anthropic-compatible",
                "harness": harness_for_row("anthropic-compatible", env, ab, ak),
                "api_key_masked": mask_key(ak),
                "models": models,
                "url": ab,
            }
        )

    return rows, notes, env


def _discover_source_paths(home: Path) -> List[str]:
    paths = [
        home / ".openclaw" / ".env",
        home / ".bashrc",
        home / ".hermes" / "config.yaml",
    ]
    return [str(p.expanduser()) for p in paths if p.is_file()]


def build_api_key_document(
    home: Path,
    env: Dict[str, str],
    rows: List[Dict[str, str]],
    manual_openai: List[Tuple[str, str]],
) -> Dict:
    """Build JSON document with real base_url + api_key per table row."""
    endpoints: List[Dict[str, str]] = []
    seen: set[Tuple[str, str]] = set()

    def add_ep(eid: str, harness: str, base: str, key: str) -> None:
        base_f, key_f = base.strip(), key.strip()
        if not key_f and not base_f:
            return
        rk = row_key(base_f, key_f)
        if rk in seen:
            return
        seen.add(rk)
        endpoints.append(
            {"id": eid, "harness": harness, "base_url": base_f, "api_key": key_f}
        )

    for r in rows:
        label = r.get("label", "")
        harness = r.get("harness", "")
        url = (r.get("url") or "").strip()
        if label == "openai-compatible":
            key = (env.get("OPENAI_API_KEY") or "").strip()
            base = (env.get("OPENAI_BASE_URL") or url).strip()
        elif label == "hermes-custom":
            key = (env.get("HERMES_API_KEY") or "").strip()
            base = (env.get("HERMES_BASE_URL") or url).strip()
        elif label == "anthropic-compatible":
            key = (env.get("ANTHROPIC_API_KEY") or env.get("ANTHROPIC_AUTH_TOKEN") or "").strip()
            base = (env.get("ANTHROPIC_BASE_URL") or url).strip()
        elif label == "manual-openai":
            key, base = "", url
            for b, k in manual_openai:
                if b.rstrip("/") == url.rstrip("/"):
                    base, key = b.strip(), k.strip()
                    break
        else:
            continue
        add_ep(label, harness, base, key)

    return {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "discover_home": str(home.expanduser().resolve()),
        "sources_read": _discover_source_paths(home),
        "endpoints": endpoints,
    }


def write_api_key_json(path: Path, document: Dict) -> None:
    path = path.expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(document, ensure_ascii=False, indent=2) + "\n"
    path.write_text(text, encoding="utf-8")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def render_markdown(rows: List[Dict[str, str]]) -> str:
    lines = [
        "| 用于 Harness | API Key（掩码） | 模型名（最多 5 个） | URL |",
        "|--------------|----------------|---------------------|-----|",
    ]
    for r in rows:
        hv = r.get("harness", "").replace("|", "\\|")
        mk = r.get("api_key_masked", "").replace("|", "\\|")
        md = r.get("models", "").replace("|", "\\|")
        ur = r.get("url", "").replace("|", "\\|")
        lines.append(f"| {hv} | {mk} | {md} | {ur} |")
    if not rows:
        lines.append("| | | | |")
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Render gateway + key snapshot table (reference.md §网关与密钥快照表)."
    )
    p.add_argument(
        "--discover",
        action="store_true",
        help="Read ~/.bashrc, ~/.openclaw/.env, ~/.hermes/config.yaml and build rows",
    )
    p.add_argument("--home", default=str(Path.home()), help="Home directory for --discover")
    p.add_argument(
        "--anthropic-probe-model",
        default="MiniMax-M2.7",
        help="Model id for POST /v1/messages health hint",
    )
    p.add_argument("--timeout", type=float, default=25.0, help="HTTP timeout seconds")
    p.add_argument("--json", action="store_true", help="Print JSON instead of Markdown")
    p.add_argument(
        "--openai-row",
        nargs=3,
        metavar=("BASE_URL", "API_KEY", "MODELS_CSV"),
        action="append",
        default=[],
        help="Manual row: OpenAI-compatible base, key, comma-separated models (max 5 used)",
    )
    p.add_argument(
        "--save-api-keys",
        nargs="?",
        const="__default__",
        default=None,
        metavar="PATH",
        help="Write real base_url + api_key to JSON (default: <this-script-dir>/api-key.json). chmod 0600 on Unix.",
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()
    rows: List[Dict[str, str]] = []
    notes: List[str] = []

    if not args.discover and not args.openai_row:
        print(
            "Specify --discover and/or one or more --openai-row BASE URL KEY models_csv",
            file=sys.stderr,
        )
        return 2
    if args.discover:
        drows, dnotes, denv = build_rows_from_discover(Path(args.home), args.anthropic_probe_model, args.timeout)
        rows.extend(drows)
        notes.extend(dnotes)
        discover_env_dict = denv
    else:
        discover_env_dict = {}
    for triple in args.openai_row:
        base, key, models_csv = triple[0], triple[1], triple[2]
        parts = [x.strip() for x in models_csv.split(",") if x.strip()][:5]
        catalog: List[str] = []
        err: Optional[str] = None
        if key:
            catalog, err = fetch_openai_model_ids(base, key, args.timeout)
        if not parts and catalog:
            joined, _ = pick_models(catalog, [], 5)
            parts = [x.strip() for x in joined.split(",") if x.strip()] if joined else []
        if err:
            notes.append(f"manual openai {base}: {err}")
        models_cell = ", ".join(parts) if parts else (pick_models(catalog, [], 5)[0] if catalog else "")
        rows.append(
            {
                "label": "manual-openai",
                "harness": harness_for_row("manual-openai", discover_env_dict, base, key),
                "api_key_masked": mask_key(key),
                "models": models_cell,
                "url": base,
            }
        )

    manual_pairs = [(t[0], t[1]) for t in args.openai_row]
    api_key_path_written: Optional[str] = None
    if args.save_api_keys is not None:
        out_path = (
            Path(__file__).resolve().parent / "api-key.json"
            if args.save_api_keys == "__default__"
            else Path(args.save_api_keys)
        )
        doc = build_api_key_document(Path(args.home), discover_env_dict, rows, manual_pairs)
        write_api_key_json(out_path, doc)
        api_key_path_written = str(out_path)

    if args.json:
        obj: Dict = {"rows": rows, "notes": notes}
        if api_key_path_written:
            obj["api_key_json_path"] = api_key_path_written
        print(json.dumps(obj, ensure_ascii=False, indent=2))
        return 0

    print(render_markdown(rows))
    for n in notes:
        print(f"<!-- {n} -->", file=sys.stderr)
    if api_key_path_written:
        print(f"<!-- wrote api-key.json: {api_key_path_written} -->", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
