import React, { useState, useEffect } from 'react';

interface DeploymentConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDeploy: (config: any) => void;
  artifactId: string;
  initialMode: string | null; // 'cpu' or 'gpu'
}

const DeploymentConfigModal: React.FC<DeploymentConfigModalProps> = ({ isOpen, onClose, onDeploy, artifactId, initialMode }) => {
  const [version, setVersion] = useState<string>('');
  const [applicationId, setApplicationId] = useState<string>('');
  const [kwargs, setKwargs] = useState<string>('{}');
  const [envVars, setEnvVars] = useState<string>('{}');
  const [hyphaToken, setHyphaToken] = useState<string>('');
  const [disableGpu, setDisableGpu] = useState<boolean>(false);
  const [maxOngoingRequests, setMaxOngoingRequests] = useState<number | ''>(10);
  const [autoRedeploy, setAutoRedeploy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen) {
       setVersion('');
       setApplicationId('');
       setKwargs('{}');
       setEnvVars('{}');
       setHyphaToken('');
       setDisableGpu(false);
       setMaxOngoingRequests(10);
       setAutoRedeploy(false);
       setError(null);
       setShowAdvanced(false);
    }
  }, [isOpen, initialMode]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
        let parsedKwargs = null;
        if (kwargs && kwargs.trim() !== '') {
            parsedKwargs = JSON.parse(kwargs);
        }
        
        let parsedEnvVars = null;
        if (envVars && envVars.trim() !== '') {
            parsedEnvVars = JSON.parse(envVars);
        }
        
        onDeploy({
            artifact_id: artifactId,
            version: version || null,
            application_id: applicationId || null,
            application_kwargs: parsedKwargs && Object.keys(parsedKwargs).length > 0 ? parsedKwargs : null,
            application_env_vars: parsedEnvVars && Object.keys(parsedEnvVars).length > 0 ? parsedEnvVars : null,
            hypha_token: hyphaToken || null,
            disable_gpu: disableGpu,
            max_ongoing_requests: maxOngoingRequests !== '' ? maxOngoingRequests : null,
            auto_redeploy: autoRedeploy
        });
        onClose();
    } catch (err) {
        setError('Invalid JSON in Application Kwargs or Env Vars. Please ensure valid JSON format.');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center sticky top-0 bg-white z-10">
          <h3 className="text-xl font-semibold text-gray-800">Deploy Application</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Artifact ID</label>
              <input 
                type="text" 
                value={artifactId} 
                disabled 
                className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-gray-500 cursor-not-allowed"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Application ID (Optional)</label>
              <input 
                type="text" 
                value={applicationId} 
                onChange={(e) => setApplicationId(e.target.value)}
                placeholder="Auto-generated"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-gray-900"
              />
            </div>

            <div className="md:col-span-2">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center text-sm font-medium text-blue-600 hover:text-blue-800 focus:outline-none"
              >
                <svg
                  className={`w-4 h-4 mr-1 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
                {showAdvanced ? 'Hide Advanced Parameters' : 'Show Advanced Parameters'}
              </button>
            </div>

            {showAdvanced && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Version</label>
                  <input 
                    type="text" 
                    value={version} 
                    onChange={(e) => setVersion(e.target.value)}
                    placeholder="Latest"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Max Ongoing Requests</label>
                  <input 
                    type="number" 
                    min="1"
                    value={maxOngoingRequests} 
                    onChange={(e) => setMaxOngoingRequests(e.target.value === '' ? '' : parseInt(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Application Kwargs (JSON)
                    <span className="text-gray-400 font-normal ml-2 text-xs">Arguments passed to application initialization</span>
                  </label>
                  <textarea 
                    value={kwargs} 
                    onChange={(e) => setKwargs(e.target.value)}
                    rows={1}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-gray-900 font-mono text-sm"
                    placeholder="{}"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Environment Variables (JSON)
                    <span className="text-gray-400 font-normal ml-2 text-xs">Environment variables for the application</span>
                  </label>
                  <textarea 
                    value={envVars} 
                    onChange={(e) => setEnvVars(e.target.value)}
                    rows={1}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-gray-900 font-mono text-sm"
                    placeholder="{}"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Hypha Token</label>
                  <input 
                    type="password" 
                    value={hyphaToken} 
                    onChange={(e) => setHyphaToken(e.target.value)}
                    autoComplete="off"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                    placeholder="None"
                  />
                </div>

                <div className="md:col-span-2 flex items-center space-x-6 pt-2">
                  <label className="flex items-center space-x-3 cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={disableGpu} 
                      onChange={(e) => setDisableGpu(e.target.checked)}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span className="text-sm font-medium text-gray-700">Disable GPU</span>
                  </label>

                  <label className="flex items-center space-x-3 cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={autoRedeploy} 
                      onChange={(e) => setAutoRedeploy(e.target.checked)}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span className="text-sm font-medium text-gray-700">Auto Redeploy</span>
                  </label>
                </div>
              </>
            )}
          </div>

          <div className="flex justify-end space-x-3 pt-6 border-t border-gray-100 mt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Deploy
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default DeploymentConfigModal;
