# BioImage.IO Colab Implementation

## Overview

This directory contains the implementation of the BioImage.IO Colab page - a browser-based collaborative image annotation platform. The implementation uses web-python-kernel to run Python code directly in the browser via WebAssembly (Pyodide), allowing users to mount local folders, create annotation sessions, and collaborate with others. Images are temporarily stored in Hypha Artifacts during the session to enable collaboration.

## Architecture

### Key Components

1. **ColabPage.tsx** - Main component that orchestrates the entire Colab interface
   - Manages file system state (mounted folders, file lists)
   - Coordinates session creation and sharing
   - Displays kernel status and progress tracking

2. **useColabKernel.ts** - React hook for managing the Python kernel
   - Initializes web-python-kernel in the browser
   - Provides code execution interface
   - Handles kernel lifecycle (start, restart, interrupt)
   - Based on the web-python-kernel implementation from hypha-agents

3. **ColabGuide.tsx** - Collapsible guide component
   - Explains how to use the platform
   - Shows step-by-step instructions
   - Displays important notes and warnings

4. **SessionModal.tsx** - Modal for creating annotation sessions
   - Collects session name and description
   - Creates annotations folder in mounted directory
   - Loads and executes Python service code
   - Installs required packages (hypha-rpc, tifffile, kaibu-utils)
   - Registers service with Hypha server
   - Generates shareable annotation URL

5. **ShareModal.tsx** - Modal for sharing annotation URLs
   - Displays QR code for easy mobile sharing
   - Provides copy-to-clipboard functionality
   - Shows usage instructions

### Supporting Files

- **public/colab_service.py** - Python code for the data providing service
  - Functions for listing, reading, and serving images
  - Annotation saving functionality
  - Hypha service registration
  - Based on the original bioimageio-colab implementation

- **public/kernel.worker.js** - Web worker for running Python kernel
  - Copied from hypha-agents project
  - Handles Pyodide initialization and execution

- **public/web-python-kernel.mjs** - Web Python Kernel module
  - Already present in the project
  - Provides kernel management interface

## Key Differences from Original Implementation

### Original (bioimageio-colab)
- Used custom Pyodide kernel manager
- Implemented in pure HTML/JavaScript/React via CDN
- Custom worker-manager.js for kernel management

### New Implementation
- Uses web-python-kernel npm module directly
- Fully integrated React/TypeScript components
- Consistent with the rest of the bioimage-model-zoo codebase
- Follows the same styling patterns as BioEngine components

## User Flow

1. **Mount Folder** (Step 1)
   - User clicks "Mount Local Folder"
   - Browser File System API prompts for folder selection
   - Images are scanned and displayed (supports: TIFF, PNG, JPG, JPEG)
   - Images remain local until requested for annotation

2. **Create Session** (Step 2)
   - User must be logged in to Hypha
   - Opens modal to enter session name and description
   - System:
     - Creates "annotations" subfolder
     - Initializes Python kernel if not already ready
     - Installs required Python packages
     - Loads colab_service.py
     - Registers service with Hypha
     - Generates annotation URL

3. **Share & Collaborate** (Step 3)
   - User clicks "Share Annotation URL"
   - Modal displays QR code and URL
   - URL can be copied or opened in new tab
   - Collaborators use URL to access Kaibu annotation interface
   - Annotations are saved to the cloud artifact and synced back to the local folder
   - User must keep browser tab open during annotation session

## Technical Details

### File System Access
- Uses File System Access API (requires HTTPS or localhost)
- Direct access to local files through browser
- Images are uploaded to Hypha Artifacts on-demand for collaboration

### Python Environment
- Runs in Pyodide (Python compiled to WebAssembly)
- Packages installed on-demand via micropip
- Virtual file system mounts user's local folder
- Async event loop keeps service running

### Hypha Integration
- Registers browser as a service provider
- Uses user's login token for authentication
- Uses Artifact Manager for temporary storage
- Service provides two endpoints:
  - `get_image()` - Uploads a random image to the artifact and returns the URL
  - `save_annotation()` - Saves annotation mask to the artifact

### Styling
- Follows BioEngine component design patterns
- Uses Tailwind CSS for consistent styling
- Gradient backgrounds (purple-to-pink theme)
- Responsive design with mobile support
- Smooth animations and transitions

## Requirements

- Modern browser with:
  - File System Access API support (Chrome, Edge, Opera)
  - WebAssembly support
  - ES6 modules support
- HTTPS connection (or localhost for development)
- User must be logged in to create sessions

## Limitations

- Browser tab must remain open during annotation sessions
- First session creation takes longer due to package installation
- Large image files may cause memory issues in browser
- File System Access API not supported in all browsers

## Future Enhancements

- Remote deployment option (mentioned in original implementation)
- Support for more image formats
- Batch annotation features
- Progress persistence across sessions
- Better error handling and recovery
- Mobile-optimized annotation interface

## Related Files

- Route: `/colab` defined in `src/App.tsx`
- Store: Uses `hyphaStore` for user/server state
- Assets: Requires `public/colab_service.py` and kernel worker files

## Development Notes

- The kernel initialization can take 30-180 seconds on first load
- Status indicator shows kernel state (starting, idle, busy, error)
- All Python code execution happens through the `executeCode` function
- File lists are manually refreshed (auto-refresh could be added)
- QR code library loaded dynamically when share modal opens

## Testing

To test the implementation:
1. Build the project: `npm run build`
2. Serve the build: `npx serve -s build`
3. Navigate to `http://localhost:3000/#/colab`
4. Log in to your Hypha account
5. Mount a folder with test images
6. Create an annotation session
7. Share and test the annotation URL

## Credits

Based on the original bioimageio-colab implementation:
- Original code: https://github.com/bioimage-io/bioimageio-colab
- Kaibu annotation tool: https://kaibu.org
- Hypha framework: https://ha.amun.ai

Adapted to use web-python-kernel from:
- https://github.com/imjoy-team/web-python-kernel
- Reference implementation: hypha-agents project
