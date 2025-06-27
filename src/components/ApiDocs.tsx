import React, { useState, useEffect } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vs } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useHyphaStore } from '../store/hyphaStore';
import { ClipboardIcon, CheckIcon } from '@heroicons/react/24/outline';
import { useSearchParams } from 'react-router-dom';

const ApiDocs: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const defaultTab = searchParams.get('tab') === 'http' ? 'http' : 'hypha-rpc';
  const [activeMainTab, setActiveMainTab] = useState<'hypha-rpc' | 'http'>(defaultTab);
  const [activeLanguageTab, setActiveLanguageTab] = useState<'python' | 'javascript'>('python');
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
    artifact_manager = await server.get_service("public/services/artifact-manager")

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
    const artifactManager = await server.getService("public/services/artifact-manager", {
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
        <div className="prose max-w-none">
          <p className="text-gray-600 mb-4">
            The BioImage Model Zoo backend is powered by <a href="https://docs.amun.ai" className="text-blue-600 hover:text-blue-800">Hypha</a>, 
            a modern RPC framework designed for building distributed applications. Hypha provides a flexible and efficient way to handle 
            service registration, remote procedure calls, and real-time communication.
          </p>

          <div className="bg-blue-50 border-l-4 border-blue-400 p-4 mb-6">
            <div className="flex">
              <div className="ml-3">
                <h3 className="text-lg font-medium text-blue-800">Two Ways to Interact with the API</h3>
                <div className="mt-2 text-blue-700">
                  <p className="mb-2">
                    <strong>1. Hypha RPC</strong>: A powerful programmatic interface that provides:
                  </p>
                  <ul className="list-disc list-inside ml-4 mb-4">
                    <li>Native Python and JavaScript support</li>
                    <li>Real-time communication via WebSocket</li>
                    <li>Type safety and better error handling</li>
                    <li>Automatic reconnection and state management</li>
                  </ul>
                  
                  <p className="mb-2">
                    <strong>2. HTTP REST API</strong>: A traditional REST interface that offers:
                  </p>
                  <ul className="list-disc list-inside ml-4">
                    <li>Standard HTTP endpoints for basic operations</li>
                    <li>Language-agnostic access to resources</li>
                    <li>Familiar REST patterns and conventions</li>
                    <li>Easy integration with existing tools and scripts</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <p className="text-gray-600 mb-4">
            Choose the method that best suits your needs. For building applications or scripts that require real-time updates 
            or complex interactions, we recommend using Hypha RPC. For simple operations or when working with tools that 
            expect REST APIs, use the HTTP endpoints.
          </p>
        </div>
      </div>

      {/* Add Token Section before the main tabs */}
      <TokenSection />

      {/* Main API Type tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveMainTab('hypha-rpc')}
            className={`${
              activeMainTab === 'hypha-rpc'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
          >
            Hypha RPC
          </button>
          <button
            onClick={() => setActiveMainTab('http')}
            className={`${
              activeMainTab === 'http'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
          >
            HTTP Endpoints
          </button>
        </nav>
      </div>

      {activeMainTab === 'hypha-rpc' ? (
        <>
          <div className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">About Hypha RPC</h2>
            <div className="prose max-w-none">
              <p className="text-gray-600 mb-4">
                Hypha RPC provides a modern, efficient way to interact with the BioImage Model Zoo programmatically. 
                It offers several advantages over traditional HTTP APIs:
              </p>
              <ul className="list-disc list-inside text-gray-600 mb-4">
                <li>Bi-directional communication through WebSocket connections</li>
                <li>Automatic reconnection and session management</li>
                <li>Type-safe interactions with built-in TypeScript support</li>
                <li>Efficient binary data transfer with WebRTC support</li>
                <li>Real-time updates and event notifications</li>
                <li>Built-in authentication and token management</li>
              </ul>
              <p className="text-gray-600 mb-4">
                This API is ideal for building applications that require real-time updates, 
                handling large data transfers, or creating interactive tools that need 
                persistent connections to the server.
              </p>
              <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-4">
                <p className="text-sm text-yellow-700">
                  <strong>Pro Tip:</strong> For the best development experience, we recommend using 
                  TypeScript with the Hypha RPC client to get full type checking and autocompletion support.
                </p>
              </div>
            </div>
          </div>
          {/* Language tabs */}
          <div className="border-b border-gray-200 mb-6">
            <nav className="-mb-px flex space-x-8">
              <button
                onClick={() => setActiveLanguageTab('python')}
                className={`${
                  activeLanguageTab === 'python'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
              >
                Python
              </button>
              <button
                onClick={() => setActiveLanguageTab('javascript')}
                className={`${
                  activeLanguageTab === 'javascript'
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
                {activeLanguageTab === 'python' ? 'pip install hypha-rpc' : '<script src="https://cdn.jsdelivr.net/npm/hypha-rpc@0.20.47/dist/hypha-rpc-websocket.min.js"></script>'}
              </SyntaxHighlighter>
            </div>
          </div>

          {/* Authentication */}
          <div className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Authentication</h2>
            <p className="text-gray-600 mb-4">
              To access protected resources, you'll need to authenticate first. There are two ways to authenticate:
            </p>

            <h3 className="text-lg font-medium text-gray-900 mb-2">1. Interactive Login</h3>
            <div className="bg-gray-50 rounded-lg p-4 mb-4">
              <SyntaxHighlighter 
                language={activeLanguageTab} 
                style={vs}
                customStyle={{
                  fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                  fontWeight: 600,
                  fontSize: '14px',
                  background: '#f9fafb'
                }}
              >
                {activeLanguageTab === 'python' ? 
                  `from hypha_rpc import login, connect_to_server

# This will display a login URL in the console
token = await login({"server_url": "https://ai.imjoy.io"})

# Connect using the token
server = await connect_to_server({
    "server_url": "https://ai.imjoy.io",
    "token": token
})` :
                  `const token = await hyphaWebsocketClient.login({
    server_url: "https://ai.imjoy.io"
});

const server = await hyphaWebsocketClient.connectToServer({
    server_url: "https://ai.imjoy.io",
    token: token
});`}
              </SyntaxHighlighter>
            </div>

            <h3 className="text-lg font-medium text-gray-900 mb-2">2. Using API Token</h3>
            <p className="text-gray-600 mb-4">
              You can generate an API token using the button above and use it directly:
            </p>
            <div className="bg-gray-50 rounded-lg p-4">
              <SyntaxHighlighter 
                language={activeLanguageTab} 
                style={vs}
                customStyle={{
                  fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                  fontWeight: 600,
                  fontSize: '14px',
                  background: '#f9fafb'
                }}
              >
                {activeLanguageTab === 'python' ? 
                  `from hypha_rpc import connect_to_server

server = await connect_to_server({
    "server_url": "https://ai.imjoy.io",
    "token": "your-api-token-here"
})` :
                  `const server = await hyphaWebsocketClient.connectToServer({
    server_url: "https://ai.imjoy.io",
    token: "your-api-token-here"
});`}
              </SyntaxHighlighter>
            </div>
          </div>

          {/* Code examples */}
          <div className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Example Usage</h2>
            <p className="text-gray-600 mb-4">
              Here's a complete example showing how to interact with the BioImage Model Zoo API:
            </p>
            <div className="bg-gray-50 rounded-lg p-4">
              <SyntaxHighlighter 
                language={activeLanguageTab} 
                style={vs}
                showLineNumbers={true}
                customStyle={{
                  fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                  fontWeight: 600,
                  fontSize: '14px',
                  background: '#f9fafb'
                }}
              >
                {activeLanguageTab === 'python' ? pythonCode : javascriptCode}
              </SyntaxHighlighter>
            </div>
          </div>

          {/* Additional Features */}
          <div className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Additional Features</h2>
            
            <h3 className="text-lg font-medium text-gray-900 mb-2">WebRTC Support</h3>
            <p className="text-gray-600 mb-4">
              For large data transfers or real-time communication, Hypha supports peer-to-peer connections via WebRTC. 
              This is particularly useful when transferring large model files or performing real-time inference.
            </p>

            <h3 className="text-lg font-medium text-gray-900 mb-2">Error Handling</h3>
            <p className="text-gray-600 mb-4">
              All API calls should be wrapped in try-catch blocks to handle potential errors properly:
            </p>
            <div className="bg-gray-50 rounded-lg p-4">
              <SyntaxHighlighter 
                language={activeLanguageTab} 
                style={vs}
                customStyle={{
                  fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                  fontWeight: 600,
                  fontSize: '14px',
                  background: '#f9fafb'
                }}
              >
                {activeLanguageTab === 'python' ? 
                  `try:
    model = await artifact_manager.read(
        artifact_id="bioimage-io/affable-shark"
    )
except Exception as e:
    print(f"Error reading model: {e}")` :
                  `try {
    const model = await artifactManager.read({
        artifact_id: "bioimage-io/affable-shark",
        _rkwargs: true
    });
} catch (error) {
    console.error("Error reading model:", error);
}`}
              </SyntaxHighlighter>
            </div>
          </div>
        </>
      ) : (
        <div className="space-y-6">
          <div className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">About HTTP REST API</h2>
            <div className="prose max-w-none">
              <p className="text-gray-600 mb-4">
                The HTTP REST API provides a traditional, stateless interface to interact with the BioImage Model Zoo. 
                This API is designed for:
              </p>
              <ul className="list-disc list-inside text-gray-600 mb-4">
                <li>Simple, direct access to model artifacts and metadata</li>
                <li>Integration with tools and scripts in any programming language</li>
                <li>Stateless operations that don't require persistent connections</li>
                <li>Browser-based direct downloads and file access</li>
                <li>Compatibility with standard HTTP tools and libraries</li>
              </ul>
              <p className="text-gray-600 mb-4">
                All endpoints follow REST conventions and return JSON responses (except for file downloads). 
                The API uses standard HTTP methods (GET, POST, PUT, DELETE) and status codes.
              </p>
              <div className="bg-blue-50 border-l-4 border-blue-400 p-4 mb-6">
                <p className="text-sm text-blue-700">
                  <strong>Authentication:</strong> For endpoints requiring authentication, 
                  include your API token in the Authorization header: 
                  <code className="ml-2 px-2 py-1 bg-blue-100 rounded">Authorization: Bearer your-token-here</code>
                </p>
              </div>
            </div>
          </div>

          <div className="mb-4">
            <p className="text-gray-600 mb-4">
              <strong>Note:</strong> <code>&lt;artifact_alias&gt;</code> is the last part of the artifact ID (e.g., "affable-shark"), while the full <code>&lt;artifact_id&gt;</code> includes the workspace (e.g., "bioimage-io/affable-shark").
            </p>
          </div>

          {/* HTTP Endpoints */}
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
                {`GET https://hypha.aicell.io/<workspace>/artifacts/<artifact_alias>`}
              </SyntaxHighlighter>
            </div>
            <p className="text-gray-600">
              Retrieves metadata, manifest, and configuration for a specific artifact.
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
                GET https://hypha.aicell.io/bioimage-io/artifacts/affable-shark
              </SyntaxHighlighter>
            </div>
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
                {`GET https://hypha.aicell.io/<workspace>/artifacts/<artifact_alias>/children`}
              </SyntaxHighlighter>
            </div>
            <p className="text-gray-600">
              Lists all child artifacts of a specified parent artifact.
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
                GET https://hypha.aicell.io/bioimage-io/artifacts/bioimage.io/children
              </SyntaxHighlighter>
            </div>
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
                {`GET https://hypha.aicell.io/<workspace>/artifacts/<artifact_alias>/files/<path>`}
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
                GET https://hypha.aicell.io/bioimage-io/artifacts/affable-shark/files/rdf.yaml
              </SyntaxHighlighter>
            </div>
            <p className="text-gray-600 mt-2">
              <strong>Query Parameters:</strong>
            </p>
            <ul className="list-disc list-inside text-gray-600 ml-4">
              <li><code>version</code> (optional): Specific version to retrieve</li>
              <li><code>silent</code> (optional): If true, doesn't increment download count</li>
              <li><code>use_proxy</code> (optional): If true, serves file through API proxy instead of redirecting (to s3)</li>
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
                {`GET https://hypha.aicell.io/<workspace>/artifacts/<artifact_alias>/create-zip-file`}
              </SyntaxHighlighter>
            </div>
            <p className="text-gray-600">
              Creates and downloads a ZIP file containing all or selected files from an artifact.
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
                GET https://hypha.aicell.io/bioimage-io/artifacts/affable-shark/create-zip-file
              </SyntaxHighlighter>
            </div>
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
                {`GET https://hypha.aicell.io/<workspace>/artifacts/<artifact_alias>/zip-files/<zip_file_path>`}
              </SyntaxHighlighter>
            </div>
            <p className="text-gray-600">
              Extracts and serves content from a ZIP file stored in an artifact without downloading the entire archive.
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
                GET https://hypha.aicell.io/bioimage-io/artifacts/affable-shark/zip-files/model.zip
              </SyntaxHighlighter>
            </div>
            <p className="text-gray-600 mt-2">
              <strong>Query Parameters:</strong>
            </p>
            <ul className="list-disc list-inside text-gray-600 ml-4">
              <li><code>path</code> (optional): Path to a specific file within the ZIP</li>
              <li><code>version</code> (optional): Specific artifact version</li>
              <li><code>token</code> (optional): Authentication token for private artifacts</li>
            </ul>
          </div>

          {/* Add new section for HTTP Service Endpoints */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">HTTP Service Endpoints</h3>
            <p className="text-gray-600 mb-4">
              Every Hypha service method is also accessible via HTTP endpoints. You can convert any Hypha RPC method call to an HTTP request using the following pattern:
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
                {`GET https://hypha.aicell.io/<service_path>/<method_name>?param1=value1&param2=value2
# OR for complex parameters
POST https://hypha.aicell.io/<service_path>/<method_name>
Content-Type: application/json

{
    "param1": "value1",
    "param2": "value2"
}`}
              </SyntaxHighlighter>
            </div>
            <p className="text-gray-600 mt-2">
              <strong>Example:</strong> Converting Hypha RPC calls to HTTP endpoints
            </p>
            <div className="bg-gray-50 rounded-lg p-4 mb-2">
              <SyntaxHighlighter 
                language="python" 
                style={vs}
                customStyle={{
                  fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                  fontWeight: 600,
                  fontSize: '14px',
                  background: '#f9fafb'
                }}
              >
                {`# Hypha RPC call:
models = await artifact_manager.list(
    parent_id="bioimage-io/bioimage.io",
    limit=10
)

# Equivalent HTTP GET request:
GET https://hypha.aicell.io/public/services/artifact-manager/list?parent_id=bioimage-io/bioimage.io&limit=10

# OR HTTP POST request:
POST https://hypha.aicell.io/public/services/artifact-manager/list
Content-Type: application/json

{
    "parent_id": "bioimage-io/bioimage.io",
    "limit": 10
}`}
              </SyntaxHighlighter>
            </div>
          </div>

          {/* Add Available Service Endpoints section */}
          <div className="mt-8">
            <h3 className="text-lg font-medium text-gray-900 mb-2">Available Service Endpoints</h3>
            <p className="text-gray-600 mb-4">
              The following endpoints are available through the artifact-manager service at <code>/public/services/artifact-manager/</code>:
            </p>

            <div className="space-y-6">
              <div>
                <h4 className="text-md font-medium text-gray-900 mb-2">Artifact Management</h4>
                <ul className="list-disc list-inside text-gray-600 space-y-4">
                  <li>
                    <code>create</code>
                    <p className="ml-6 mt-1">Creates a new artifact. Parameters:</p>
                    <ul className="list-disc list-inside ml-8">
                      <li>alias (optional): Custom identifier for the artifact</li>
                      <li>workspace: Target workspace</li>
                      <li>parent_id (optional): ID of the parent artifact</li>
                      <li>manifest: Artifact metadata and configuration</li>
                      <li>type: Artifact type (e.g., "model", "generic")</li>
                      <li>config (optional): Additional configuration</li>
                      <li>version (optional): Version identifier</li>
                    </ul>
                    <p className="ml-6 mt-1 text-gray-500">Returns: Artifact object containing ID, manifest, config, and other metadata</p>
                  </li>
                  <li>
                    <code>read</code>
                    <p className="ml-6 mt-1">Retrieves artifact details. Parameters:</p>
                    <ul className="list-disc list-inside ml-8">
                      <li>artifact_id: ID of the artifact to read</li>
                      <li>silent (optional): Don't increment view count</li>
                      <li>version (optional): Specific version to retrieve</li>
                    </ul>
                    <p className="ml-6 mt-1 text-gray-500">Returns: Complete artifact object including manifest, config, and version history</p>
                  </li>
                  <li>
                    <code>edit</code>
                    <p className="ml-6 mt-1">Updates an existing artifact. Parameters:</p>
                    <ul className="list-disc list-inside ml-8">
                      <li>artifact_id: ID of the artifact to edit</li>
                      <li>manifest (optional): Updated metadata</li>
                      <li>type (optional): New artifact type</li>
                      <li>config (optional): Updated configuration</li>
                      <li>version (optional): Version to update</li>
                    </ul>
                    <p className="ml-6 mt-1 text-gray-500">Returns: Updated artifact object with new values</p>
                  </li>
                  <li>
                    <code>delete</code>
                    <p className="ml-6 mt-1">Removes an artifact. Parameters:</p>
                    <ul className="list-disc list-inside ml-8">
                      <li>artifact_id: ID of the artifact to delete</li>
                      <li>delete_files (optional): Whether to delete associated files</li>
                      <li>recursive (optional): Delete child artifacts</li>
                      <li>version (optional): Specific version to delete</li>
                    </ul>
                    <p className="ml-6 mt-1 text-gray-500">Returns: None</p>
                  </li>
                </ul>
              </div>

              <div>
                <h4 className="text-md font-medium text-gray-900 mb-2">File Operations</h4>
                <ul className="list-disc list-inside text-gray-600 space-y-4">
                  <li>
                    <code>put_file</code>
                    <p className="ml-6 mt-1">Generates upload URL for a file. Parameters:</p>
                    <ul className="list-disc list-inside ml-8">
                      <li>artifact_id: Target artifact ID</li>
                      <li>file_path: Path for the file</li>
                      <li>download_weight (optional): Weight for download count</li>
                    </ul>
                    <p className="ml-6 mt-1 text-gray-500">Returns: Pre-signed URL for uploading the file</p>
                  </li>
                  <li>
                    <code>get_file</code>
                    <p className="ml-6 mt-1">Generates download URL for a file. Parameters:</p>
                    <ul className="list-disc list-inside ml-8">
                      <li>artifact_id: Source artifact ID</li>
                      <li>file_path: Path to the file</li>
                      <li>silent (optional): Don't increment download count</li>
                      <li>version (optional): Specific version to retrieve</li>
                    </ul>
                    <p className="ml-6 mt-1 text-gray-500">Returns: Pre-signed URL for downloading the file</p>
                  </li>
                  <li>
                    <code>list_files</code>
                    <p className="ml-6 mt-1">Lists files in an artifact. Parameters:</p>
                    <ul className="list-disc list-inside ml-8">
                      <li>artifact_id: Target artifact ID</li>
                      <li>dir_path (optional): Directory to list</li>
                      <li>limit (optional): Maximum number of files to list</li>
                      <li>version (optional): Specific version to list</li>
                    </ul>
                    <p className="ml-6 mt-1 text-gray-500">Returns: Array of file objects containing name, type (file/directory), size, and last modified date</p>
                  </li>
                  <li>
                    <code>remove_file</code>
                    <p className="ml-6 mt-1">Removes a file from an artifact. Parameters:</p>
                    <ul className="list-disc list-inside ml-8">
                      <li>artifact_id: Target artifact ID</li>
                      <li>file_path: Path to the file to remove</li>
                    </ul>
                    <p className="ml-6 mt-1 text-gray-500">Returns: None</p>
                  </li>
                </ul>
              </div>

              <div>
                <h4 className="text-md font-medium text-gray-900 mb-2">Vector Operations</h4>
                <ul className="list-disc list-inside text-gray-600 space-y-4">
                  <li>
                    <code>add_vectors</code>
                    <p className="ml-6 mt-1">Adds vectors to a collection. Parameters:</p>
                    <ul className="list-disc list-inside ml-8">
                      <li>artifact_id: Target vector collection ID</li>
                      <li>vectors: List of vectors to add</li>
                      <li>update (optional): Whether to update existing vectors</li>
                      <li>embedding_models (optional): Models for embedding</li>
                    </ul>
                    <p className="ml-6 mt-1 text-gray-500">Returns: None</p>
                  </li>
                  <li>
                    <code>search_vectors</code>
                    <p className="ml-6 mt-1">Searches vectors in a collection. Parameters:</p>
                    <ul className="list-disc list-inside ml-8">
                      <li>artifact_id: Vector collection ID</li>
                      <li>query: Search query</li>
                      <li>filters (optional): Search filters</li>
                      <li>limit (optional): Maximum results</li>
                      <li>offset (optional): Results offset</li>
                    </ul>
                    <p className="ml-6 mt-1 text-gray-500">Returns: Array of matching vectors with similarity scores</p>
                  </li>
                  <li>
                    <code>list_vectors</code>
                    <p className="ml-6 mt-1">Lists vectors in a collection. Parameters:</p>
                    <ul className="list-disc list-inside ml-8">
                      <li>artifact_id: Vector collection ID</li>
                      <li>offset (optional): Starting offset</li>
                      <li>limit (optional): Maximum results</li>
                      <li>return_fields (optional): Fields to return</li>
                    </ul>
                    <p className="ml-6 mt-1 text-gray-500">Returns: Array of vectors with specified fields</p>
                  </li>
                </ul>
              </div>

              <div>
                <h4 className="text-md font-medium text-gray-900 mb-2">Other Operations</h4>
                <ul className="list-disc list-inside text-gray-600 space-y-4">
                  <li>
                    <code>list</code>
                    <p className="ml-6 mt-1">Lists child artifacts. Parameters:</p>
                    <ul className="list-disc list-inside ml-8">
                      <li>parent_id (optional): Parent artifact ID</li>
                      <li>keywords (optional): Search keywords</li>
                      <li>filters (optional): Filter criteria</li>
                      <li>limit (optional): Maximum results</li>
                      <li>offset (optional): Results offset</li>
                    </ul>
                    <p className="ml-6 mt-1 text-gray-500">Returns: Array of artifact objects, or if pagination=true, an object containing items array, total count, offset, and limit</p>
                  </li>
                  <li>
                    <code>commit</code>
                    <p className="ml-6 mt-1">Commits staged changes. Parameters:</p>
                    <ul className="list-disc list-inside ml-8">
                      <li>artifact_id: Target artifact ID</li>
                      <li>version (optional): Version to commit</li>
                      <li>comment (optional): Commit message</li>
                    </ul>
                    <p className="ml-6 mt-1 text-gray-500">Returns: Updated artifact object with committed changes</p>
                  </li>
                  <li>
                    <code>publish</code>
                    <p className="ml-6 mt-1">Publishes artifact to external service. Parameters:</p>
                    <ul className="list-disc list-inside ml-8">
                      <li>artifact_id: Target artifact ID</li>
                      <li>to (optional): Target service (e.g., "zenodo")</li>
                      <li>metadata (optional): Additional metadata</li>
                    </ul>
                    <p className="ml-6 mt-1 text-gray-500">Returns: Publication record from the external service (e.g., Zenodo record)</p>
                  </li>
                  <li>
                    <code>reset_stats</code>
                    <p className="ml-6 mt-1">Resets artifact statistics. Parameters:</p>
                    <ul className="list-disc list-inside ml-8">
                      <li>artifact_id: Target artifact ID</li>
                    </ul>
                    <p className="ml-6 mt-1 text-gray-500">Returns: None</p>
                  </li>
                </ul>
              </div>
            </div>

            <div className="mt-6 bg-yellow-50 border-l-4 border-yellow-400 p-4">
              <p className="text-sm text-yellow-700">
                <strong>Note:</strong> All endpoints require authentication via the <code>Authorization</code> header. 
                Some endpoints may have additional parameters not listed here. Refer to the API response messages for 
                detailed error information and requirements.
              </p>
            </div>
          </div>

          {/* Python Examples section continues... */}
          <div className="mt-8">
            <h3 className="text-lg font-medium text-gray-900 mb-2">Python Examples Using Requests</h3>
            <p className="text-gray-600 mb-4">
              Here are complete examples showing how to interact with the API using Python's requests library:
            </p>
            <div className="bg-gray-50 rounded-lg p-4">
              <SyntaxHighlighter 
                language="python" 
                style={vs}
                customStyle={{
                  fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                  fontWeight: 600,
                  fontSize: '14px',
                  background: '#f9fafb'
                }}
              >
                {`import requests
import json

# Base URL for the API
BASE_URL = "https://hypha.aicell.io"
API_TOKEN = "your-api-token-here"

# Headers for authentication
headers = {
    "Authorization": f"Bearer {API_TOKEN}",
    "Content-Type": "application/json"
}

def download_model_files():
    """Example: Download model files"""
    # List available models
    response = requests.get(
        f"{BASE_URL}/public/services/artifact-manager/list",
        params={
            "parent_id": "bioimage-io/bioimage.io",
            "limit": 10
        },
        headers=headers
    )
    models = response.json()
    print("Available models:", json.dumps(models, indent=2))

    # Get model details
    model_id = "bioimage-io/affable-shark"
    response = requests.get(
        f"{BASE_URL}/public/services/artifact-manager/read",
        params={"artifact_id": model_id},
        headers=headers
    )
    model = response.json()
    print("Model details:", json.dumps(model, indent=2))

    # Download a specific file
    file_path = "weights.pt"
    response = requests.get(
        f"{BASE_URL}/public/services/artifact-manager/get_file",
        params={
            "artifact_id": model_id,
            "file_path": file_path
        },
        headers=headers
    )
    download_url = response.json()
    
    # Download the file
    response = requests.get(download_url)
    with open(file_path, "wb") as f:
        f.write(response.content)
    print(f"Downloaded {file_path}")

def upload_model():
    """Example: Upload a new model"""
    # Create model manifest
    model_manifest = {
        "type": "model",
        "name": "My test model",
        "description": "This is a test model",
        "tags": ["test", "model"],
        "status": "request-review"
    }

    # Create new model
    response = requests.post(
        f"{BASE_URL}/public/services/artifact-manager/create",
        json={
            "parent_id": "bioimage-io/bioimage.io",
            "alias": "{animal_adjective}-{animal}",
            "type": "model",
            "manifest": model_manifest,
            "config": {"publish_to": "sandbox_zenodo"},
            "version": "stage"
        },
        headers=headers
    )
    new_model = response.json()
    model_id = new_model["id"]
    print(f"Created model with ID: {model_id}")

    # Get upload URL for a file
    response = requests.post(
        f"{BASE_URL}/public/services/artifact-manager/put_file",
        json={
            "artifact_id": model_id,
            "file_path": "weights.pt"
        },
        headers=headers
    )
    upload_url = response.json()

    # Upload file to the provided URL
    with open("path/to/your/weights.pt", "rb") as f:
        response = requests.put(
            upload_url,
            data=f,
            headers={"Content-Type": ""}  # Important for S3 uploads
        )
    print("File uploaded successfully")

    # Update model status
    model_manifest["status"] = "request-review"
    response = requests.post(
        f"{BASE_URL}/public/services/artifact-manager/edit",
        json={
            "artifact_id": model_id,
            "version": "stage",
            "manifest": model_manifest
        },
        headers=headers
    )
    print("Model status updated to request-review")

if __name__ == "__main__":
    download_model_files()
    upload_model()`}
              </SyntaxHighlighter>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ApiDocs; 