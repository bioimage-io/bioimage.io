import React, { useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useHyphaStore } from '../store/hyphaStore';
import { ClipboardIcon, CheckIcon } from '@heroicons/react/24/outline';

const ApiDocs: React.FC = () => {
  const [token, setToken] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const { server, user } = useHyphaStore();
  const [activeTab, setActiveTab] = useState<'python' | 'curl' | 'javascript'>('python');

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

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">API Documentation</h1>
      
      <div className="prose max-w-none mb-10">
        <p className="text-gray-600 text-lg">
          The RI-SCALE Model Hub provides a REST API for programmatic access to all models and artifacts.
          The base URL for the API is <code className="text-sm bg-gray-100 px-2 py-1 rounded">https://hypha.aicell.io</code>.
        </p>
      </div>

      {/* Authentication Section */}
      <section className="mb-12 border border-gray-200 rounded-xl p-6 bg-gray-50">
        <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <span>🔑</span> Authentication
        </h2>
        {user ? (
          <div className="space-y-4">
            <p className="text-gray-600">
              Generate a personal API token to authenticate your requests. Include this token in the header of your requests:
              <br />
              <code className="text-sm bg-gray-200 px-2 py-1 rounded mt-2 inline-block">Authorization: Bearer YOUR_TOKEN</code>
            </p>
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
              <button
                onClick={generateToken}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors font-medium text-sm"
              >
                Generate New Token
              </button>
              
              {token && (
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <input
                    type="text"
                    value={token}
                    readOnly
                    className="flex-1 sm:w-64 px-3 py-2 border border-gray-300 rounded-md font-mono text-sm bg-white"
                  />
                  <button
                    onClick={copyToClipboard}
                    className="p-2 border border-gray-300 rounded-md hover:bg-white transition-colors bg-gray-100"
                    title="Copy to clipboard"
                  >
                    {copied ? (
                      <CheckIcon className="h-5 w-5 text-green-600" />
                    ) : (
                      <ClipboardIcon className="h-5 w-5 text-gray-500" />
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 text-amber-700 bg-amber-50 p-4 rounded-lg border border-amber-200">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="font-medium">Please log in to generate an API token.</p>
          </div>
        )}
      </section>

      {/* Examples Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-gray-900">Common Operations</h2>
        <div className="flex bg-gray-100 p-1 rounded-lg">
          {(['python', 'curl', 'javascript'] as const).map((lang) => (
            <button
              key={lang}
              onClick={() => setActiveTab(lang)}
              className={`px-4 py-1.5 text-sm font-medium rounded-md capitalize transition-all ${
                activeTab === lang 
                  ? 'bg-white text-gray-900 shadow-sm' 
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {lang}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-8">
        {/* List Models */}
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
            <h3 className="font-medium text-gray-900">List Models</h3>
            <p className="text-sm text-gray-500 mt-1">Retrieve a paginated list of models from the hub.</p>
          </div>
          <SyntaxHighlighter 
            language={activeTab === 'curl' ? 'bash' : activeTab}
            style={vscDarkPlus}
            customStyle={{ margin: 0, borderRadius: 0, padding: '1.5rem' }}
          >
            {activeTab === 'python' ? `import requests

# List first 10 models
response = requests.get(
    "https://hypha.aicell.io/ri-scale/artifacts/ai-model-hub/children",
    params={"limit": 10}
)
models = response.json()

for model in models:
    print(f"{model['alias']}: {model['manifest']['name']}")` 
            : activeTab === 'javascript' ? `// List first 10 models
fetch("https://hypha.aicell.io/ri-scale/artifacts/ai-model-hub/children?limit=10")
  .then(res => res.json())
  .then(models => {
    models.forEach(model => {
      console.log(\`\${model.alias}: \${model.manifest.name}\`);
    });
  });`
            : `curl "https://hypha.aicell.io/ri-scale/artifacts/ai-model-hub/children?limit=10"`}
          </SyntaxHighlighter>
        </div>

        {/* Get Model Details */}
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
            <h3 className="font-medium text-gray-900">Get Model Details</h3>
            <p className="text-sm text-gray-500 mt-1">Get manifest and metadata for a specific model.</p>
          </div>
          <SyntaxHighlighter 
            language={activeTab === 'curl' ? 'bash' : activeTab}
            style={vscDarkPlus}
            customStyle={{ margin: 0, borderRadius: 0, padding: '1.5rem' }}
          >
            {activeTab === 'python' ? `import requests

# Get details for a specific model
model_id = "ri-scale/artifacts/affable-shark" # Example ID
response = requests.get(f"https://hypha.aicell.io/{model_id}")
details = response.json()

print(details['manifest'])`
            : activeTab === 'javascript' ? `const modelId = "ri-scale/artifacts/affable-shark"; // Example ID

fetch(\`https://hypha.aicell.io/\${modelId}\`)
  .then(res => res.json())
  .then(details => {
    console.log(details.manifest);
  });`
            : `curl "https://hypha.aicell.io/ri-scale/artifacts/affable-shark"`}
          </SyntaxHighlighter>
        </div>

        {/* Download File */}
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
            <h3 className="font-medium text-gray-900">Download Model File</h3>
            <p className="text-sm text-gray-500 mt-1">Download a specific file (e.g. weights, configuration) from a model.</p>
          </div>
          <SyntaxHighlighter 
            language={activeTab === 'curl' ? 'bash' : activeTab}
            style={vscDarkPlus}
            customStyle={{ margin: 0, borderRadius: 0, padding: '1.5rem' }}
          >
            {activeTab === 'python' ? `import requests

model_id = "ri-scale/artifacts/affable-shark"
file_path = "rdf.yaml"

url = f"https://hypha.aicell.io/{model_id}/files/{file_path}"
response = requests.get(url)

with open(file_path, 'wb') as f:
    f.write(response.content)`
            : activeTab === 'javascript' ? `const modelId = "ri-scale/artifacts/affable-shark";
const filePath = "rdf.yaml";

fetch(\`https://hypha.aicell.io/\${modelId}/files/\${filePath}\`)
  .then(res => res.blob())
  .then(blob => {
    // Handle file blob...
    console.log("File downloaded", blob.size);
  });`
            : `curl -O "https://hypha.aicell.io/ri-scale/artifacts/affable-shark/files/rdf.yaml"`}
          </SyntaxHighlighter>
        </div>
      </div>

      <div className="mt-12 text-center text-sm text-gray-500">
        <p>
          For more advanced usage, please refer to the <a href="https://docs.amun.ai/#/artifact-manager" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:align-top">Hypha Artifact Manager Documentation</a>.
        </p>
      </div>
    </div>
  );
};

export default ApiDocs;
