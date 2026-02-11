
import yaml from 'js-yaml';

// Helper to normalize paths (remove ./ prefix)
const normalizePath = (path: string): string => {
  if (path.startsWith('./')) {
    return path.substring(2);
  }
  return path;
};

interface RdfUpdateResult {
  updated: boolean;
  newRdfContent: string;
  count: number;
}

/**
 * Updates SHA256 values in the RDF content for a specific file.
 * Logic for Case 1 (Upload) and Case 2 (Edit).
 * 
 * @param rdfContent The string content of rdf.yaml
 * @param fileName The name of the file being updated (relative path)
 * @param newSha256 The new SHA256 calculation
 * @returns Object containing updated status, new content, and old SHA if found
 */
export function updateRdfFileReference(
  rdfContent: string,
  fileName: string,
  newSha256: string
): { updated: boolean; newRdfContent: string; oldSha256?: string; found: boolean } {
  try {
    const manifest = yaml.load(rdfContent) as any;
    if (!manifest || typeof manifest !== 'object') {
      return { updated: false, newRdfContent: rdfContent, found: false };
    }

    let found = false;
    let updated = false;
    let oldSha256: string | undefined = undefined;

    const normalizedFileName = normalizePath(fileName);

    // Recursive search and update
    const traverse = (obj: any) => {
      if (!obj || typeof obj !== 'object') return;

      if (Array.isArray(obj)) {
        obj.forEach(traverse);
        return;
      }

      // Check if this object looks like a file reference with source
      if ('source' in obj && typeof obj.source === 'string') {
        const sourcePath = normalizePath(obj.source);
        if (sourcePath === normalizedFileName) {
          found = true;
          if (obj.sha256 !== newSha256) {
            oldSha256 = obj.sha256;
            obj.sha256 = newSha256;
            updated = true;
          }
        }
      }

      // Recursively check all properties
      Object.keys(obj).forEach(key => {
        // Skip primitives
        if (typeof obj[key] === 'object') {
          traverse(obj[key]);
        }
      });
    };

    traverse(manifest);

    if (updated) {
      // Dump back to YAML string
      // Note: This will reformat the YAML. 
      const newContent = yaml.dump(manifest);
      return { updated: true, newRdfContent: newContent, oldSha256, found };
    }

    return { updated: false, newRdfContent: rdfContent, oldSha256, found };

  } catch (e) {
    console.error('Failed to parse or update RDF', e);
    return { updated: false, newRdfContent: rdfContent, found: false };
  }
}

/**
 * Synchronizes all file SHA256 values in the RDF content against a trusted map of file hashes.
 * Logic for Case 3 (Edit rdf.yaml).
 * 
 * @param rdfContent The string content of rdf.yaml
 * @param fileShaMap A map of filename -> sha256 (trusted source)
 * @returns Object with result and count of updates
 */
export function synchronizeRdfSha256(
  rdfContent: string,
  fileShaMap: Record<string, string>
): RdfUpdateResult {
  try {
    const manifest = yaml.load(rdfContent) as any;
    if (!manifest || typeof manifest !== 'object') {
      return { updated: false, newRdfContent: rdfContent, count: 0 };
    }

    let updateCount = 0;

    const traverse = (obj: any) => {
      if (!obj || typeof obj !== 'object') return;

      if (Array.isArray(obj)) {
        obj.forEach(traverse);
        return;
      }

      if ('source' in obj && typeof obj.source === 'string') {
        const sourcePath = normalizePath(obj.source);
        const trustedSha = fileShaMap[sourcePath];
        
        if (trustedSha) {
          if (obj.sha256 !== trustedSha) {
            obj.sha256 = trustedSha;
            updateCount++;
          }
        }
      }

      Object.keys(obj).forEach(key => {
        if (typeof obj[key] === 'object') {
          traverse(obj[key]);
        }
      });
    };

    traverse(manifest);

    if (updateCount > 0) {
      const newContent = yaml.dump(manifest);
      return { updated: true, newRdfContent: newContent, count: updateCount };
    }

    return { updated: false, newRdfContent: rdfContent, count: 0 };

  } catch (e) {
    console.error('Failed to synchronize RDF', e);
    return { updated: false, newRdfContent: rdfContent, count: 0 };
  }
}

/**
 * Recursively updates SHA256 values in a manifest object.
 * 
 * @param manifest The manifest object to update
 * @param fileShaMap A map of filename -> sha256
 * @param dryRun If true, do not modify the manifest, only return potential updates
 * @returns Object with updated status and count
 */
export function updateManifestSha256(
  manifest: any,
  fileShaMap: Record<string, string>,
  dryRun: boolean = false
): { updated: boolean; count: number; updatedPaths: string[] } {
  let count = 0;
  let updated = false;
  const updatedPaths: string[] = [];

  const traverse = (obj: any) => {
    if (!obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      obj.forEach(traverse);
      return;
    }

    if ('source' in obj && typeof obj.source === 'string') {
      const sourcePath = normalizePath(obj.source);
      const trustedSha = fileShaMap[sourcePath];
      
      if (trustedSha) {
        if (obj.sha256 !== trustedSha) {
          if (!dryRun) {
            obj.sha256 = trustedSha;
          }
          updated = true;
          count++;
          updatedPaths.push(sourcePath);
        }
      }
    }

    Object.keys(obj).forEach(key => {
      // Skip primitives
      if (typeof obj[key] === 'object') {
        traverse(obj[key]);
      }
    });
  };

  traverse(manifest);
  return { updated, count, updatedPaths };
}

/**
 * Updates SHA256 for a single source file in the manifest object.
 * 
 * @param manifest The manifest object
 * @param fileName The file name
 * @param sha256 The new SHA256
 * @returns Object indicating if update happened
 */
export function updateManifestFileSha256(
    manifest: any,
    fileName: string,
    sha256: string
): { updated: boolean } {
    let updated = false;
    const normalizedFileName = normalizePath(fileName);

    const traverse = (obj: any) => {
        if (!obj || typeof obj !== 'object') return;

        if (Array.isArray(obj)) {
            obj.forEach(traverse);
            return;
        }

        if ('source' in obj && typeof obj.source === 'string') {
            const sourcePath = normalizePath(obj.source);
            if (sourcePath === normalizedFileName) {
                if (obj.sha256 !== sha256) {
                    obj.sha256 = sha256;
                    updated = true;
                }
            }
        }

        Object.keys(obj).forEach(key => {
            if (typeof obj[key] === 'object') {
                traverse(obj[key]);
            }
        });
    };

    traverse(manifest);
    return { updated };
}
