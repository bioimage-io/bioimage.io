/**
 * Resolves a relative URL to a full Hypha artifact URL
 * @param path - The relative path to resolve
 * @param resourceId - The resource ID
 * @returns The full resolved URL
 */
export const resolveHyphaUrl = (path: string, resourceId: string, use_proxy: boolean = false): string => {
  if (!path) return '';
  
  // If the path is already a full URL, return it as is
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }

  // Extract the ID from the full artifact ID (removing any prefix like 'ri-scale/')
  const id = resourceId.split('/').pop();
  
  // Construct the full URL
  if (use_proxy) {
    return `https://hypha.aicell.io/ri-scale/artifacts/${id}/files/${path}?use_proxy=true`;
  } else {
    return `https://hypha.aicell.io/ri-scale/artifacts/${id}/files/${path}`;
  }
}; 