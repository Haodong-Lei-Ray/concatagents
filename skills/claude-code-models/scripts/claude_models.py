#!/usr/bin/env python3
"""Manage Claude Code dual-upstream routes in api-local.json."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from copy import deepcopy
from pathlib import Path
from typing import Any

DEFAULT_CONFIG = Path(
    os.environ.get(
        "CLAUDE_PROXY_CONFIG",
        Path(__file__).resolve().parents[3] / "api-local.json",
    )
)
CANONICAL = ("minimax", "deepseek")
MASK = "***"


def load_config(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def save_config(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def mask_route(route: dict[str, Any]) -> dict[str, Any]:
    out = deepcopy(route)
    if out.get("apiKey"):
        key = out["apiKey"]
        out["apiKey"] = key[:6] + MASK if len(key) > 6 else MASK
    return out


def ensure_routes(data: dict[str, Any]) -> dict[str, Any]:
    routes = data.setdefault("routes", {})
    if not isinstance(routes, dict):
        raise SystemExit("routes must be an object")
    return routes


def cmd_list(args: argparse.Namespace) -> int:
    data = load_config(args.config)
    routes = ensure_routes(data)
    custom_route = data.get("customRoute") or (
        "custom" if "custom" in routes else "deepseek"
    )
    listen = data.get("listen", {})
    print(f"config: {args.config}")
    print(f"listen: {listen.get('bind', '127.0.0.1')}:{listen.get('port', 3889)}")
    print(f"customRoute: {custom_route}")
    print("routes:")
    for name, route in routes.items():
        role = []
        if name == "minimax":
            role.append("default-upstream (slots 1-4)")
        if name == custom_route or name == "deepseek":
            role.append("custom-upstream (slot 5)")
        tag = f" [{', '.join(role)}]" if role else ""
        print(f"  - {name}{tag}")
        masked = mask_route(route)
        for k, v in masked.items():
            print(f"      {k}: {v}")
    return 0


def cmd_get(args: argparse.Namespace) -> int:
    routes = ensure_routes(load_config(args.config))
    if args.name not in routes:
        raise SystemExit(f"route not found: {args.name}")
    print(json.dumps(mask_route(routes[args.name]), indent=2, ensure_ascii=False))
    return 0


def route_from_args(args: argparse.Namespace) -> dict[str, Any]:
    route: dict[str, Any] = {
        "baseUrl": args.base_url,
        "apiKey": args.api_key,
        "model": args.model,
    }
    if args.match_models:
        route["matchModels"] = [m.strip() for m in args.match_models.split(",") if m.strip()]
    return route


def cmd_add(args: argparse.Namespace) -> int:
    data = load_config(args.config)
    routes = ensure_routes(data)
    if args.name in routes:
        raise SystemExit(f"route already exists: {args.name}")
    routes[args.name] = route_from_args(args)
    save_config(args.config, data)
    print(f"added route: {args.name}")
    return 0


def cmd_update(args: argparse.Namespace) -> int:
    data = load_config(args.config)
    routes = ensure_routes(data)
    if args.name not in routes:
        raise SystemExit(f"route not found: {args.name}")
    route = routes[args.name]
    if args.base_url:
        route["baseUrl"] = args.base_url
    if args.api_key:
        route["apiKey"] = args.api_key
    if args.model:
        route["model"] = args.model
    if args.match_models is not None:
        models = [m.strip() for m in args.match_models.split(",") if m.strip()]
        if models:
            route["matchModels"] = models
        else:
            route.pop("matchModels", None)
    save_config(args.config, data)
    print(f"updated route: {args.name}")
    return 0


def cmd_delete(args: argparse.Namespace) -> int:
    data = load_config(args.config)
    routes = ensure_routes(data)
    if args.name not in routes:
        raise SystemExit(f"route not found: {args.name}")
    if args.name in CANONICAL and not args.force:
        raise SystemExit(
            f"refusing to delete canonical route '{args.name}' "
            f"(use --force if you really mean it)"
        )
    del routes[args.name]
    if data.get("customRoute") == args.name:
        data["customRoute"] = "deepseek" if "deepseek" in routes else next(iter(routes), "deepseek")
    save_config(args.config, data)
    print(f"deleted route: {args.name}")
    return 0


def cmd_apply_env(args: argparse.Namespace) -> int:
    """Sync ANTHROPIC_CUSTOM_MODEL_OPTION* from the custom/deepseek route."""
    data = load_config(args.config)
    routes = ensure_routes(data)
    custom_name = data.get("customRoute") or (
        "custom" if "custom" in routes else "deepseek"
    )
    if custom_name not in routes:
        raise SystemExit(f"custom route missing: {custom_name}")
    route = routes[custom_name]
    model = route["model"]
    display = args.display_name or {
        "deepseek": "DeepSeek",
        "minimax": "MiniMax",
    }.get(custom_name, custom_name.title())
    desc = args.description or f"通过本地代理的 {custom_name} 上游"
    print("export these in ~/.bashrc and ~/.zshrc:")
    print(f'export ANTHROPIC_CUSTOM_MODEL_OPTION="{model}"')
    print(f'export ANTHROPIC_CUSTOM_MODEL_OPTION_NAME="{display}"')
    print(f'export ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION="{desc}"')
    if args.write:
        for rc in (Path.home() / ".bashrc", Path.home() / ".zshrc"):
            if not rc.exists():
                continue
            text = rc.read_text(encoding="utf-8")
            replacements = {
                r'^export ANTHROPIC_CUSTOM_MODEL_OPTION=.*$': f'export ANTHROPIC_CUSTOM_MODEL_OPTION="{model}"',
                r'^export ANTHROPIC_CUSTOM_MODEL_OPTION_NAME=.*$': f'export ANTHROPIC_CUSTOM_MODEL_OPTION_NAME="{display}"',
                r'^export ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION=.*$': f'export ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION="{desc}"',
            }
            for pattern, repl in replacements.items():
                text, n = re.subn(pattern, repl, text, count=1, flags=re.M)
                if n == 0:
                    raise SystemExit(f"pattern not found in {rc}: {pattern}")
            rc.write_text(text, encoding="utf-8")
            print(f"updated {rc}")
    return 0


def cmd_dual_only(args: argparse.Namespace) -> int:
    """Keep only listen plus minimax/deepseek routes."""
    data = load_config(args.config)
    routes = ensure_routes(data)
    keep = {k: routes[k] for k in CANONICAL if k in routes}
    missing = [k for k in CANONICAL if k not in keep]
    if missing:
        raise SystemExit(f"missing canonical routes: {', '.join(missing)}")
    data["routes"] = keep
    data.pop("customRoute", None)
    save_config(args.config, data)
    print("api-local.json now has only listen + routes: minimax, deepseek")
    return 0


def cmd_verify(args: argparse.Namespace) -> int:
    data = load_config(args.config)
    port = data.get("listen", {}).get("port", 3889)
    bind = data.get("listen", {}).get("bind", "127.0.0.1")
    base = f"http://{bind}:{port}"
    try:
        out = subprocess.check_output(
            ["curl", "-fsS", "-m", "3", f"{base}/"],
            text=True,
        ).strip()
        print(f"proxy health: OK ({out!r})")
    except subprocess.CalledProcessError as exc:
        print(f"proxy health: FAIL ({exc})")
        return 1
    routes = ensure_routes(data)
    minimax_model = routes["minimax"]["model"]
    deepseek_model = routes["deepseek"]["model"]
    for model in (minimax_model, deepseek_model):
        try:
            subprocess.run(
                ["claude", "--model", model, "-p", "只回复 hi"],
                check=True,
                timeout=120,
                capture_output=not args.verbose,
            )
            print(f"claude --model {model}: OK")
        except Exception as exc:
            print(f"claude --model {model}: FAIL ({exc})")
            return 1
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Claude Code model route manager")
    p.add_argument(
        "--config",
        type=Path,
        default=DEFAULT_CONFIG,
        help=f"path to api-local.json (default: {DEFAULT_CONFIG})",
    )
    sub = p.add_subparsers(dest="command", required=True)

    sub.add_parser("list", help="list routes (keys masked)").set_defaults(func=cmd_list)
    g = sub.add_parser("get", help="show one route")
    g.add_argument("name")
    g.set_defaults(func=cmd_get)

    a = sub.add_parser("add", help="add a route")
    a.add_argument("name")
    a.add_argument("--base-url", required=True)
    a.add_argument("--api-key", required=True)
    a.add_argument("--model", required=True)
    a.add_argument("--match-models", default="")
    a.set_defaults(func=cmd_add)

    u = sub.add_parser("update", help="update a route")
    u.add_argument("name")
    u.add_argument("--base-url")
    u.add_argument("--api-key")
    u.add_argument("--model")
    u.add_argument("--match-models")
    u.set_defaults(func=cmd_update)

    d = sub.add_parser("delete", help="delete a route")
    d.add_argument("name")
    d.add_argument("--force", action="store_true")
    d.set_defaults(func=cmd_delete)

    e = sub.add_parser("apply-env", help="print or patch shell custom-model exports")
    e.add_argument("--display-name")
    e.add_argument("--description")
    e.add_argument("--write", action="store_true", help="patch ~/.bashrc and ~/.zshrc")
    e.set_defaults(func=cmd_apply_env)

    sub.add_parser(
        "dual-only",
        help="keep only minimax + deepseek in api-local.json",
    ).set_defaults(func=cmd_dual_only)

    v = sub.add_parser("verify", help="health check proxy and both models")
    v.add_argument("--verbose", action="store_true")
    v.set_defaults(func=cmd_verify)
    return p


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if not args.config.exists():
        raise SystemExit(f"config not found: {args.config}")
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
