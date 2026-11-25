import type { RemoteImageSource, TrainingUrlEntry } from '../components/colab/brokerApi';
import { trainingImageRef } from '../components/colab/brokerApi';

/**
 * Build the `start_training` arguments for the images a run will train on.
 *
 * Extracted from Finetune.tsx because the defect this guards lives in the CALL
 * CONSTRUCTION, not in the helper it uses. A review proved the difference by
 * measurement: with the mapping inside the component, reverting both call sites
 * to `e.image_url` left the whole suite green, 112 of 112, because the tests
 * only exercised the helper. A test can only catch this if it runs the code
 * that builds the arrays.
 *
 * Two invariants it exists to hold:
 *
 *  - Each image is passed as whatever the broker sent for it, a url string for
 *    a materialised image or the source object for a remote one. Reading
 *    `image_url` unconditionally put `undefined` in the array for a region row,
 *    silently.
 *  - `train_images` and `train_labels` are paired POSITIONALLY by the backend,
 *    so order is part of the contract. A reordering would train each image
 *    against another image's labels and nothing would report it.
 */

export interface TrainingUrlsLike {
  train: TrainingUrlEntry[];
  test: TrainingUrlEntry[];
}

export type ImageRef = string | RemoteImageSource;

export interface StartTrainingImages {
  train_images: ImageRef[];
  train_labels: string[];
  val_images?: ImageRef[];
  val_labels?: string[];
}

/** How many entries carry neither a url nor a source, i.e. are out of contract. */
export function unresolvableCount(urls: TrainingUrlsLike): number {
  return [...urls.train, ...urls.test].filter((e) => trainingImageRef(e) === undefined).length;
}

/**
 * Throws when any entry is unresolvable, so a caller cannot build a call with a
 * hole in it by ignoring a return value.
 */
export function buildStartTrainingImages(urls: TrainingUrlsLike): StartTrainingImages {
  const bad = unresolvableCount(urls);
  if (bad > 0) {
    throw new Error(`${bad} training image(s) carry neither image_url nor image_source`);
  }
  const out: StartTrainingImages = {
    train_images: urls.train.map((e) => trainingImageRef(e) as ImageRef),
    train_labels: urls.train.map((e) => e.geojson_url),
  };
  if (urls.test.length > 0) {
    out.val_images = urls.test.map((e) => trainingImageRef(e) as ImageRef);
    out.val_labels = urls.test.map((e) => e.geojson_url);
  }
  return out;
}
