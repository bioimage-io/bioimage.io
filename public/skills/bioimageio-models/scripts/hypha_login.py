#!/usr/bin/env python3
"""
hypha_login.py — Get a Hypha token and save it to .env

Usage:
    python hypha_login.py              # saves token to .env in current directory
    python hypha_login.py --env /path/to/.env

The script opens a login URL in your browser (or prints it if it can't).
After you log in, the token is saved so the submission script can read it.
"""
import argparse
import asyncio
import os
import sys
from pathlib import Path


async def login(env_path: Path) -> None:
    try:
        from hypha_rpc import login as hypha_login
    except ImportError:
        print("hypha-rpc is not installed. Run: pip install hypha-rpc")
        sys.exit(1)

    server_url = "https://hypha.aicell.io"
    print(f"Logging in to {server_url} ...")
    print("A browser window will open. If it doesn't, copy the URL printed below.\n")

    token = await hypha_login({"server_url": server_url})

    if not token:
        print("Login failed — no token received.")
        sys.exit(1)

    # Write / update .env file
    env_path = env_path.resolve()
    existing: dict[str, str] = {}
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                existing[k.strip()] = v.strip()

    existing["HYPHA_TOKEN"] = token
    env_path.write_text(
        "\n".join(f"{k}={v}" for k, v in existing.items()) + "\n"
    )

    print(f"\nToken saved to: {env_path}")
    print("\nTo use it in the current shell:")
    print(f'  export HYPHA_TOKEN=$(grep HYPHA_TOKEN {env_path} | cut -d= -f2)')
    print("\nOr load it in Python:")
    print("  from dotenv import load_dotenv; load_dotenv()")
    print("  import os; token = os.environ['HYPHA_TOKEN']")


def main() -> None:
    parser = argparse.ArgumentParser(description="Log in to Hypha and save token to .env")
    parser.add_argument(
        "--env",
        type=Path,
        default=Path(".env"),
        help="Path to .env file (default: ./.env)",
    )
    args = parser.parse_args()
    asyncio.run(login(args.env))


if __name__ == "__main__":
    main()
