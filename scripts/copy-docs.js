const fs = require('fs');
const path = require('path');

/**
 * Recursively copy a directory from source to destination
 * @param {string} src - Source directory path
 * @param {string} dest - Destination directory path
 */
function copyDirectory(src, dest) {
  // Create destination directory if it doesn't exist
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  // Read source directory
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      // Recursively copy subdirectory
      copyDirectory(srcPath, destPath);
    } else {
      // Copy file
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Main execution
const sourceDir = path.join(__dirname, '..', 'docs');
const destDir = path.join(__dirname, '..', 'build', 'docs');

try {
  console.log('Copying docs directory to build...');
  
  // Check if source directory exists
  if (!fs.existsSync(sourceDir)) {
    console.error('Error: docs directory not found at', sourceDir);
    process.exit(1);
  }

  // Copy the docs directory
  copyDirectory(sourceDir, destDir);
  
  console.log('✅ Successfully copied docs to build/docs');
} catch (error) {
  console.error('❌ Error copying docs:', error.message);
  process.exit(1);
} 