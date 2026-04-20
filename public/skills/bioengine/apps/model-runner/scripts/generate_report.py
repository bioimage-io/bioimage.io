"""
Generate a self-contained HTML model comparison report.

Usage (auto-discover all illustrations in output directory):
    python scripts/generate_report.py --output-dir comparison_results/

Usage (explicit files):
    python scripts/generate_report.py \
        --summary comparison_results/comparison_summary.json \
        --output-dir comparison_results/
"""
import argparse
import base64
import json
import math
from pathlib import Path
from typing import Dict, List, Optional


def generate_html_report(
    output_dir: Path,
    summary: Dict,
    figure_images: Dict[str, Dict[str, bytes]],
) -> Path:
    """Generate a self-contained single HTML report with summary, figures, and metric table."""
    report_path = output_dir / "model_comparison_report.html"

    task_description = summary.get("task", "Unknown Task")
    dataset = summary.get("dataset", "")
    keywords = summary.get("keywords", [])
    metrics = summary.get("metrics", {})
    model_errors = summary.get("failed_models", {})
    excluded = summary.get("excluded", {})
    candidates = summary.get("candidates", [])
    notes = summary.get("notes", {})
    ranking = summary.get("ranking", [])
    eval_method = summary.get("evaluation_method", "")

    candidate_ids = candidates if isinstance(candidates, list) else list(candidates)
    successful_ids = [m for m in candidate_ids if m not in model_errors]

    best_model_raw = summary.get("best_model", {})
    if isinstance(best_model_raw, str):
        best_model_id = best_model_raw
        best_model_metrics = metrics.get(best_model_id, {})
    else:
        best_model_id = best_model_raw.get("id", "N/A")
        best_model_metrics = best_model_raw.get("metrics", {})

    # Sort by f1 descending, fall back to iou
    def sort_key(item):
        v = item[1]
        if not isinstance(v, dict):
            return float("-inf")
        return v.get("f1", v.get("iou", float("-inf")))

    sorted_metrics = sorted(metrics.items(), key=sort_key, reverse=True)

    def format_metric(value, decimals: int = 4) -> str:
        if value is None:
            return "N/A"
        if isinstance(value, (int, float)):
            if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
                return "inf" if value > 0 else "-inf"
            return f"{value:.{decimals}f}"
        return str(value)

    # Identify available metric keys — prioritise f1, mean_iou, then others
    if sorted_metrics and isinstance(sorted_metrics[0][1], dict):
        all_metric_keys = list(sorted_metrics[0][1].keys())
    else:
        all_metric_keys = ["f1", "mean_iou"]

    prioritized_keys = [k for k in ["f1", "mean_iou", "iou", "dice", "psnr"] if k in all_metric_keys]
    count_keys = [k for k in ["tp", "fp", "fn", "n_pred", "n_gt"] if k in all_metric_keys]
    other_keys = [k for k in all_metric_keys if k not in prioritized_keys and k not in count_keys]
    display_keys = prioritized_keys + other_keys + count_keys

    metric_rows = []
    for rank, (model_id, vals) in enumerate(sorted_metrics, start=1):
        highlight = ' class="bg-blue-50"' if model_id == best_model_id else ""
        row_html = f"""
            <tr class="border-b border-gray-200 hover:bg-gray-50"{highlight}>
                <td class="px-4 py-3 text-sm text-gray-900">{rank}</td>
                <td class="px-4 py-3 text-sm font-medium text-gray-900">{model_id}{"&nbsp;★" if model_id == best_model_id else ""}</td>
        """
        for k in display_keys:
            val = vals.get(k) if isinstance(vals, dict) else None
            row_html += f'<td class="px-4 py-3 text-sm text-gray-800 text-right">{format_metric(val, 4)}</td>'
        row_html += "</tr>"
        metric_rows.append(row_html)

    header_html = """
        <tr>
            <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-700">Rank</th>
            <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-700">Model ID</th>
    """
    for k in display_keys:
        header_html += f'<th class="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-700">{k.replace("_", " ").upper()}</th>'
    header_html += "</tr>"

    excluded_rows = []
    for model_id, reason in excluded.items():
        excluded_rows.append(f"""
            <tr class="border-b border-gray-200">
                <td class="px-4 py-3 text-sm font-medium text-gray-900">{model_id}</td>
                <td class="px-4 py-3 text-sm text-gray-700">{reason[:300]}</td>
            </tr>
        """)

    failed_rows = []
    for model_id, error_msg in model_errors.items():
        failed_rows.append(f"""
            <tr class="border-b border-gray-200">
                <td class="px-4 py-3 text-sm font-medium text-gray-900">{model_id}</td>
                <td class="px-4 py-3 text-sm text-gray-700">{str(error_msg)[:300]}</td>
            </tr>
        """)

    notes_rows = []
    for model_id, note in notes.items():
        notes_rows.append(f"""
            <tr class="border-b border-gray-200">
                <td class="px-4 py-3 text-sm font-medium text-gray-900">{model_id}</td>
                <td class="px-4 py-3 text-sm text-gray-700">{note}</td>
            </tr>
        """)

    figures_html = []
    for title, image_info in figure_images.items():
        filename = image_info["filename"]
        image_bytes = image_info["bytes"]
        ext = filename.lower().split(".")[-1]
        mime_type = "image/svg+xml" if ext == "svg" else "image/png"
        image_src = f"data:{mime_type};base64,{base64.b64encode(image_bytes).decode('ascii')}"
        figures_html.append(f"""
            <div class="mb-8 last:mb-0">
                <div class="flex items-center justify-between gap-3 mb-3">
                    <h3 class="text-base font-semibold text-gray-900">{title}</h3>
                    <button class="save-figure-btn px-3 py-1.5 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700"
                            data-filename="{filename}" data-src="{image_src}">
                        Export
                    </button>
                </div>
                <img src="{image_src}" alt="{title}" class="w-full rounded-lg border border-gray-200 shadow-sm" />
            </div>
        """)

    summary_json = json.dumps(summary, indent=2, default=str)
    gt_n = summary.get("ground_truth_n_cells", "N/A")

    html = f"""<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>BioImage.IO Model Comparison Report</title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50 text-gray-900">
    <main class="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">

        <header class="mb-8">
            <h1 class="text-3xl font-bold tracking-tight">BioImage.IO Model Comparison Report</h1>
            <p class="text-sm text-gray-500 mt-1">Generated by BioEngine model-runner skill</p>
        </header>

        <!-- Task summary -->
        <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
            <h2 class="text-xl font-semibold mb-4">Task Summary</h2>
            <dl class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="rounded-lg bg-gray-50 p-4 border border-gray-200">
                    <dt class="text-xs uppercase tracking-wide text-gray-500">Task</dt>
                    <dd class="mt-1 text-sm font-medium">{task_description}</dd>
                </div>
                <div class="rounded-lg bg-gray-50 p-4 border border-gray-200">
                    <dt class="text-xs uppercase tracking-wide text-gray-500">Dataset</dt>
                    <dd class="mt-1 text-sm font-medium">{dataset or "N/A"}</dd>
                </div>
                <div class="rounded-lg bg-gray-50 p-4 border border-gray-200">
                    <dt class="text-xs uppercase tracking-wide text-gray-500">Keywords</dt>
                    <dd class="mt-1 text-sm font-medium">{", ".join(keywords) if keywords else "N/A"}</dd>
                </div>
                <div class="rounded-lg bg-gray-50 p-4 border border-gray-200">
                    <dt class="text-xs uppercase tracking-wide text-gray-500">Ground truth cells</dt>
                    <dd class="mt-1 text-sm font-medium">{gt_n}</dd>
                </div>
                <div class="rounded-lg bg-gray-50 p-4 border border-gray-200">
                    <dt class="text-xs uppercase tracking-wide text-gray-500">Models screened / best</dt>
                    <dd class="mt-1 text-sm font-medium">{len(successful_ids)} screened &mdash; best: <strong>{best_model_id}</strong></dd>
                </div>
                <div class="rounded-lg bg-gray-50 p-4 border border-gray-200">
                    <dt class="text-xs uppercase tracking-wide text-gray-500">Evaluation method</dt>
                    <dd class="mt-1 text-sm font-medium">{eval_method or "N/A"}</dd>
                </div>
            </dl>
        </section>

        <!-- Figures -->
        <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
            <h2 class="text-xl font-semibold mb-6">Illustrations</h2>
            {"".join(figures_html) if figures_html else "<p class='text-sm text-gray-600'>No figures found.</p>"}
        </section>

        <!-- Metrics table -->
        <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
            <h2 class="text-xl font-semibold mb-4">Metrics</h2>
            <div class="overflow-x-auto">
                <table class="min-w-full border border-gray-200 rounded-lg overflow-hidden">
                    <thead class="bg-gray-100">{header_html}</thead>
                    <tbody>
                        {"".join(metric_rows) if metric_rows else '<tr><td colspan="10" class="px-4 py-3 text-sm text-gray-600">No metrics available.</td></tr>'}
                    </tbody>
                </table>
            </div>
        </section>

        <!-- Notes -->
        {"" if not notes_rows else f'''
        <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
            <h2 class="text-xl font-semibold mb-4">Model Notes</h2>
            <div class="overflow-x-auto">
                <table class="min-w-full border border-gray-200 rounded-lg overflow-hidden">
                    <thead class="bg-gray-100">
                        <tr>
                            <th class="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-700">Model</th>
                            <th class="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-700">Note</th>
                        </tr>
                    </thead>
                    <tbody>{"".join(notes_rows)}</tbody>
                </table>
            </div>
        </section>
        '''}

        <!-- Excluded / failed -->
        {"" if not excluded_rows else f'''
        <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
            <h2 class="text-xl font-semibold mb-4">Excluded Models (pre-inference)</h2>
            <div class="overflow-x-auto">
                <table class="min-w-full border border-gray-200 rounded-lg overflow-hidden">
                    <thead class="bg-gray-100">
                        <tr>
                            <th class="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-700">Model</th>
                            <th class="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-700">Reason</th>
                        </tr>
                    </thead>
                    <tbody>{"".join(excluded_rows)}</tbody>
                </table>
            </div>
        </section>
        '''}

        {"" if not failed_rows else f'''
        <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
            <h2 class="text-xl font-semibold mb-4">Failed Models (inference error)</h2>
            <div class="overflow-x-auto">
                <table class="min-w-full border border-gray-200 rounded-lg overflow-hidden">
                    <thead class="bg-gray-100">
                        <tr>
                            <th class="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-700">Model</th>
                            <th class="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-700">Error</th>
                        </tr>
                    </thead>
                    <tbody>{"".join(failed_rows)}</tbody>
                </table>
            </div>
        </section>
        '''}

        <!-- Raw JSON -->
        <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h2 class="text-xl font-semibold mb-4">Raw Summary JSON</h2>
            <pre class="text-xs bg-gray-50 p-4 rounded-lg overflow-x-auto border border-gray-200 leading-5">{summary_json}</pre>
        </section>

    </main>

    <script>
        document.querySelectorAll(".save-figure-btn").forEach((btn) => {{
            btn.addEventListener("click", () => {{
                const a = document.createElement("a");
                a.href = btn.dataset.src;
                a.download = btn.dataset.filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            }});
        }});
    </script>
</body>
</html>
"""

    report_path.write_text(html, encoding="utf-8")
    print(f"  HTML report saved: {report_path}")
    return report_path


