#!/usr/bin/env python3
"""
upload_model.py — Upload a validated model package to the BioImage Model Zoo.

Usage:
    export HYPHA_TOKEN=...            # from `python hypha_login.py`
    python upload_model.py <package_dir>
    python upload_model.py <package_dir> --token <hypha_token>

What it does (and deliberately does NOT do):
  1. Loads the package's rdf.yaml as the manifest.
  2. Creates a STAGED artifact under bioimage-io/bioimage.io with status "draft".
     - The packaged rdf.yaml is uploaded verbatim; `status` is an app-level review
       field kept only in the Hypha manifest, never written into the RDF file
       (bioimageio.spec's ModelDescr is a closed schema and rejects unknown
       top-level fields).
     - Reviewers are granted `rw+` on the model FROM CREATION via config.permissions.
       create() writes config straight into the enforced base config while the
       artifact stays staged/versionless, so reviewers can edit the model at every
       review stage without anyone committing (or publishing) it. This is the ONE
       frontend/API-reachable moment to grant enforced perms without publishing:
       a later stage=False edit would mint a version (publish); a staged edit is
       silently unenforced.
  3. Uploads every file in the package.
  4. Does NOT commit and does NOT set status to in-review. The model stays a
     staged draft. Run `submit_for_review.py` when you're ready for curator review.

Prints the artifact id — you need it for submit_for_review.py.
"""
import argparse
import asyncio
import os
import sys
from pathlib import Path

SERVER_URL = "https://hypha.aicell.io"
PARENT_ID = "bioimage-io/bioimage.io"  # the main Zoo collection

# Permission codes that mark a collection member as a model-zoo reviewer.
# (`r` = public read, `@` = a list of specific readers — neither is a reviewer.)
REVIEWER_CODES = {"rw", "rw+", "*"}
REVIEWER_GRANT = "rw+"  # read/write, NOT delete — what each reviewer gets on the model

# File extensions that count as model weights (higher download weight = ranks
# higher in the popularity sort).
WEIGHT_EXTS = (".pt", ".pth", ".onnx", ".h5", ".pb", ".zip")


def build_reviewer_permissions(collection_config: dict) -> dict:
    """Reviewer ids from the collection, each granted rw+ on the new model.

    Never downgrades anyone already at `*` (they're skipped; create() gives the
    uploader `*` automatically). Returns a plain {user_id: code} dict.
    """
    perms: dict[str, str] = {}
    for uid, code in (collection_config.get("permissions") or {}).items():
        # Codes can be non-string (the `@` key maps to a list of reader ids);
        # those are never reviewers. Guard the type before the set membership
        # test (matches roles.ts `typeof code === 'string'`).
        if isinstance(code, str) and code in REVIEWER_CODES and code != "*":
            perms[uid] = REVIEWER_GRANT
    return perms


async def upload_model(package_dir: str, token: str) -> str:
    package = Path(package_dir).resolve()
    rdf_path = package / "rdf.yaml"
    if not rdf_path.exists():
        raise FileNotFoundError(f"rdf.yaml not found in {package}")

    import yaml  # pip install pyyaml
    with open(rdf_path) as f:
        manifest = yaml.safe_load(f)

    name = manifest.get("name", "unnamed-model")
    model_type = manifest.get("type", "model")
    print(f"Uploading: {name} (type={model_type})")

    # alias pattern is type-specific (matches the website's Upload.tsx logic).
    alias_pattern = {
        "model": "{animal_adjective}-{animal}",
        "dataset": "{fruit_adjective}-{fruit}",
        "application": "{object_adjective}-{object}",
    }.get(model_type, "{object_adjective}-{object}")

    import httpx
    from hypha_rpc import connect_to_server

    async with connect_to_server({
        "server_url": SERVER_URL,
        "token": token,
        "method_timeout": 120,
    }) as server:
        am = await server.get_service("public/artifact-manager")

        # Read the collection to resolve the reviewer set for the permission grant.
        collection = await am.read(artifact_id=PARENT_ID)
        reviewer_permissions = build_reviewer_permissions(collection.get("config") or {})

        artifact = await am.create(
            parent_id=PARENT_ID,
            alias=alias_pattern,
            type=model_type,
            manifest={**manifest, "status": "draft"},  # app-level manifest only
            config={"permissions": reviewer_permissions},
            stage=True,           # staged = not publicly visible; awaits curator review
            overwrite=False,
        )
        artifact_id = artifact["id"]
        print(f"Created staged artifact: {artifact_id}")
        print(f"  granted rw+ to {len(reviewer_permissions)} reviewer(s)")

        # Upload every file in the package (skip build junk).
        files = [
            f for f in package.rglob("*")
            if f.is_file() and "__pycache__" not in f.parts
        ]
        async with httpx.AsyncClient(timeout=300) as client:
            for file_path in files:
                rel_path = str(file_path.relative_to(package))
                weight = 1 if rel_path.endswith(WEIGHT_EXTS) else 0
                put_url = await am.put_file(
                    artifact_id=artifact_id,
                    file_path=rel_path,
                    download_weight=weight,
                )
                with open(file_path, "rb") as fobj:
                    resp = await client.put(
                        put_url, content=fobj.read(), headers={"Content-Type": ""}
                    )
                resp.raise_for_status()
                print(f"  uploaded {rel_path}")

        # NO commit: the model stays a staged draft for curator review.
        staging_url = f"https://bioimage.io/#/upload?artifact_id={artifact_id}&stage=true"
        print("\nUpload complete (staged draft, not yet submitted for review).")
        print(f"Artifact ID: {artifact_id}")
        print(f"Preview:     {staging_url}")
        print(f"\nNext: python submit_for_review.py {artifact_id}")
        return artifact_id


def main() -> None:
    parser = argparse.ArgumentParser(description="Upload a model package to the BioImage Model Zoo.")
    parser.add_argument("package_dir", help="Path to the validated model package directory")
    parser.add_argument(
        "--token",
        default=os.environ.get("HYPHA_TOKEN"),
        help="Hypha token (default: $HYPHA_TOKEN). Get one with hypha_login.py.",
    )
    args = parser.parse_args()
    if not args.token:
        print("No Hypha token. Set $HYPHA_TOKEN (run hypha_login.py) or pass --token.", file=sys.stderr)
        sys.exit(1)
    asyncio.run(upload_model(args.package_dir, args.token))


if __name__ == "__main__":
    main()
