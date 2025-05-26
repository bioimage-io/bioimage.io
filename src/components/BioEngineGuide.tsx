import React, { useState } from 'react';

type OSType = 'macos' | 'linux' | 'windows';
type ModeType = 'single-machine' | 'slurm' | 'connect';

const BioEngineGuide: React.FC = () => {
  const [os, setOS] = useState<OSType>('macos');
  const [mode, setMode] = useState<ModeType>('single-machine');
  const [cpus, setCpus] = useState(2);
  const [hasGpu, setHasGpu] = useState(false);
  const [gpus, setGpus] = useState(1);
  const [runAsRoot, setRunAsRoot] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  
  // Advanced options
  const [workspace, setWorkspace] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [token, setToken] = useState('');
  const [rayAddress, setRayAddress] = useState('');
  const [adminUsers, setAdminUsers] = useState('*');
  const [logDir, setLogDir] = useState('');
  const [cacheDir, setCacheDir] = useState('');

  const getPlatform = () => {
    switch (os) {
      case 'macos': return 'linux/arm64';
      case 'linux': return 'linux/amd64';
      case 'windows': return 'windows/amd64';
      default: return 'linux/amd64';
    }
  };

  const getUserFlag = () => {
    if (runAsRoot) return '';
    
    switch (os) {
      case 'windows':
        return ''; // Windows doesn't use the same user flag
      default:
        return '--user $(id -u):$(id -g) ';
    }
  };

  const getGpuFlag = () => {
    return hasGpu ? '--gpus=all ' : '';
  };

  const getCommand = () => {
    const platform = getPlatform();
    const userFlag = getUserFlag();
    const gpuFlag = getGpuFlag();
    
    // Determine mount directory and cache directory
    let mountDir = '/tmp';
    let hostMountPath = '';
    
    if (os === 'windows') {
      hostMountPath = runAsRoot ? 'C:\\temp' : '%TEMP%';
    } else {
      hostMountPath = '$(mktemp -d)';
    }
    
    // If user specified a custom cache directory, use it as the mount point
    if (cacheDir) {
      mountDir = cacheDir;
    }
    
    // Base arguments
    let args = [`--mode ${mode}`];
    
    // Mode-specific arguments
    if (mode === 'single-machine') {
      args.push(`--head_num_cpus ${cpus}`);
      if (hasGpu) {
        args.push(`--head_num_gpus ${gpus}`);
      }
    } else if (mode === 'connect' && rayAddress) {
      args.push(`--ray_address ${rayAddress}`);
    }
    
    // Advanced arguments
    if (workspace) args.push(`--workspace ${workspace}`);
    if (serverUrl) args.push(`--server_url ${serverUrl}`);
    if (token) args.push(`--token ${token}`);
    
    // Handle admin users - space separated
    if (adminUsers && adminUsers !== '*') {
      const users = adminUsers.split(',').map(u => u.trim()).join(' ');
      args.push(`--admin_users ${users}`);
    } else if (adminUsers === '*') {
      args.push(`--admin_users "*"`);
    }
    
    if (logDir) args.push(`--log_dir ${logDir}`);
    if (cacheDir) args.push(`--cache_dir ${cacheDir}`);
    
    const argsString = args.join(' ');
    
    if (os === 'windows') {
      return `docker run ${gpuFlag}--platform ${platform} -it --rm -v ${hostMountPath}:${mountDir} ghcr.io/aicell-lab/bioengine-worker:0.1.17 python -m bioengine_worker ${argsString}`;
    }
    
    return `docker run ${gpuFlag}--platform ${platform} -it --rm ${userFlag}-v ${hostMountPath}:${mountDir} ghcr.io/aicell-lab/bioengine-worker:0.1.17 python -m bioengine_worker ${argsString}`;
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(getCommand());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className="mt-6 border-t border-gray-200 pt-4">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between text-left hover:bg-gray-50 rounded-lg p-3 transition-colors duration-200"
      >
        <div className="flex items-center">
          <div className="w-8 h-8 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-lg flex items-center justify-center mr-3">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h4 className="text-sm font-medium text-gray-800">Need to start BioEngine locally?</h4>
            <p className="text-xs text-gray-500">Click to configure your local setup</p>
          </div>
        </div>
        <div className="flex items-center">
          <span className="text-xs text-gray-500 mr-2">{isExpanded ? 'Hide' : 'Show'}</span>
          <svg 
            className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

        {isExpanded && (
          <div className="mt-4 space-y-6">
            {/* Basic Configuration */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Operating System */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Operating System</label>
                <select
                  value={os}
                  onChange={(e) => setOS(e.target.value as OSType)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  aria-label="Select operating system"
                >
                  <option value="macos">macOS</option>
                  <option value="linux">Linux</option>
                  <option value="windows">Windows</option>
                </select>
              </div>

              {/* Mode */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Mode</label>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as ModeType)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  aria-label="Select mode"
                >
                  <option value="single-machine">Single Machine</option>
                  <option value="slurm">SLURM (HPC)</option>
                  <option value="connect">Connect to Existing</option>
                </select>
              </div>

              {/* CPU Count - only for single-machine mode */}
              {mode === 'single-machine' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">CPU Cores</label>
                  <input
                    type="number"
                    min="1"
                    max="32"
                    value={cpus}
                    onChange={(e) => setCpus(parseInt(e.target.value) || 1)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    aria-label="Number of CPU cores"
                  />
                </div>
              )}

              {/* GPU Options - only for single-machine mode */}
              {mode === 'single-machine' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">GPU Support</label>
                  <div className="flex items-center space-x-4">
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={hasGpu}
                        onChange={(e) => setHasGpu(e.target.checked)}
                        className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                      />
                      <span className="ml-2 text-sm text-gray-700">Enable GPU</span>
                    </label>
                  </div>
                  {hasGpu && (
                    <input
                      type="number"
                      min="1"
                      max="8"
                      value={gpus}
                      onChange={(e) => setGpus(parseInt(e.target.value) || 1)}
                      placeholder="GPU count"
                      className="w-full mt-2 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  )}
                </div>
              )}

              {/* Ray Address - only for connect mode */}
              {mode === 'connect' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Ray Address</label>
                  <input
                    type="text"
                    value={rayAddress}
                    onChange={(e) => setRayAddress(e.target.value)}
                    placeholder="ray://head-node-ip:10001"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    aria-label="Ray cluster address"
                  />
                </div>
              )}

              {/* Run as Root */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Permissions</label>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={runAsRoot}
                    onChange={(e) => setRunAsRoot(e.target.checked)}
                    className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span className="ml-2 text-sm text-gray-700">Run as root</span>
                </label>
                <p className="text-xs text-gray-500 mt-1">
                  {runAsRoot ? "Will run with root privileges" : "Will run with current user permissions"}
                </p>
              </div>
            </div>

            {/* Advanced Options Toggle */}
            <div className="border-t border-gray-200 pt-4">
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center text-sm text-gray-600 hover:text-gray-800 transition-colors duration-200"
              >
                <svg 
                  className={`w-4 h-4 mr-2 transition-transform duration-200 ${showAdvanced ? 'rotate-90' : ''}`} 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                Advanced Options
              </button>
            </div>

            {/* Advanced Options */}
            {showAdvanced && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Workspace</label>
                  <input
                    type="text"
                    value={workspace}
                    onChange={(e) => setWorkspace(e.target.value)}
                    placeholder="your-workspace"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Server URL</label>
                  <input
                    type="text"
                    value={serverUrl}
                    onChange={(e) => setServerUrl(e.target.value)}
                    placeholder="https://hypha.aicell.io"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Token</label>
                  <input
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="your-auth-token"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Admin Users</label>
                  <input
                    type="text"
                    value={adminUsers}
                    onChange={(e) => setAdminUsers(e.target.value)}
                    placeholder="* or user1,user2,user3"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">Use "*" for all users, or comma-separated list (will be converted to space-separated)</p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Log Directory</label>
                  <input
                    type="text"
                    value={logDir}
                    onChange={(e) => setLogDir(e.target.value)}
                    placeholder="/path/to/logs"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Cache Directory</label>
                  <input
                    type="text"
                    value={cacheDir}
                    onChange={(e) => setCacheDir(e.target.value)}
                    placeholder="/path/to/cache"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">Container path - will also update the volume mount</p>
                </div>
              </div>
            )}

            {/* Generated Command */}
            <div className="bg-gray-900 rounded-xl p-4 relative">
              <div className="flex justify-between items-start mb-2">
                <h4 className="text-sm font-medium text-gray-300">
                  {os === 'windows' ? 'PowerShell Command:' : 'Terminal Command:'}
                </h4>
                <button
                  onClick={copyToClipboard}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg transition-colors duration-200 flex items-center"
                >
                  {copied ? (
                    <>
                      <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Copied!
                    </>
                  ) : (
                    <>
                      <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Copy
                    </>
                  )}
                </button>
              </div>
              <code className="text-green-400 text-sm font-mono break-all whitespace-pre-wrap">
                {getCommand()}
              </code>
            </div>

            {/* Additional Info */}
            <div className="p-4 bg-blue-50 rounded-xl border border-blue-200">
              <div className="flex items-start">
                <svg className="w-5 h-5 text-blue-600 mr-2 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="text-sm text-blue-800">
                  <p className="font-medium mb-1">Prerequisites & Notes:</p>
                  <ul className="list-disc list-inside space-y-1 text-blue-700">
                    <li>Docker must be installed and running</li>
                    {mode === 'single-machine' && hasGpu && <li>NVIDIA Docker runtime required for GPU support</li>}
                    {mode === 'slurm' && <li>SLURM cluster access and proper configuration required</li>}
                    {mode === 'connect' && <li>Existing Ray cluster must be running and accessible</li>}
                    <li>After running, the worker will be available at the service ID shown in the terminal</li>
                    <li>Use the service ID to connect to your BioEngine worker from this interface</li>
                    {mode === 'connect' && <li>Make sure the Ray address is accessible from your network</li>}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}
    </div>
  );
};

export default BioEngineGuide; 