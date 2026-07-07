#!/usr/bin/env python3
"""
Compute SHA256 hashes for every file in a model package directory.

Usage:
    python compute_sha256.py <directory>
    python compute_sha256.py model_package/generated/

Output is a `relative_path: sha256` line per file discovered under the
target directory. It is a *superset*, not a package inventory: this
script has no way of knowing what your rdf.yaml references. Copy only
the hashes for files that appear in rdf.yaml (weights, test tensors,
architecture, cover, custom license, custom processing sources) and
ignore any stray hashes for files that shouldn't be in the package in
the first place — see SKILL.md Phase 2's Keep / Drop list.
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

    print("# SHA256 hashes — paste into rdf.yaml")
    print("# (Copy only the lines for files rdf.yaml references; ignore the rest.)\n")
    for p in paths:
        rel = p.relative_to(base)
        digest = sha256_file(p)
        print(f"{rel}: {digest}")


if __name__ == "__main__":
    main()
