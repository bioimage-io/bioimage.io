import numpy as np
import requests
import yaml
import json
import io

HTTP_BASE = "https://hypha.aicell.io/bioimage-io/services/model-runner"


def infer_http(model_id, image_array):
    """
    Run inference via HTTP for a numpy array. Uploads, infers, downloads result.
    Returns the first output as a numpy array.
    """
    # 1. Get upload URL
    res = requests.get(f"{HTTP_BASE}/get_upload_url?file_type=.npy")
    res.raise_for_status()
    upload_info = res.json()
    upload_url = upload_info["upload_url"]
    file_path = upload_info["file_path"]

    # 2. Upload array
    buffer = io.BytesIO()
    np.save(buffer, image_array.astype(np.float32))
    buffer.seek(0)
    upload_res = requests.put(upload_url, data=buffer.getvalue())
    upload_res.raise_for_status()

    # 3. Infer
    payload = {
        "model_id": model_id,
        "inputs": file_path,
        "return_download_url": True,
    }
    infer_res = requests.post(f"{HTTP_BASE}/infer", json=payload)
    if infer_res.status_code != 200:
        raise Exception(f"Inference failed: {infer_res.text}")

    out_dict = infer_res.json()

    # 4. Download first output
    out_url = list(out_dict.values())[0]
    out_res = requests.get(out_url)
    out_res.raise_for_status()

    out_buffer = io.BytesIO(out_res.content)
    return np.load(out_buffer)


def infer_with_retry(model_id, image_array, max_retries=3, retry_delay=15):
    """
    Run inference with automatic retry on GPU OOM errors.

    OOM surfaces as RuntimeError / torch.OutOfMemoryError re-raised from a Ray
    worker, often with the message "Failed to unpickle serialized exception".
    These are transient — the GPU frees memory once the previous job finishes.

    Args:
        model_id:     BioImage.IO model slug
        image_array:  numpy array in the correct input shape for the model
        max_retries:  number of attempts before giving up (default 3)
        retry_delay:  base wait in seconds; back-off is linear: delay, 2*delay, 3*delay

    Returns:
        numpy array — first output of the model

    Raises:
        The last exception if all retries are exhausted, or immediately on
        non-OOM errors.
    """
    import time

    OOM_KEYWORDS = ["outofmemory", "out of memory", "cuda out", "unpickle serialized"]

    for attempt in range(max_retries):
        try:
            return infer_http(model_id, image_array)
        except Exception as e:
            err = str(e).lower()
            is_oom = any(kw in err for kw in OOM_KEYWORDS)
            if is_oom and attempt < max_retries - 1:
                wait = retry_delay * (attempt + 1)
                print(f"  OOM on '{model_id}' (attempt {attempt + 1}/{max_retries}), "
                      f"retrying in {wait}s…")
                time.sleep(wait)
            else:
                raise


def get_model_rdf(model_id):
    """Fetch the RDF yaml for a given model ID."""
    url = f"https://hypha.aicell.io/bioimage-io/artifacts/{model_id}/files/rdf.yaml"
    res = requests.get(url)
    if res.status_code == 200:
        return yaml.safe_load(res.text)
    raise Exception(f"Failed to fetch RDF for {model_id}, status: {res.status_code}")


def get_input_axes_info(rdf):
    """Parse RDF to get input axis string. Returns (axes_str, version_str)."""
    version = rdf.get("format_version", "0.4.")
    inputs = rdf.get("inputs", [])
    if not inputs:
        return None, version

    inp = inputs[0]
    axes = inp.get("axes")
    if version.startswith("0.4"):
        # axes is a string like "bcyx"
        return axes, "0.4"
    else:
        # axes is a list of dicts
        axes_str = ""
        for ax in axes:
            t = ax.get("type", "")
            if t == "batch":
                axes_str += "b"
            elif t == "channel":
                axes_str += "c"
            elif t == "space":
                axes_str += ax.get("id", "")
        return axes_str, "0.5"


def pad_or_crop_to_valid_size(img_array, axes_str, rdf_input):
    """Pad or crop height and width to meet min and step requirements for 0.5.x."""
    version = rdf_input.get("format_version", "0.4.")
    if version.startswith("0.4"):
        return img_array
    return img_array


def prepare_image_for_model(img, axes_str):
    """
    Given an input image (assumed HxW or HxWxC), format it to match axes_str (e.g. 'bcyx').
    """
    img = img.astype(np.float32)

    if img.ndim == 2:
        if "b" in axes_str and "c" in axes_str:
            return img[np.newaxis, np.newaxis, ...]
        elif "b" in axes_str:
            return img[np.newaxis, ...]
        elif "c" in axes_str:
            return img[np.newaxis, ...]

    if img.ndim == 3:
        if img.shape[2] <= 3:  # HWC → CHW
            img = np.transpose(img, (2, 0, 1))
        if axes_str == "bcyx":
            return img[np.newaxis, ...]

    return img


