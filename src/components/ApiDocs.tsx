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
                    aria-label="API Token"
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
import httpx
import asyncio
from hypha_rpc import connect_to_server

async def interact_with_model_zoo():
    # Connect to the server
    server = await connect_to_server(
        server_url="https://hypha.aicell.io",
        token=os.environ.get("BIOIMAGEIO_API_TOKEN")  # Your authentication token
    )

    # Get the artifact manager service
    artifact_manager = await server.get_service("public/artifact-manager")

    # List available models
    models = await artifact_manager.list(
        parent_id="bioimage-io/bioimage.io",
        limit=10
    )
    print("Models in the model zoo:", len(models))

    # Get details of a specific model
    model = await artifact_manager.read(
        artifact_id="bioimage-io/affable-shark"
    )

    # List files of a specific model
    files = await artifact_manager.list_files(
        artifact_id="bioimage-io/affable-shark"
    )
    print("Files in the model:", files)

    # Download model files
    file_url = await artifact_manager.get_file(
        artifact_id="bioimage-io/affable-shark",
        file_path="weights.pt"
    )

    # Upload a new model
    # Create a manifest dictionary for the model
    model_rdf_dict = {
        "type": "model",
        "name": "My test model",
        "description": "This is a test model",
        "tags": ["test", "model"],
        "status": "request-review"
    }

    # Determine the alias pattern based on the artifact type
    alias_patterns = {
        "model": "{animal_adjective}-{animal}",
        "application": "{object_adjective}-{object}",
        "dataset": "{fruit_adjective}-{fruit}",
    }
    id_pattern = alias_patterns.get(model_rdf_dict["type"])
    
    new_model = await artifact_manager.create(
        parent_id="bioimage-io/bioimage.io",
        alias=id_pattern,
        type=model_rdf_dict["type"],
        manifest=model_rdf_dict,
        config={
            "publish_to": "sandbox_zenodo"
        },
        version="stage"
    )

    print(f"Model created with ID: {new_model.id}")

    # Upload model files
    put_url = await artifact_manager.put_file(
        artifact_id=new_model.id,
        file_path="weights.pt"
    )

    # Use put_url to upload your file
    async def upload_file(put_url, file_path):
        async with httpx.AsyncClient() as client:
            with open(file_path, 'rb') as file:
                response = await client.put(put_url, content=file)
                response.raise_for_status()
                print(f"File uploaded successfully: {response.status_code}")

    # Use put_url to upload your file
    await upload_file(put_url, "path/to/your/weights.pt")
    
    # Request for review
    new_model["manifest"]["status"] = "request-review"
    await artifact_manager.edit(
        artifact_id=new_model.id,
        version="stage",
        manifest=new_model["manifest"]
    )
    print(f"Model status updated to request-review")

    # Now you can see your model also in "My Artifacts" menu in the model zoo

if __name__ == "__main__":
    asyncio.run(interact_with_model_zoo())`;

  // Note: When calling Python backend from JavaScript:
  // 1. Use case_conversion: "camel" to automatically convert Python's snake_case to JavaScript's camelCase
  // 2. Add _rkwargs: true to each method call object to ensure parameters are passed as keyword arguments to Python
  const javascriptCode = `import { hyphaWebsocketClient } from 'hypha-rpc';

