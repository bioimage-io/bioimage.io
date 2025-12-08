import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

interface TrainingModalProps {
  setShowTrainingModal: (show: boolean) => void;
  dataArtifactId: string | null;
  label: string;
  server: any;
}

interface ExistingModel {
  id: string;
  name: string;
  created_at: number;
  url: string;
  session_id?: string;
}

const TrainingModal: React.FC<TrainingModalProps> = ({
  setShowTrainingModal,
  dataArtifactId,
  label,
  server,
}) => {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'choose' | 'new' | 'existing'>('choose');
  const [isStarting, setIsStarting] = useState(false);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingModels, setExistingModels] = useState<ExistingModel[]>([]);

  // Training configuration for new training
  const [selectedModel, setSelectedModel] = useState('cpsam');
  const [epochs, setEpochs] = useState(10);
  const [learningRate, setLearningRate] = useState(0.000001);
  const [weightDecay, setWeightDecay] = useState(0.0001);

  const availableModels = [
    { value: 'cpsam', label: 'Cellpose-SAM', description: 'Transformer-based cell segmentation' },
  ];

  // Load existing models when switching to existing mode
  useEffect(() => {
    if (mode === 'existing' && dataArtifactId && server) {
      loadExistingModels();
    }
  }, [mode, dataArtifactId, server]);

  const loadExistingModels = async () => {
    if (!dataArtifactId || !server) return;

    setIsLoadingModels(true);
    setError(null);

    try {
      const cellposeService = await server.getService('bioimage-io/cellpose-finetuning', {mode: 'last'});
      const models = await cellposeService.list_models_by_dataset(
        dataArtifactId,
        {
          collection: 'bioimage-io/colab-annotations',
          _rkwargs: true
        }
      );

      setExistingModels(models);
      console.log(`✓ Loaded ${models.length} existing models for dataset`);
    } catch (err) {
      console.error('Error loading existing models:', err);
      setError(`Failed to load existing models: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsLoadingModels(false);
    }
  };

  const handleStartNewTraining = async () => {
    if (!server) {
      setError('Not connected to server. Please login first.');
      return;
    }

    if (!dataArtifactId) {
      setError('No data artifact available. Please create an annotation session first.');
      return;
    }

    setIsStarting(true);
    setError(null);

    try {
      console.log('Getting cellpose-finetuning service...');
      const cellposeService = await server.getService('bioimage-io/cellpose-finetuning', {mode: 'last'});

      console.log('Starting training with artifact:', dataArtifactId);

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

      const sessionId = sessionStatus.session_id;
      console.log('✓ Training started with session ID:', sessionId);

      // Close modal and navigate to training page
      setShowTrainingModal(false);
      navigate(`/finetune-cellpose/${sessionId}`, {
        state: { dataArtifactId, label }
      });

    } catch (error) {
      console.error('Error starting training:', error);
      setError(
        `Failed to start training: ${error instanceof Error ? error.message : String(error)}`
      );
      setIsStarting(false);
    }
  };

  const handleSelectExistingModel = (model: ExistingModel) => {
    // Extract session ID from model ID (format: workspace/collection/session_id)
    const sessionId = model.id.split('/').pop() || model.id;

    setShowTrainingModal(false);
    navigate(`/finetune-cellpose/${sessionId}`, {
      state: { dataArtifactId, label }
    });
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn">
      <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-lg max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto border border-white/20">
        {/* Header */}
        <div className="p-6 border-b border-gray-200/50 sticky top-0 bg-white/95 backdrop-blur-md z-10">
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
              <h3 className="text-lg font-semibold text-gray-800">
                {mode === 'choose' && 'Train AI Model'}
                {mode === 'new' && 'Start New Training'}
                {mode === 'existing' && 'Existing Models'}
              </h3>
            </div>
            <button
              onClick={() => setShowTrainingModal(false)}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          {mode === 'choose' && (
            <div className="space-y-4">
              <p className="text-gray-600 mb-6">
                Choose whether to start a new training or view existing models trained on this dataset.
              </p>

              {/* Start New Training */}
              <button
                onClick={() => setMode('new')}
                className="w-full p-6 border-2 border-blue-200 hover:border-blue-400 rounded-xl hover:bg-blue-50 transition-all group text-left"
              >
                <div className="flex items-start">
                  <div className="w-12 h-12 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-xl flex items-center justify-center mr-4 group-hover:scale-110 transition-transform">
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h4 className="text-lg font-semibold text-gray-800 mb-1">Start New Training</h4>
                    <p className="text-sm text-gray-600">
                      Configure and start a new Cellpose model training session on your annotations
                    </p>
                  </div>
                  <svg className="w-5 h-5 text-gray-400 group-hover:text-blue-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>

              {/* View Existing Models */}
              <button
                onClick={() => setMode('existing')}
                className="w-full p-6 border-2 border-purple-200 hover:border-purple-400 rounded-xl hover:bg-purple-50 transition-all group text-left"
              >
                <div className="flex items-start">
                  <div className="w-12 h-12 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl flex items-center justify-center mr-4 group-hover:scale-110 transition-transform">
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h4 className="text-lg font-semibold text-gray-800 mb-1">View Existing Models</h4>
                    <p className="text-sm text-gray-600">
                      Browse and monitor models that were previously trained on this dataset
                    </p>
                  </div>
                  <svg className="w-5 h-5 text-gray-400 group-hover:text-purple-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>
            </div>
          )}

          {mode === 'new' && (
            <div className="space-y-4">
              <button
                onClick={() => setMode('choose')}
                className="mb-4 text-sm text-gray-600 hover:text-gray-800 flex items-center"
              >
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </button>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Model Type
                </label>
                <select
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  disabled={isStarting}
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
                    Epochs
                  </label>
                  <input
                    type="number"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={epochs}
                    onChange={(e) => setEpochs(parseInt(e.target.value))}
                    min="1"
                    max="1000"
                    disabled={isStarting}
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
                    disabled={isStarting}
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
                    disabled={isStarting}
                  />
                </div>
              </div>

              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-amber-700 text-sm">
                  <strong>Note:</strong> Training will use annotations from{' '}
                  <span className="font-mono text-xs">{dataArtifactId?.split('/').pop()}</span>
                </p>
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-red-600 text-sm flex items-center">
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {error}
                  </p>
                </div>
              )}

              <button
                type="button"
                onClick={handleStartNewTraining}
                disabled={isStarting || !dataArtifactId}
                className="w-full px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl hover:from-blue-700 hover:to-indigo-700 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed flex items-center justify-center shadow-sm hover:shadow-md transition-all duration-200"
              >
                {isStarting ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                    Starting Training...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Start Training
                  </>
                )}
              </button>
            </div>
          )}

          {mode === 'existing' && (
            <div className="space-y-4">
              <button
                onClick={() => setMode('choose')}
                className="mb-4 text-sm text-gray-600 hover:text-gray-800 flex items-center"
              >
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </button>

              {isLoadingModels ? (
                <div className="py-12 text-center">
                  <div className="w-12 h-12 border-4 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                  <p className="text-gray-600">Loading existing models...</p>
                </div>
              ) : existingModels.length === 0 ? (
                <div className="py-12 text-center">
                  <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-800 mb-2">No Existing Models</h3>
                  <p className="text-gray-600 mb-4">
                    No models have been trained on this dataset yet.
                  </p>
                  <button
                    onClick={() => setMode('new')}
                    className="px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:from-blue-700 hover:to-indigo-700"
                  >
                    Start New Training
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-gray-600 mb-4">
                    Found {existingModels.length} model{existingModels.length !== 1 ? 's' : ''} trained on this dataset
                  </p>
                  {existingModels.map((model) => (
                    <button
                      key={model.id}
                      onClick={() => handleSelectExistingModel(model)}
                      className="w-full p-4 border-2 border-gray-200 hover:border-purple-400 rounded-xl hover:bg-purple-50 transition-all group text-left"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h4 className="font-semibold text-gray-800 mb-1">{model.name}</h4>
                          <p className="text-xs font-mono text-gray-500 mb-2">{model.id}</p>
                          <p className="text-xs text-gray-600">
                            Created: {formatDate(model.created_at)}
                          </p>
                        </div>
                        <svg className="w-5 h-5 text-gray-400 group-hover:text-purple-600 transition-colors flex-shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-red-600 text-sm flex items-center">
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {error}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TrainingModal;
