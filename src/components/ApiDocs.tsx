import React, { useState, useEffect } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useHyphaStore } from '../store/hyphaStore';
import { ClipboardIcon, CheckIcon } from '@heroicons/react/24/outline';
import { useSearchParams } from 'react-router-dom';

const ApiDocs: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const defaultTab = searchParams.get('tab') || 'getting-started';
  const [activeMainTab, setActiveMainTab] = useState<'getting-started' | 'api-reference' | 'hypha-rpc' | 'faqs'>(defaultTab as any);
  const [activeLanguageTab, setActiveLanguageTab] = useState<'curl' | 'python' | 'javascript'>('curl');
  const [activeHyphaLanguageTab, setActiveHyphaLanguageTab] = useState<'python' | 'javascript'>('python');
  const [token, setToken] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const { server, user } = useHyphaStore();

  // Add URL query parameter handling
  useEffect(() => {
    setSearchParams(params => {
      params.set('tab', activeMainTab);
      return params;
    });
  }, [activeMainTab, setSearchParams]);

  const generateToken = async () => {
    try {
      const newToken = await server.generateToken();
      setToken(newToken);
    } catch (error) {
      console.error('Failed to generate token:', error);
    }
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy token:', error);
    }
  };

  // Token section component
  const TokenSection = () => (
    <div className="mb-8 p-6 bg-gray-50 rounded-lg border border-gray-200">
      <h3 className="text-lg font-medium text-gray-900 mb-4">🔑 Generate API Token</h3>
      {user ? (
        <div className="space-y-4">
          <p className="text-gray-600">
            Generate a personal API token to authenticate your requests to the RI-SCALE Model Hub API.
          </p>
          <div className="flex flex-col space-y-3">
            <button
              onClick={generateToken}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 w-fit"
            >
              Generate New Token
            </button>
            
            {token && (
              <div className="relative">
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={token}
                    readOnly
                    aria-label="API Token"
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm font-mono"
                  />
                  <button
                    onClick={copyToClipboard}
                    className="inline-flex items-center p-2 border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                    title="Copy to clipboard"
                  >
                    {copied ? (
                      <CheckIcon className="h-5 w-5 text-green-500" />
                    ) : (
                      <ClipboardIcon className="h-5 w-5 text-gray-500" />
                    )}
                  </button>
                </div>
                {copied && (
                  <span className="absolute right-0 -bottom-6 text-sm text-green-600">
                    Copied to clipboard!
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
          <div className="flex">
            <div className="ml-3">
              <p className="text-sm text-yellow-700">
                Please log in to generate an API token. Click the login button in the top right corner.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">
          RI-SCALE Model Hub API Documentation
        </h1>
        <div className="prose max-w-none">
          <p className="text-gray-600 mb-4">
            Welcome to the RI-SCALE Model Hub API! This documentation will guide you through accessing and managing 
            bioimage analysis models, datasets, and applications programmatically.
          </p>
        </div>
      </div>

      {/* Add Token Section */}
      <TokenSection />

      {/* Main navigation tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveMainTab('getting-started')}
            className={`${
              activeMainTab === 'getting-started'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
          >
            Getting Started
          </button>
          <button
            onClick={() => setActiveMainTab('api-reference')}
            className={`${
              activeMainTab === 'api-reference'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
          >
            API Reference
          </button>
          <button
            onClick={() => setActiveMainTab('hypha-rpc')}
            className={`${
              activeMainTab === 'hypha-rpc'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
          >
            Hypha RPC Client
          </button>
          <button
            onClick={() => setActiveMainTab('faqs')}
            className={`${
              activeMainTab === 'faqs'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
          >
            FAQs
          </button>
        </nav>
      </div>

      {/* Getting Started Tab */}
      {activeMainTab === 'getting-started' && (
        <div className="space-y-8">
          {/* Useful Links Section */}
          <div>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">🔗 Useful Links</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <a 
                href="https://hypha.aicell.io/bioimage-io/artifacts/bioimage.io/children" 
                target="_blank" 
                rel="noopener noreferrer"
                className="p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors border border-gray-200"
              >
                <h4 className="font-medium text-gray-900 mb-1">📦 View All Models</h4>
                <p className="text-sm text-gray-600">Browse the complete collection of models in the zoo</p>
                <code className="text-xs text-blue-600 mt-2 block truncate">
                  https://hypha.aicell.io/bioimage-io/artifacts/bioimage.io/children
                </code>
              </a>
              
              <a 
                href="https://hypha.aicell.io/bioimage-io/artifacts/affable-shark" 
                target="_blank" 
                rel="noopener noreferrer"
                className="p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors border border-gray-200"
              >
                <h4 className="font-medium text-gray-900 mb-1">🔍 Example Model API</h4>
                <p className="text-sm text-gray-600">See the API response for a specific model</p>
                <code className="text-xs text-blue-600 mt-2 block truncate">
                  https://hypha.aicell.io/bioimage-io/artifacts/affable-shark
                </code>
              </a>
              
              <a 
                href="https://docs.amun.ai/#/artifact-manager" 
                target="_blank" 
                rel="noopener noreferrer"
                className="p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors border border-gray-200"
              >
                <h4 className="font-medium text-gray-900 mb-1">📚 Artifact Manager Docs</h4>
                <p className="text-sm text-gray-600">Complete documentation for the Artifact Manager service</p>
                <code className="text-xs text-blue-600 mt-2 block truncate">
                  https://docs.amun.ai/#/artifact-manager
                </code>
              </a>
              
              <a 
                href="https://modelhub.riscale.eu" 
                target="_blank" 
                rel="noopener noreferrer"
                className="p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors border border-gray-200"
              >
                <h4 className="font-medium text-gray-900 mb-1">🌐 RI-SCALE Model Hub</h4>
                <p className="text-sm text-gray-600">Main website to browse models visually</p>
                <code className="text-xs text-blue-600 mt-2 block truncate">
                  https://modelhub.riscale.eu
                </code>
              </a>
            </div>
          </div>

          {/* Introduction */}
          <div>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">🚀 Quick Start</h2>
            <div className="prose max-w-none">
              <p className="text-gray-600 mb-4">
                The RI-SCALE Model Hub uses the <strong>Artifact Manager</strong> service (part of the Hypha platform) 
                to host and manage models, datasets, and applications. All resources are called <strong>artifacts</strong> 
                and can be accessed via simple HTTP endpoints.
              </p>
            </div>
          </div>

          {/* Basic Concepts */}
          <div>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">📚 Basic Concepts</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <div className="p-4 bg-gray-50 rounded-lg">
                <h4 className="font-medium text-gray-900 mb-2">Artifact</h4>
                <p className="text-sm text-gray-600">
                  A digital resource (model, dataset, or application) with metadata, files, and version history.
                </p>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg">
                <h4 className="font-medium text-gray-900 mb-2">Collection</h4>
                <p className="text-sm text-gray-600">
                  A container that groups related artifacts together (e.g., all models in the zoo).
                </p>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg">
                <h4 className="font-medium text-gray-900 mb-2">Alias</h4>
                <p className="text-sm text-gray-600">
                  A human-readable identifier like "affable-shark" (auto-generated or custom).
                </p>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg">
                <h4 className="font-medium text-gray-900 mb-2">Manifest</h4>
                <p className="text-sm text-gray-600">
                  Metadata describing the artifact (name, description, authors, etc.).
                </p>
              </div>
            </div>
          </div>

          {/* Common Operations */}
          <div>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">🔧 Common Operations</h2>
            
            {/* Language selector for examples */}
            <div className="border-b border-gray-200 mb-4">
              <nav className="-mb-px flex space-x-6">
                <button
                  onClick={() => setActiveLanguageTab('curl')}
                  className={`${
                    activeLanguageTab === 'curl'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  } py-2 px-1 border-b-2 font-medium text-sm`}
                >
                  cURL
                </button>
                <button
                  onClick={() => setActiveLanguageTab('python')}
                  className={`${
                    activeLanguageTab === 'python'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  } py-2 px-1 border-b-2 font-medium text-sm`}
                >
                  Python
                </button>
                <button
                  onClick={() => setActiveLanguageTab('javascript')}
                  className={`${
                    activeLanguageTab === 'javascript'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  } py-2 px-1 border-b-2 font-medium text-sm`}
                >
                  JavaScript
                </button>
              </nav>
            </div>

            {/* 1. List all models */}
            <div className="mb-6">
              <h3 className="text-lg font-medium text-gray-900 mb-2">1️⃣ List All Models</h3>
              <p className="text-gray-600 mb-3">Get a list of all available models in the RI-SCALE Model Hub:</p>
              <div className="bg-gray-900 rounded-lg overflow-hidden">
                <SyntaxHighlighter 
                  language={activeLanguageTab === 'curl' ? 'bash' : activeLanguageTab}
                  style={vscDarkPlus}
                  customStyle={{
                    fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                    fontSize: '14px',
                    background: '#111827',
                    padding: '1.5rem',
                    margin: 0,
                    borderRadius: '0.5rem'
                  }}
                >
                  {activeLanguageTab === 'curl' ? 
`# List first 10 models
curl "https://hypha.aicell.io/bioimage-io/artifacts/bioimage.io/children?limit=10"

# With search filter
curl "https://hypha.aicell.io/bioimage-io/artifacts/bioimage.io/children?keywords=segmentation&limit=5"` :
                  activeLanguageTab === 'python' ?
`import requests

# List first 10 models
response = requests.get(
    "https://hypha.aicell.io/bioimage-io/artifacts/bioimage.io/children",
    params={"limit": 10}
)
models = response.json()

# Print model names
for model in models:
    print(f"- {model['alias']}: {model['manifest'].get('name', 'N/A')}")` :
`// List first 10 models
fetch('https://hypha.aicell.io/bioimage-io/artifacts/bioimage.io/children?limit=10')
  .then(res => res.json())
  .then(models => {
    models.forEach(model => {
      console.log(\`- \${model.alias}: \${model.manifest.name || 'N/A'}\`);
    });
  });`}
                </SyntaxHighlighter>
              </div>
            </div>

            {/* 2. Get model details */}
            <div className="mb-6">
              <h3 className="text-lg font-medium text-gray-900 mb-2">2️⃣ Get Model Details</h3>
              <p className="text-gray-600 mb-3">Retrieve complete information about a specific model:</p>
              <div className="bg-gray-900 rounded-lg overflow-hidden">
                <SyntaxHighlighter 
                  language={activeLanguageTab === 'curl' ? 'bash' : activeLanguageTab}
                  style={vscDarkPlus}
                  customStyle={{
                    fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                    fontSize: '14px',
                    background: '#111827',
                    padding: '1.5rem',
                    margin: 0,
                    borderRadius: '0.5rem'
                  }}
                >
                  {activeLanguageTab === 'curl' ? 
`# Get model metadata
curl "https://hypha.aicell.io/bioimage-io/artifacts/affable-shark"

# Pretty print with jq (if installed)
curl -s "https://hypha.aicell.io/bioimage-io/artifacts/affable-shark" | jq .` :
                  activeLanguageTab === 'python' ?
`import requests
import json

# Get model details
response = requests.get(
    "https://hypha.aicell.io/bioimage-io/artifacts/affable-shark"
)
model = response.json()

# Display key information
print(f"Name: {model['manifest']['name']}")
print(f"Description: {model['manifest']['description']}")
print(f"Authors: {', '.join([a['name'] for a in model['manifest']['authors']])}")
print(f"Tags: {', '.join(model['manifest'].get('tags', []))}")` :
`// Get model details
fetch('https://hypha.aicell.io/bioimage-io/artifacts/affable-shark')
  .then(res => res.json())
  .then(model => {
    console.log('Name:', model.manifest.name);
    console.log('Description:', model.manifest.description);
    console.log('Authors:', model.manifest.authors.map(a => a.name).join(', '));
    console.log('Tags:', model.manifest.tags?.join(', ') || 'None');
  });`}
                </SyntaxHighlighter>
              </div>
            </div>

            {/* 3. List model files */}
            <div className="mb-6">
              <h3 className="text-lg font-medium text-gray-900 mb-2">3️⃣ List Model Files</h3>
              <p className="text-gray-600 mb-3">See all files included in a model:</p>
              <div className="bg-gray-900 rounded-lg overflow-hidden">
                <SyntaxHighlighter 
                  language={activeLanguageTab === 'curl' ? 'bash' : activeLanguageTab}
                  style={vscDarkPlus}
                  customStyle={{
                    fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                    fontSize: '14px',
                    background: '#111827',
                    padding: '1.5rem',
                    margin: 0,
                    borderRadius: '0.5rem'
                  }}
                >
                  {activeLanguageTab === 'curl' ? 
`# List all files in a model
curl "https://hypha.aicell.io/bioimage-io/artifacts/affable-shark/files/"` :
                  activeLanguageTab === 'python' ?
`import requests

# List model files
response = requests.get(
    "https://hypha.aicell.io/bioimage-io/artifacts/affable-shark/files/"
)
files = response.json()

# Display files with sizes
for file in files:
    size_mb = file['size'] / (1024 * 1024)
    print(f"{file['name']}: {size_mb:.2f} MB")` :
`// List model files
fetch('https://hypha.aicell.io/bioimage-io/artifacts/affable-shark/files/')
  .then(res => res.json())
  .then(files => {
    files.forEach(file => {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
      console.log(\`\${file.name}: \${sizeMB} MB\`);
    });
  });`}
                </SyntaxHighlighter>
              </div>
            </div>

            {/* 4. Download model files */}
            <div className="mb-6">
              <h3 className="text-lg font-medium text-gray-900 mb-2">4️⃣ Download Model Files</h3>
              <p className="text-gray-600 mb-3">Download specific files or the entire model as a ZIP:</p>
              <div className="bg-gray-900 rounded-lg overflow-hidden">
                <SyntaxHighlighter 
                  language={activeLanguageTab === 'curl' ? 'bash' : activeLanguageTab}
                  style={vscDarkPlus}
                  customStyle={{
                    fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                    fontSize: '14px',
                    background: '#111827',
                    padding: '1.5rem',
                    margin: 0,
                    borderRadius: '0.5rem'
                  }}
                >
                  {activeLanguageTab === 'curl' ? 
`# Download a specific file
curl -O "https://hypha.aicell.io/bioimage-io/artifacts/affable-shark/files/rdf.yaml"

# Download model weights
curl -O "https://hypha.aicell.io/bioimage-io/artifacts/affable-shark/files/weights.pt"

# Download entire model as ZIP
curl -O "https://hypha.aicell.io/bioimage-io/artifacts/affable-shark/create-zip-file"` :
                  activeLanguageTab === 'python' ?
`import requests

# Download a specific file
def download_file(url, filename):
    response = requests.get(url, stream=True)
    with open(filename, 'wb') as f:
        for chunk in response.iter_content(chunk_size=8192):
            f.write(chunk)
    print(f"Downloaded: {filename}")

# Download model specification
download_file(
    "https://hypha.aicell.io/bioimage-io/artifacts/affable-shark/files/rdf.yaml",
    "rdf.yaml"
)

# Download entire model as ZIP
download_file(
    "https://hypha.aicell.io/bioimage-io/artifacts/affable-shark/create-zip-file",
    "model.zip"
)` :
`// Download a file using fetch
async function downloadFile(url, filename) {
  const response = await fetch(url);
  const blob = await response.blob();
  
  // Create download link
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

// Download model specification
downloadFile(
  'https://hypha.aicell.io/bioimage-io/artifacts/affable-shark/files/rdf.yaml',
  'rdf.yaml'
);

// Download entire model as ZIP
downloadFile(
  'https://hypha.aicell.io/bioimage-io/artifacts/affable-shark/create-zip-file',
  'model.zip'
);`}
                </SyntaxHighlighter>
              </div>
            </div>

            {/* 5. Search models */}
            <div className="mb-6">
              <h3 className="text-lg font-medium text-gray-900 mb-2">5️⃣ Search Models</h3>
              <p className="text-gray-600 mb-3">Search for models using keywords and filters:</p>
              <div className="bg-gray-900 rounded-lg overflow-hidden">
                <SyntaxHighlighter 
                  language={activeLanguageTab === 'curl' ? 'bash' : activeLanguageTab}
                  style={vscDarkPlus}
                  customStyle={{
                    fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                    fontSize: '14px',
                    background: '#111827',
                    padding: '1.5rem',
                    margin: 0,
                    borderRadius: '0.5rem'
                  }}
                >
                  {activeLanguageTab === 'curl' ? 
`# Search by keywords
curl "https://hypha.aicell.io/bioimage-io/artifacts/bioimage.io/children?keywords=segmentation,unet&limit=5"

# Search with filters (URL-encoded JSON)
curl "https://hypha.aicell.io/bioimage-io/artifacts/bioimage.io/children?filters=%7B%22type%22%3A%22model%22%7D&limit=10"

# Pagination
curl "https://hypha.aicell.io/bioimage-io/artifacts/bioimage.io/children?offset=10&limit=10"` :
                  activeLanguageTab === 'python' ?
`import requests
import json

# Search by keywords
response = requests.get(
    "https://hypha.aicell.io/bioimage-io/artifacts/bioimage.io/children",
    params={
        "keywords": "segmentation,unet",
        "limit": 5
    }
)
results = response.json()

# Search with filters
response = requests.get(
    "https://hypha.aicell.io/bioimage-io/artifacts/bioimage.io/children",
    params={
        "filters": json.dumps({"type": "model"}),
        "limit": 10
    }
)

# Display results
for model in response.json():
    print(f"- {model['alias']}: {model['manifest'].get('name', 'N/A')}")` :
`// Search by keywords
fetch('https://hypha.aicell.io/bioimage-io/artifacts/bioimage.io/children?' + 
      new URLSearchParams({
        keywords: 'segmentation,unet',
        limit: 5
      }))
  .then(res => res.json())
  .then(results => {
    results.forEach(model => {
      console.log(\`- \${model.alias}: \${model.manifest.name || 'N/A'}\`);
    });
  });

// Search with filters
const filters = JSON.stringify({ type: 'model' });
fetch(\`https://hypha.aicell.io/bioimage-io/artifacts/bioimage.io/children?filters=\${encodeURIComponent(filters)}&limit=10\`)
  .then(res => res.json())
  .then(console.log);`}
                </SyntaxHighlighter>
              </div>
            </div>
          </div>

          {/* Upload Models Section */}
          <div>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">📤 Managing Models</h2>
            
            {/* Create New Model */}
            <div className="mb-8">
              <h3 className="text-lg font-medium text-gray-900 mb-3">Create and Upload a New Model</h3>
              <p className="text-gray-600 mb-4">
                Models are created as staged versions first, then committed when ready:
              </p>
              
              <div className="bg-gray-900 rounded-lg overflow-hidden">
                <SyntaxHighlighter 
                  language="python"
                  style={vscDarkPlus}
                  showLineNumbers={true}
                  customStyle={{
                    fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                    fontSize: '14px',
                    background: '#111827',
                    padding: '1.5rem',
                    margin: 0,
                    borderRadius: '0.5rem'
                  }}
                >
{`import requests
import json

# Configuration
API_TOKEN = "your-api-token-here"  # Generate from the token section above
BASE_URL = "https://hypha.aicell.io"

headers = {
    "Authorization": f"Bearer {API_TOKEN}",
    "Content-Type": "application/json"
}

def upload_new_model():
    # Step 1: Create model metadata
    model_manifest = {
        "name": "My Segmentation Model",
        "description": "U-Net model for cell segmentation",
        "authors": [{"name": "Your Name"}],
        "tags": ["segmentation", "cell", "unet"],
        "license": "MIT",
        "documentation": "# My Model\\n\\nThis model segments cells...",
        "covers": ["cover.png"],
    }

    # Step 2: Create the model artifact as staged version
    response = requests.post(
        f"{BASE_URL}/public/services/artifact-manager/create",
        json={
            "parent_id": "bioimage-io/bioimage.io",
            "type": "model",
            "manifest": model_manifest,
            "alias": "{animal_adjective}-{animal}",  # Auto-generate a name
            "stage": True  # Create as staged version
        },
        headers=headers
    )
    
    if response.status_code != 200:
        print(f"Error creating model: {response.text}")
        return
    
    model = response.json()
    model_id = model["id"]
    print(f"✅ Created staged model: {model_id}")
    
    # Step 3: Upload files
    files_to_upload = [
        ("weights.pt", "path/to/your/weights.pt"),
        ("cover.png", "path/to/your/cover.png"),
        ("rdf.yaml", "path/to/your/rdf.yaml")
    ]
    
    for file_name, local_path in files_to_upload:
        # Get upload URL
        response = requests.post(
            f"{BASE_URL}/public/services/artifact-manager/put_file",
            json={
                "artifact_id": model_id,
                "file_path": file_name
            },
            headers=headers
        )
        upload_url = response.json()
        
        # Upload the file
        with open(local_path, "rb") as f:
            response = requests.put(
                upload_url,
                data=f,
                headers={"Content-Type": ""}  # Important for S3
            )
        print(f"✅ Uploaded: {file_name}")
    
    # Step 4: Commit the staged version
    response = requests.post(
        f"{BASE_URL}/public/services/artifact-manager/commit",
        json={
            "artifact_id": model_id,
            "comment": "Initial model release"
        },
        headers=headers
    )
    
    if response.status_code == 200:
        print(f"✅ Model committed successfully!")
        
        # Step 5: Request review (optional)
        model_manifest["status"] = "request-review"
        response = requests.post(
            f"{BASE_URL}/public/services/artifact-manager/edit",
            json={
                "artifact_id": model_id,
                "manifest": model_manifest
            },
            headers=headers
        )
        print(f"✅ Model ready for review: {model_id}")
        print(f"View at: https://modelhub.riscale.eu/#/p/{model_id}")

if __name__ == "__main__":
    upload_new_model()`}
                </SyntaxHighlighter>
              </div>
            </div>

            {/* Edit Existing Model */}
            <div className="mb-8">
              <h3 className="text-lg font-medium text-gray-900 mb-3">Edit an Existing Model In-Place</h3>
              <p className="text-gray-600 mb-4">
                Update metadata or files of an existing model without creating a new version:
              </p>
              
              <div className="bg-gray-900 rounded-lg overflow-hidden">
                <SyntaxHighlighter 
                  language="python"
                  style={vscDarkPlus}
                  showLineNumbers={true}
                  customStyle={{
                    fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                    fontSize: '14px',
                    background: '#111827',
                    padding: '1.5rem',
                    margin: 0,
                    borderRadius: '0.5rem'
                  }}
                >
{`def edit_existing_model(model_id):
    # Step 1: Get current model details
    response = requests.post(
        f"{BASE_URL}/public/services/artifact-manager/read",
        json={"artifact_id": model_id},
        headers=headers
    )
    current_model = response.json()
    
    # Step 2: Update metadata
    updated_manifest = current_model["manifest"]
    updated_manifest["description"] = "Updated description"
    updated_manifest["tags"].append("new-tag")
    
    # Step 3: Apply edits to staged version
    response = requests.post(
        f"{BASE_URL}/public/services/artifact-manager/edit",
        json={
            "artifact_id": model_id,
            "manifest": updated_manifest,
            "stage": True  # Edit as staged version
        },
        headers=headers
    )
    
    # Step 4: Replace or add files (optional)
    response = requests.post(
        f"{BASE_URL}/public/services/artifact-manager/put_file",
        json={
            "artifact_id": model_id,
            "file_path": "weights_v2.pt"  # New or replacement file
        },
        headers=headers
    )
    upload_url = response.json()
    
    with open("path/to/new/weights.pt", "rb") as f:
        requests.put(upload_url, data=f, headers={"Content-Type": ""})
    
    # Step 5: Commit the changes
    response = requests.post(
        f"{BASE_URL}/public/services/artifact-manager/commit",
        json={
            "artifact_id": model_id,
            "comment": "Updated model weights and metadata"
        },
        headers=headers
    )
    
    print(f"✅ Model {model_id} updated successfully!")`}
                </SyntaxHighlighter>
              </div>
            </div>

            {/* Create New Version */}
            <div className="mb-8">
              <h3 className="text-lg font-medium text-gray-900 mb-3">Create a New Version of a Model</h3>
              <p className="text-gray-600 mb-4">
                Create a new version while preserving the previous version:
              </p>
              
              <div className="bg-gray-900 rounded-lg overflow-hidden">
                <SyntaxHighlighter 
                  language="python"
                  style={vscDarkPlus}
                  showLineNumbers={true}
                  customStyle={{
                    fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                    fontSize: '14px',
                    background: '#111827',
                    padding: '1.5rem',
                    margin: 0,
                    borderRadius: '0.5rem'
                  }}
                >
{`def create_new_version(model_id, version_name="v2"):
    # Step 1: Read current model
    response = requests.post(
        f"{BASE_URL}/public/services/artifact-manager/read",
        json={"artifact_id": model_id},
        headers=headers
    )
    current_model = response.json()
    
    # Step 2: Create staged version with updated manifest
    updated_manifest = current_model["manifest"]
    updated_manifest["version"] = version_name
    updated_manifest["description"] += f" - Version {version_name}"
    
    response = requests.post(
        f"{BASE_URL}/public/services/artifact-manager/edit",
        json={
            "artifact_id": model_id,
            "manifest": updated_manifest,
            "version": version_name,  # Specify new version
            "stage": True
        },
        headers=headers
    )
    
    # Step 3: Upload new version files
    files_to_upload = [
        ("weights_v2.pt", "path/to/new/weights.pt"),
        ("changelog.md", "path/to/changelog.md")
    ]
    
    for file_name, local_path in files_to_upload:
        response = requests.post(
            f"{BASE_URL}/public/services/artifact-manager/put_file",
            json={
                "artifact_id": model_id,
                "file_path": file_name
            },
            headers=headers
        )
        upload_url = response.json()
        
        with open(local_path, "rb") as f:
            requests.put(upload_url, data=f, headers={"Content-Type": ""})
    
    # Step 4: Commit the new version
    response = requests.post(
        f"{BASE_URL}/public/services/artifact-manager/commit",
        json={
            "artifact_id": model_id,
            "version": version_name,
            "comment": f"Release version {version_name}"
        },
        headers=headers
    )
    
    print(f"✅ New version {version_name} created for {model_id}")`}
                </SyntaxHighlighter>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* API Reference Tab */}
      {activeMainTab === 'api-reference' && (
        <div className="space-y-8">
          <div>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">📖 API Reference</h2>
            <p className="text-gray-600 mb-6">
              Complete reference for all HTTP endpoints and service methods available in the RI-SCALE Model Hub API.
            </p>
          </div>

          {/* HTTP Endpoints */}
          <div>
            <h3 className="text-xl font-medium text-gray-900 mb-4">HTTP REST Endpoints</h3>
            
            <div className="bg-blue-50 border-l-4 border-blue-400 p-4 mb-6">
              <p className="text-sm text-blue-700">
                <strong>Authentication:</strong> For protected endpoints, include your API token in the Authorization header:
                <code className="ml-2 px-2 py-1 bg-blue-100 rounded">Authorization: Bearer your-token-here</code>
              </p>
            </div>

            <div className="space-y-6">
              {/* Artifact Operations */}
              <div className="border rounded-lg p-4">
                <h4 className="font-medium text-gray-900 mb-3">Artifact Operations</h4>
                
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center space-x-2 mb-2">
                      <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded">GET</span>
                      <code className="text-sm font-mono">/&lt;workspace&gt;/artifacts/&lt;artifact_alias&gt;</code>
                    </div>
                    <p className="text-sm text-gray-600 ml-12">Get artifact metadata and manifest</p>
                    <details className="ml-12 mt-2">
                      <summary className="text-xs text-gray-500 cursor-pointer">Parameters</summary>
                      <div className="mt-2 bg-gray-50 p-3 rounded">
                        <table className="text-xs w-full">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left font-medium p-1">Parameter</th>
                              <th className="text-left font-medium p-1">Type</th>
                              <th className="text-left font-medium p-1">Default</th>
                              <th className="text-left font-medium p-1">Description</th>
                            </tr>
                          </thead>
                          <tbody className="text-gray-600">
                            <tr className="border-b">
                              <td className="p-1"><code>version</code></td>
                              <td className="p-1">string</td>
                              <td className="p-1">latest</td>
                              <td className="p-1">Specific version to retrieve</td>
                            </tr>
                            <tr className="border-b">
                              <td className="p-1"><code>silent</code></td>
                              <td className="p-1">boolean</td>
                              <td className="p-1">false</td>
                              <td className="p-1">Don't increment view count</td>
                            </tr>
                            <tr>
                              <td className="p-1"><code>stage</code></td>
                              <td className="p-1">boolean</td>
                              <td className="p-1">false</td>
                              <td className="p-1">Get staged version</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </details>
                  </div>

                  <div>
                    <div className="flex items-center space-x-2 mb-2">
                      <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded">GET</span>
                      <code className="text-sm font-mono">/&lt;workspace&gt;/artifacts/&lt;artifact_alias&gt;/children</code>
                    </div>
                    <p className="text-sm text-gray-600 ml-12">List child artifacts</p>
                    <details className="ml-12 mt-2">
                      <summary className="text-xs text-gray-500 cursor-pointer">Parameters</summary>
                      <div className="mt-2 bg-gray-50 p-3 rounded">
                        <table className="text-xs w-full">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left font-medium p-1">Parameter</th>
                              <th className="text-left font-medium p-1">Type</th>
                              <th className="text-left font-medium p-1">Default</th>
                              <th className="text-left font-medium p-1">Description</th>
                            </tr>
                          </thead>
                          <tbody className="text-gray-600">
                            <tr className="border-b">
                              <td className="p-1"><code>keywords</code></td>
                              <td className="p-1">string</td>
                              <td className="p-1">-</td>
                              <td className="p-1">Comma-separated search terms</td>
                            </tr>
                            <tr className="border-b">
                              <td className="p-1"><code>filters</code></td>
                              <td className="p-1">JSON</td>
                              <td className="p-1">-</td>
                              <td className="p-1">Filter criteria (e.g., {`{"type":"model"}`})</td>
                            </tr>
                            <tr className="border-b">
                              <td className="p-1"><code>offset</code></td>
                              <td className="p-1">integer</td>
                              <td className="p-1">0</td>
                              <td className="p-1">Skip first N results</td>
                            </tr>
                            <tr className="border-b">
                              <td className="p-1"><code>limit</code></td>
                              <td className="p-1">integer</td>
                              <td className="p-1">100</td>
                              <td className="p-1">Maximum results (max: 1000)</td>
                            </tr>
                            <tr className="border-b">
                              <td className="p-1"><code>order_by</code></td>
                              <td className="p-1">string</td>
                              <td className="p-1">-</td>
                              <td className="p-1">Sort field: created, downloads, views</td>
                            </tr>
                            <tr className="border-b">
                              <td className="p-1"><code>mode</code></td>
                              <td className="p-1">string</td>
                              <td className="p-1">AND</td>
                              <td className="p-1">Search mode: AND or OR</td>
                            </tr>
                            <tr>
                              <td className="p-1"><code>stage</code></td>
                              <td className="p-1">string</td>
                              <td className="p-1">false</td>
                              <td className="p-1">"true", "false", or "all"</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </details>
                  </div>

                  <div>
                    <div className="flex items-center space-x-2 mb-2">
                      <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded">GET</span>
                      <code className="text-sm font-mono">/&lt;workspace&gt;/artifacts/&lt;artifact_alias&gt;/files/&lt;path&gt;</code>
                    </div>
                    <p className="text-sm text-gray-600 ml-12">Download or list files</p>
                    <details className="ml-12 mt-2">
                      <summary className="text-xs text-gray-500 cursor-pointer">Parameters</summary>
                      <div className="mt-2 bg-gray-50 p-3 rounded">
                        <table className="text-xs w-full">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left font-medium p-1">Parameter</th>
                              <th className="text-left font-medium p-1">Type</th>
                              <th className="text-left font-medium p-1">Default</th>
                              <th className="text-left font-medium p-1">Description</th>
                            </tr>
                          </thead>
                          <tbody className="text-gray-600">
                            <tr className="border-b">
                              <td className="p-1"><code>version</code></td>
                              <td className="p-1">string</td>
                              <td className="p-1">latest</td>
                              <td className="p-1">Specific version</td>
                            </tr>
                            <tr className="border-b">
                              <td className="p-1"><code>silent</code></td>
                              <td className="p-1">boolean</td>
                              <td className="p-1">false</td>
                              <td className="p-1">Don't increment download count</td>
                            </tr>
                            <tr className="border-b">
                              <td className="p-1"><code>use_proxy</code></td>
                              <td className="p-1">boolean</td>
                              <td className="p-1">auto</td>
                              <td className="p-1">Serve through API proxy</td>
                            </tr>
                            <tr className="border-b">
                              <td className="p-1"><code>stage</code></td>
                              <td className="p-1">boolean</td>
                              <td className="p-1">false</td>
                              <td className="p-1">Get staged version</td>
                            </tr>
                            <tr>
                              <td className="p-1"><code>expires_in</code></td>
                              <td className="p-1">integer</td>
                              <td className="p-1">3600</td>
                              <td className="p-1">URL expiration in seconds</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </details>
                  </div>

                  <div>
                    <div className="flex items-center space-x-2 mb-2">
                      <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded">GET</span>
                      <code className="text-sm font-mono">/&lt;workspace&gt;/artifacts/&lt;artifact_alias&gt;/create-zip-file</code>
                    </div>
                    <p className="text-sm text-gray-600 ml-12">Download artifact as ZIP</p>
                    <details className="ml-12 mt-2">
                      <summary className="text-xs text-gray-500 cursor-pointer">Parameters</summary>
                      <div className="mt-2 bg-gray-50 p-3 rounded">
                        <table className="text-xs w-full">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left font-medium p-1">Parameter</th>
                              <th className="text-left font-medium p-1">Type</th>
                              <th className="text-left font-medium p-1">Default</th>
                              <th className="text-left font-medium p-1">Description</th>
                            </tr>
                          </thead>
                          <tbody className="text-gray-600">
                            <tr className="border-b">
                              <td className="p-1"><code>file</code></td>
                              <td className="p-1">string[]</td>
                              <td className="p-1">all</td>
                              <td className="p-1">Specific files to include (repeatable)</td>
                            </tr>
                            <tr>
                              <td className="p-1"><code>version</code></td>
                              <td className="p-1">string</td>
                              <td className="p-1">latest</td>
                              <td className="p-1">Specific version</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </details>
                  </div>
                </div>
              </div>

              {/* Service Endpoints */}
              <div className="border rounded-lg p-4">
                <h4 className="font-medium text-gray-900 mb-3">Service Endpoints</h4>
                <p className="text-sm text-gray-600 mb-3">
                  All Artifact Manager methods are accessible via HTTP at:
                  <code className="ml-2 px-2 py-1 bg-gray-100 rounded">/public/services/artifact-manager/&lt;method&gt;</code>
                </p>
                
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center space-x-2 mb-2">
                      <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded">POST</span>
                      <code className="text-sm font-mono">/public/services/artifact-manager/create</code>
                    </div>
                    <p className="text-sm text-gray-600 ml-12">Create new artifact</p>
                    <details className="ml-12 mt-2">
                      <summary className="text-xs text-gray-500 cursor-pointer">Parameters</summary>
                      <div className="mt-2 bg-gray-50 p-3 rounded">
                        <table className="text-xs w-full">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left font-medium p-1">Parameter</th>
                              <th className="text-left font-medium p-1">Type</th>
                              <th className="text-left font-medium p-1">Required</th>
                              <th className="text-left font-medium p-1">Description</th>
                            </tr>
                          </thead>
                          <tbody className="text-gray-600">
                            <tr className="border-b">
                              <td className="p-1"><code>parent_id</code></td>
                              <td className="p-1">string</td>
                              <td className="p-1">✓</td>
                              <td className="p-1">Parent collection ID</td>
                            </tr>
                            <tr className="border-b">
                              <td className="p-1"><code>type</code></td>
                              <td className="p-1">string</td>
                              <td className="p-1">✓</td>
                              <td className="p-1">model | dataset | application | collection</td>
                            </tr>
                            <tr className="border-b">
                              <td className="p-1"><code>manifest</code></td>
                              <td className="p-1">object</td>
                              <td className="p-1">✓</td>
                              <td className="p-1">Metadata (name, description, authors)</td>
                            </tr>
                            <tr className="border-b">
                              <td className="p-1"><code>alias</code></td>
                              <td className="p-1">string</td>
                              <td className="p-1"></td>
                              <td className="p-1">Custom ID or pattern</td>
                            </tr>
                            <tr className="border-b">
                              <td className="p-1"><code>config</code></td>
                              <td className="p-1">object</td>
                              <td className="p-1"></td>
                              <td className="p-1">Additional configuration</td>
                            </tr>
                            <tr className="border-b">
                              <td className="p-1"><code>version</code></td>
                              <td className="p-1">string</td>
                              <td className="p-1"></td>
                              <td className="p-1">Version or "draft"/"stage"</td>
                            </tr>
                            <tr className="border-b">
                              <td className="p-1"><code>stage</code></td>
                              <td className="p-1">boolean</td>
                              <td className="p-1"></td>
                              <td className="p-1">Create as staged version</td>
                            </tr>
                            <tr>
                              <td className="p-1"><code>overwrite</code></td>
                              <td className="p-1">boolean</td>
                              <td className="p-1"></td>
                              <td className="p-1">Replace if exists</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </details>
                  </div>

                  <div>
                    <div className="flex items-center space-x-2 mb-2">
                      <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded">GET</span>
                      <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded">POST</span>
                      <code className="text-sm font-mono">/public/services/artifact-manager/read</code>
                    </div>
                    <p className="text-sm text-gray-600 ml-12">Get artifact details</p>
                    <details className="ml-12 mt-2">
                      <summary className="text-xs text-gray-500 cursor-pointer">Parameters</summary>
                      <div className="mt-2 bg-gray-50 p-3 rounded">
                        <table className="text-xs w-full">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left font-medium p-1">Parameter</th>
                              <th className="text-left font-medium p-1">Type</th>
                              <th className="text-left font-medium p-1">Required</th>
                              <th className="text-left font-medium p-1">Description</th>
                            </tr>
                          </thead>
                          <tbody className="text-gray-600">
                            <tr className="border-b">
                              <td className="p-1"><code>artifact_id</code></td>
                              <td className="p-1">string</td>
                              <td className="p-1">✓</td>
                              <td className="p-1">Artifact identifier</td>
                            </tr>
                            <tr className="border-b">
                              <td className="p-1"><code>silent</code></td>
                              <td className="p-1">boolean</td>
                              <td className="p-1"></td>
                              <td className="p-1">Don't increment view count</td>
                            </tr>
                            <tr className="border-b">
                              <td className="p-1"><code>version</code></td>
                              <td className="p-1">string</td>
                              <td className="p-1"></td>
                              <td className="p-1">Specific version</td>
                            </tr>
                            <tr>
                              <td className="p-1"><code>stage</code></td>
                              <td className="p-1">boolean</td>
                              <td className="p-1"></td>
                              <td className="p-1">Get staged version</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </details>
                  </div>

                  <div>
                    <div className="flex items-center space-x-2 mb-2">
                      <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded">POST</span>
                      <code className="text-sm font-mono">/public/services/artifact-manager/edit</code>
                    </div>
                    <p className="text-sm text-gray-600 ml-12">Update artifact</p>
                    <details className="ml-12 mt-2">
                      <summary className="text-xs text-gray-500 cursor-pointer">Parameters</summary>
                      <div className="mt-2 bg-gray-50 p-3 rounded">
                        <table className="text-xs w-full">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left font-medium p-1">Parameter</th>
                              <th className="text-left font-medium p-1">Type</th>
                              <th className="text-left font-medium p-1">Required</th>
                              <th className="text-left font-medium p-1">Description</th>
                            </tr>
                          </thead>
                          <tbody className="text-gray-600">
                            <tr className="border-b">
                              <td className="p-1"><code>artifact_id</code></td>
                              <td className="p-1">string</td>
                              <td className="p-1">✓</td>
                              <td className="p-1">Artifact identifier</td>
                            </tr>
                            <tr className="border-b">
                              <td className="p-1"><code>manifest</code></td>
                              <td className="p-1">object</td>
                              <td className="p-1"></td>
                              <td className="p-1">Updated metadata</td>
                            </tr>
                            <tr className="border-b">
                              <td className="p-1"><code>config</code></td>
                              <td className="p-1">object</td>
                              <td className="p-1"></td>
                              <td className="p-1">Updated configuration</td>
                            </tr>
                            <tr className="border-b">
                              <td className="p-1"><code>version</code></td>
                              <td className="p-1">string</td>
                              <td className="p-1"></td>
                              <td className="p-1">Version to edit</td>
                            </tr>
                            <tr>
                              <td className="p-1"><code>stage</code></td>
                              <td className="p-1">boolean</td>
                              <td className="p-1"></td>
                              <td className="p-1">Edit staged version</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </details>
                  </div>

                  <div>
                    <div className="flex items-center space-x-2 mb-2">
                      <span className="px-2 py-1 bg-red-100 text-red-800 text-xs font-medium rounded">POST</span>
                      <code className="text-sm font-mono">/public/services/artifact-manager/delete</code>
                    </div>
                    <p className="text-sm text-gray-600 ml-12">Delete artifact</p>
                    <details className="ml-12 mt-2">
                      <summary className="text-xs text-gray-500 cursor-pointer">Parameters</summary>
                      <div className="mt-2 bg-gray-50 p-3 rounded">
                        <table className="text-xs w-full">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left font-medium p-1">Parameter</th>
                              <th className="text-left font-medium p-1">Type</th>
                              <th className="text-left font-medium p-1">Required</th>
                              <th className="text-left font-medium p-1">Description</th>
                            </tr>
                          </thead>
                          <tbody className="text-gray-600">
                            <tr className="border-b">
                              <td className="p-1"><code>artifact_id</code></td>
                              <td className="p-1">string</td>
                              <td className="p-1">✓</td>
                              <td className="p-1">Artifact identifier</td>
                            </tr>
                            <tr className="border-b">
                              <td className="p-1"><code>delete_files</code></td>
                              <td className="p-1">boolean</td>
                              <td className="p-1"></td>
                              <td className="p-1">Also delete S3 files</td>
                            </tr>
                            <tr className="border-b">
                              <td className="p-1"><code>recursive</code></td>
                              <td className="p-1">boolean</td>
                              <td className="p-1"></td>
                              <td className="p-1">Delete child artifacts</td>
                            </tr>
                            <tr>
                              <td className="p-1"><code>version</code></td>
                              <td className="p-1">string</td>
                              <td className="p-1"></td>
                              <td className="p-1">Specific version to delete</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </details>
                  </div>

                  <div>
                    <div className="flex items-center space-x-2 mb-2">
                      <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded">GET</span>
                      <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded">POST</span>
                      <code className="text-sm font-mono">/public/services/artifact-manager/list_children</code>
                    </div>
                    <p className="text-sm text-gray-600 ml-12">List child artifacts</p>
                    <details className="ml-12 mt-2">
                      <summary className="text-xs text-gray-500 cursor-pointer">Parameters</summary>
                      <div className="mt-2 bg-gray-50 p-3 rounded">
                        <table className="text-xs w-full">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left font-medium p-1">Parameter</th>
                              <th className="text-left font-medium p-1">Type</th>
                              <th className="text-left font-medium p-1">Required</th>
                              <th className="text-left font-medium p-1">Description</th>
                            </tr>
                          </thead>
                          <tbody className="text-gray-600">
                            <tr className="border-b">
                              <td className="p-1"><code>parent_id</code></td>
                              <td className="p-1">string</td>
                              <td className="p-1"></td>
                              <td className="p-1">Parent artifact ID</td>
                            </tr>
                            <tr className="border-b">
                              <td className="p-1"><code>keywords</code></td>
                              <td className="p-1">string[]</td>
                              <td className="p-1"></td>
                              <td className="p-1">Search keywords</td>
                            </tr>
                            <tr className="border-b">
                              <td className="p-1"><code>filters</code></td>
                              <td className="p-1">object</td>
                              <td className="p-1"></td>
                              <td className="p-1">Filter criteria</td>
                            </tr>
                            <tr className="border-b">
                              <td className="p-1"><code>mode</code></td>
                              <td className="p-1">string</td>
                              <td className="p-1"></td>
                              <td className="p-1">"AND" or "OR" (default: AND)</td>
                            </tr>
                            <tr className="border-b">
                              <td className="p-1"><code>offset</code></td>
                              <td className="p-1">integer</td>
                              <td className="p-1"></td>
                              <td className="p-1">Skip first N results</td>
                            </tr>
                            <tr className="border-b">
                              <td className="p-1"><code>limit</code></td>
                              <td className="p-1">integer</td>
                              <td className="p-1"></td>
                              <td className="p-1">Max results (default: 100)</td>
                            </tr>
                            <tr className="border-b">
                              <td className="p-1"><code>order_by</code></td>
                              <td className="p-1">string</td>
                              <td className="p-1"></td>
                              <td className="p-1">Sort field</td>
                            </tr>
                            <tr>
                              <td className="p-1"><code>stage</code></td>
                              <td className="p-1">bool/string</td>
                              <td className="p-1"></td>
                              <td className="p-1">true, false, or "all"</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </details>
                  </div>

                  <div>
                    <div className="flex items-center space-x-2 mb-2">
                      <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded">POST</span>
                      <code className="text-sm font-mono">/public/services/artifact-manager/put_file</code>
                    </div>
                    <p className="text-sm text-gray-600 ml-12">Get upload URL for file</p>
                    <details className="ml-12 mt-2">
                      <summary className="text-xs text-gray-500 cursor-pointer">Parameters</summary>
                      <div className="mt-2 bg-gray-50 p-3 rounded">
                        <table className="text-xs w-full">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left font-medium p-1">Parameter</th>
                              <th className="text-left font-medium p-1">Type</th>
                              <th className="text-left font-medium p-1">Required</th>
                              <th className="text-left font-medium p-1">Description</th>
                            </tr>
                          </thead>
                          <tbody className="text-gray-600">
                            <tr className="border-b">
                              <td className="p-1"><code>artifact_id</code></td>
                              <td className="p-1">string</td>
                              <td className="p-1">✓</td>
                              <td className="p-1">Target artifact ID</td>
                            </tr>
                            <tr className="border-b">
                              <td className="p-1"><code>file_path</code></td>
                              <td className="p-1">string</td>
                              <td className="p-1">✓</td>
                              <td className="p-1">File path/name</td>
                            </tr>
                            <tr className="border-b">
                              <td className="p-1"><code>download_weight</code></td>
                              <td className="p-1">float</td>
                              <td className="p-1"></td>
                              <td className="p-1">Weight for stats (default: 0)</td>
                            </tr>
                            <tr>
                              <td className="p-1"><code>expires_in</code></td>
                              <td className="p-1">integer</td>
                              <td className="p-1"></td>
                              <td className="p-1">URL expiration (default: 3600)</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </details>
                  </div>

                  <div>
                    <div className="flex items-center space-x-2 mb-2">
                      <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded">GET</span>
                      <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded">POST</span>
                      <code className="text-sm font-mono">/public/services/artifact-manager/get_file</code>
                    </div>
                    <p className="text-sm text-gray-600 ml-12">Get download URL for file</p>
                    <details className="ml-12 mt-2">
                      <summary className="text-xs text-gray-500 cursor-pointer">Parameters</summary>
                      <div className="mt-2 bg-gray-50 p-3 rounded">
                        <table className="text-xs w-full">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left font-medium p-1">Parameter</th>
                              <th className="text-left font-medium p-1">Type</th>
                              <th className="text-left font-medium p-1">Required</th>
                              <th className="text-left font-medium p-1">Description</th>
                            </tr>
                          </thead>
                          <tbody className="text-gray-600">
                            <tr className="border-b">
                              <td className="p-1"><code>artifact_id</code></td>
                              <td className="p-1">string</td>
                              <td className="p-1">✓</td>
                              <td className="p-1">Source artifact ID</td>
                            </tr>
                            <tr className="border-b">
                              <td className="p-1"><code>file_path</code></td>
                              <td className="p-1">string</td>
                              <td className="p-1">✓</td>
                              <td className="p-1">File path/name</td>
                            </tr>
                            <tr className="border-b">
                              <td className="p-1"><code>silent</code></td>
                              <td className="p-1">boolean</td>
                              <td className="p-1"></td>
                              <td className="p-1">Don't track download</td>
                            </tr>
                            <tr className="border-b">
                              <td className="p-1"><code>version</code></td>
                              <td className="p-1">string</td>
                              <td className="p-1"></td>
                              <td className="p-1">Specific version</td>
                            </tr>
                            <tr className="border-b">
                              <td className="p-1"><code>stage</code></td>
                              <td className="p-1">boolean</td>
                              <td className="p-1"></td>
                              <td className="p-1">Get staged version</td>
                            </tr>
                            <tr>
                              <td className="p-1"><code>expires_in</code></td>
                              <td className="p-1">integer</td>
                              <td className="p-1"></td>
                              <td className="p-1">URL expiration (default: 3600)</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </details>
                  </div>

                  <div>
                    <div className="flex items-center space-x-2 mb-2">
                      <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded">GET</span>
                      <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded">POST</span>
                      <code className="text-sm font-mono">/public/services/artifact-manager/list_files</code>
                    </div>
                    <p className="text-sm text-gray-600 ml-12">List files in artifact</p>
                    <details className="ml-12 mt-2">
                      <summary className="text-xs text-gray-500 cursor-pointer">Parameters</summary>
                      <div className="mt-2 bg-gray-50 p-3 rounded">
                        <table className="text-xs w-full">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left font-medium p-1">Parameter</th>
                              <th className="text-left font-medium p-1">Type</th>
                              <th className="text-left font-medium p-1">Required</th>
                              <th className="text-left font-medium p-1">Description</th>
                            </tr>
                          </thead>
                          <tbody className="text-gray-600">
                            <tr className="border-b">
                              <td className="p-1"><code>artifact_id</code></td>
                              <td className="p-1">string</td>
                              <td className="p-1">✓</td>
                              <td className="p-1">Artifact identifier</td>
                            </tr>
                            <tr className="border-b">
                              <td className="p-1"><code>dir_path</code></td>
                              <td className="p-1">string</td>
                              <td className="p-1"></td>
                              <td className="p-1">Directory path</td>
                            </tr>
                            <tr className="border-b">
                              <td className="p-1"><code>limit</code></td>
                              <td className="p-1">integer</td>
                              <td className="p-1"></td>
                              <td className="p-1">Max files (default: 1000)</td>
                            </tr>
                            <tr className="border-b">
                              <td className="p-1"><code>version</code></td>
                              <td className="p-1">string</td>
                              <td className="p-1"></td>
                              <td className="p-1">Specific version</td>
                            </tr>
                            <tr>
                              <td className="p-1"><code>stage</code></td>
                              <td className="p-1">boolean</td>
                              <td className="p-1"></td>
                              <td className="p-1">List staged files</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </details>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Method Documentation */}
          <div>
            <h3 className="text-xl font-medium text-gray-900 mb-4">Method Parameters</h3>
            <p className="text-gray-600 mb-4">
              Detailed parameter documentation for key service methods:
            </p>

            <div className="space-y-4">
              {/* create method */}
              <details className="border rounded-lg p-4">
                <summary className="font-medium text-gray-900 cursor-pointer">
                  create(parent_id, type, manifest, alias?, config?, version?)
                </summary>
                <div className="mt-4 space-y-2 text-sm">
                  <p className="text-gray-600">Creates a new artifact in the collection.</p>
                  <div className="bg-gray-50 rounded p-3 mt-3">
                    <h5 className="font-medium mb-2">Parameters:</h5>
                    <ul className="space-y-1 text-gray-600">
                      <li><code className="font-mono">parent_id</code> - Parent collection ID (e.g., "bioimage-io/bioimage.io")</li>
                      <li><code className="font-mono">type</code> - Artifact type: "model", "dataset", "application", or "collection"</li>
                      <li><code className="font-mono">manifest</code> - Metadata object with name, description, authors, etc.</li>
                      <li><code className="font-mono">alias</code> - Custom ID or pattern like <code>{`{animal_adjective}-{animal}`}</code></li>
                      <li><code className="font-mono">config</code> - Additional configuration (e.g., publish_to settings)</li>
                      <li><code className="font-mono">version</code> - Version identifier or "draft"/"stage"</li>
                    </ul>
                  </div>
                </div>
              </details>

              {/* list method */}
              <details className="border rounded-lg p-4">
                <summary className="font-medium text-gray-900 cursor-pointer">
                  list(parent_id?, keywords?, filters?, limit?, offset?, order_by?)
                </summary>
                <div className="mt-4 space-y-2 text-sm">
                  <p className="text-gray-600">Lists and searches artifacts.</p>
                  <div className="bg-gray-50 rounded p-3 mt-3">
                    <h5 className="font-medium mb-2">Parameters:</h5>
                    <ul className="space-y-1 text-gray-600">
                      <li><code className="font-mono">parent_id</code> - Parent artifact to list children from</li>
                      <li><code className="font-mono">keywords</code> - Comma-separated search terms</li>
                      <li><code className="font-mono">filters</code> - JSON object with filter criteria</li>
                      <li><code className="font-mono">limit</code> - Maximum results (default: 100)</li>
                      <li><code className="font-mono">offset</code> - Skip first N results</li>
                      <li><code className="font-mono">order_by</code> - Sort field (e.g., "created", "downloads")</li>
                    </ul>
                  </div>
                </div>
              </details>

              {/* put_file method */}
              <details className="border rounded-lg p-4">
                <summary className="font-medium text-gray-900 cursor-pointer">
                  put_file(artifact_id, file_path, download_weight?)
                </summary>
                <div className="mt-4 space-y-2 text-sm">
                  <p className="text-gray-600">Gets a pre-signed URL for uploading a file.</p>
                  <div className="bg-gray-50 rounded p-3 mt-3">
                    <h5 className="font-medium mb-2">Parameters:</h5>
                    <ul className="space-y-1 text-gray-600">
                      <li><code className="font-mono">artifact_id</code> - Target artifact ID</li>
                      <li><code className="font-mono">file_path</code> - Path/name for the file</li>
                      <li><code className="font-mono">download_weight</code> - Weight for download statistics</li>
                    </ul>
                    <h5 className="font-medium mb-2 mt-3">Returns:</h5>
                    <p className="text-gray-600">Pre-signed URL for PUT request to upload the file</p>
                  </div>
                </div>
              </details>
            </div>
          </div>

          {/* Full documentation link */}
          <div className="bg-gray-50 border rounded-lg p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-2">📚 Complete Documentation</h3>
            <p className="text-gray-600 mb-3">
              For the complete Artifact Manager documentation including advanced features, vector operations, 
              and publishing workflows, visit:
            </p>
            <a 
              href="https://docs.amun.ai/#/artifact-manager" 
              target="_blank" 
              rel="noopener noreferrer"
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
            >
              View Full Documentation →
            </a>
          </div>
        </div>
      )}

      {/* Hypha RPC Tab */}
      {activeMainTab === 'hypha-rpc' && (
        <div className="space-y-8">
          <div>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">🔌 Hypha RPC Client</h2>
            <p className="text-gray-600 mb-6">
              The Hypha RPC client provides a more powerful, WebSocket-based interface for interacting with the RI-SCALE Model Hub. 
              It offers real-time communication, better error handling, and native support for Python and JavaScript.
            </p>
            
            <div className="bg-blue-50 border-l-4 border-blue-400 p-4 mb-6">
              <h3 className="text-lg font-medium text-blue-800 mb-2">✨ Why Use Hypha RPC?</h3>
              <ul className="list-disc list-inside text-blue-700 space-y-1">
                <li>Persistent WebSocket connections for better performance</li>
                <li>Automatic reconnection and session management</li>
                <li>Type-safe method calls with better error messages</li>
                <li>Support for large file transfers via WebRTC</li>
                <li>Real-time updates and event subscriptions</li>
              </ul>
            </div>
          </div>

          {/* Installation */}
          <div>
            <h3 className="text-xl font-medium text-gray-900 mb-4">Installation</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h4 className="font-medium text-gray-700 mb-2">Python</h4>
                <div className="bg-gray-900 rounded-lg overflow-hidden">
                  <SyntaxHighlighter 
                    language="bash"
                    style={vscDarkPlus}
                    customStyle={{
                      fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                      fontSize: '14px',
                      background: '#111827',
                      padding: '1rem',
                      margin: 0,
                      borderRadius: '0.5rem'
                    }}
                  >
                    {`pip install hypha-rpc`}
                  </SyntaxHighlighter>
                </div>
              </div>
              <div>
                <h4 className="font-medium text-gray-700 mb-2">JavaScript</h4>
                <div className="bg-gray-900 rounded-lg overflow-hidden">
                  <SyntaxHighlighter 
                    language="bash"
                    style={vscDarkPlus}
                    customStyle={{
                      fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                      fontSize: '14px',
                      background: '#111827',
                      padding: '1rem',
                      margin: 0,
                      borderRadius: '0.5rem'
                    }}
                  >
                    {`npm install hypha-rpc`}
                  </SyntaxHighlighter>
                </div>
              </div>
            </div>
          </div>

          {/* Complete Examples */}
          <div>
            <h3 className="text-xl font-medium text-gray-900 mb-4">Complete Examples</h3>
            
            {/* Language tabs */}
            <div className="border-b border-gray-200 mb-4">
              <nav className="-mb-px flex space-x-6">
                <button
                  onClick={() => setActiveHyphaLanguageTab('python')}
                  className={`${
                    activeHyphaLanguageTab === 'python'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  } py-2 px-1 border-b-2 font-medium text-sm`}
                >
                  Python
                </button>
                <button
                  onClick={() => setActiveHyphaLanguageTab('javascript')}
                  className={`${
                    activeHyphaLanguageTab === 'javascript'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  } py-2 px-1 border-b-2 font-medium text-sm`}
                >
                  JavaScript
                </button>
              </nav>
            </div>

            <div className="bg-gray-900 rounded-lg overflow-hidden">
              <SyntaxHighlighter 
                language={activeHyphaLanguageTab}
                style={vscDarkPlus}
                showLineNumbers={true}
                customStyle={{
                  fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                  fontSize: '14px',
                  background: '#111827',
                  padding: '1.5rem',
                  margin: 0,
                  borderRadius: '0.5rem'
                }}
              >
                {activeHyphaLanguageTab === 'python' ? 
`import asyncio
from hypha_rpc import connect_to_server

async def main():
    # Connect to the Hypha server
    server = await connect_to_server({
        "server_url": "https://hypha.aicell.io",
        "token": "your-api-token"  # Optional, for authenticated access
    })
    
    # Get the artifact manager service
    artifact_manager = await server.get_service("public/artifact-manager")
    
    # List available models
    models = await artifact_manager.list(
        parent_id="bioimage-io/bioimage.io",
        keywords="segmentation",
        limit=5
    )
    
    print(f"Found {len(models)} segmentation models:")
    for model in models:
        print(f"  - {model['alias']}: {model['manifest'].get('name', 'N/A')}")
    
    # Get details of a specific model
    model = await artifact_manager.read(
        artifact_id="bioimage-io/affable-shark"
    )
    print(f"\\nModel: {model['manifest']['name']}")
    print(f"Description: {model['manifest']['description']}")
    
    # List files in the model
    files = await artifact_manager.list_files(
        artifact_id="bioimage-io/affable-shark"
    )
    print(f"\\nModel contains {len(files)} files")
    
    # Get download URL for a file
    download_url = await artifact_manager.get_file(
        artifact_id="bioimage-io/affable-shark",
        file_path="weights.pt"
    )
    print(f"\\nDownload URL for weights: {download_url[:50]}...")
    
    # Create a new model (requires authentication)
    new_model = await artifact_manager.create(
        parent_id="bioimage-io/bioimage.io",
        type="model",
        manifest={
            "name": "My Test Model",
            "description": "A test model for demonstration",
            "authors": [{"name": "Your Name"}],
            "tags": ["test", "demo"]
        },
        alias="{animal_adjective}-{animal}",  # Auto-generate name
        version="draft"
    )
    print(f"\\nCreated new model: {new_model['id']}")
    
    # Upload a file to the model
    upload_url = await artifact_manager.put_file(
        artifact_id=new_model['id'],
        file_path="weights.pt"
    )
    print(f"Upload URL: {upload_url[:50]}...")
    # Now use the upload_url with requests.put() to upload your file

if __name__ == "__main__":
    asyncio.run(main())` :
`import { hyphaWebsocketClient } from 'hypha-rpc';

async function main() {
    // Connect to the Hypha server
    const server = await hyphaWebsocketClient.connectToServer({
        server_url: "https://hypha.aicell.io",
        token: "your-api-token"  // Optional, for authenticated access
    });
    
    // Get the artifact manager service
    // Note: case_conversion for automatic snake_case to camelCase conversion
    const artifactManager = await server.getService(
        "public/artifact-manager",
        { case_conversion: "camel" }
    );
    
    // List available models
    // Note: _rkwargs ensures parameters are passed as keyword arguments
    const models = await artifactManager.list({
        parent_id: "bioimage-io/bioimage.io",
        keywords: "segmentation",
        limit: 5,
        _rkwargs: true
    });
    
    console.log(\`Found \${models.length} segmentation models:\`);
    models.forEach(model => {
        console.log(\`  - \${model.alias}: \${model.manifest.name || 'N/A'}\`);
    });
    
    // Get details of a specific model
    const model = await artifactManager.read({
        artifact_id: "bioimage-io/affable-shark",
        _rkwargs: true
    });
    console.log(\`\\nModel: \${model.manifest.name}\`);
    console.log(\`Description: \${model.manifest.description}\`);
    
    // List files in the model
    const files = await artifactManager.listFiles({
        artifact_id: "bioimage-io/affable-shark",
        _rkwargs: true
    });
    console.log(\`\\nModel contains \${files.length} files\`);
    
    // Get download URL for a file
    const downloadUrl = await artifactManager.getFile({
        artifact_id: "bioimage-io/affable-shark",
        file_path: "weights.pt",
        _rkwargs: true
    });
    console.log(\`\\nDownload URL: \${downloadUrl.substring(0, 50)}...\`);
    
    // Create a new model (requires authentication)
    const newModel = await artifactManager.create({
        parent_id: "bioimage-io/bioimage.io",
        type: "model",
        manifest: {
            name: "My Test Model",
            description: "A test model for demonstration",
            authors: [{ name: "Your Name" }],
            tags: ["test", "demo"]
        },
        alias: "{animal_adjective}-{animal}",  // Auto-generate name
        version: "draft",
        _rkwargs: true
    });
    console.log(\`\\nCreated new model: \${newModel.id}\`);
    
    // Upload a file to the model
    const uploadUrl = await artifactManager.putFile({
        artifact_id: newModel.id,
        file_path: "weights.pt",
        _rkwargs: true
    });
    console.log(\`Upload URL: \${uploadUrl.substring(0, 50)}...\`);
    // Now use fetch with PUT method to upload your file
}

main().catch(console.error);`}
              </SyntaxHighlighter>
            </div>
          </div>

          {/* Important Notes */}
          <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
            <h3 className="text-lg font-medium text-yellow-800 mb-2">⚠️ Important Notes</h3>
            <ul className="list-disc list-inside text-yellow-700 space-y-1 text-sm">
              <li>JavaScript requires <code>case_conversion: "camel"</code> to convert Python's snake_case to camelCase</li>
              <li>JavaScript requires <code>_rkwargs: true</code> in each method call for proper parameter passing</li>
              <li>All methods return Promises and should be awaited</li>
              <li>Error handling with try-catch blocks is recommended for production code</li>
              <li>The WebSocket connection automatically reconnects on disconnection</li>
            </ul>
          </div>
        </div>
      )}

      {/* FAQs Tab */}
      {activeMainTab === 'faqs' && (
        <div className="space-y-8">
          <div>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">❓ Frequently Asked Questions</h2>
          </div>

          <div className="space-y-4">
            <details className="border rounded-lg p-4">
              <summary className="font-medium text-gray-900 cursor-pointer">
                What's the difference between HTTP API and Hypha RPC?
              </summary>
              <div className="mt-3 text-gray-600">
                <p className="mb-2">
                  <strong>HTTP API</strong> is ideal for simple operations, one-time requests, and when you need compatibility 
                  with any programming language or tool. It's stateless and uses standard REST conventions.
                </p>
                <p>
                  <strong>Hypha RPC</strong> is better for complex applications, real-time updates, and when you need 
                  persistent connections. It offers better performance for multiple operations and supports advanced 
                  features like WebRTC file transfers.
                </p>
              </div>
            </details>

            <details className="border rounded-lg p-4">
              <summary className="font-medium text-gray-900 cursor-pointer">
                How do I authenticate my API requests?
              </summary>
              <div className="mt-3 text-gray-600">
                <p className="mb-2">
                  1. Generate an API token using the button in the "Generate API Token" section above (requires login)
                </p>
                <p className="mb-2">
                  2. For HTTP requests, include the token in the Authorization header:
                  <code className="block mt-1 p-2 bg-gray-100 rounded">Authorization: Bearer your-token-here</code>
                </p>
                <p>
                  3. For Hypha RPC, pass the token when connecting:
                  <code className="block mt-1 p-2 bg-gray-100 rounded">{`connect_to_server({"server_url": "...", "token": "your-token"})`}</code>
                </p>
              </div>
            </details>

            <details className="border rounded-lg p-4">
              <summary className="font-medium text-gray-900 cursor-pointer">
                What are the naming patterns for new artifacts?
              </summary>
              <div className="mt-3 text-gray-600">
                <p className="mb-2">You can use auto-generated aliases with these patterns:</p>
                <ul className="list-disc list-inside space-y-1 ml-4">
                  <li><strong>Models:</strong> <code>{`{animal_adjective}-{animal}`}</code> (e.g., "affable-shark")</li>
                  <li><strong>Applications:</strong> <code>{`{object_adjective}-{object}`}</code> (e.g., "shiny-hammer")</li>
                  <li><strong>Datasets:</strong> <code>{`{fruit_adjective}-{fruit}`}</code> (e.g., "sweet-apple")</li>
                </ul>
                <p className="mt-2">Or provide your own custom alias that's unique within the workspace.</p>
              </div>
            </details>

            <details className="border rounded-lg p-4">
              <summary className="font-medium text-gray-900 cursor-pointer">
                How do I upload large files efficiently?
              </summary>
              <div className="mt-3 text-gray-600">
                <p className="mb-2">
                  1. Use the <code>put_file</code> method to get a pre-signed upload URL
                </p>
                <p className="mb-2">
                  2. Upload directly to the URL using PUT request (this goes directly to S3)
                </p>
                <p className="mb-2">
                  3. For very large files, consider using multipart upload or WebRTC transfer via Hypha RPC
                </p>
                <p>
                  4. Remember to set <code>Content-Type: ""</code> header when uploading to S3 URLs
                </p>
              </div>
            </details>

            <details className="border rounded-lg p-4">
              <summary className="font-medium text-gray-900 cursor-pointer">
                What's the difference between "stage", and published versions?
              </summary>
              <div className="mt-3 text-gray-600">
                <ul className="list-disc list-inside space-y-2">
                  <li><strong>Stage:</strong> For review, can be tested but not yet public</li>
                  <li><strong>Published:</strong> Final version, publicly available and immutable</li>
                </ul>
                <p className="mt-2">
                  Use <code>version="draft"</code> when creating, then update status to "request-review" when ready.
                </p>
              </div>
            </details>

            <details className="border rounded-lg p-4">
              <summary className="font-medium text-gray-900 cursor-pointer">
                How do I search for specific types of models?
              </summary>
              <div className="mt-3 text-gray-600">
                <p className="mb-2">Use the <code>keywords</code> and <code>filters</code> parameters:</p>
                <div className="bg-gray-100 rounded p-3 mt-2">
                  <code className="text-sm">
                    {`// Search by keywords
?keywords=segmentation,cell,unet

// Filter by type
?filters={"type":"model","tags":["3d"]}

// Combine both
?keywords=nucleus&filters={"format_version":"0.4.0"}`}
                  </code>
                </div>
              </div>
            </details>

            <details className="border rounded-lg p-4">
              <summary className="font-medium text-gray-900 cursor-pointer">
                Can I access private/unpublished models?
              </summary>
              <div className="mt-3 text-gray-600">
                <p>
                  Yes, if you have the appropriate permissions. You'll need to:
                </p>
                <ul className="list-disc list-inside mt-2 space-y-1">
                  <li>Be authenticated with a valid API token</li>
                  <li>Have been granted access by the model owner</li>
                  <li>Include your token in all API requests</li>
                </ul>
                <p className="mt-2">
                  Your own models in "draft" or "stage" status are always accessible to you when authenticated.
                </p>
              </div>
            </details>

            <details className="border rounded-lg p-4">
              <summary className="font-medium text-gray-900 cursor-pointer">
                What file formats are supported for models?
              </summary>
              <div className="mt-3 text-gray-600">
                <p>The RI-SCALE Model Hub supports various formats including:</p>
                <ul className="list-disc list-inside mt-2 space-y-1">
                  <li>Model weights: .pt, .pth (PyTorch), .h5 (Keras/TensorFlow), .onnx, etc.</li>
                  <li>Metadata: rdf.yaml (model specification)</li>
                  <li>Documentation: .md files</li>
                  <li>Images: .png, .jpg for covers and previews</li>
                  <li>Sample data: .tif, .tiff, .npy, etc.</li>
                </ul>
              </div>
            </details>

            <details className="border rounded-lg p-4">
              <summary className="font-medium text-gray-900 cursor-pointer">
                How can I contribute a model to the zoo?
              </summary>
              <div className="mt-3 text-gray-600">
                <ol className="list-decimal list-inside space-y-2">
                  <li>Prepare your model following the bioimage.io specification</li>
                  <li>Create an account and generate an API token</li>
                  <li>Use the upload example in the "Getting Started" section to create your model</li>
                  <li>Upload all required files (weights, rdf.yaml, cover image, etc.)</li>
                  <li>Set status to "request-review" when ready</li>
                  <li>The RI-SCALE Model Hub team will review and publish your model</li>
                </ol>
              </div>
            </details>

            <details className="border rounded-lg p-4">
              <summary className="font-medium text-gray-900 cursor-pointer">
                Where can I get help or report issues?
              </summary>
              <div className="mt-3 text-gray-600">
                <ul className="list-disc list-inside space-y-2">
                  <li>
                    <strong>RI-SCALE Model Hub issues:</strong>{' '}
                    <a href="https://issues" className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">
                      GitHub Issues
                    </a>
                  </li>
                  <li>
                    <strong>API/Technical issues:</strong>{' '}
                    <a href="https://github.com/amun-ai/hypha/issues" className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">
                      Hypha GitHub Issues
                    </a>
                  </li>
                  <li>
                    <strong>Community forum:</strong>{' '}
                    <a href="https://forum.image.sc/tag/bioimage-io" className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">
                      Image.sc Forum
                    </a>
                  </li>
                  <li>
                    <strong>Documentation:</strong>{' '}
                    <a href="https://docs.amun.ai" className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">
                      Hypha Docs
                    </a>
                  </li>
                </ul>
              </div>
            </details>
          </div>
        </div>
      )}
    </div>
  );
};

export default ApiDocs;