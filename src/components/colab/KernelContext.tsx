import React, { createContext, useContext, useEffect, useState, useRef, useCallback, ReactNode } from 'react';

interface ExecuteOutput {
  type: 'stdout' | 'stderr' | 'result' | 'error' | 'image' | 'html';
  content: string;
  short_content?: string;
}

interface ExecuteCallbacks {
  onOutput?: (output: ExecuteOutput) => void;
  onStatus?: (status: string) => void;
}

interface KernelContextType {
  isReady: boolean;
  kernelStatus: 'idle' | 'busy' | 'starting' | 'error';
  executeCode: ((code: string, callbacks?: ExecuteCallbacks) => Promise<void>) | null;
  restartKernel: () => Promise<void>;
  interruptKernel: () => Promise<boolean>;
  mountDirectory: ((mountPoint: string, dirHandle: FileSystemDirectoryHandle) => Promise<boolean>) | undefined;
  syncFileSystem: ((mountPath: string) => Promise<{success: boolean; error?: string}>) | undefined;
  writeFilesToPyodide: ((files: File[], targetPath: string) => Promise<{success: boolean; error?: string}>) | undefined;
  kernelManager: any;
  /** Persisted across navigation — the locally mounted folder handle for the active session. */
  imageFolderHandle: FileSystemDirectoryHandle | null;
  setImageFolderHandle: (handle: FileSystemDirectoryHandle | null) => void;
}

const KernelContext = createContext<KernelContextType | undefined>(undefined);

interface KernelProviderProps {
  children: ReactNode;
  skipInitialization?: boolean;
}

