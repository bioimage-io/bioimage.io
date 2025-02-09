import React, { useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vs } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useHyphaStore } from '../store/hyphaStore';
import { ClipboardIcon, CheckIcon } from '@heroicons/react/24/outline';

const ApiDocs: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'python' | 'javascript'>('python');
  const [token, setToken] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const { server, user } = useHyphaStore();

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

  // Add token section component
  const TokenSection = () => (
    <div className="mb-8 p-6 bg-gray-50 rounded-lg border border-gray-200">
      <h3 className="text-lg font-medium text-gray-900 mb-4">Generate API Token</h3>
      {user ? (
        <div className="space-y-4">
          <p className="text-gray-600">
            Generate a new API token to use with the BioImage Model Zoo API.
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
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
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

  const pythonCode = `import os
import asyncio
from hypha_rpc import connect_to_server

async def interact_with_model_zoo():
    # Connect to the server
    server = await connect_to_server({
        "server_url": "https://hypha.aicell.io",
        "token": os.environ.get("BIOIMAGEIO_API_TOKEN")  # Your authentication token
    })

    # Get the artifact manager service
    artifact_manager = await server.get_service("public/artifact-manager")

    # List available models
    models = await artifact_manager.list({
        "parent_id": "bioimage-io/bioimage.io",
        "limit": 10
    })

    # Get details of a specific model
    model = await artifact_manager.read("nickname:your-model-id")

    # Download model files
    file_url = await artifact_manager.get_file({
        "artifact_id": f"bioimage-io/{model.id}",
        "file_path": "weights.pt"
    })

    # Upload a new model
    new_model = await artifact_manager.create({
        "parent_id": "bioimage-io/bioimage.io",
        "alias": "{zenodo_conceptrecid}",
        "type": "model",
        "manifest": your_manifest_dict,
        "config": {
            "publish_to": "sandbox_zenodo"
        },
        "version": "stage"
    })

    # Upload model files
    put_url = await artifact_manager.put_file({
        "artifact_id": f"bioimage-io/{new_model.id}",
        "file_path": "weights.pt"
    })
    # Use put_url to upload your file
    
    # Commit the changes
    await artifact_manager.commit({
        "artifact_id": f"bioimage-io/{new_model.id}",
    })
if __name__ == "__main__":
    asyncio.run(interact_with_model_zoo())
    `;

  const javascriptCode = `import { hyphaWebsocketClient } from 'hypha-rpc';

async function interactWithModelZoo() {
    // Connect to the server
    const server = await hyphaWebsocketClient.connectToServer({
        server_url: "https://hypha.aicell.io",
        token: "your-auth-token"  // Your authentication token
    });

    // Get the artifact manager service
    const artifactManager = await server.getService("public/artifact-manager");

    // List available models
    const models = await artifactManager.list({
        parent_id: "bioimage-io/bioimage.io",
        limit: 10
    });

    // Get details of a specific model
    const model = await artifactManager.read("bioimage-io/" + "nickname:your-model-id");

    // Download model files
    const fileUrl = await artifactManager.get_file({
        artifact_id: "bioimage-io/" + model.id,
        file_path: "weights.pt"
    });
    console.log(fileUrl);

    // Upload model files
    const putUrl = await artifactManager.put_file({
        artifact_id: newModel.id,
        file_path: "weights.pt"
    });

    // Commit the changes
    await artifactManager.commit({
        artifact_id: "bioimage-io/" + newModel.id,
    })
}`;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">
          BioImage Model Zoo API
        </h1>
        <p className="text-gray-600">
          Interact with the BioImage Model Zoo programmatically using our API. 
          Choose your preferred language below to see example code and documentation.
        </p>
      </div>

      {/* Add Token Section before the language tabs */}
      <TokenSection />

      {/* Language tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('python')}
            className={`${
              activeTab === 'python'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
          >
            Python
          </button>
          <button
            onClick={() => setActiveTab('javascript')}
            className={`${
              activeTab === 'javascript'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
          >
            JavaScript
          </button>
        </nav>
      </div>

      {/* Installation instructions */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Installation</h2>
        <div className="bg-gray-50 rounded-lg p-4">
          {activeTab === 'python' ? (
            <SyntaxHighlighter language="bash" style={vs}>
              pip install hypha-rpc
            </SyntaxHighlighter>
          ) : (
            <SyntaxHighlighter language="bash" style={vs}>
              npm install hypha-rpc
            </SyntaxHighlighter>
          )}
        </div>
      </div>

      {/* Code examples */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Example Usage</h2>
        <div className="bg-gray-50 rounded-lg p-4">
          <SyntaxHighlighter 
            language={activeTab} 
            style={vs}
            showLineNumbers={true}
          >
            {activeTab === 'python' ? pythonCode : javascriptCode}
          </SyntaxHighlighter>
        </div>
      </div>

      {/* API Reference */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">API Reference</h2>
        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">Authentication</h3>
            <p className="text-gray-600 mb-2">
              To use the API, you need an authentication token which can be generated by clicking the "Generate New Token" button above.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">Common Operations</h3>
            <ul className="list-disc list-inside text-gray-600 space-y-2">
              <li>List models: Get a list of all available models</li>
              <li>Read model: Get details about a specific model</li>
              <li>Download files: Get URLs for downloading model files</li>
              <li>Upload model: Create a new model entry</li>
              <li>Upload files: Add files to an existing model</li>
            </ul>
          </div>

          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">Error Handling</h3>
            <p className="text-gray-600">
              All API calls should be wrapped in try-catch blocks to handle potential errors.
              The API will return appropriate error messages and status codes.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ApiDocs; 