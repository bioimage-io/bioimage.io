import React, { useState, useEffect } from 'react';

interface TrainingModalProps {
  setShowTrainingModal: (show: boolean) => void;
  imageFolderHandle: FileSystemDirectoryHandle | null;
  annotationsFolderHandle: FileSystemDirectoryHandle | null;
  dataArtifactId: string | null;
  setIsRunning: (running: boolean) => void;
  executeCode: ((code: string, callbacks?: any) => Promise<void>) | null;
  artifactManager: any;
  server: any;
}

const TrainingModal: React.FC<TrainingModalProps> = ({
  setShowTrainingModal,
  imageFolderHandle,
  annotationsFolderHandle,
  dataArtifactId,
  setIsRunning,
  executeCode,
  artifactManager,
  server,
}) => {
  const [isTraining, setIsTraining] = useState(false);
  const [selectedModel, setSelectedModel] = useState('cpsam');
  const [epochs, setEpochs] = useState(10);
  const [learningRate, setLearningRate] = useState(0.000001);
  const [weightDecay, setWeightDecay] = useState(0.0001);
  const [error, setError] = useState<string | null>(null);
  const [trainingProgress, setTrainingProgress] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [statusType, setStatusType] = useState<string>('');
  const [trainLosses, setTrainLosses] = useState<number[]>([]);
  const [testLosses, setTestLosses] = useState<number[]>([]);
  const [currentEpoch, setCurrentEpoch] = useState<number | null>(null);
  const [totalEpochs, setTotalEpochs] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState<number | null>(null);
  const [nTrain, setNTrain] = useState<number | null>(null);
  const [nTest, setNTest] = useState<number | null>(null);

  const availableModels = [
    { value: 'cpsam', label: 'Cellpose-SAM', description: 'Transformer-based cell segmentation' },
  ];

  // Poll for training status
  useEffect(() => {
    if (!sessionId || !server) return;

    let intervalId: NodeJS.Timeout;

    const pollStatus = async () => {
      try {
        const cellposeService = await server.getService('bioimage-io/cellpose-finetuning');
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
          setIsRunning(false);
          setTimeout(() => {
            setShowTrainingModal(false);
          }, 3000);
        } else if (status.status_type === 'failed') {
          setIsTraining(false);
          setIsRunning(false);
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
  }, [sessionId, server, setShowTrainingModal, setIsRunning]);

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
      setIsRunning(true);

      console.log('Getting cellpose-finetuning service...');
      const cellposeService = await server.getService('bioimage-io/cellpose-finetuning');

      console.log('Starting training with artifact:', dataArtifactId);
      setTrainingProgress('Starting training...');

      // Convert all parameters to plain values to avoid ObjectProxy issues
      // Pattern matching: * must capture the same string in both patterns
      // images/image1.png → annotations/image1_mask_1.png
      // Both * capture "image1" (the stem without extension)
      const sessionStatus = await cellposeService.start_training({
        artifact: String(dataArtifactId),
        model: String(selectedModel),
        train_images: 'images/*.png',  // Matches: images/image1.png (where * = "image1")
        train_annotations: 'annotations/*_mask_1.png',  // Matches: annotations/image1_mask_1.png (where * = "image1")
        n_epochs: Number(epochs),
        learning_rate: Number(learningRate),
        weight_decay: Number(weightDecay),
        n_samples: null, // Use all available samples
        min_train_masks: 1, // Allow training with at least 1 mask per image
        _rkwargs: true,
      });

      const newSessionId = sessionStatus.session_id;
      setSessionId(newSessionId);

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
      setIsRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn">
      <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-lg max-w-2xl w-full mx-4 border border-white/20">
        <div className="p-6 border-b border-gray-200/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-xl flex items-center justify-center mr-3">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-800">Train AI Model</h3>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {!sessionId && (
            <>
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

              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-amber-700 text-sm">
                  <strong>Note:</strong> Training will use the annotations from your current data artifact ({dataArtifactId ? dataArtifactId.split('/').pop() : 'N/A'})
                </p>
              </div>
            </>
          )}

          {sessionId && (
            <div className="space-y-3">
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-gray-600 mb-1">Session ID:</p>
                <p className="text-xs font-mono text-blue-700 break-all">{sessionId}</p>
              </div>

              {statusType && (
                <div className={`p-3 rounded-lg border ${
                  statusType === 'completed' ? 'bg-green-50 border-green-200' :
                  statusType === 'failed' ? 'bg-red-50 border-red-200' :
                  statusType === 'running' ? 'bg-blue-50 border-blue-200' :
                  'bg-gray-50 border-gray-200'
                }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <div className={`w-2 h-2 rounded-full mr-2 ${
                        statusType === 'completed' ? 'bg-green-500' :
                        statusType === 'failed' ? 'bg-red-500' :
                        statusType === 'running' ? 'bg-blue-500 animate-pulse' :
                        'bg-gray-500 animate-pulse'
                      }`}></div>
                      <p className={`text-sm font-medium ${
                        statusType === 'completed' ? 'text-green-700' :
                        statusType === 'failed' ? 'text-red-700' :
                        statusType === 'running' ? 'text-blue-700' :
                        'text-gray-700'
                      }`}>
                        Status: {statusType}
                      </p>
                    </div>
                    {currentEpoch != null && totalEpochs != null && (
                      <span className="text-xs font-medium text-gray-600">
                        Epoch {currentEpoch}/{totalEpochs}
                      </span>
                    )}
                  </div>
                  {elapsedSeconds != null && (
                    <div className="mt-2 text-xs text-gray-600">
                      Elapsed: {Math.floor(elapsedSeconds / 60)}m {Math.floor(elapsedSeconds % 60)}s
                    </div>
                  )}
                </div>
              )}

              {/* Dataset Info */}
              {(nTrain != null || nTest != null) && (
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                  <p className="text-xs font-medium text-gray-600 mb-1">Dataset</p>
                  <div className="flex gap-4 text-xs text-gray-700">
                    {nTrain != null && <span>Training: {nTrain} samples</span>}
                    {nTest != null && <span>Test: {nTest} samples</span>}
                  </div>
                </div>
              )}

              {/* Loss Metrics */}
              {trainLosses.length > 0 && (
                <div className="p-3 bg-white border border-gray-200 rounded-lg">
                  <p className="text-xs font-medium text-gray-700 mb-2">Training Loss</p>
                  <div className="h-32 relative">
                    {(() => {
                      const validTrainLosses = trainLosses.filter(l => l > 0);
                      const validTestLosses = testLosses.filter(l => l > 0);
                      if (validTrainLosses.length === 0) return null;

                      const allLosses = [...validTrainLosses, ...validTestLosses];
                      const maxLoss = Math.max(...allLosses);
                      const minLoss = Math.min(...allLosses);
                      const range = maxLoss - minLoss || 1;

                      const width = 100;
                      const height = 100;
                      const padding = 5;

                      const trainPoints = validTrainLosses.map((loss, i) => {
                        const x = (i / (validTrainLosses.length - 1 || 1)) * (width - 2 * padding) + padding;
                        const y = height - padding - ((loss - minLoss) / range) * (height - 2 * padding);
                        return `${x},${y}`;
                      }).join(' ');

                      const testPoints = validTestLosses.length > 0 ? validTestLosses.map((loss, i) => {
                        const x = (i / (validTestLosses.length - 1 || 1)) * (width - 2 * padding) + padding;
                        const y = height - padding - ((loss - minLoss) / range) * (height - 2 * padding);
                        return `${x},${y}`;
                      }).join(' ') : '';

                      return (
                        <>
                          <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full">
                            <polyline
                              points={trainPoints}
                              fill="none"
                              stroke="#3b82f6"
                              strokeWidth="1.5"
                            />
                            {testPoints && (
                              <polyline
                                points={testPoints}
                                fill="none"
                                stroke="#10b981"
                                strokeWidth="1.5"
                                strokeDasharray="2,2"
                              />
                            )}
                          </svg>
                          <div className="flex gap-3 mt-2 text-xs">
                            <div className="flex items-center gap-1">
                              <div className="w-3 h-0.5 bg-blue-500"></div>
                              <span className="text-gray-600">
                                Train: {validTrainLosses[validTrainLosses.length - 1]?.toFixed(4)}
                              </span>
                            </div>
                            {validTestLosses.length > 0 && (
                              <div className="flex items-center gap-1">
                                <div className="w-3 h-0.5 bg-green-500" style={{borderTop: '1px dashed'}}></div>
                                <span className="text-gray-600">
                                  Test: {validTestLosses[validTestLosses.length - 1]?.toFixed(4)}
                                </span>
                              </div>
                            )}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              )}
            </div>
          )}

          {trainingProgress && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-blue-700 text-sm whitespace-pre-wrap">{trainingProgress}</p>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-600 text-sm flex items-center">
                <svg
                  className="w-4 h-4 mr-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                {error}
              </p>
            </div>
          )}
        </div>

        <div className="p-6 pt-0 border-t border-gray-200/50 flex justify-end space-x-3">
          <button
            type="button"
            onClick={() => setShowTrainingModal(false)}
            disabled={isTraining && statusType !== 'completed' && statusType !== 'failed'}
            className="px-6 py-3 text-gray-600 bg-white border-2 border-gray-200 rounded-xl hover:bg-gray-50 hover:border-gray-300 disabled:opacity-50 shadow-sm hover:shadow-md transition-all duration-200"
          >
            {statusType === 'completed' || statusType === 'failed' ? 'Close' : 'Cancel'}
          </button>
          {!sessionId && (
            <button
              type="button"
              onClick={handleStartTraining}
              disabled={isTraining || !dataArtifactId}
              className="px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl hover:from-blue-700 hover:to-indigo-700 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed flex items-center shadow-sm hover:shadow-md transition-all duration-200"
            >
              {isTraining ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                  Starting...
                </>
              ) : (
                'Start Training'
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default TrainingModal;