async function interactWithModelZoo() {
    // Connect to the server
    const server = await hyphaWebsocketClient.connectToServer({
        server_url: "https://hypha.aicell.io",
        token: "your-auth-token"  // Your authentication token
    });

    // Get the artifact manager service
    const artifactManager = await server.getService("public/artifact-manager", {
        case_conversion: "camel"
    });

    // List available models
    const models = await artifactManager.list({
        parent_id: "bioimage-io/bioimage.io",
        limit: 10,
        _rkwargs: true
    });
    console.log("Models in the model zoo:", models.length);

    // Get details of a specific model
    const model = await artifactManager.read({
        artifact_id: "bioimage-io/affable-shark",
        _rkwargs: true
    });

    // List files of a specific model
    const files = await artifactManager.listFiles({
        artifact_id: "bioimage-io/affable-shark",
        _rkwargs: true
    });
    console.log("Files in the model:", files);

    // Download model files
    const fileUrl = await artifactManager.getFile({
        artifact_id: "bioimage-io/affable-shark",
        file_path: "weights.pt",
        _rkwargs: true
    });

    // Upload a new model
    // Create a manifest dictionary for the model
    const modelRdfDict = {
        type: "model",
        name: "My test model",
        description: "This is a test model",
        tags: ["test", "model"],
        status: "request-review"
    };

    // Determine the alias pattern based on the artifact type
    const aliasPatterns = {
        model: "{animal_adjective}-{animal}",
        application: "{object_adjective}-{object}",
        dataset: "{fruit_adjective}-{fruit}",
    };
    const idPattern = aliasPatterns[modelRdfDict.type];

    const newModel = await artifactManager.create({
        parent_id: "bioimage-io/bioimage.io",
        alias: idPattern,
        type: modelRdfDict.type,
        manifest: modelRdfDict,
        config: {
            publish_to: "sandbox_zenodo"
        },
        version: "stage",
        _rkwargs: true
    });

    console.log("Model created with ID:", newModel.id);

    // Upload model files
    const putUrl = await artifactManager.putFile({
        artifact_id: newModel.id,
        file_path: "weights.pt",
        _rkwargs: true
    });

    // Use putUrl to upload your file
    async function uploadFile(putUrl, filePath) {
        const response = await fetch(putUrl, {
            method: 'PUT',
            body: await fetch(filePath).then(res => res.blob()),
            headers: {
                'Content-Type': '' // this is important for s3
            }
        });
        if (!response.ok) {
            throw new Error(\`Failed to upload file: \${response.status}\`);
        }
        console.log(\`File uploaded successfully: \${response.status}\`);
    }

    // Use putUrl to upload your file
    await uploadFile(putUrl, "path/to/your/weights.pt");

    // Request for review
    newModel.manifest.status = "request-review";
    await artifactManager.edit({
        artifact_id: newModel.id,
        version: "stage",
        manifest: newModel.manifest,
        _rkwargs: true
    });
    console.log("Model status updated to request-review");

    // Now you can see your model also in "My Artifacts" menu in the model zoo
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
            <SyntaxHighlighter 
              language="bash" 
              style={vs}
              customStyle={{
                fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                fontWeight: 600,
                fontSize: '14px',
                background: '#f9fafb'
              }}
            >
              pip install hypha-rpc
            </SyntaxHighlighter>
          ) : (
            <SyntaxHighlighter 
              language="bash" 
              style={vs}
              customStyle={{
                fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                fontWeight: 600,
                fontSize: '14px',
                background: '#f9fafb'
              }}
            >
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
            customStyle={{
              fontFamily: 'Monaco, Consolas, "Courier New", monospace',
              fontWeight: 600,
              fontSize: '14px',
              background: '#f9fafb'
            }}
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

      {/* HTTP Endpoints */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">HTTP Endpoints</h2>
        <p className="text-gray-600 mb-4">
          In addition to the programmatic API, you can also access artifacts directly via HTTP endpoints.
          These endpoints are useful for direct access to models and their files without using the client libraries.
        </p>

        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">Get Artifact Metadata</h3>
            <div className="bg-gray-50 rounded-lg p-4 mb-2">
              <SyntaxHighlighter 
                language="bash" 
                style={vs}
                customStyle={{
                  fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                  fontWeight: 600,
                  fontSize: '14px',
                  background: '#f9fafb'
                }}
              >
                GET https://hypha.aicell.io/{"<workspace>"}/artifacts/{"<artifact_alias>"}
              </SyntaxHighlighter>
            </div>
            <p className="text-gray-600">
              Retrieves metadata, manifest, and configuration for a specific artifact.
            </p>
            <p className="text-gray-600 mt-2">
              <strong>Query Parameters:</strong>
            </p>
            <ul className="list-disc list-inside text-gray-600 ml-4">
              <li><code>version</code> (optional): Specific version to retrieve (defaults to latest)</li>
              <li><code>silent</code> (optional): If true, doesn't increment view count</li>
            </ul>
          </div>

          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">List Child Artifacts</h3>
            <div className="bg-gray-50 rounded-lg p-4 mb-2">
              <SyntaxHighlighter 
                language="bash" 
                style={vs}
                customStyle={{
                  fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                  fontWeight: 600,
                  fontSize: '14px',
                  background: '#f9fafb'
                }}
              >
                GET https://hypha.aicell.io/{"<workspace>"}/artifacts/{"<artifact_alias>"}/children
              </SyntaxHighlighter>
            </div>
            <p className="text-gray-600">
              Lists all child artifacts of a specified parent artifact.
            </p>
            <p className="text-gray-600 mt-2">
              <strong>Query Parameters:</strong>
            </p>
            <ul className="list-disc list-inside text-gray-600 ml-4">
              <li><code>keywords</code> (optional): Comma-separated search terms</li>
              <li><code>filters</code> (optional): JSON-encoded filter criteria</li>
              <li><code>offset</code> (optional): Pagination offset (default: 0)</li>
              <li><code>limit</code> (optional): Maximum number of results (default: 100)</li>
              <li><code>order_by</code> (optional): Field to sort by</li>
              <li><code>pagination</code> (optional): Whether to return pagination metadata</li>
            </ul>
          </div>

          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">Download Artifact Files</h3>
            <div className="bg-gray-50 rounded-lg p-4 mb-2">
              <SyntaxHighlighter 
                language="bash" 
                style={vs}
                customStyle={{
                  fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                  fontWeight: 600,
                  fontSize: '14px',
                  background: '#f9fafb'
                }}
              >
                GET https://hypha.aicell.io/{"<workspace>"}/artifacts/{"<artifact_alias>"}/files/{"<path>"}
              </SyntaxHighlighter>
            </div>
            <p className="text-gray-600">
              Retrieves a specific file from an artifact or lists files in a directory.
            </p>
            <p className="text-gray-600 mt-2">
              <strong>Example:</strong>
            </p>
            <div className="bg-gray-50 rounded-lg p-4 mb-2">
              <SyntaxHighlighter 
                language="bash" 
                style={vs}
                customStyle={{
                  fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                  fontWeight: 600,
                  fontSize: '14px',
                  background: '#f9fafb'
                }}
              >
                https://hypha.aicell.io/bioimage-io/artifacts/trustworthy-llama/files/rdf.yaml?use_proxy=true
              </SyntaxHighlighter>
            </div>
            <p className="text-gray-600 mt-2">
              <strong>Query Parameters:</strong>
            </p>
            <ul className="list-disc list-inside text-gray-600 ml-4">
              <li><code>version</code> (optional): Specific version to retrieve</li>
              <li><code>silent</code> (optional): If true, doesn't increment download count</li>
              <li><code>use_proxy</code> (optional): If true, serves file through API proxy instead of redirecting</li>
              <li><code>token</code> (optional): Authentication token for private artifacts</li>
            </ul>
          </div>

          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">Download Artifact as ZIP</h3>
            <div className="bg-gray-50 rounded-lg p-4 mb-2">
              <SyntaxHighlighter 
                language="bash" 
                style={vs}
                customStyle={{
                  fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                  fontWeight: 600,
                  fontSize: '14px',
                  background: '#f9fafb'
                }}
              >
                GET https://hypha.aicell.io/{"<workspace>"}/artifacts/{"<artifact_alias>"}/create-zip-file
              </SyntaxHighlighter>
            </div>
            <p className="text-gray-600">
              Creates and downloads a ZIP file containing all or selected files from an artifact.
            </p>
            <p className="text-gray-600 mt-2">
              <strong>Query Parameters:</strong>
            </p>
            <ul className="list-disc list-inside text-gray-600 ml-4">
              <li><code>file</code> (optional, repeatable): Specific files to include in the ZIP</li>
              <li><code>version</code> (optional): Specific version to download</li>
              <li><code>token</code> (optional): Authentication token for private artifacts</li>
            </ul>
          </div>

          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">Access Files Inside ZIP Archives</h3>
            <div className="bg-gray-50 rounded-lg p-4 mb-2">
              <SyntaxHighlighter 
                language="bash" 
                style={vs}
                customStyle={{
                  fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                  fontWeight: 600,
                  fontSize: '14px',
                  background: '#f9fafb'
                }}
              >
                GET https://hypha.aicell.io/{"<workspace>"}/artifacts/{"<artifact_alias>"}/zip-files/{"<zip_file_path>"}
              </SyntaxHighlighter>
            </div>
            <p className="text-gray-600">
              Extracts and serves content from a ZIP file stored in an artifact without downloading the entire archive.
            </p>
            <p className="text-gray-600 mt-2">
              <strong>Query Parameters:</strong>
            </p>
            <ul className="list-disc list-inside text-gray-600 ml-4">
              <li><code>path</code> (optional): Path to a specific file within the ZIP</li>
              <li><code>version</code> (optional): Specific artifact version</li>
              <li><code>token</code> (optional): Authentication token for private artifacts</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ApiDocs; 