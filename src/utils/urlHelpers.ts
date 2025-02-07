/**
 * Resolves a relative URL to a full Hypha artifact URL
 * @param path - The relative path to resolve
 * @param resourceId - The resource ID
 * @returns The full resolved URL
 */
export const resolveHyphaUrl = (path: string, resourceId: string): string => {
  if (!path) return '';
  
  // If the path is already a full URL, return it as is
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }

  // Extract the ID from the full resource ID (removing any prefix like 'bioimage.io/')
  const id = resourceId.split('/').pop();
  
  // Construct the full URL
  return `https://hypha.aicell.io/bioimage-io/artifacts/${id}/files/${path}?use_proxy=true`;
}; 