def main():
    parser = argparse.ArgumentParser(description="Generate BioImage.IO Model Comparison Report")
    parser.add_argument("--summary", help="Path to comparison_summary.json")
    parser.add_argument(
        "--output-dir", default="./comparison_results", help="Output directory (also used for auto-discovery)"
    )
    # Legacy args kept for backwards compatibility
    parser.add_argument("--montage", help="(legacy) montage image path")
    parser.add_argument("--barplot", help="(legacy) barplot image path (comma-separated)")
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Resolve summary
    summary_path = Path(args.summary) if args.summary else output_dir / "comparison_summary.json"
    if not summary_path.exists():
        print(f"ERROR: summary file not found: {summary_path}")
        return
    with open(summary_path) as f:
        summary = json.load(f)

    # Auto-discover illustrations in order, then legacy files
    figure_images = {}
    illustration_order = [
        ("illustration1_barplot.png",  "Illustration 1 — Ranked metric barplot"),
        ("illustration2_montage.png",  "Illustration 2 — Input / predictions montage"),
        ("illustration3_counts.png",   "Illustration 3 — Object count comparison"),
        # legacy names
        ("model_comparison_barplot.png",  "Model comparison barplot"),
        ("model_comparison_montage.png",  "Model output montage"),
        ("model_comparison_barplot.svg",  "Model comparison barplot (SVG)"),
        ("model_comparison_montage.svg",  "Model output montage (SVG)"),
    ]
    for fname, title in illustration_order:
        candidate = output_dir / fname
        if candidate.exists():
            with open(candidate, "rb") as f:
                figure_images[title] = {"filename": fname, "bytes": f.read()}

    # Legacy explicit args
    if args.montage:
        p = Path(args.montage)
        if p.exists() and p.name not in {v["filename"] for v in figure_images.values()}:
            name = p.stem.replace("_", " ").title()
            with open(p, "rb") as f:
                figure_images[name] = {"filename": p.name, "bytes": f.read()}
    if args.barplot:
        for bp in args.barplot.split(","):
            p = Path(bp.strip())
            if p.exists() and p.name not in {v["filename"] for v in figure_images.values()}:
                name = p.stem.replace("_", " ").title()
                with open(p, "rb") as f:
                    figure_images[name] = {"filename": p.name, "bytes": f.read()}

    if not figure_images:
        print("WARNING: no illustration files found in output directory.")

    generate_html_report(output_dir, summary, figure_images)


if __name__ == "__main__":
    main()
