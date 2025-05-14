import React, { useState, useEffect } from 'react';
import { useHyphaContext } from '../HyphaContext';
import { useHyphaStore } from '../store/hyphaStore';
import { ImagejJsController } from '../utils/viewerControl';
import { 
  ModelRunnerEngine, 
  getRdfTensorUrl, 
  rdfHasTensor, 

} from '../utils/modelRun';
import { imjoyToTfjs, inferImgAxesViaSpec, mapAxes, parseAxes, isImg2Img, processForShow } from '../utils/imgProcess';

// Extend the ModelRunnerEngine type to properly type the runTiles method
interface ExtendedModelRunnerEngine extends ModelRunnerEngine {
  runTiles: (
    tensor: any,
    inputSpec: any,
    outputSpec: any,
    tileSizes: any,
    tileOverlaps: any,
    additionalParameters?: any,
    reportFunc?: (msg: string) => void
  ) => Promise<any>;
}

// Define interfaces for RDF structure
interface AxisSpec {
  type: 'batch' | 'channel' | 'space';
  id?: string;
  size?: {
    min: number;
    step?: number;
  };
  halo?: number;
  channel_names?: string[];
  scale?: number;
  concatenable?: boolean;
}

interface ModelInputSpec {
  axes: string | AxisSpec[];
  data_type?: string;
  shape?: {
    min: number[];
    step?: number[];
  };
  data?: {
    type: string;
  };
  test_tensor?: {
    source: string;
    sha256?: string;
  };
  sample_tensor?: {
    source: string;
    sha256?: string;
  };
  id?: string;
}

interface ModelOutputSpec {
  axes: string | AxisSpec[];
  halo?: number[];
  test_tensor?: {
    source: string;
    sha256?: string;
  };
  sample_tensor?: {
    source: string;
    sha256?: string;
  };
  id?: string;
}

interface ModelRDF {
  id: string;
  name: string;
  description?: string;
  inputs: ModelInputSpec[];
  outputs: ModelOutputSpec[];
  test_inputs?: string[];
  test_outputs?: string[];
  sample_inputs?: string[];
  sample_outputs?: string[];
  [key: string]: any; // Allow other properties
}

