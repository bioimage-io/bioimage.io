import React, { useState } from 'react';
import { COLLECTION_ID } from './datasetApi';
import { registerDataset } from './brokerApi';

export interface CreateDatasetModalProps {
  server: any;
  user: any;
  artifactManager: any;
  onClose: () => void;
  onCreated: (artifactId: string, folderHandle?: any) => void;
}

const SUPPORTED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.tif', '.tiff'];

/**
 * Probes `bioimage-io/{alias}` for up to 5 randomly-generated aliases, same
 * pattern as SessionModal.tsx's generateUniqueAlias — a failed `read` means
 * the alias is free.
 */
async function generateUniqueAlias(artifactManager: any): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const alias = `annotation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      await artifactManager.read({ artifact_id: `bioimage-io/${alias}`, stage: true, _rkwargs: true });
    } catch {
      return alias;
    }
  }
  throw new Error('Could not generate a unique dataset alias after 5 attempts.');
}

// colab-rework-plan.md §11 item 1: creating a dataset does exactly two
// things — create the artifact + broker `register_dataset` — regardless of
// whether a local folder was picked. No kernel, no image upload happens
// here. A picked folder is only used to default the dataset name and to
// hand the (in-memory, unserializable) directory handle forward via router
// state, so the overview page can mount it lazily (item 2) without asking
// the user to pick it again.
const CreateDatasetModal: React.FC<CreateDatasetModalProps> = ({
  server,
  user,
  artifactManager,
  onClose,
  onCreated,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [folderHandle, setFolderHandle] = useState<any>(null);
  const [fileCount, setFileCount] = useState(0);
  const [step, setStep] = useState<'configure' | 'creating'>('configure');
  const [error, setError] = useState<string | null>(null);

  const handleFolderClick = async () => {
    try {
      const dirHandle = await (window as any).showDirectoryPicker();
      setFolderHandle(dirHandle);
      if (!name.trim()) setName(dirHandle.name);

      let count = 0;
      for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file') {
          const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
          if (SUPPORTED_EXTENSIONS.includes(ext)) count += 1;
        }
      }
      setFileCount(count);
      setError(null);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError(`Failed to select folder: ${(err as Error).message}`);
      }
    }
  };

  const createDataset = async (): Promise<string> => {
    const alias = await generateUniqueAlias(artifactManager);
    const artifactId = `bioimage-io/${alias}`;

    const manifest: Record<string, unknown> = { name, description };
    if (user?.id) manifest.created_by = user.id;
    if (user?.id || user?.email) manifest.owner = { id: user?.id, email: user?.email };

    const createKwargs: Record<string, unknown> = {
      parent_id: COLLECTION_ID,
      alias,
      manifest,
      type: 'dataset',
      stage: true,
    };
    if (user?.id && user.id.trim().toLowerCase() !== 'anonymous') {
      createKwargs.config = { permissions: { [user.id]: '*' } };
    }
    await artifactManager.create({ ...createKwargs, _rkwargs: true });

    return artifactId;
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('Please name your dataset.');
      return;
    }
    if (!user?.email || !artifactManager) {
      setError('You must be logged in to create a dataset.');
      return;
    }

    setStep('creating');
    setError(null);

    try {
      const artifactId = await createDataset();
      await registerDataset(server, artifactId);
      onCreated(artifactId, folderHandle);
    } catch (err) {
      setError((err as Error).message || 'Failed to create dataset.');
      setStep('configure');
    }
  };

  const isDisabled = !name.trim();

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={step === 'configure' ? onClose : undefined}
    >
      <div className="bg-white rounded-2xl shadow-lg max-w-lg w-full mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Create dataset</h2>
          {step === 'configure' && (
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        <div className="p-6 space-y-4">
          {step === 'configure' ? (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Name</label>
                <input
                  type="text"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  placeholder="e.g., Cell segmentation project"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Description <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <textarea
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  placeholder="Brief description of your annotation project"
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Local images <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <button
                  onClick={handleFolderClick}
                  className="w-full px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg hover:border-purple-500 hover:bg-purple-50 transition-colors flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  {folderHandle ? `${folderHandle.name} (${fileCount} images)` : 'Choose a folder to mount'}
                </button>
                <p className="text-xs text-gray-500 mt-1.5">
                  Images are not uploaded now. You can upload them, one at a time or all at once, from the dataset page.
                </p>
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
              )}

              <div>
                <button
                  onClick={handleCreate}
                  disabled={isDisabled}
                  className="w-full px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl hover:from-purple-700 hover:to-pink-700 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed font-medium shadow-sm hover:shadow-md active:scale-[0.98] transition-all"
                >
                  Create dataset
                </button>
              </div>
            </>
          ) : (
            <div className="text-center py-8">
              <div className="w-16 h-16 border-4 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <h3 className="text-base font-semibold text-gray-800 mb-1">Creating dataset...</h3>
              <p className="text-sm text-gray-600">Registering artifact...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CreateDatasetModal;
