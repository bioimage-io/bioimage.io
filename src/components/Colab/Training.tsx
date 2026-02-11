import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

// Declare Plotly as a global variable
declare const Plotly: any;

interface ValidationMetrics {
  pixel_accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  iou: number;
}

interface InstanceMetrics {
  ap_0_5: number;
  ap_0_75: number;
  ap_0_9: number;
  n_true: number;
  n_pred: number;
}

interface ExportResult {
  artifact_id: string;
  artifact_url: string;
  download_url: string;
  files: string[];
  model_name: string;
  status: string;
}

interface TrainingProps {
  sessionId?: string;
  dataArtifactId?: string;
  label?: string;
  server: any;
  onBack?: () => void;
}

const Training: React.FC<TrainingProps> = ({
  sessionId: initialSessionId,
  dataArtifactId,
  label,
  server,
  onBack,
}) => {
  const navigate = useNavigate();
  const plotRef = useRef<HTMLDivElement>(null);
  const metricsPlotRef = useRef<HTMLDivElement>(null);
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
  const [testLosses, setTestLosses] = useState<(number | null)[]>([]);
  const [currentEpoch, setCurrentEpoch] = useState<number | null>(null);
  const [totalEpochs, setTotalEpochs] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState<number | null>(null);
  const [nTrain, setNTrain] = useState<number | null>(null);
  const [nTest, setNTest] = useState<number | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportedArtifactId, setExportedArtifactId] = useState<string | null>(null);
  const [showTrainingDialog, setShowTrainingDialog] = useState(false);
  const [isContinueMode, setIsContinueMode] = useState(false);
  const [trainingConfig, setTrainingConfig] = useState<{
    model: string;
    epochs: number;
    learningRate: number;
    weightDecay: number;
  } | null>(null);
  const [storedArtifactId, setStoredArtifactId] = useState<string | null>(null);
  const [datasetInfo, setDatasetInfo] = useState<any>(null);
  const [storedLabel, setStoredLabel] = useState<string | null>(label || null);

  // New state for batch-level progress
  const [currentBatch, setCurrentBatch] = useState<number | null>(null);
  const [totalBatches, setTotalBatches] = useState<number | null>(null);

  // New state for start time
  const [startTime, setStartTime] = useState<string | null>(null);

  // New state for validation metrics
  const [testMetrics, setTestMetrics] = useState<(ValidationMetrics | null)[]>([]);

  // New state for instance metrics (end-of-training)
  const [instanceMetrics, setInstanceMetrics] = useState<InstanceMetrics | null>(null);

  // New state for export enhancements
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [modelName, setModelName] = useState<string>('');

  // New state for stop training
  const [isStopping, setIsStopping] = useState(false);

  // New state for chart tab
  const [activeChartTab, setActiveChartTab] = useState<'loss' | 'metrics'>('loss');

  // New state for validation config
  const [validationInterval, setValidationInterval] = useState<number>(1);
  const [testImages, setTestImages] = useState<string>('');
  const [testAnnotations, setTestAnnotations] = useState<string>('');

  // Initialize storedArtifactId from dataArtifactId prop (for new training sessions)
  useEffect(() => {
    if (dataArtifactId && !storedArtifactId && !sessionId) {
      // Only set from prop if we don't have a session ID (new training)
      setStoredArtifactId(dataArtifactId);
    }
  }, [dataArtifactId, storedArtifactId, sessionId]);

  // Fetch dataset artifact info when storedArtifactId changes
  useEffect(() => {
    if (!storedArtifactId || !server) return;

    const fetchDatasetInfo = async () => {
      try {
        const artifactManager = await server.getService('public/artifact-manager');
        const datasetArtifact = await artifactManager.read({
          artifact_id: storedArtifactId,
          stage: true,
          _rkwargs: true
        });
        setDatasetInfo(datasetArtifact);
        console.log('Loaded dataset artifact info:', datasetArtifact);
      } catch (error) {
        console.error('Error fetching dataset artifact:', error);
      }
    };

    fetchDatasetInfo();
  }, [storedArtifactId, server]);

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

  // Poll for training status (only poll if training is ongoing)
  useEffect(() => {
    if (!sessionId || !server) return;

    let intervalId: NodeJS.Timeout | null = null;

    const fetchStatus = async () => {
      try {
        const cellposeService = await server.getService('bioimage-io/cellpose-finetuning', {mode: "last"});
        const status = await cellposeService.get_training_status(sessionId);

        setStatusType(status.status_type);
        setTrainingProgress(status.message);

        // Get dataset artifact ID from training status (backend now provides this)
        if (status.dataset_artifact_id && !storedArtifactId) {
          setStoredArtifactId(status.dataset_artifact_id);
          console.log('Found dataset_artifact_id in training status:', status.dataset_artifact_id);
        }

        // Update metrics
        if (status.train_losses) setTrainLosses(status.train_losses);
        if (status.test_losses) setTestLosses(status.test_losses);
        if (status.current_epoch != null) setCurrentEpoch(status.current_epoch);
        if (status.total_epochs != null) setTotalEpochs(status.total_epochs);
        if (status.elapsed_seconds != null) setElapsedSeconds(status.elapsed_seconds);
        if (status.n_train != null) setNTrain(status.n_train);
        if (status.n_test != null) setNTest(status.n_test);

        // New fields
        if (status.current_batch != null) setCurrentBatch(status.current_batch);
        if (status.total_batches != null) setTotalBatches(status.total_batches);
        if (status.start_time) setStartTime(status.start_time);
        if (status.test_metrics) setTestMetrics(status.test_metrics);
        if (status.instance_metrics) setInstanceMetrics(status.instance_metrics);

        // Recover exported artifact ID from status (for resumed sessions)
        if (status.exported_artifact_id && !exportedArtifactId) {
          setExportedArtifactId(status.exported_artifact_id);
        }

        // Check if training is in a terminal state
        const isTerminalState = ['completed', 'failed', 'stopped'].includes(status.status_type);

        if (status.status_type === 'completed') {
          setIsTraining(false);
          console.log('Training completed');
        } else if (status.status_type === 'failed') {
          setIsTraining(false);
          setError(status.message);
          console.log('Training failed');
        } else if (status.status_type === 'stopped') {
          setIsTraining(false);
          console.log('Training stopped');
        }

        // If in terminal state, stop polling
        if (isTerminalState && intervalId) {
          clearInterval(intervalId);
          intervalId = null;
          console.log('Stopped polling - training finished');
        }

        // If not in terminal state and not polling yet, start polling
        if (!isTerminalState && !intervalId) {
          intervalId = setInterval(fetchStatus, 2000);
          console.log('Started polling - training ongoing');
        }
      } catch (error) {
        console.error('Error fetching training status:', error);
      }
    };

    // Initial fetch
    fetchStatus();

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [sessionId, server]);

  // Update Plotly loss chart when losses change
  useEffect(() => {
    if (!plotlyLoaded || !plotRef.current || trainLosses.length === 0) return;

    // Preserve epoch indices for train losses, filter out invalid values
    const trainLossData = trainLosses
      .map((l, i) => ({ epoch: i + 1, loss: l }))
      .filter((d) => d.loss != null && d.loss > 0);

    if (trainLossData.length === 0) return;

    const trainTrace = {
      x: trainLossData.map((d) => d.epoch),
      y: trainLossData.map((d) => d.loss),
      mode: "lines+markers",
      name: "Train Loss",
      line: { color: "#3b82f6", width: 2 },
      marker: { size: 6 }
    };

    const traces: any[] = [trainTrace];

    // test_losses uses null for skipped epochs - preserve epoch indices
    const testLossData = testLosses
      .map((l, i) => ({ epoch: i + 1, loss: l }))
      .filter((d) => d.loss !== null && d.loss !== undefined && (d.loss as number) > 0);

    if (testLossData.length > 0) {
      const testTrace = {
        x: testLossData.map((d) => d.epoch),
        y: testLossData.map((d) => d.loss),
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

  // Update Plotly validation metrics chart
  useEffect(() => {
    if (!plotlyLoaded || !metricsPlotRef.current || testMetrics.length === 0) return;

    const validMetrics = testMetrics
      .map((m, i) => ({ epoch: i + 1, metrics: m }))
      .filter((d) => d.metrics !== null);

    if (validMetrics.length === 0) return;

    const metricDefs: { key: keyof ValidationMetrics; label: string; color: string }[] = [
      { key: 'f1', label: 'F1 / Dice', color: '#8b5cf6' },
      { key: 'iou', label: 'IoU', color: '#3b82f6' },
      { key: 'precision', label: 'Precision', color: '#10b981' },
      { key: 'recall', label: 'Recall', color: '#f59e0b' },
      { key: 'pixel_accuracy', label: 'Pixel Accuracy', color: '#ef4444' },
    ];

    const traces = metricDefs.map(({ key, label, color }) => ({
      x: validMetrics.map((d) => d.epoch),
      y: validMetrics.map((d) => d.metrics![key]),
      mode: "lines+markers",
      name: label,
      line: { color, width: 2 },
      marker: { size: 5 },
    }));

    const layout = {
      title: "Validation Metrics (Pixel-Level)",
      xaxis: { title: "Epoch", showgrid: true, gridcolor: "#e5e7eb" },
      yaxis: { title: "Score", showgrid: true, gridcolor: "#e5e7eb", range: [0, 1] },
      plot_bgcolor: "#f9fafb",
      paper_bgcolor: "#f9fafb",
      margin: { l: 60, r: 40, t: 40, b: 60 },
      legend: { x: 1, xanchor: "right", y: 1 },
      hovermode: "closest",
    };

    const config = {
      responsive: true,
      displayModeBar: true,
      displaylogo: false,
      modeBarButtonsToRemove: ["pan2d", "lasso2d", "select2d"],
    };

    Plotly.newPlot(metricsPlotRef.current, traces, layout, config);
  }, [testMetrics, plotlyLoaded]);

  const handleStartTraining = async (continueFromSession?: boolean) => {
    if (!server) {
      setError('Not connected to server. Please login first.');
      return;
    }

    // Artifact ID should always come from storedArtifactId (populated from training status)
    if (!storedArtifactId) {
      if (continueFromSession) {
        setError('Loading dataset information from training session...');
      } else {
        setError('No data artifact available. Please create an annotation session first.');
      }
      return;
    }

    const artifactToUse = storedArtifactId;

    setIsTraining(true);
    setError(null);
    setTrainingProgress('Connecting to training service...');
    setShowTrainingDialog(false);

    // Reset new state for fresh training
    setCurrentBatch(null);
    setTotalBatches(null);
    setStartTime(null);
    setTestMetrics([]);
    setInstanceMetrics(null);
    setExportResult(null);
    setExportedArtifactId(null);
    setActiveChartTab('loss');

    try {
      console.log('Getting cellpose-finetuning service...');
      const cellposeService = await server.getService('bioimage-io/cellpose-finetuning', {mode: "last"});

      console.log('Starting training with artifact:', artifactToUse);
      setTrainingProgress('Starting training...');

      // Use stored label to ensure consistency across multiple continue operations
      const labelToUse = storedLabel || label;
      const maskFolder = labelToUse ? `masks_${labelToUse}` : 'annotations';

      // Store the label on first training
      if (!storedLabel && labelToUse) {
        setStoredLabel(labelToUse);
      }

      // Use session ID if continuing training, otherwise use selected model
      const modelParam = continueFromSession && sessionId ? sessionId : selectedModel;

      if (continueFromSession && sessionId) {
        console.log(`Continuing training from session: ${sessionId}`);
        console.log(`Using artifact: ${artifactToUse}`);
        console.log(`Using mask folder: ${maskFolder}`);
      } else {
        console.log(`Starting new training with model: ${selectedModel}`);
      }

      const trainingParams: any = {
        artifact: String(artifactToUse),
        model: String(modelParam),
        train_images: 'input_images/*.png',
        train_annotations: `${maskFolder}/*.png`,
        n_epochs: Number(epochs),
        learning_rate: Number(learningRate),
        weight_decay: Number(weightDecay),
        n_samples: null,
        min_train_masks: 1,
        _rkwargs: true,
      };

      // Add optional test data parameters
      if (testImages.trim()) {
        trainingParams.test_images = testImages.trim();
        trainingParams.test_annotations = testAnnotations.trim() || `${maskFolder}/*.png`;
      }

      // Add validation interval
      if (validationInterval > 0) {
        trainingParams.validation_interval = validationInterval;
      }

      console.log('Training parameters:', JSON.stringify(trainingParams, null, 2));

      const sessionStatus = await cellposeService.start_training(trainingParams);

      const newSessionId = sessionStatus.session_id;
      setSessionId(newSessionId);

      // Store the artifact ID from the session status if not already set
      if (!storedArtifactId && sessionStatus.dataset_artifact_id) {
        setStoredArtifactId(sessionStatus.dataset_artifact_id);
      }

      // Save training configuration
      setTrainingConfig({
        model: continueFromSession ? 'continued' : selectedModel,
        epochs,
        learningRate,
        weightDecay,
      });

      // Update URL with session ID
      navigate(`/training/${newSessionId}`, { replace: true });

      // Extract initial status if available
      if (sessionStatus.status_type) setStatusType(sessionStatus.status_type);
      if (sessionStatus.message) setTrainingProgress(sessionStatus.message);
      if (sessionStatus.train_losses) setTrainLosses(sessionStatus.train_losses);
      if (sessionStatus.test_losses) setTestLosses(sessionStatus.test_losses);
      if (sessionStatus.current_epoch != null) setCurrentEpoch(sessionStatus.current_epoch);
      if (sessionStatus.total_epochs != null) setTotalEpochs(sessionStatus.total_epochs);
      if (sessionStatus.n_train != null) setNTrain(sessionStatus.n_train);
      if (sessionStatus.n_test != null) setNTest(sessionStatus.n_test);

      console.log('Training started with session ID:', newSessionId);

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
      const cellposeService = await server.getService('bioimage-io/cellpose-finetuning', {mode: "last"});

      const exportParams: any = { _rkwargs: true };
      if (modelName.trim()) {
        exportParams.model_name = modelName.trim();
      }

      const result = await cellposeService.export_model(sessionId, exportParams);

      const artifactId = result.artifact_id || result;
      setExportedArtifactId(artifactId);
      setExportResult(result);

      console.log('Model exported successfully:', result);
    } catch (error) {
      console.error('Error exporting model:', error);
      setError(`Failed to export model: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleStopTraining = async () => {
    if (!sessionId || !server) return;

    setIsStopping(true);
    try {
      const cellposeService = await server.getService('bioimage-io/cellpose-finetuning', {mode: "last"});
      await cellposeService.stop_training(sessionId);
      console.log('Stop training requested for session:', sessionId);
    } catch (error) {
      console.error('Error stopping training:', error);
      setError(`Failed to stop training: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsStopping(false);
    }
  };

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else if (storedArtifactId) {
      // Navigate back to the specific dataset annotation session
      navigate(`/colab/${storedArtifactId}`);
    } else {
      // Fallback to colab home if no artifact ID
      navigate('/colab');
    }
  };

  // Helper to get the latest non-null validation metrics
  const getLatestValidationMetrics = () => {
    if (testMetrics.length === 0) return null;
    for (let i = testMetrics.length - 1; i >= 0; i--) {
      if (testMetrics[i] !== null) {
        return { epoch: i + 1, metrics: testMetrics[i]! };
      }
    }
    return null;
  };

  // Render the advanced settings section (shared between config form and dialog)
  const renderAdvancedSettings = (disabled: boolean) => (
    <details className="border border-gray-200 rounded-lg">
      <summary className="px-4 py-3 text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-50 select-none">
        Validation & Advanced Settings
      </summary>
      <div className="px-4 pb-4 space-y-4 pt-2">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Validation Interval (epochs)
          </label>
          <input
            type="number"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            value={validationInterval}
            onChange={(e) => setValidationInterval(parseInt(e.target.value) || 1)}
            min="1"
            max="1000"
            disabled={disabled}
          />
          <p className="text-xs text-gray-500 mt-1">
            Run validation every N epochs. Requires test data below.
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Test Images Path (optional)
          </label>
          <input
            type="text"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            value={testImages}
            onChange={(e) => setTestImages(e.target.value)}
            placeholder="e.g., input_images/*.png (same as training data)"
            disabled={disabled}
          />
          <p className="text-xs text-gray-500 mt-1">
            Provide test images to enable per-epoch validation metrics and final AP evaluation.
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Test Annotations Path (optional)
          </label>
          <input
            type="text"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            value={testAnnotations}
            onChange={(e) => setTestAnnotations(e.target.value)}
            placeholder="e.g., masks_cells/*.png (auto-matched if empty)"
            disabled={disabled}
          />
        </div>
      </div>
    </details>
  );

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
                Train AI Model
              </h1>
            </div>
            {sessionId && (
              <p className="text-sm text-gray-600 ml-14">
                Session ID: <span className="font-mono text-xs">{sessionId}</span>
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            {/* Stop Training Button */}
            {sessionId && statusType === 'running' && (
              <button
                onClick={handleStopTraining}
                disabled={isStopping}
                className="px-4 py-2 bg-red-500 hover:bg-red-600 disabled:bg-gray-400 text-white text-sm rounded-lg flex items-center gap-2 transition-colors"
              >
                {isStopping ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Stopping...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <rect x="6" y="6" width="12" height="12" rx="1" />
                    </svg>
                    Stop Training
                  </>
                )}
              </button>
            )}
            {sessionId && (
              <div className="flex items-center gap-2 px-4 py-2 bg-white/80 rounded-lg border border-gray-200 shadow-sm">
                <div className={`w-2 h-2 rounded-full ${
                  statusType === 'completed' ? 'bg-green-500' :
                  statusType === 'failed' ? 'bg-red-500' :
                  statusType === 'stopped' ? 'bg-orange-500' :
                  statusType === 'running' ? 'bg-blue-500 animate-pulse' :
                  'bg-gray-500 animate-pulse'
                }`}></div>
                <span className="text-sm font-medium text-gray-700">
                  {statusType || 'Initializing...'}
                </span>
              </div>
            )}
          </div>
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

                {/* Advanced Settings */}
                {renderAdvancedSettings(isTraining)}

                <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-amber-700 text-sm">
                    <strong>Note:</strong> Training will use annotations from your data artifact{' '}
                    {storedArtifactId && (
                      <span className="font-mono text-xs">({storedArtifactId.split('/').pop()})</span>
                    )}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => handleStartTraining(false)}
                  disabled={isTraining || !storedArtifactId}
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
                {/* Training Info Box */}
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg p-6 border border-blue-200">
                  <h3 className="text-lg font-semibold text-gray-800 mb-4">Training Configuration</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <p className="text-xs text-gray-600 mb-1">Model Type</p>
                      <p className="text-sm font-medium text-gray-800">
                        {trainingConfig?.model === 'continued' ? 'Continued Training' : 'Cellpose-SAM'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-600 mb-1">Epochs</p>
                      <p className="text-sm font-medium text-gray-800">{totalEpochs || trainingConfig?.epochs || epochs}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-600 mb-1">Learning Rate</p>
                      <p className="text-sm font-medium text-gray-800">{trainingConfig?.learningRate || learningRate}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-600 mb-1">Weight Decay</p>
                      <p className="text-sm font-medium text-gray-800">{trainingConfig?.weightDecay || weightDecay}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-xs text-gray-600 mb-1">Dataset Artifact ID</p>
                      <p className="text-sm font-medium text-gray-800 font-mono text-xs break-all">
                        {storedArtifactId || 'Loading...'}
                      </p>
                      {datasetInfo?.manifest?.name && (
                        <p className="text-xs text-gray-600 mt-1">{datasetInfo.manifest.name}</p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs text-gray-600 mb-1">Annotation Label</p>
                      <p className="text-sm font-medium text-gray-800">
                        {label || (datasetInfo?.manifest?.labels && datasetInfo.manifest.labels[0]) || 'default'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-600 mb-1">Images in Dataset</p>
                      <p className="text-sm font-medium text-gray-800">
                        {datasetInfo ? (
                          datasetInfo.manifest?.files
                            ? Object.keys(datasetInfo.manifest.files).filter((f: string) => f.startsWith('input_images/')).length
                            : 'N/A'
                        ) : 'Loading...'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Progress Info - Enhanced with batch-level progress */}
                {currentEpoch != null && totalEpochs != null && (statusType === 'running' || statusType === 'preparing') && (
                  <div>
                    <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
                      <span className="font-medium">Training Progress</span>
                      <span>Epoch {currentEpoch} / {totalEpochs}</span>
                    </div>
                    {/* Epoch progress bar */}
                    <div className="w-full bg-gray-200 rounded-full h-3">
                      <div
                        className="bg-gradient-to-r from-blue-500 to-indigo-500 h-3 rounded-full transition-all duration-300"
                        style={{
                          width: `${((currentEpoch || 0) / (totalEpochs || 1)) * 100}%`,
                        }}
                      ></div>
                    </div>
                    {/* Batch-level progress within current epoch */}
                    {currentBatch != null && totalBatches != null && totalBatches > 0 && (
                      <div className="mt-2">
                        <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                          <span>Batch Progress</span>
                          <span>{currentBatch} / {totalBatches}</span>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-1.5">
                          <div
                            className="bg-blue-300 h-1.5 rounded-full transition-all duration-300"
                            style={{ width: `${(currentBatch / totalBatches) * 100}%` }}
                          ></div>
                        </div>
                      </div>
                    )}
                    {/* Time info */}
                    <div className="flex items-center gap-4 mt-2">
                      {startTime && (
                        <p className="text-xs text-gray-500">
                          Started: {new Date(startTime).toLocaleTimeString()}
                        </p>
                      )}
                      {elapsedSeconds != null && (
                        <p className="text-xs text-gray-500">
                          Elapsed: {Math.floor(elapsedSeconds / 60)}m {Math.floor(elapsedSeconds % 60)}s
                        </p>
                      )}
                      {elapsedSeconds != null && currentEpoch != null && totalEpochs != null && currentEpoch > 0 && (
                        <p className="text-xs text-gray-500">
                          ETA: ~{Math.floor((elapsedSeconds / currentEpoch) * (totalEpochs - currentEpoch) / 60)}m {Math.floor((elapsedSeconds / currentEpoch) * (totalEpochs - currentEpoch) % 60)}s
                        </p>
                      )}
                    </div>
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

                {/* Latest Validation Metrics Summary */}
                {(() => {
                  const latest = getLatestValidationMetrics();
                  if (!latest) return null;
                  const m = latest.metrics;
                  return (
                    <div className="bg-purple-50/50 rounded-lg p-4 border border-purple-200/60">
                      <h4 className="text-sm font-semibold text-gray-700 mb-3">
                        Validation Metrics (Epoch {latest.epoch})
                      </h4>
                      <div className="grid grid-cols-5 gap-3">
                        {[
                          { label: 'F1 / Dice', value: m.f1, color: 'text-purple-600' },
                          { label: 'IoU', value: m.iou, color: 'text-blue-600' },
                          { label: 'Precision', value: m.precision, color: 'text-green-600' },
                          { label: 'Recall', value: m.recall, color: 'text-amber-600' },
                          { label: 'Pixel Acc', value: m.pixel_accuracy, color: 'text-red-600' },
                        ].map(({ label: metricLabel, value, color }) => (
                          <div key={metricLabel} className="text-center">
                            <p className="text-xs text-gray-500">{metricLabel}</p>
                            <p className={`text-lg font-bold ${color}`}>{(value * 100).toFixed(1)}%</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Chart Tabs & Charts */}
                {trainLosses.length > 0 && (
                  <div>
                    <div className="flex border-b border-gray-200 mb-0">
                      <button
                        onClick={() => setActiveChartTab('loss')}
                        className={`px-4 py-2 text-sm font-medium transition-colors ${
                          activeChartTab === 'loss'
                            ? 'border-b-2 border-blue-500 text-blue-600'
                            : 'text-gray-500 hover:text-gray-700'
                        }`}
                      >
                        Training Loss
                      </button>
                      {testMetrics.some(m => m !== null) && (
                        <button
                          onClick={() => setActiveChartTab('metrics')}
                          className={`px-4 py-2 text-sm font-medium transition-colors ${
                            activeChartTab === 'metrics'
                              ? 'border-b-2 border-purple-500 text-purple-600'
                              : 'text-gray-500 hover:text-gray-700'
                          }`}
                        >
                          Validation Metrics
                        </button>
                      )}
                    </div>
                    <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 border-t-0 rounded-t-none">
                      <div ref={plotRef} style={{ width: '100%', height: '400px', display: activeChartTab === 'loss' ? 'block' : 'none' }}></div>
                      <div ref={metricsPlotRef} style={{ width: '100%', height: '400px', display: activeChartTab === 'metrics' ? 'block' : 'none' }}></div>
                    </div>
                  </div>
                )}

                {/* Status Message */}
                {trainingProgress && (
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-blue-700 text-sm whitespace-pre-wrap">{trainingProgress}</p>
                  </div>
                )}

                {/* Instance Metrics (shown when training completes with test data) */}
                {instanceMetrics && (
                  <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg p-6 border border-green-200">
                    <h3 className="text-lg font-semibold text-gray-800 mb-4">
                      Instance Segmentation Results
                    </h3>
                    <p className="text-xs text-gray-500 mb-4">
                      Average Precision computed by running full Cellpose inference on the test set with Hungarian matching.
                    </p>
                    <div className="grid grid-cols-3 gap-4 mb-4">
                      <div className="bg-white/60 rounded-lg p-3 text-center">
                        <p className="text-xs text-gray-500">AP @ IoU 0.5</p>
                        <p className="text-2xl font-bold text-green-600">{(instanceMetrics.ap_0_5 * 100).toFixed(1)}%</p>
                      </div>
                      <div className="bg-white/60 rounded-lg p-3 text-center">
                        <p className="text-xs text-gray-500">AP @ IoU 0.75</p>
                        <p className="text-2xl font-bold text-green-600">{(instanceMetrics.ap_0_75 * 100).toFixed(1)}%</p>
                      </div>
                      <div className="bg-white/60 rounded-lg p-3 text-center">
                        <p className="text-xs text-gray-500">AP @ IoU 0.9</p>
                        <p className="text-2xl font-bold text-green-600">{(instanceMetrics.ap_0_9 * 100).toFixed(1)}%</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-white/60 rounded-lg p-3 text-center">
                        <p className="text-xs text-gray-500">Ground Truth Instances</p>
                        <p className="text-xl font-bold text-gray-800">{instanceMetrics.n_true}</p>
                      </div>
                      <div className="bg-white/60 rounded-lg p-3 text-center">
                        <p className="text-xs text-gray-500">Predicted Instances</p>
                        <p className="text-xl font-bold text-gray-800">{instanceMetrics.n_pred}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Export Section */}
                {(statusType === 'completed' || statusType === 'stopped') && (
                  <div className="pt-6 border-t border-gray-200 space-y-4">
                    {!exportedArtifactId ? (
                      <div className="space-y-4">
                        {/* Model Name Input */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Model Name (optional)
                          </label>
                          <input
                            type="text"
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
                            value={modelName}
                            onChange={(e) => setModelName(e.target.value)}
                            placeholder="e.g., My Cell Segmentation Model v1"
                          />
                        </div>
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
                              Export Model to BioImage.IO
                            </>
                          )}
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="flex items-center text-green-700 bg-green-50 px-4 py-3 rounded-lg border border-green-200">
                          <svg className="w-5 h-5 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          <span>
                            Model exported successfully!
                            {exportResult?.model_name && (
                              <span className="ml-1 font-semibold">{exportResult.model_name}</span>
                            )}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <a
                            href={exportResult?.download_url || `${server?.config?.publicBaseUrl || 'https://hypha.aicell.io'}/bioimage-io/artifacts/${exportedArtifactId.split('/').pop()}/create-zip-file`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl hover:from-blue-700 hover:to-indigo-700 flex items-center justify-center shadow-sm hover:shadow-md transition-all duration-200"
                          >
                            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            Download ZIP
                          </a>

                          {exportResult?.artifact_url && (
                            <a
                              href={exportResult.artifact_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-6 py-3 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 flex items-center justify-center transition-colors"
                            >
                              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                              </svg>
                              View Artifact
                            </a>
                          )}
                        </div>

                        {/* Exported Files List */}
                        {exportResult?.files && exportResult.files.length > 0 && (
                          <details className="bg-gray-50 rounded-lg border border-gray-200">
                            <summary className="px-4 py-3 text-xs text-gray-600 font-semibold cursor-pointer hover:bg-gray-100 select-none">
                              Exported Files ({exportResult.files.length})
                            </summary>
                            <ul className="px-4 pb-3 text-xs font-mono text-gray-700 space-y-1">
                              {exportResult.files.map((file, i) => (
                                <li key={i} className="flex items-center">
                                  <svg className="w-3 h-3 mr-1.5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                  </svg>
                                  {file}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}

                        <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                          <p className="text-xs text-gray-600 mb-1">Artifact ID:</p>
                          <p className="text-xs font-mono text-gray-800 break-all">
                            {exportedArtifactId}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Continue Training Button */}
                    <button
                      onClick={() => {
                        setIsContinueMode(true);
                        setSelectedModel('continue');
                        setShowTrainingDialog(true);
                      }}
                      disabled={isTraining || !storedArtifactId}
                      className="w-full px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl hover:from-purple-700 hover:to-pink-700 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed flex items-center justify-center shadow-sm hover:shadow-md transition-all duration-200"
                    >
                      {!storedArtifactId ? (
                        <>
                          <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                          Loading Dataset Info...
                        </>
                      ) : (
                        <>
                          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          Continue Training
                        </>
                      )}
                    </button>
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

                {/* Stopped Display */}
                {statusType === 'stopped' && !exportedArtifactId && (
                  <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg">
                    <p className="text-orange-700 text-sm">
                      Training was stopped. You can export the model with the current weights or continue training.
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
                <svg className="w-4 h-4 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {error}
              </p>
            </div>
          )}
        </div>

        {/* Training Configuration Dialog */}
        {showTrainingDialog && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-bold text-gray-800">
                    {isContinueMode ? 'Continue Training' : 'Configure Training'}
                  </h2>
                  <button
                    onClick={() => {
                      setShowTrainingDialog(false);
                      setIsContinueMode(false);
                    }}
                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-6">
                {/* Model Selection - only show if not in continue mode */}
                {!isContinueMode && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Training Mode
                    </label>
                    <div className="grid grid-cols-2 gap-4">
                      <button
                        onClick={() => setSelectedModel('cpsam')}
                        className={`p-4 rounded-lg border-2 transition-all ${
                          selectedModel === 'cpsam'
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-300 hover:border-gray-400'
                        }`}
                      >
                        <div className="text-left">
                          <p className="font-semibold text-gray-800">Start New Training</p>
                          <p className="text-xs text-gray-600 mt-1">Train from pretrained Cellpose-SAM model</p>
                        </div>
                      </button>
                      {sessionId && (
                        <button
                          onClick={() => setSelectedModel('continue')}
                          className={`p-4 rounded-lg border-2 transition-all ${
                            selectedModel === 'continue'
                              ? 'border-purple-500 bg-purple-50'
                              : 'border-gray-300 hover:border-gray-400'
                          }`}
                        >
                          <div className="text-left">
                            <p className="font-semibold text-gray-800">Continue Training</p>
                            <p className="text-xs text-gray-600 mt-1">Continue from this session's weights</p>
                          </div>
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Show continue mode indicator when in continue mode */}
                {isContinueMode && (
                  <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
                    <div className="flex items-center text-purple-700">
                      <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      <p className="font-semibold">Continue Training Mode</p>
                    </div>
                    <p className="text-sm text-purple-600 mt-1">Training will continue from the current model weights.</p>
                  </div>
                )}

                {/* Training Parameters */}
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
                    />
                  </div>
                </div>

                {/* Advanced Settings */}
                {renderAdvancedSettings(false)}

                {/* Info Box */}
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-amber-700 text-sm">
                    <strong>Note:</strong> {selectedModel === 'continue' ? 'Training will continue from the current model weights.' : 'Training will start from the pretrained Cellpose-SAM model.'}
                    {' '}Dataset: {storedArtifactId && (
                      <span className="font-mono text-xs">({storedArtifactId.split('/').pop()})</span>
                    )}
                  </p>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setShowTrainingDialog(false);
                      setIsContinueMode(false);
                    }}
                    className="flex-1 px-6 py-3 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleStartTraining(selectedModel === 'continue')}
                    disabled={isTraining}
                    className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl hover:from-blue-700 hover:to-indigo-700 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed flex items-center justify-center shadow-sm hover:shadow-md transition-all duration-200"
                  >
                    {isTraining ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                        Starting...
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
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Training;
