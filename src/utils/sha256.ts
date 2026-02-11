/**
 * SHA256 calculation utilities for file integrity verification
 */

import { createSHA256 } from 'hash-wasm';

// Threshold for using chunked hashing (10MB)
const CHUNKED_HASH_THRESHOLD = 10 * 1024 * 1024;
// Chunk size for reading large files (8MB)
const CHUNK_SIZE = 8 * 1024 * 1024;

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
 * Calculate SHA256 hash from a File object using chunked reading for large files
 * This avoids loading the entire file into memory at once
 * @param file - File object to hash
 * @param onProgress - Optional progress callback (0-100)
 * @returns Promise resolving to hex string of SHA256 hash
 */
export async function calculateFileSHA256(
  file: File,
  onProgress?: (progress: number) => void
): Promise<string> {
  // For small files, use the simple approach
  if (file.size < CHUNKED_HASH_THRESHOLD) {
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
  
  // For large files, use chunked hashing with hash-wasm
  return calculateFileSHA256Chunked(file, onProgress);
}

/**
 * Calculate SHA256 hash from a File object using chunked reading
 * Uses hash-wasm for incremental hashing to avoid memory issues with large files
 * @param file - File object to hash
 * @param onProgress - Optional progress callback (0-100)
 * @returns Promise resolving to hex string of SHA256 hash
 */
export async function calculateFileSHA256Chunked(
  file: File,
  onProgress?: (progress: number) => void
): Promise<string> {
  // Create incremental hasher
  const hasher = await createSHA256();
  hasher.init();
  
  const totalSize = file.size;
  let processedSize = 0;
  
  // Process file in chunks
  let offset = 0;
  while (offset < totalSize) {
    const chunkEnd = Math.min(offset + CHUNK_SIZE, totalSize);
    const chunk = file.slice(offset, chunkEnd);
    
    // Read the chunk as ArrayBuffer
    const buffer = await chunk.arrayBuffer();
    
    // Update the hash with this chunk
    hasher.update(new Uint8Array(buffer));
    
    processedSize = chunkEnd;
    offset = chunkEnd;
    
    // Report progress
    if (onProgress) {
      onProgress((processedSize / totalSize) * 100);
    }
  }
  
  // Finalize and return the hash
  return hasher.digest('hex');
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