export const KernelProvider: React.FC<KernelProviderProps> = ({ children, skipInitialization = false }) => {
  const [isReady, setIsReady] = useState(false);
  const [kernelStatus, setKernelStatus] = useState<'idle' | 'busy' | 'starting' | 'error'>('starting');
  const [executeCode, setExecuteCode] = useState<((code: string, callbacks?: ExecuteCallbacks) => Promise<void>) | null>(null);

  const kernelManagerRef = useRef<any>(null);
  const currentKernelIdRef = useRef<string | null>(null);
  const currentKernelRef = useRef<any>(null);
  const isInitializingRef = useRef(false);
  const nativefsRef = useRef<any>(null);
  const [imageFolderHandle, setImageFolderHandle] = useState<FileSystemDirectoryHandle | null>(null);

  // Function to dynamically load web-python-kernel module
  const loadWebPythonKernel = useCallback(async () => {
    if (kernelManagerRef.current) {
      return kernelManagerRef.current;
    }

    try {
      console.log('[Kernel Context] Loading kernel module...');
      const pageBase = new URL('.', window.location.href).href;
      const WebPythonKernel = await import(/* webpackIgnore: true */ `${pageBase}web-python-kernel.mjs`);

      (window as any).WebPythonKernel = WebPythonKernel;
      window.dispatchEvent(new Event('web-python-kernel-loaded'));

      console.log('[Kernel Context] Module loaded successfully');

      const { KernelManager, KernelMode, KernelLanguage, KernelEvents } = WebPythonKernel;

      const workerUrl = `${process.env.PUBLIC_URL || ''}/kernel.worker.js`;

      const manager = new KernelManager({
        allowedKernelTypes: [
          { mode: KernelMode.WORKER, language: KernelLanguage.PYTHON }
        ],
        interruptionMode: 'auto',
        workerUrl,
        pool: {
          enabled: false,
          poolSize: 0,
          autoRefill: false
        }
      });

      kernelManagerRef.current = { manager, KernelMode, KernelLanguage, KernelEvents };
      return kernelManagerRef.current;
    } catch (error) {
      console.error('[Kernel Context] Failed to load kernel module:', error);
      throw error;
    }
  }, []);

  // Create executeCode function that wraps the kernel execution
  const createExecuteCodeFunction = useCallback((manager: any, kernelId: string) => {
    return async (code: string, callbacks?: ExecuteCallbacks) => {
      let hasError = false;

      try {
        setKernelStatus('busy');

        const stream = manager.executeStream(kernelId, code);

        for await (const event of stream) {
          switch (event.type) {
            case 'stream':
              if (event.data.name === 'stdout' && callbacks?.onOutput) {
                callbacks.onOutput({
                  type: 'stdout',
                  content: event.data.text,
                  short_content: event.data.text
                });
              } else if (event.data.name === 'stderr' && callbacks?.onOutput) {
                callbacks.onOutput({
                  type: 'stderr',
                  content: event.data.text,
                  short_content: event.data.text
                });
              }
              break;

            case 'execute_result':
              if (event.data && event.data.data) {
                const textPlain = event.data.data['text/plain'];
                if (textPlain && textPlain !== 'None' && callbacks?.onOutput) {
                  callbacks.onOutput({
                    type: 'result',
                    content: textPlain,
                    short_content: textPlain
                  });
                }
              }
              break;

            case 'display_data':
              if (event.data && event.data.data && callbacks?.onOutput) {
                if (event.data.data['image/png']) {
                  callbacks.onOutput({
                    type: 'image',
                    content: `data:image/png;base64,${event.data.data['image/png']}`,
                    short_content: '[Image]'
                  });
                } else if (event.data.data['text/html']) {
                  callbacks.onOutput({
                    type: 'html',
                    content: event.data.data['text/html'],
                    short_content: '[HTML]'
                  });
                } else if (event.data.data['text/plain']) {
                  const plainText = event.data.data['text/plain'];
                  callbacks.onOutput({
                    type: 'result',
                    content: plainText,
                    short_content: plainText
                  });
                }
              }
              break;

            case 'execute_error':
            case 'error':
              hasError = true;
              if (callbacks?.onOutput) {
                const errorMsg = event.data
                  ? `${event.data.ename || 'Error'}: ${event.data.evalue || 'Unknown error'}`
                  : 'Execution failed';
                callbacks.onOutput({
                  type: 'error',
                  content: errorMsg,
                  short_content: errorMsg
                });
              }
              if (event.data?.traceback && callbacks?.onOutput) {
                event.data.traceback.forEach((line: string) => {
                  callbacks.onOutput?.({
                    type: 'stderr',
                    content: line,
                    short_content: line
                  });
                });
              }
              break;
          }
        }

        setKernelStatus('idle');

        if (callbacks?.onStatus) {
          callbacks.onStatus(hasError ? 'Error' : 'Completed');
        }

      } catch (error) {
        setKernelStatus('idle');
        console.error('[Kernel Context] Execution error:', error);

        if (callbacks?.onOutput) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          callbacks.onOutput({
            type: 'error',
            content: errorMsg,
            short_content: errorMsg
          });
        }

        if (callbacks?.onStatus) {
          callbacks.onStatus('Error');
        }
      }
    };
  }, []);

  // Kernel initialization
  useEffect(() => {
    if (skipInitialization) {
      console.log('[Kernel Context] Skipping initialization');
      setIsReady(true);
      return;
    }

    async function initializeKernel() {
      if (isInitializingRef.current) {
        console.log('[Kernel Context] Initialization already in progress, skipping...');
        return;
      }

      isInitializingRef.current = true;

      const initTimeout = setTimeout(() => {
        console.error('[Kernel Context] Initialization timeout after 180 seconds');
        setKernelStatus('error');
        setIsReady(false);
        isInitializingRef.current = false;
      }, 180000);

      try {
        setKernelStatus('starting');
        console.log('[Kernel Context] Initializing web-python-kernel...');

        const { manager, KernelMode, KernelLanguage, KernelEvents } = await loadWebPythonKernel();

        console.log('[Kernel Context] Creating kernel...');

        const kernelId = await manager.createKernel({
          mode: KernelMode.WORKER,
          lang: KernelLanguage.PYTHON,
          autoSyncFs: true,
        });

        console.log('[Kernel Context] Created kernel:', kernelId);

        currentKernelIdRef.current = kernelId;
        const kernel = manager.kernels?.[kernelId] || manager.getKernel?.(kernelId);
        currentKernelRef.current = kernel;

        manager.onKernelEvent(kernelId, KernelEvents.KERNEL_BUSY, () => {
          setKernelStatus('busy');
        });

        manager.onKernelEvent(kernelId, KernelEvents.KERNEL_IDLE, () => {
          setKernelStatus('idle');
        });

        clearTimeout(initTimeout);

        const executeCodeFn = createExecuteCodeFunction(manager, kernelId);
        setExecuteCode(() => executeCodeFn);
        setKernelStatus('idle');
        setIsReady(true);

        console.log('[Kernel Context] Kernel initialization completed successfully');

        isInitializingRef.current = false;
      } catch (error) {
        clearTimeout(initTimeout);
        console.error('[Kernel Context] Initialization error:', error);
        setKernelStatus('error');
        setIsReady(false);
        isInitializingRef.current = false;
      }
    }

    initializeKernel();

    return () => {
      if (skipInitialization) return;
      
      const manager = kernelManagerRef.current?.manager;
      const kernelId = currentKernelIdRef.current;
      if (manager && kernelId) {
        console.log('[Kernel Context] Destroying kernel on unmount...');
        manager.destroyKernel(kernelId).catch((e: any) => console.error('[Kernel Context] Error destroying kernel:', e));
        currentKernelIdRef.current = null;
      }
    };
  }, [skipInitialization, loadWebPythonKernel, createExecuteCodeFunction]);

  // Function to interrupt kernel execution
  const interruptKernel = useCallback(async () => {
    const manager = kernelManagerRef.current?.manager;
    const kernelId = currentKernelIdRef.current;

    if (!manager || !kernelId) {
      console.warn('[Kernel Context] No active kernel to interrupt');
      return false;
    }

    try {
      console.log('[Kernel Context] Interrupting kernel:', kernelId);
      const success = await manager.interruptKernel(kernelId);
      return success;
    } catch (error) {
      console.error('[Kernel Context] Error interrupting kernel:', error);
      return false;
    }
  }, []);

  // Function to restart kernel
  const restartKernel = useCallback(async () => {
    const manager = kernelManagerRef.current?.manager;
    const kernelId = currentKernelIdRef.current;

    if (!manager || !kernelId) {
      console.warn('[Kernel Context] No active kernel to restart');
      return;
    }

    try {
      console.log('[Kernel Context] Restarting kernel:', kernelId);
      await manager.restartKernel(kernelId);
      setKernelStatus('idle');
      console.log('[Kernel Context] Kernel restarted successfully');
    } catch (error) {
      console.error('[Kernel Context] Error restarting kernel:', error);
      setKernelStatus('error');
      throw error;
    }
  }, []);

  const mountDirectory = useCallback(async (mountPoint: string, dirHandle: FileSystemDirectoryHandle): Promise<boolean> => {
    const kernel = currentKernelRef.current;
    const manager = kernelManagerRef.current?.manager;
    const kernelId = currentKernelIdRef.current;

    if (!kernel || !dirHandle) {
      console.error('[Kernel Context] Cannot mount: no kernel or directory handle');
      return false;
    }

    try {
      console.log(`[Kernel Context] Mounting directory to ${mountPoint}...`);
      let nativefs;
      if (kernel.kernel && typeof kernel.kernel.mountFS === 'function') {
        nativefs = await kernel.kernel.mountFS(mountPoint, dirHandle, 'read');
      } else if (typeof kernel.mountFS === 'function') {
        nativefs = await kernel.mountFS(mountPoint, dirHandle, 'read');
      } else if (manager && typeof manager.mountFS === 'function') {
        nativefs = await manager.mountFS(kernelId, mountPoint, dirHandle, 'read');
      } else {
        throw new Error('mountFS not found on kernel or manager');
      }
      nativefsRef.current = nativefs;
      console.log(`[Kernel Context] Successfully mounted directory to ${mountPoint}`);
      return true;
    } catch (error) {
      console.error('[Kernel Context] Error mounting directory:', error);
      return false;
    }
  }, []);

  const syncFileSystem = useCallback(async (mountPath: string) => {
    console.log(`[Kernel Context] Sync requested for ${mountPath}`);
    return { success: true };
  }, []);

  const writeFilesToPyodide = useCallback(async (files: File[], targetPath: string) => {
    console.log(`[Kernel Context] Write files requested to ${targetPath}`);
    return { success: true };
  }, []);

  const value: KernelContextType = {
    isReady,
    kernelStatus,
    executeCode,
    restartKernel,
    interruptKernel,
    mountDirectory,
    syncFileSystem,
    writeFilesToPyodide,
    kernelManager: kernelManagerRef.current,
    imageFolderHandle,
    setImageFolderHandle,
  };

  return (
    <KernelContext.Provider value={value}>
      {children}
    </KernelContext.Provider>
  );
};

export const useSharedKernel = (): KernelContextType => {
  const context = useContext(KernelContext);
  if (context === undefined) {
    throw new Error('useSharedKernel must be used within a KernelProvider');
  }
  return context;
};

/**
 * Safe version of useSharedKernel that returns null instead of throwing when context is unavailable.
 * Use this when you need to conditionally use the shared kernel.
 */
export const useSharedKernelIfAvailable = (): KernelContextType | null => {
  const context = useContext(KernelContext);
  return context || null;
};