def normalize_image(img, pmin=1.0, pmax=99.8):
    """Percentile-based normalization commonly used in fluorescence."""
    perc_min, perc_max = np.percentile(img, (pmin, pmax))
    img_norm = (img - perc_min) / (perc_max - perc_min + 1e-6)
    return np.clip(img_norm, 0, 1).astype(np.float32)


def compute_instance_f1(pred_labels, gt_labels, iou_threshold=0.5):
    """
    Compute instance-level F1 score at a given IoU threshold.

    Uses greedy bipartite matching (Hungarian-style):
    for each GT instance, find the best-overlapping predicted instance;
    count as TP if IoU >= iou_threshold.

    Args:
        pred_labels: 2D integer array, 0 = background, 1..N = instance IDs
        gt_labels:   2D integer array, 0 = background, 1..M = instance IDs
        iou_threshold: minimum IoU to count as a match (default 0.5)

    Returns:
        dict with keys: f1, precision, recall, tp, fp, fn, mean_iou, n_pred, n_gt
    """
    pred_ids = np.unique(pred_labels)
    pred_ids = pred_ids[pred_ids > 0]
    gt_ids = np.unique(gt_labels)
    gt_ids = gt_ids[gt_ids > 0]

    n_pred = len(pred_ids)
    n_gt = len(gt_ids)

    if n_gt == 0 and n_pred == 0:
        return {"f1": 1.0, "precision": 1.0, "recall": 1.0, "tp": 0, "fp": 0, "fn": 0,
                "mean_iou": 1.0, "n_pred": 0, "n_gt": 0}
    if n_gt == 0:
        return {"f1": 0.0, "precision": 0.0, "recall": 1.0, "tp": 0, "fp": n_pred, "fn": 0,
                "mean_iou": 0.0, "n_pred": n_pred, "n_gt": 0}
    if n_pred == 0:
        return {"f1": 0.0, "precision": 1.0, "recall": 0.0, "tp": 0, "fp": 0, "fn": n_gt,
                "mean_iou": 0.0, "n_pred": 0, "n_gt": n_gt}

    # Build IoU matrix: rows = GT, cols = pred
    iou_matrix = np.zeros((n_gt, n_pred), dtype=np.float32)
    for i, gid in enumerate(gt_ids):
        gt_mask = gt_labels == gid
        for j, pid in enumerate(pred_ids):
            pred_mask = pred_labels == pid
            intersection = np.logical_and(gt_mask, pred_mask).sum()
            if intersection == 0:
                continue
            union = np.logical_or(gt_mask, pred_mask).sum()
            iou_matrix[i, j] = intersection / union

    # Greedy matching: assign each GT to its best-overlapping prediction
    matched_pred = set()
    tp = 0
    matched_ious = []
    for i in range(n_gt):
        best_j = np.argmax(iou_matrix[i])
        best_iou = iou_matrix[i, best_j]
        if best_iou >= iou_threshold and best_j not in matched_pred:
            tp += 1
            matched_pred.add(best_j)
            matched_ious.append(best_iou)

    fp = n_pred - tp
    fn = n_gt - tp
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0
    mean_iou = float(np.mean(matched_ious)) if matched_ious else 0.0

    return {
        "f1": round(float(f1), 4),
        "precision": round(float(precision), 4),
        "recall": round(float(recall), 4),
        "tp": int(tp),
        "fp": int(fp),
        "fn": int(fn),
        "mean_iou": round(mean_iou, 4),
        "n_pred": int(n_pred),
        "n_gt": int(n_gt),
    }


def evaluate_segmentation(pred, gt):
    """
    Semantic (pixel-level) segmentation evaluation.
    Returns binary IoU and Dice.

    NOTE: For instance segmentation tasks (cell/nucleus counting), use
    compute_instance_f1(pred_labels, gt_labels) instead — this function
    computes pixel-level binary overlap which is misleading for object counting.
    """
    p_bin = (pred > 0).astype(bool) if pred.dtype != bool else pred
    g_bin = (gt > 0).astype(bool) if gt.dtype != bool else gt

    intersection = np.logical_and(p_bin, g_bin).sum()
    union = np.logical_or(p_bin, g_bin).sum()

    iou = float(intersection / union) if union > 0 else 0.0
    dice = float(2 * intersection / (p_bin.sum() + g_bin.sum())) if (p_bin.sum() + g_bin.sum()) > 0 else 0.0

    return {"semantic_iou": iou, "dice": dice}
