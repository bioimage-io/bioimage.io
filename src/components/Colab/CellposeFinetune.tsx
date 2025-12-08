import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

// Declare Plotly as a global variable
declare const Plotly: any;

interface CellposeFinetuneProps {
  sessionId?: string;
  dataArtifactId?: string;
  label?: string;
  server: any;
  onBack?: () => void;
}

const CellposeFinetune: React.FC<CellposeFinetuneProps> = ({
  sessionId: initialSessionId,
  dataArtifactId,
  label,
  server,
  onBack,
}) => {
  const navigate = useNavigate();
  const plotRef = useRef<HTMLDivElement>(null);
  const [plotlyLoaded, setPlotlyLoaded] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId || null);
  const [isTraining, setIsTraining] = useState(false);
  const [selectedModel, setSelectedModel] = useState('cpsam');
  const [epochs, setEpochs] = useState(10);
  const [learningRate, setLearningRate] = useState(0.000001);
  const [weightDecay, setWeightDecay] = useState(0.0001);
  const [error, setError] = useState<string | null>(null);
  const [trainingProgress, setTrainingProgress] = useState('');
  const [statusType, setStatusType] = useState<string>('');
  const [trainLosses, setTrainLosses] = useState<number[]>([]);
  const [testLosses, setTestLosses] = useState<number[]>([]);
  const [currentEpoch, setCurrentEpoch] = useState<number | null>(null);
  const [totalEpochs, setTotalEpochs] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState<number | null>(null);
  const [nTrain, setNTrain] = useState<number | null>(null);
  const [nTest, setNTest] = useState<number | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportedArtifactId, setExportedArtifactId] = useState<string | null>(null);

  // Load Plotly.js from CDN
  useEffect(() => {
    if (typeof Plotly !== 'undefined') {
      setPlotlyLoaded(true);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://cdn.plot.ly/plotly-2.27.0.min.js';
    script.async = true;
    script.onload = () => setPlotlyLoaded(true);
    document.body.appendChild(script);

    return () => {
      // Cleanup if needed
    };
  }, []);

  const availableModels = [
    { value: 'cpsam', label: 'Cellpose-SAM', description: 'Transformer-based cell segmentation' },
  ];

  // Poll for training status
  useEffect(() => {
    if (!sessionId || !server) return;

    let intervalId: NodeJS.Timeout;

    const pollStatus = async () => {
      try {
        const cellposeService = await server.getService('bioimage-io/cellpose-finetuning', {mode: 'last'});
        const status = await cellposeService.get_training_status(sessionId);

        setStatusType(status.status_type);
        setTrainingProgress(status.message);

        // Update metrics
        if (status.train_losses) setTrainLosses(status.train_losses);
        if (status.test_losses) setTestLosses(status.test_losses);
        if (status.current_epoch != null) setCurrentEpoch(status.current_epoch);
        if (status.total_epochs != null) setTotalEpochs(status.total_epochs);
        if (status.elapsed_seconds != null) setElapsedSeconds(status.elapsed_seconds);
        if (status.n_train != null) setNTrain(status.n_train);
        if (status.n_test != null) setNTest(status.n_test);

        if (status.status_type === 'completed') {
          setIsTraining(false);
        } else if (status.status_type === 'failed') {
          setIsTraining(false);
          setError(status.message);
        }
      } catch (error) {
        console.error('Error polling training status:', error);
      }
    };

    // Start polling every 2 seconds
    intervalId = setInterval(pollStatus, 2000);
    pollStatus(); // Initial poll

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [sessionId, server]);

  // Update Plotly chart when losses change
  useEffect(() => {
    if (!plotlyLoaded || !plotRef.current || trainLosses.length === 0) return;

    const validTrainLosses = trainLosses.filter((l) => l > 0);
    const validTestLosses = testLosses.filter((l) => l > 0);

    if (validTrainLosses.length === 0) return;

    const trainTrace = {
      x: validTrainLosses.map((_, i) => i + 1),
      y: validTrainLosses,
      mode: "lines+markers",
      name: "Train Loss",
      line: { color: "#3b82f6", width: 2 },
      marker: { size: 6 }
    };

    const traces: any[] = [trainTrace];

    if (validTestLosses.length > 0) {
      const testTrace = {
        x: validTestLosses.map((_, i) => i + 1),
        y: validTestLosses,
        mode: "lines+markers",
        name: "Test Loss",
        line: { color: "#10b981", width: 2, dash: "dash" },
        marker: { size: 6 }
      };
      traces.push(testTrace);
    }

    const layout = {
      title: "Training Loss",
      xaxis: {
        title: "Epoch",
        showgrid: true,
        gridcolor: "#e5e7eb"
      },
      yaxis: {
        title: "Loss",
        showgrid: true,
        gridcolor: "#e5e7eb",
        type: "log"
      },
      plot_bgcolor: "#f9fafb",
      paper_bgcolor: "#f9fafb",
      margin: { l: 60, r: 40, t: 40, b: 60 },
      legend: {
        x: 1,
        xanchor: "right",
        y: 1
      },
      hovermode: "closest"
    };

    const config = {
      responsive: true,
      displayModeBar: true,
      displaylogo: false,
      modeBarButtonsToRemove: ["pan2d", "lasso2d", "select2d"]
    };

    Plotly.newPlot(plotRef.current, traces, layout, config);
  }, [trainLosses, testLosses, plotlyLoaded]);

  const handleStartTraining = async () => {
    if (!server) {
      setError('Not connected to server. Please login first.');
      return;
    }

    if (!dataArtifactId) {
      setError('No data artifact available. Please create an annotation session first.');
      return;
    }

    setIsTraining(true);
    setError(null);
    setTrainingProgress('Connecting to training service...');

    try {
      console.log('Getting cellpose-finetuning service...');
      const cellposeService = await server.getService('bioimage-io/cellpose-finetuning', {mode: 'last'});

      console.log('Starting training with artifact:', dataArtifactId);
      setTrainingProgress('Starting training...');

      const maskFolder = label ? `masks_${label}` : 'annotations';
      const sessionStatus = await cellposeService.start_training({
        artifact: String(dataArtifactId),
        model: String(selectedModel),
        train_images: 'input_images/*.png',
        train_annotations: `${maskFolder}/*.png`,
        n_epochs: Number(epochs),
        learning_rate: Number(learningRate),
        weight_decay: Number(weightDecay),
        n_samples: null,
        min_train_masks: 1,
        _rkwargs: true,
      });

      const newSessionId = sessionStatus.session_id;
      setSessionId(newSessionId);

      // Update URL with session ID
      navigate(`/finetune-cellpose/${newSessionId}`, { replace: true });

      // Extract initial status if available
      if (sessionStatus.status_type) setStatusType(sessionStatus.status_type);
      if (sessionStatus.message) setTrainingProgress(sessionStatus.message);
      if (sessionStatus.train_losses) setTrainLosses(sessionStatus.train_losses);
      if (sessionStatus.test_losses) setTestLosses(sessionStatus.test_losses);
      if (sessionStatus.current_epoch != null) setCurrentEpoch(sessionStatus.current_epoch);
      if (sessionStatus.total_epochs != null) setTotalEpochs(sessionStatus.total_epochs);
      if (sessionStatus.n_train != null) setNTrain(sessionStatus.n_train);
      if (sessionStatus.n_test != null) setNTest(sessionStatus.n_test);

      console.log('✓ Training started with session ID:', newSessionId);

    } catch (error) {
      console.error('Error starting training:', error);
      setError(
        `Failed to start training: ${error instanceof Error ? error.message : String(error)}`
      );
      setTrainingProgress('');
      setIsTraining(false);
    }
  };

  const handleExportModel = async () => {
    if (!sessionId || !server) {
      setError('No training session available to export.');
      return;
    }

    setIsExporting(true);
    setError(null);

    try {
      console.log('Exporting model from session:', sessionId);
      const cellposeService = await server.getService('bioimage-io/cellpose-finetuning', {mode: 'last'});
      const result = await cellposeService.export_model(sessionId, { _rkwargs: true });

      const artifactId = result.artifact_id || result;
      setExportedArtifactId(artifactId);

      console.log('✓ Model exported successfully to artifact:', artifactId);
    } catch (error) {
      console.error('Error exporting model:', error);
      setError(`Failed to export model: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else if (dataArtifactId) {
      // Navigate back to the specific colab session
      navigate(`/colab/${dataArtifactId}`);
    } else {
      // Fallback to colab home if no artifact ID
      navigate('/colab');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-purple-50/30 to-blue-50/30">
      <div className="max-w-[1400px] mx-auto px-4 py-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <button
                onClick={handleBack}
                className="p-2 hover:bg-white/60 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 via-pink-600 to-blue-600 bg-clip-text text-transparent tracking-tight">
                Train Cellpose Model
              </h1>
            </div>
            {sessionId && (
              <p className="text-sm text-gray-600 ml-14">
                Session ID: <span className="font-mono text-xs">{sessionId}</span>
              </p>
            )}
          </div>
          {sessionId && (
            <div className="flex items-center gap-2 px-4 py-2 bg-white/80 rounded-lg border border-gray-200 shadow-sm">
              <div className={`w-2 h-2 rounded-full ${
                statusType === 'completed' ? 'bg-green-500' :
                statusType === 'failed' ? 'bg-red-500' :
                statusType === 'running' ? 'bg-blue-500 animate-pulse' :
                'bg-gray-500 animate-pulse'
              }`}></div>
              <span className="text-sm font-medium text-gray-700">
                {statusType || 'Initializing...'}
              </span>
            </div>
          )}
        </div>

        {/* Main Content */}
        <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-md border border-gray-200 p-8">
          {!sessionId ? (
            <>
              {/* Training Configuration */}
              <h2 className="text-xl font-semibold text-gray-800 mb-6">Configure Training</h2>

              <div className="space-y-6 max-w-2xl">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Model Type
                  </label>
                  <select
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    disabled={isTraining}
                  >
                    {availableModels.map((model) => (
                      <option key={model.value} value={model.value}>
                        {model.label} - {model.description}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Number of Epochs
                    </label>
                    <input
                      type="number"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      value={epochs}
                      onChange={(e) => setEpochs(parseInt(e.target.value))}
                      min="1"
                      max="1000"
                      disabled={isTraining}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Learning Rate
                    </label>
                    <input
                      type="number"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      value={learningRate}
                      onChange={(e) => setLearningRate(parseFloat(e.target.value))}
                      step="0.000001"
                      min="0.000001"
                      max="1"
                      disabled={isTraining}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Weight Decay
                    </label>
                    <input
                      type="number"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      value={weightDecay}
                      onChange={(e) => setWeightDecay(parseFloat(e.target.value))}
                      step="0.0001"
                      min="0"
                      max="1"
                      disabled={isTraining}
                    />
                  </div>
                </div>

                <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-amber-700 text-sm">
                    <strong>Note:</strong> Training will use annotations from your data artifact{' '}
                    {dataArtifactId && (
                      <span className="font-mono text-xs">({dataArtifactId.split('/').pop()})</span>
                    )}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleStartTraining}
                  disabled={isTraining || !dataArtifactId}
                  className="w-full px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl hover:from-blue-700 hover:to-indigo-700 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed flex items-center justify-center shadow-sm hover:shadow-md transition-all duration-200"
                >
                  {isTraining ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                      Starting Training...
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                      Start Training
                    </>
                  )}
                </button>
              </div>
            </>
          ) : (
            <>
              {/* Training Progress */}
              <div className="space-y-6">
                {/* Progress Info */}
                {currentEpoch != null && totalEpochs != null && statusType === 'running' && (
                  <div>
                    <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
                      <span className="font-medium">Training Progress</span>
                      <span>Epoch {currentEpoch} / {totalEpochs}</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-3">
                      <div
                        className="bg-gradient-to-r from-blue-500 to-indigo-500 h-3 rounded-full transition-all duration-300"
                        style={{
                          width: `${((currentEpoch || 0) / (totalEpochs || 1)) * 100}%`,
                        }}
                      ></div>
                    </div>
                    {elapsedSeconds != null && (
                      <p className="text-xs text-gray-500 mt-2">
                        Elapsed: {Math.floor(elapsedSeconds / 60)}m {Math.floor(elapsedSeconds % 60)}s
                      </p>
                    )}
                  </div>
                )}

                {/* Dataset Info */}
                {(nTrain != null || nTest != null) && (
                  <div className="grid grid-cols-2 gap-4">
                    {nTrain != null && (
                      <div className="bg-blue-50/50 rounded-lg p-4 border border-blue-200/60">
                        <p className="text-sm text-gray-600 mb-1">Training Samples</p>
                        <p className="text-3xl font-bold text-blue-600">{nTrain}</p>
                      </div>
                    )}
                    {nTest != null && (
                      <div className="bg-green-50/50 rounded-lg p-4 border border-green-200/60">
                        <p className="text-sm text-gray-600 mb-1">Test Samples</p>
                        <p className="text-3xl font-bold text-green-600">{nTest}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Training Loss Chart */}
                {trainLosses.length > 0 && (
                  <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                    <div ref={plotRef} style={{ width: '100%', height: '400px' }}></div>
                  </div>
                )}

                {/* Status Message */}
                {trainingProgress && (
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-blue-700 text-sm whitespace-pre-wrap">{trainingProgress}</p>
                  </div>
                )}

                {/* Export Section */}
                {statusType === 'completed' && (
                  <div className="pt-6 border-t border-gray-200">
                    {!exportedArtifactId ? (
                      <button
                        onClick={handleExportModel}
                        disabled={isExporting}
                        className="w-full px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-xl hover:from-green-700 hover:to-emerald-700 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed flex items-center justify-center shadow-sm hover:shadow-md transition-all duration-200"
                      >
                        {isExporting ? (
                          <>
                            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                            Exporting Model...
                          </>
                        ) : (
                          <>
                            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            Export Model
                          </>
                        )}
                      </button>
                    ) : (
                      <div className="space-y-4">
                        <div className="flex items-center text-green-700 bg-green-50 px-4 py-3 rounded-lg border border-green-200">
                          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          Model exported successfully!
                        </div>

                        <a
                          href={`${server?.config?.publicBaseUrl || 'https://hypha.bioimage.io'}/bioimage-io/artifacts/${exportedArtifactId.split('/').pop()}/create-zip-file`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-full px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl hover:from-blue-700 hover:to-indigo-700 flex items-center justify-center shadow-sm hover:shadow-md transition-all duration-200"
                        >
                          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                          Download Model ZIP
                        </a>

                        <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                          <p className="text-xs text-gray-600 mb-1">Artifact ID:</p>
                          <p className="text-xs font-mono text-gray-800 break-all">
                            {exportedArtifactId}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Error Display */}
                {statusType === 'failed' && (
                  <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-red-700 text-sm">
                      Training failed. Please check the logs and try again.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Error Message */}
          {error && (
            <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-600 text-sm flex items-center">
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {error}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CellposeFinetune;
