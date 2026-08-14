import React, { useState } from 'react';
import { useSharedKernel } from './KernelContext';
import { COLLECTION_ID } from './datasetApi';
import { registerDataset } from './brokerApi';

export interface CreateDatasetModalProps {
  server: any;
  user: any;
  artifactManager: any;
  onClose: () => void;
  onCreated: (artifactId: string) => void;
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

// F3 (colab-rework-plan.md): fast path skips the kernel entirely (a direct
// artifact-manager `create`, mirroring colab_service.py's
// `_ensure_artifact_exists`); the mount path boots the kernel only when a
// local folder is chosen, then follows the established
// register_service -> create_dataset -> per-image upload_image flow.
// `executeCode` never surfaces a Python return value to JS (see
// KernelContext.tsx), so every id used below is generated in JS first and
// any data genuinely produced by Python is fetched by calling the freshly
// registered Hypha service directly, not by parsing kernel output.
const CreateDatasetModal: React.FC<CreateDatasetModalProps> = ({
  server,
  user,
  artifactManager,
  onClose,
  onCreated,
}) => {
  const { isReady: isKernelReady, kernelStatus, executeCode, mountDirectory, requestKernel } = useSharedKernel();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [folderHandle, setFolderHandle] = useState<any>(null);
  const [fileCount, setFileCount] = useState(0);
  const [step, setStep] = useState<'configure' | 'creating'>('configure');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  const handleFolderClick = async () => {
    requestKernel();
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

  const createFastPath = async (): Promise<string> => {
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

  const createMountPath = async (): Promise<string> => {
    if (!executeCode || !mountDirectory || !folderHandle) {
      throw new Error('Python kernel is not ready.');
    }

    let token = localStorage.getItem('token') || '';
    if (!token && typeof server?.generateToken === 'function') {
      token = await server.generateToken();
    }
    if (!token) {
      throw new Error('Authentication token missing. Please log in again.');
    }
    const serverUrl = server.config.publicBaseUrl;
    const alias = await generateUniqueAlias(artifactManager);

    const runCode = async (code: string) => {
      let failed = false;
      let message = '';
      await executeCode(code, {
        onOutput: (output: any) => {
          if (output.type === 'error') {
            failed = true;
            message = output.content || output.short_content || 'Unknown Python error';
          }
        },
      });
      if (failed) throw new Error(message);
    };

    await runCode(`
import micropip
await micropip.install(['numpy', 'Pillow', 'hypha-rpc', 'tifffile==2024.7.24'])
print("Packages installed", end='')
`);

    const serviceCode = await (await fetch(`${process.env.PUBLIC_URL}/colab_service.py`)).text();
    await runCode(serviceCode);

    const mounted = await mountDirectory('/mnt', folderHandle);
    if (!mounted) {
      throw new Error('Failed to mount the local folder.');
    }

    const clientId = `colab-client-${Date.now()}`;
    const serviceId = `data-provider-${Date.now()}`;

    await runCode(`
service_info = await register_service(
    server_url=${JSON.stringify(serverUrl)},
    token=${JSON.stringify(token)},
    name=${JSON.stringify(name)},
    description=${JSON.stringify(description)},
    artifact_alias=${JSON.stringify(alias)},
    images_path="/mnt",
    client_id=${JSON.stringify(clientId)},
    service_id=${JSON.stringify(serviceId)},
    user_id=${JSON.stringify(user?.id || '')},
    user_email=${JSON.stringify(user?.email || '')}
)
print("Service registered successfully", end='')
`);

    const fullServiceId = `${server.config.workspace}/${clientId}:${serviceId}`;
    const dataService = await server.getService(fullServiceId);

    const created = await dataService.create_dataset();
    const artifactId: string = created.artifact_id;

    const localImages: Array<{ stem: string; format: string }> = await dataService.list_local_images();
    setProgress({ current: 0, total: localImages.length });
    for (let i = 0; i < localImages.length; i++) {
      const image = localImages[i];
      await dataService.upload_image(`${image.stem}.${image.format}`);
      setProgress({ current: i + 1, total: localImages.length });
    }

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
    setProgress(null);

    try {
      const artifactId = folderHandle ? await createMountPath() : await createFastPath();
      await registerDataset(server, artifactId);
      onCreated(artifactId);
    } catch (err) {
      setError((err as Error).message || 'Failed to create dataset.');
      setStep('configure');
    }
  };

  const kernelBlocked = !!folderHandle && !isKernelReady;
  const isDisabled = !name.trim() || kernelBlocked;

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
                <p className="text-xs text-gray-500 mt-1.5">You can also add images later from the dataset page.</p>
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
              )}

              <div>
                <button
                  onClick={handleCreate}
                  disabled={isDisabled}
                  className="w-full px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl hover:from-purple-700 hover:to-pink-700 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed font-medium shadow-sm hover:shadow-md active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                >
                  {kernelBlocked ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                        <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className="opacity-75" />
                      </svg>
                      Preparing kernel...
                    </>
                  ) : (
                    'Create dataset'
                  )}
                </button>
                {kernelBlocked && (
                  <p className="text-xs text-gray-500 mt-1.5 text-center">
                    {kernelStatus === 'error'
                      ? 'Python kernel failed to start. Please reload the page.'
                      : 'Preparing the in-browser Python kernel to read your local folder.'}
                  </p>
                )}
              </div>
            </>
          ) : (
            <div className="text-center py-8">
              <div className="w-16 h-16 border-4 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <h3 className="text-base font-semibold text-gray-800 mb-1">Creating dataset...</h3>
              {progress ? (
                <>
                  <p className="text-sm text-gray-600 mb-3">
                    Uploading images: {progress.current}/{progress.total}
                  </p>
                  <div className="max-w-xs mx-auto bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-gradient-to-r from-purple-500 to-pink-500 h-2 rounded-full transition-all duration-300"
                      style={{
                        width: `${progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0}%`,
                      }}
                    />
                  </div>
                </>
              ) : (
                <p className="text-sm text-gray-600">
                  {folderHandle ? 'Mounting local folder...' : 'Registering artifact...'}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CreateDatasetModal;
