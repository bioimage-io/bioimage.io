import React, { useState } from 'react';
import { useHyphaContext } from '../HyphaContext';
import { Button, Tooltip, Box } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import RefreshIcon from '@mui/icons-material/Refresh';

interface ModelRunnerProps {
  artifactId?: string;
  isDisabled?: boolean;
  className?: string;
  onRunStateChange?: (isRunning: boolean) => void;
  createContainerCallback?: (containerId: string) => string;
}

const ModelRunner: React.FC<ModelRunnerProps> = ({ 
  artifactId, 
  isDisabled = false, 
  className = '',
  onRunStateChange,
  createContainerCallback
}) => {
  const { hyphaCoreAPI, isHyphaCoreReady } = useHyphaContext();
  const [isLoading, setIsLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [currentWindowId, setCurrentWindowId] = useState<string | null>(null);
  const [isReloading, setIsReloading] = useState(false);

  const runModel = async () => {
    if (!artifactId || !hyphaCoreAPI || !isHyphaCoreReady) {
      console.error('Cannot run model: Missing artifactId or hyphaCoreAPI is not ready');
      return;
    }

    setIsLoading(true);

    try {
      // Extract model ID from the full artifactId
      const modelId = artifactId.split('/').pop();
      
      // Create a unique window ID
      const windowId = `model-runner-${modelId}-${Date.now()}`;
      
      // First update the state - call the container creation callback
      let containerId = windowId;
      if (createContainerCallback) {
        containerId = createContainerCallback(windowId);
      }
      
      // Store the window ID for future operations
      setCurrentWindowId(containerId);
      
      // Create the window using hypha-core API
      await hyphaCoreAPI.createWindow({
        name: `Run Model: ${modelId}`,
        src: "https://ij.imjoy.io/",
        window_id: containerId
      });
      
      console.log(`Created window ${containerId} for model ${modelId}`);
      
      setIsRunning(true);
      setIsLoading(false);
      // Notify parent component if callback provided
      if (onRunStateChange) {
        onRunStateChange(true);
      }

    } catch (error) {
      console.error('Failed to run model:', error);
      setIsLoading(false);
    }
  };

  const reloadApp = async () => {
    if (!currentWindowId || !hyphaCoreAPI || !isHyphaCoreReady) {
      console.error('Cannot reload app: Missing windowId or hyphaCoreAPI is not ready');
      return;
    }

    setIsReloading(true);

    try {
              
      // Extract model ID from the full artifactId
      const modelId = artifactId?.split('/').pop();
      
         // Create a new window ID
      const newWindowId = `model-runner-${modelId}-${Date.now()}`;
      // delete the dom element with the id currentWindowId
      const domElement = document.getElementById(currentWindowId);
      if (domElement) {
        // clear the content of the dom element
        domElement.innerHTML = '';
        // set the id of the dom element to the new window id
        domElement.id = newWindowId;
      }

     
      
      // Call the container creation callback
      let containerId = newWindowId;
      if (createContainerCallback) {
        containerId = createContainerCallback(newWindowId);
      }
      
      // Store the new window ID
      setCurrentWindowId(containerId);
      
      // Create a new window
      await hyphaCoreAPI.createWindow({
        name: `Run Model: ${modelId}`,
        src: "https://ij.imjoy.io/",
        window_id: containerId
      });
      
      console.log(`Reloaded app in window ${containerId}`);
      
      setIsReloading(false);
    } catch (error) {
      console.error('Failed to reload app:', error);
      setIsReloading(false);
    }
  };

  return (
    <div className={className}>
      <Tooltip title={!isHyphaCoreReady ? "Initializing HyphaCore..." : isRunning ? "Reload the application" : "Run model in ImageJ.JS"}>
        <span>
          <Button
            onClick={isRunning ? reloadApp : runModel}
            disabled={isDisabled || (isRunning ? isReloading : isLoading) || !isHyphaCoreReady}
            variant="outlined"
            color={isRunning ? "primary" : "primary"}
            startIcon={
              isRunning ? (
                isReloading ? (
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                ) : (
                  <RefreshIcon />
                )
              ) : (
                isLoading ? (
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                ) : (
                  <PlayArrowIcon />
                )
              )
            }
          >
            {isRunning ? "Reload App" : "Run Model"}
          </Button>
        </span>
      </Tooltip>
    </div>
  );
};

export default ModelRunner; 