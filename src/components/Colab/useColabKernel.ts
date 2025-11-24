/**
 * Hook for managing kernel state and operations for Colab using web-python-kernel
 */

import { useState, useRef, useEffect, useCallback } from 'react';

interface ExecuteOutput {
  type: 'stdout' | 'stderr' | 'result' | 'error' | 'image' | 'html';
  content: string;
  short_content?: string;
}

interface ExecuteCallbacks {
  onOutput?: (output: ExecuteOutput) => void;
  onStatus?: (status: string) => void;
}

interface KernelManager {
  isReady: boolean;
  kernelStatus: 'idle' | 'busy' | 'starting' | 'error';
  executeCode: ((code: string, callbacks?: ExecuteCallbacks) => Promise<void>) | null;
  restartKernel: () => Promise<void>;
  interruptKernel: () => Promise<boolean>;
  mountDirectory: ((mountPoint: string, dirHandle: FileSystemDirectoryHandle) => Promise<boolean>) | undefined;
  kernelManager: any;
}

export const useColabKernel = (): KernelManager => {
  const [isReady, setIsReady] = useState(false);
  const [kernelStatus, setKernelStatus] = useState<'idle' | 'busy' | 'starting' | 'error'>('starting');
  const [executeCode, setExecuteCode] = useState<((code: string, callbacks?: ExecuteCallbacks) => Promise<void>) | null>(null);

  const kernelManagerRef = useRef<any>(null);
  const currentKernelIdRef = useRef<string | null>(null);
  const currentKernelRef = useRef<any>(null);
  const isInitializingRef = useRef(false);

  // Function to dynamically load web-python-kernel module
  const loadWebPythonKernel = useCallback(async () => {
    if (kernelManagerRef.current) {
      return kernelManagerRef.current;
    }

    try {
      console.log('[Colab Kernel] Loading kernel module...');
      const baseUrl = process.env.PUBLIC_URL || '';
      const WebPythonKernel = await import(/* webpackIgnore: true */ `${baseUrl}/web-python-kernel.mjs`);

      (window as any).WebPythonKernel = WebPythonKernel;
      window.dispatchEvent(new Event('web-python-kernel-loaded'));

      console.log('[Colab Kernel] Module loaded successfully');

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
      console.error('[Colab Kernel] Failed to load kernel module:', error);
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
        console.error('[Colab Kernel] Execution error:', error);

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
    async function initializeKernel() {
      if (isInitializingRef.current) {
        console.log('[Colab Kernel] Initialization already in progress, skipping...');
        return;
      }

      isInitializingRef.current = true;

      const initTimeout = setTimeout(() => {
        console.error('[Colab Kernel] Initialization timeout after 180 seconds');
        setKernelStatus('error');
        setIsReady(false);
        isInitializingRef.current = false;
      }, 180000);

      try {
        setKernelStatus('starting');
        console.log('[Colab Kernel] Initializing web-python-kernel...');

        const { manager, KernelMode, KernelLanguage, KernelEvents } = await loadWebPythonKernel();

        console.log('[Colab Kernel] Creating kernel...');

        const kernelId = await manager.createKernel({
          mode: KernelMode.WORKER,
          lang: KernelLanguage.PYTHON,
          autoSyncFs: true,
        });

        console.log('[Colab Kernel] Created kernel:', kernelId);

        currentKernelIdRef.current = kernelId;
        // Get the actual kernel instance from the manager
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

        console.log('[Colab Kernel] Kernel initialization completed successfully');

        isInitializingRef.current = false;
      } catch (error) {
        clearTimeout(initTimeout);
        console.error('[Colab Kernel] Initialization error:', error);
        setKernelStatus('error');
        setIsReady(false);
        isInitializingRef.current = false;
      }
    }

    initializeKernel();
  }, [loadWebPythonKernel, createExecuteCodeFunction]);

  // Function to interrupt kernel execution
  const interruptKernel = useCallback(async () => {
    const manager = kernelManagerRef.current?.manager;
    const kernelId = currentKernelIdRef.current;

    if (!manager || !kernelId) {
      console.warn('[Colab Kernel] No active kernel to interrupt');
      return false;
    }

    try {
      console.log('[Colab Kernel] Interrupting kernel:', kernelId);
      const success = await manager.interruptKernel(kernelId);
      return success;
    } catch (error) {
      console.error('[Colab Kernel] Error interrupting kernel:', error);
      return false;
    }
  }, []);

  // Function to restart kernel
  const restartKernel = useCallback(async () => {
    const manager = kernelManagerRef.current?.manager;
    const { KernelMode, KernelLanguage, KernelEvents } = kernelManagerRef.current || {};
    const kernelId = currentKernelIdRef.current;

    if (!manager || !KernelMode || !KernelLanguage) {
      console.error('[Colab Kernel] Kernel manager not initialized');
      return;
    }

    try {
      setKernelStatus('starting');

      if (kernelId) {
        try {
          await manager.destroyKernel(kernelId);
        } catch (error) {
          console.warn('[Colab Kernel] Error destroying old kernel:', error);
        }
      }

      const newKernelId = await manager.createKernel({
        mode: KernelMode.WORKER,
        lang: KernelLanguage.PYTHON,
        autoSyncFs: true,
      });

      console.log('[Colab Kernel] Created new kernel:', newKernelId);

      currentKernelIdRef.current = newKernelId;
      // Get the actual kernel instance from the manager
      const newKernel = manager.kernels?.[newKernelId] || manager.getKernel?.(newKernelId);
      currentKernelRef.current = newKernel;

      manager.onKernelEvent(newKernelId, KernelEvents.KERNEL_BUSY, () => {
        setKernelStatus('busy');
      });

      manager.onKernelEvent(newKernelId, KernelEvents.KERNEL_IDLE, () => {
        setKernelStatus('idle');
      });

      const executeCodeFn = createExecuteCodeFunction(manager, newKernelId);
      setExecuteCode(() => executeCodeFn);
      setKernelStatus('idle');
      setIsReady(true);

      console.log('[Colab Kernel] Kernel restarted successfully');
    } catch (error) {
      console.error('[Colab Kernel] Failed to restart kernel:', error);
      setKernelStatus('error');
      setIsReady(false);
    }
  }, [createExecuteCodeFunction]);

  // Mount native filesystem directory using web-python-kernel's built-in mountFS
  const mountDirectory = useCallback(async (mountPoint: string, dirHandle: FileSystemDirectoryHandle) => {
    const kernel = currentKernelRef.current;
    if (!kernel || !dirHandle) {
      console.error('[Colab Kernel] No kernel or directory handle available');
      return false;
    }

    try {
      console.log(`[Colab Kernel] Mounting directory to ${mountPoint}...`);

      // Use web-python-kernel's built-in mountFS API
      const nativefs = await kernel.kernel.mountFS(mountPoint, dirHandle, 'readwrite');

      console.log(`[Colab Kernel] Successfully mounted directory to ${mountPoint}`);

      // Verify the mount by listing files
      if (executeCode) {
        await executeCode(`
import os
if os.path.exists("${mountPoint}"):
    files = os.listdir("${mountPoint}")
    print(f"Mounted directory contains {len(files)} items")
    if files:
        print(f"Sample files: {files[:5]}")
else:
    print("Warning: Mount point does not exist")
`);
      }

      return true;
    } catch (error) {
      console.error('[Colab Kernel] Error mounting directory:', error);
      return false;
    }
  }, [executeCode]);

  return {
    isReady,
    kernelStatus,
    executeCode,
    restartKernel,
    interruptKernel,
    mountDirectory,
    kernelManager: kernelManagerRef.current
  };
};