// Helper function to check if an object has a property
const rdfHas = (rdf: ModelRDF | null, key: string): boolean => {
  return rdfHasTensor(rdf, key);
};

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
  const { isLoggedIn } = useHyphaStore();
  const [isLoading, setIsLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [currentWindowId, setCurrentWindowId] = useState<string | null>(null);
  const [isReloading, setIsReloading] = useState(false);
  const [viewerControl, setViewerControl] = useState<ImagejJsController | null>(null);
  const [runner, setRunner] = useState<ExtendedModelRunnerEngine | null>(null);
  const [infoMessage, setInfoMessage] = useState<string>("");
  const [isError, setIsError] = useState<boolean>(false);
  const [isWaiting, setIsWaiting] = useState<boolean>(false);
  const [inputLoaded, setInputLoaded] = useState<boolean>(false);
  
  // Button states
  const [buttonEnabledRun, setButtonEnabledRun] = useState<boolean>(false);
  const [buttonEnabledInput, setButtonEnabledInput] = useState<boolean>(false);
  const [buttonEnabledOutput, setButtonEnabledOutput] = useState<boolean>(false);

  const setInfoPanel = (message: string, waiting: boolean = false, error: boolean = false) => {
    setInfoMessage(message);
    setIsWaiting(waiting);
    setIsError(error);
  };

  const updateButtonStates = (enabled: boolean, modelRunner = runner) => {
    if (!modelRunner?.rdf) {
      setButtonEnabledRun(false);
      setButtonEnabledInput(false);
      setButtonEnabledOutput(false);
    } else {
      setButtonEnabledRun(enabled);
      setButtonEnabledInput(enabled && (
        rdfHas(modelRunner.rdf as ModelRDF, "test_inputs") || 
        rdfHas(modelRunner.rdf as ModelRDF, "sample_inputs")
      ));
      setButtonEnabledOutput(enabled && (
        rdfHas(modelRunner.rdf as ModelRDF, "test_outputs") || 
        rdfHas(modelRunner.rdf as ModelRDF, "sample_outputs")
      ));
    }
  };

  const initModel = async (modelId: string, modelRunner = runner) => {
    if (!modelRunner) return;
    
    setInfoPanel(`Initializing model ${modelId}...`, true);
    updateButtonStates(false, modelRunner);
    
    try {
      await modelRunner.loadModel(modelId);
      // Update any model parameters if needed
      // This would be similar to the parametersStore.$patch in the Vue example
      
      updateButtonStates(true, modelRunner);
      setInfoPanel("");
    } catch (e) {
      setInfoPanel(`Failed to load model ${modelId}.`, false, true);
      console.error(e);
    }
  };

  const runModel = async () => {
    if (!artifactId || !hyphaCoreAPI || !isHyphaCoreReady || !runner || !viewerControl) {
      console.error('Cannot run model: Missing dependencies');
      return;
    }

    setIsLoading(true);
    setButtonEnabledRun(false);
    setInfoPanel("Running the model...", true);

    try {
      // Get the input image from the viewer
      const img = await viewerControl.getImage();
      
      // Get the RDF specs
      const rdf = runner.rdf as ModelRDF;
      const inputSpec = rdf.inputs[0];
      const outputSpec = rdf.outputs[0];
      
      // Infer the image axes and reshape the tensor to match input spec
      const imgAxes = inferImgAxesViaSpec(img._rshape, inputSpec.axes, true);
      console.log("Input image axes:", imgAxes);
      console.log("Reshaping image to match the input spec");
      
      // Convert image to tensor and reshape
      const tensor = imjoyToTfjs(img);
      const reshapedTensor = mapAxes(tensor, imgAxes, parseAxes(inputSpec));
      
      // Use default tile sizes and overlaps
      const tileSizes = runner.getDefaultTileSizes();
      const tileOverlaps = runner.getDefaultTileOverlaps();
      
      // Create parameters store object with default values
      const parametersStore = {
        tileSizes,
        tileOverlaps,
        additionalParameters: undefined as any
      };
      
      // Run the model with tiling
      const outTensor = await runner.runTiles(
        reshapedTensor,
        inputSpec,
        outputSpec,
        parametersStore.tileSizes,
        parametersStore.tileOverlaps,
        parametersStore.additionalParameters,
        (msg: string) => setInfoPanel(msg, true)
      );
      
      // Display the results
      if (runner.isImg2Img()) {
        // Image segmentation/transformation model
        const imgsForShow = processForShow(outTensor, outputSpec.axes);
        await viewerControl.showImgs(imgsForShow, "output");
      } else {
        // Classification model
        await viewerControl.showTableFromTensor(outTensor, "output");
      }
      
      setInfoPanel("Model execution completed successfully!");
    } catch (error) {
      console.error('Failed to run model:', error);
      setInfoPanel("Failed to run the model. See console for details.", false, true);
    } finally {
      setIsLoading(false);
      setButtonEnabledRun(true);
    }
  };

  const setupRunner = async () => {
    if (!artifactId || !hyphaCoreAPI || !isHyphaCoreReady) {
      console.error('Cannot setup runner: Missing artifactId or hyphaCoreAPI is not ready');
      return;
    }

    setIsLoading(true);

    try {
      // Extract model ID from the full artifactId
      const modelId = artifactId.split('/').pop() || '';
      
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
      const imagej = await hyphaCoreAPI.createWindow({
        name: `Run Model: ${modelId}`,
        src: "https://ij.imjoy.io/",
        window_id: containerId
      });
      
      const viewer = new ImagejJsController(imagej);
      setViewerControl(viewer);
      
      const modelRunner = new ModelRunnerEngine() as ExtendedModelRunnerEngine;
      await modelRunner.init()
      setRunner(modelRunner);
      
      // Initialize the model with the provided artifact ID
      await initModel(modelId, modelRunner);
      
      console.log(`Created window ${containerId} for model ${modelId}`);
      
      setIsRunning(true);
      setIsLoading(false);
      
      // Notify parent component if callback provided
      if (onRunStateChange) {
        onRunStateChange(true);
      }

    } catch (error) {
      console.error('Failed to setup runner:', error);
      setInfoPanel("Failed to setup the model runner. See console for details.", false, true);
      setIsLoading(false);
    }
  };

  const loadTestInput = async () => {
    if (!runner || !viewerControl) return;
    
    setInfoPanel("Loading test input...", true);
    
    try {
      const rdf = runner.rdf as ModelRDF;
      if (rdfHas(rdf, "test_inputs")) {
        const testInputUrl = getRdfTensorUrl(rdf, 'test_inputs');
        if (testInputUrl) {
          await viewerControl.viewFromUrl(
            testInputUrl,
            rdf.inputs[0],
            rdf.outputs[0]
          );
          setInputLoaded(true);
        }
      } else if (rdfHas(rdf, "sample_inputs")) {
        const sampleInputUrl = getRdfTensorUrl(rdf, 'sample_inputs');
        if (sampleInputUrl) {
          await viewerControl.viewFromUrl(
            sampleInputUrl,
            rdf.inputs[0],
            rdf.outputs[0]
          );
          setInputLoaded(true);
        }
      } else {
        alert("No test input found.");
      }
    } catch (err) {
      console.log("Failed to load the test input, see console for details.");
      console.error(err);
      
      try {
        const rdf = runner.rdf as ModelRDF;
        if (rdfHas(rdf, "sample_inputs")) {
          console.log("Loading sample input instead...");
          const sampleInputUrl = getRdfTensorUrl(rdf, 'sample_inputs');
          if (sampleInputUrl) {
            await viewerControl.viewFromUrl(
              sampleInputUrl,
              rdf.inputs[0], 
              rdf.outputs[0]
            );
            setInputLoaded(true);
          }
        }
      } catch (sampleError) {
        console.error("Failed to load sample input:", sampleError);
        setInfoPanel("Failed to load any input images.", false, true);
      }
    } finally {
      setInfoPanel("");
    }
  };

  const loadTestOutput = async () => {
    if (!runner || !viewerControl) return;
    
    setInfoPanel("Loading test output...", true);
    
    try {
      const rdf = runner.rdf as ModelRDF;
      if (rdfHas(rdf, "test_outputs")) {
        const testOutputUrl = getRdfTensorUrl(rdf, 'test_outputs');
        if (testOutputUrl) {
          await viewerControl.viewFromUrl(
            testOutputUrl,
            rdf.inputs[0],
            rdf.outputs[0],
            "output"
          );
        }
      } else if (rdfHas(rdf, "sample_outputs")) {
        const sampleOutputUrl = getRdfTensorUrl(rdf, 'sample_outputs');
        if (sampleOutputUrl) {
          await viewerControl.viewFromUrl(
            sampleOutputUrl,
            rdf.inputs[0],
            rdf.outputs[0],
            "output"
          );
        }
      } else {
        alert("No test output found.");
      }
    } catch (err) {
      console.log("Failed to load the test output.");
      console.error(err);
      
      try {
        const rdf = runner.rdf as ModelRDF;
        if (rdfHas(rdf, "sample_outputs")) {
          console.log("Loading sample output instead...");
          const sampleOutputUrl = getRdfTensorUrl(rdf, 'sample_outputs');
          if (sampleOutputUrl) {
            await viewerControl.viewFromUrl(
              sampleOutputUrl,
              rdf.inputs[0],
              rdf.outputs[0],
              "output"
            );
          }
        }
      } catch (sampleError) {
        console.error("Failed to load sample output:", sampleError);
        setInfoPanel("Failed to load any output images.", false, true);
      }
    } finally {
      setInfoPanel("");
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
      const modelId = artifactId?.split('/').pop() || '';
      
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
      setInputLoaded(false);
    } catch (error) {
      console.error('Failed to reload app:', error);
      setIsReloading(false);
    }
  };

  return (
    <div className={`relative ${className}`}>
      <div className="flex h-[40px] space-x-2">
        <button
          onClick={isRunning ? reloadApp : setupRunner}
          disabled={!isLoggedIn || isDisabled || (isRunning ? isReloading : isLoading) || !isHyphaCoreReady}
          title={
            !isLoggedIn 
              ? "Please login to run models" 
              : !isHyphaCoreReady 
                ? "Initializing HyphaCore..." 
                : isRunning 
                  ? "Reload the application" 
                  : "Initialize model in ImageJ.JS"
          }
          className={`inline-flex items-center gap-2 px-4 h-full rounded-md font-medium transition-colors
            ${!isLoggedIn || isDisabled || !isHyphaCoreReady
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : isRunning
                ? 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-300'
                : 'bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-300'
            }`}
        >
          {/* Icon */}
          {isRunning ? (
            isReloading ? (
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )
          ) : (
            isLoading ? (
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                  d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                  d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )
          )}
          
          {/* Button text */}
          <span className="hidden sm:inline">
            {!isLoggedIn ? "Login to Run" : isRunning ? "Reload App" : "Run Model"}
          </span>
        </button>
        
        {isRunning && (
          <>
            <button
              onClick={loadTestInput}
              disabled={!buttonEnabledInput || isWaiting}
              className={`inline-flex items-center gap-2 px-4 h-full rounded-md font-medium transition-colors
                ${!buttonEnabledInput || isWaiting
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-300'
                }`}
            >
              <span className="hidden sm:inline">Load Sample Image</span>
            </button>
            
            <button
              onClick={runModel}
              disabled={!buttonEnabledRun || isWaiting || !inputLoaded}
              className={`inline-flex items-center gap-2 px-4 h-full rounded-md font-medium transition-colors
                ${!buttonEnabledRun || isWaiting || !inputLoaded
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700 border border-blue-700'
                }`}
            >
              {isWaiting ? (
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                    d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                </svg>
              )}
              <span className="hidden sm:inline">Run Model</span>
            </button>
            
            <button
              onClick={loadTestOutput}
              disabled={!buttonEnabledOutput || isWaiting}
              className={`inline-flex items-center gap-2 px-4 h-full rounded-md font-medium transition-colors
                ${!buttonEnabledOutput || isWaiting
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-300'
                }`}
            >
              <span className="hidden sm:inline">Show Reference Output</span>
            </button>
          </>
        )}
      </div>
      
      {infoMessage && (
        <div className="mt-2 px-3 py-2 text-sm rounded" style={{ color: isError ? 'red' : 'black' }}>
          {isWaiting && <span className="mr-2">⏳</span>}
          {infoMessage}
        </div>
      )}
    </div>
  );
};

export default ModelRunner; 