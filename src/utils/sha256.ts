/**
 * SHA256 calculation utilities for file integrity verification
 */

/**
 * Calculate SHA256 hash from string or ArrayBuffer
 * @param data - String or ArrayBuffer to hash
 * @returns Promise resolving to hex string of SHA256 hash
 */
export async function calculateSHA256(data: string | ArrayBuffer): Promise<string> {
  let buffer: ArrayBuffer;
  
  if (typeof data === 'string') {
    // Convert string to ArrayBuffer
    const encoder = new TextEncoder();
    buffer = encoder.encode(data).buffer;
  } else {
    buffer = data;
  }
  
  // Calculate SHA256 using Web Crypto API
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  
  // Convert ArrayBuffer to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  return hashHex;
}

/**
 * Calculate SHA256 hash from a File object
 * @param file - File object to hash
 * @param onProgress - Optional progress callback
 * @returns Promise resolving to hex string of SHA256 hash
 */
export async function calculateFileSHA256(
  file: File,
  onProgress?: (progress: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onprogress = (e) => {
      if (onProgress && e.lengthComputable) {
        onProgress((e.loaded / e.total) * 100);
      }
    };
    
    reader.onload = async (e) => {
      try {
        if (!e.target?.result) {
          reject(new Error('Failed to read file'));
          return;
        }
        const hash = await calculateSHA256(e.target.result as ArrayBuffer);
        resolve(hash);
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

interface FileNode {
  file?: File;
  path: string;
  [key: string]: any;
}

/**
 * Calculate SHA256 hashes for an array of FileNode objects
 * @param files - Array of FileNode objects with File data
 * @param onProgress - Optional progress callback
 * @returns Promise resolving to Map of file paths to SHA256 hashes
 */
export async function calculateFileHashes(
  files: FileNode[],
  onProgress?: (current: number, total: number) => void
): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  
  for (let i = 0; i < files.length; i++) {
    const fileNode = files[i];
    if (fileNode.file) {
      try {
        const hash = await calculateFileSHA256(fileNode.file);
        hashes.set(fileNode.path, hash);
        
        if (onProgress) {
          onProgress(i + 1, files.length);
        }
      } catch (error) {
        console.error(`Failed to calculate hash for ${fileNode.path}:`, error);
      }
    }
  }
  
  return hashes;
}
