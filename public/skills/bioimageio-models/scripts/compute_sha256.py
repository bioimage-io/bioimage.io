#!/usr/bin/env python3
"""
Compute SHA256 hashes for all files in a model package directory.

Usage:
    python compute_sha256.py <directory>
    python compute_sha256.py model_package/

Outputs a mapping of relative_path -> sha256 hash, ready to paste into rdf.yaml
"""
import hashlib
import sys
from pathlib import Path


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    if len(sys.argv) < 2:
        print("Usage: python compute_sha256.py <directory_or_file>")
        sys.exit(1)

    target = Path(sys.argv[1])

    if target.is_file():
        paths = [target]
        base = target.parent
    elif target.is_dir():
        paths = sorted(
            p for p in target.rglob("*")
            if p.is_file()
            and "__pycache__" not in p.parts
            and p.suffix not in (".pyc", ".pyo")
        )
        base = target
    else:
        print(f"Error: {target} does not exist")
        sys.exit(1)

    print("# SHA256 hashes — paste into rdf.yaml\n")
    for p in paths:
        rel = p.relative_to(base)
        digest = sha256_file(p)
        print(f"{rel}: {digest}")


if __name__ == "__main__":
    main()
