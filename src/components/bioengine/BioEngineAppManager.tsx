import React, { useState, useCallback, useRef } from 'react';
import Editor from '@monaco-editor/react';
import yaml from 'js-yaml';

// ─── Types ───────────────────────────────────────────────────────────────────

type ArtifactType = {
  id: string;
  name: string;
  type: string;
  workspace: string;
  parent_id: string;
  alias: string;
  description?: string;
  manifest?: any;
  supportedModes?: { cpu: boolean; gpu: boolean };
  defaultMode?: string;
};

interface RawFileEntry {
  name: string;
  type?: string;
  size?: number;
  last_modified?: number | string;
}

interface DirEntry {
  kind: 'file' | 'dir';
  displayName: string;  // just the entry name at this level
  fullPath: string;     // full path relative to artifact root
  size?: number;
  lastModified?: string;
}

interface LoadedFile {
  content: string;
  language: string;
  isEditable: boolean;
}

interface PermissionInfo {
  mode: 'admin' | 'token';
  workspace?: string;
  token?: string;
}

interface BioEngineAppManagerProps {
  serviceId: string;
  server: any;
  isLoggedIn: boolean;
  adminUsers?: string[];
  currentUserEmail?: string;
  availableWorkspaces?: string[];
  onArtifactUpdated?: () => void;
}

type DialogMode = 'closed' | 'view' | 'edit' | 'create' | 'copy';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getFileLanguage(fileName: string): string {
  const ext = fileName.toLowerCase().split('.').pop() || '';
  const map: Record<string, string> = {
    yaml: 'yaml', yml: 'yaml', py: 'python', js: 'javascript',
    ts: 'typescript', json: 'json', md: 'markdown', txt: 'plaintext',
    sh: 'shell', cfg: 'plaintext', conf: 'plaintext', ini: 'plaintext',
    dockerfile: 'dockerfile', ijm: 'plaintext',
  };
  return map[ext] || (fileName === 'Dockerfile' ? 'dockerfile' : 'plaintext');
}

function isEditableFile(fileName: string): boolean {
  const ext = fileName.toLowerCase().split('.').pop() || '';
  const editableExts = ['yaml','yml','py','js','ts','json','md','txt','sh','ijm','cfg','conf','ini','dockerfile','requirements','gitignore'];
  return editableExts.includes(ext) || fileName === 'Dockerfile' || fileName === 'requirements.txt';
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/** Given a flat file list, compute entries visible at `dir`. */
function getEntriesAtDir(rawFiles: RawFileEntry[], dir: string): DirEntry[] {
  const entries: DirEntry[] = [];
  const seenDirs = new Set<string>();

  for (const f of rawFiles) {
    const name = f.name;
    if (!name.startsWith(dir)) continue;
    const rel = name.slice(dir.length);
    if (!rel) continue;

    const slashIdx = rel.indexOf('/');
    // A name is a directory if it contains a slash, ends with a slash,
    // or the artifact manager returned type: 'directory' (no trailing slash).
    const isExplicitDir = f.type === 'directory' || rel.endsWith('/');

    if (slashIdx === -1 && !isExplicitDir) {
      // plain file at this level
      const lm = f.last_modified
        ? new Date(typeof f.last_modified === 'number' ? f.last_modified * 1000 : f.last_modified).toLocaleString()
        : undefined;
      entries.push({ kind: 'file', displayName: rel, fullPath: name, size: f.size, lastModified: lm });
    } else {
      // subdirectory (from an explicit dir entry or a nested file path)
      let dirName: string;
      if (slashIdx !== -1) {
        dirName = rel.slice(0, slashIdx + 1);
      } else {
        // explicit dir entry without trailing slash — normalise to have one
        dirName = rel.replace(/\/?$/, '/');
      }
      if (!seenDirs.has(dirName)) {
        seenDirs.add(dirName);
        entries.push({ kind: 'dir', displayName: dirName, fullPath: dir + dirName });
      }
    }
  }

  return entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    return a.displayName.localeCompare(b.displayName);
  });
}

function getParentDir(dir: string): string {
  if (!dir) return '';
  const trimmed = dir.endsWith('/') ? dir.slice(0, -1) : dir;
  const idx = trimmed.lastIndexOf('/');
  return idx === -1 ? '' : trimmed.slice(0, idx + 1);
}

const DEFAULT_MANIFEST = `id: my-new-app
name: My New App
description: A new BioEngine application
id_emoji: 🚀
type: ray-serve
deployments:
  - "main:MyNewApp"
`;

const DEFAULT_MAIN_PY = `import asyncio
import time
from datetime import datetime
from typing import Any, Dict

from ray import serve
from pydantic import Field
from hypha_rpc.utils.schema import schema_method


@serve.deployment(
    ray_actor_options={"num_cpus": 1, "num_gpus": 0, "memory": 2 * 1024**3},
    max_ongoing_requests=10,
)
class MyNewApp:
    """A simple BioEngine application example."""

    def __init__(self):
        self.start_time = time.time()
        print("MyNewApp initialized successfully!")

    async def async_init(self) -> None:
        await asyncio.sleep(0.01)

    @schema_method
    async def ping(
        self,
        message: str = Field("Hello", description="Message to echo back")
    ) -> Dict[str, Any]:
        """Ping the application to check connectivity."""
        return {
            "status": "ok",
            "message": f"Hello from MyNewApp! You said: {message}",
            "timestamp": datetime.now().isoformat(),
            "uptime": time.time() - self.start_time
        }
`;

// ─── Component ───────────────────────────────────────────────────────────────

const BioEngineAppManager = React.forwardRef<
  { openCreateDialog: () => void; openEditDialog: (artifact: ArtifactType) => void },
  BioEngineAppManagerProps
>(({
  serviceId,
  server,
  isLoggedIn,
  adminUsers = [],
  currentUserEmail,
  availableWorkspaces = [],
  onArtifactUpdated,
}, ref) => {

  // ─ Mode & artifact
  const [mode, setMode] = useState<DialogMode>('closed');
  const [artifact, setArtifact] = useState<ArtifactType | null>(null);

  // ─ File browser
  const [rawFiles, setRawFiles] = useState<RawFileEntry[]>([]);
  const [currentDir, setCurrentDir] = useState('');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [loadedFiles, setLoadedFiles] = useState<Record<string, LoadedFile>>({});
  const [fileLoading, setFileLoading] = useState(false);

  // ─ Edit-mode changes
  const [editedContents, setEditedContents] = useState<Record<string, string>>({});
  const [newFiles, setNewFiles] = useState<Record<string, string>>({});   // path → content
  const [deletedFiles, setDeletedFiles] = useState<Set<string>>(new Set());

  // ─ Permission
  const [permission, setPermission] = useState<PermissionInfo | null>(null);
  const [permChecking, setPermChecking] = useState(false);
  const [permError, setPermError] = useState<string | null>(null);

  // ─ Loading / error
  const [initialLoading, setInitialLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ─ Create / copy
  const [createFiles, setCreateFiles] = useState<Record<string, string>>({
    'manifest.yaml': DEFAULT_MANIFEST,
    'main.py': DEFAULT_MAIN_PY,
  });
  const [createSelectedFile, setCreateSelectedFile] = useState('manifest.yaml');
  const [createWorkspace, setCreateWorkspace] = useState('');
  const [createChecking, setCreateChecking] = useState(false);

  const [copyWorkspace, setCopyWorkspace] = useState('');
  const [copySaving, setCopySaving] = useState(false);

  // ─ New file / folder input
  const [newEntryName, setNewEntryName] = useState('');
  const [newEntryKind, setNewEntryKind] = useState<'file' | 'folder'>('file');

  // ─ Delete dialog
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);

  const artifactManagerRef = useRef<any>(null);

  const getArtifactManager = useCallback(async () => {
    if (artifactManagerRef.current) return artifactManagerRef.current;
    const am = await server.getService('public/artifact-manager');
    artifactManagerRef.current = am;
    return am;
  }, [server]);

  const getWorkerWorkspace = useCallback((): string => {
    return serviceId ? serviceId.split('/')[0] : '';
  }, [serviceId]);

  // ─── Token generation ──────────────────────────────────────────────────────

  const generateWorkspaceToken = useCallback(async (workspace: string): Promise<string> => {
    try {
      if (typeof server.generate_token === 'function') {
        const tok = await server.generate_token({ workspace, expires_in: 3600 });
        return typeof tok === 'string' ? tok : (tok?.token ?? tok);
      }
    } catch (_) { /* fall through */ }
    if (server.config?.token) return server.config.token;
    throw new Error(`Cannot obtain a token for workspace "${workspace}". Make sure you are a member of that workspace.`);
  }, [server]);

  // ─── Permission check (called when entering edit mode) ───────────────────

  const checkEditPermission = useCallback(async (art: ArtifactType): Promise<PermissionInfo> => {
    const workerWs = getWorkerWorkspace();
    const artifactWs = art.id.split('/')[0];
    const bioengineWorker = await server.getService(serviceId, { mode: 'random' });

    if (artifactWs === workerWs) {
      const isAdmin = await bioengineWorker.check_access();
      if (isAdmin) {
        return { mode: 'admin' };
      }
      // Not admin — try to generate token for worker's workspace
      const token = await generateWorkspaceToken(workerWs);
      return { mode: 'token', workspace: workerWs, token };
    } else {
      // Different workspace — generate token for it
      const token = await generateWorkspaceToken(artifactWs);
      return { mode: 'token', workspace: artifactWs, token };
    }
  }, [serviceId, server, getWorkerWorkspace, generateWorkspaceToken]);

  // ─── Upload via worker ────────────────────────────────────────────────────

  const uploadApp = useCallback(async (
    filesToUpload: Array<{ name: string; content: string; type: string }>,
    perm: PermissionInfo
  ): Promise<string> => {
    const bioengineWorker = await server.getService(serviceId, { mode: 'random' });
    if (perm.mode === 'admin') {
      return await bioengineWorker.upload_app({ files: filesToUpload, _rkwargs: true });
    } else {
      return await bioengineWorker.upload_app({
        files: filesToUpload,
        workspace: perm.workspace,
        hypha_token: perm.token,
        _rkwargs: true,
      });
    }
  }, [serviceId, server]);

  // ─── Load artifact file list ──────────────────────────────────────────────

  const loadArtifactFiles = useCallback(async (art: ArtifactType) => {
    setInitialLoading(true);
    setRawFiles([]);
    setLoadedFiles({});
    setCurrentDir('');
    setSelectedFile(null);
    try {
      const am = await getArtifactManager();
      const fileList: RawFileEntry[] = await am.list_files({ artifact_id: art.id, _rkwargs: true });
      setRawFiles(fileList || []);

      // Auto-select manifest.yaml so the user sees something immediately
      const hasManifest = (fileList || []).some((f: RawFileEntry) => f.name === 'manifest.yaml');
      if (hasManifest) {
        // Load content inline so the editor is populated without a second click
        try {
          const url = await am.get_file({ artifact_id: art.id, file_path: 'manifest.yaml', _rkwargs: true });
          const res = await fetch(url);
          const content = res.ok ? await res.text() : '# Failed to load manifest.yaml';
          setLoadedFiles({ 'manifest.yaml': { content, language: 'yaml', isEditable: true } });
        } catch {
          setLoadedFiles({ 'manifest.yaml': { content: '# Failed to load manifest.yaml', language: 'yaml', isEditable: false } });
        }
        setSelectedFile('manifest.yaml');
      }
    } catch (err) {
      setError(`Failed to list files: ${err}`);
    } finally {
      setInitialLoading(false);
    }
  }, [getArtifactManager]);

  // ─── Load a single file's content ────────────────────────────────────────

  const loadFileContent = useCallback(async (art: ArtifactType, filePath: string) => {
    if (loadedFiles[filePath]) {
      setSelectedFile(filePath);
      return;
    }
    if (!isEditableFile(filePath)) {
      setLoadedFiles(prev => ({
        ...prev,
        [filePath]: { content: `// Binary file — not editable`, language: 'plaintext', isEditable: false },
      }));
      setSelectedFile(filePath);
      return;
    }
    setFileLoading(true);
    try {
      const am = await getArtifactManager();
      const url = await am.get_file({ artifact_id: art.id, file_path: filePath, _rkwargs: true });
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const content = await res.text();
      setLoadedFiles(prev => ({
        ...prev,
        [filePath]: { content, language: getFileLanguage(filePath), isEditable: true },
      }));
      setSelectedFile(filePath);
    } catch (err) {
      setLoadedFiles(prev => ({
        ...prev,
        [filePath]: { content: `// Failed to load: ${err}`, language: 'plaintext', isEditable: false },
      }));
      setSelectedFile(filePath);
    } finally {
      setFileLoading(false);
    }
  }, [loadedFiles, getArtifactManager]);

  // ─── Open view dialog ─────────────────────────────────────────────────────

  const handleOpenViewDialog = useCallback(async (art: ArtifactType) => {
    setArtifact(art);
    setMode('view');
    setError(null);
    setPermError(null);
    setPermission(null);
    setEditedContents({});
    setNewFiles({});
    setDeletedFiles(new Set());
    await loadArtifactFiles(art);
  }, [loadArtifactFiles]);

  // ─── Enter edit mode ──────────────────────────────────────────────────────

  const handleEnterEditMode = useCallback(async () => {
    if (!artifact) return;
    setPermChecking(true);
    setPermError(null);
    try {
      const perm = await checkEditPermission(artifact);
      setPermission(perm);
      setMode('edit');
    } catch (err) {
      setPermError(`Cannot enter edit mode: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPermChecking(false);
    }
  }, [artifact, checkEditPermission]);

  // ─── Discard changes ──────────────────────────────────────────────────────

  const handleDiscardChanges = useCallback(() => {
    setMode('view');
    setEditedContents({});
    setNewFiles({});
    setDeletedFiles(new Set());
    setPermission(null);
    setPermError(null);
    setError(null);
  }, []);

  // ─── Update app ───────────────────────────────────────────────────────────

  const handleUpdateApp = useCallback(async () => {
    if (!artifact || !permission) return;
    setSaving(true);
    setError(null);
    try {
      // Merge: loaded (possibly edited) + new files, minus deleted
      const filesToUpload: Array<{ name: string; content: string; type: string }> = [];

      // All files from rawFiles (excluding directories and deleted)
      for (const rf of rawFiles) {
        if (rf.name.endsWith('/')) continue;        // skip dir entries
        if (deletedFiles.has(rf.name)) continue;   // skip deleted

        const editedContent = editedContents[rf.name];
        const loadedContent = loadedFiles[rf.name]?.content;

        if (editedContent !== undefined) {
          filesToUpload.push({ name: rf.name, content: editedContent, type: 'text' });
        } else if (loadedContent !== undefined && loadedFiles[rf.name]?.isEditable) {
          filesToUpload.push({ name: rf.name, content: loadedContent, type: 'text' });
        }
        // Binary files that weren't loaded are skipped — worker keeps existing
      }

      // Add new files
      for (const [path, content] of Object.entries(newFiles)) {
        filesToUpload.push({ name: path, content, type: 'text' });
      }

      if (!filesToUpload.some(f => f.name === 'manifest.yaml')) {
        throw new Error('manifest.yaml is required');
      }

      await uploadApp(filesToUpload, permission);
      onArtifactUpdated?.();
      handleCloseDialog();
    } catch (err) {
      setError(`Failed to update app: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }, [artifact, permission, rawFiles, deletedFiles, editedContents, loadedFiles, newFiles, uploadApp, onArtifactUpdated]);

  // ─── Create Copy ─────────────────────────────────────────────────────────

  const handleOpenCopyDialog = useCallback(() => {
    setCopyWorkspace(server.config?.workspace || '');
    setCopySaving(false);
    setMode('copy');
  }, [server]);

  const handleCreateCopy = useCallback(async () => {
    if (!artifact) return;
    const targetWs = copyWorkspace.trim();
    if (!targetWs) { setError('Please specify a target workspace.'); return; }

    setCopySaving(true);
    setError(null);
    try {
      const token = await generateWorkspaceToken(targetWs);
      const perm: PermissionInfo = { mode: 'token', workspace: targetWs, token };

      // Collect all loaded editable files
      const filesToUpload: Array<{ name: string; content: string; type: string }> = [];
      for (const rf of rawFiles) {
        if (rf.name.endsWith('/')) continue;
        const loaded = loadedFiles[rf.name];
        if (loaded?.isEditable && loaded.content) {
          // Strip workspace from manifest id
          let content = loaded.content;
          if (rf.name === 'manifest.yaml') {
            try {
              const obj: any = yaml.load(content);
              if (obj?.id && typeof obj.id === 'string' && obj.id.includes('/')) {
                obj.id = obj.id.split('/').pop();
              }
              content = yaml.dump(obj, { indent: 2, lineWidth: 120, noRefs: true });
            } catch { /* use original */ }
          }
          filesToUpload.push({ name: rf.name, content, type: 'text' });
        }
      }
      if (!filesToUpload.some(f => f.name === 'manifest.yaml')) {
        throw new Error('manifest.yaml was not loaded — please open the file first to load its content.');
      }

      await uploadApp(filesToUpload, perm);
      onArtifactUpdated?.();
      handleCloseDialog();
    } catch (err) {
      setError(`Failed to create copy: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCopySaving(false);
    }
  }, [artifact, copyWorkspace, rawFiles, loadedFiles, generateWorkspaceToken, uploadApp, onArtifactUpdated]);

  // ─── Create new app ───────────────────────────────────────────────────────

  const handleOpenCreateDialog = useCallback(() => {
    setArtifact(null);
    setCreateFiles({ 'manifest.yaml': DEFAULT_MANIFEST, 'main.py': DEFAULT_MAIN_PY });
    setCreateSelectedFile('manifest.yaml');
    setCreateWorkspace(server.config?.workspace || '');
    setError(null);
    setCreateChecking(false);
    setMode('create');
  }, [server]);

  const handleCreateApp = useCallback(async () => {
    const targetWs = createWorkspace.trim();
    if (!targetWs) { setError('Please specify a workspace.'); return; }

    const manifestContent = createFiles['manifest.yaml'];
    if (!manifestContent) { setError('manifest.yaml is required.'); return; }

    let manifestObj: any;
    try { manifestObj = yaml.load(manifestContent); } catch (e) {
      setError(`Invalid YAML in manifest.yaml: ${e}`); return;
    }
    const appId = manifestObj?.id;
    if (!appId) { setError('manifest.yaml must have an "id" field.'); return; }

    setCreateChecking(true);
    setError(null);
    try {
      // Check existence
      const am = await getArtifactManager();
      const fullArtifactId = `${targetWs}/${appId}`;
      try {
        await am.read({ artifact_id: fullArtifactId, _rkwargs: true });
        setError(`Artifact "${fullArtifactId}" already exists. Choose a different id in manifest.yaml or workspace.`);
        return;
      } catch {
        // Good — doesn't exist yet
      }

      // Determine permission
      const workerWs = getWorkerWorkspace();
      let perm: PermissionInfo;
      if (targetWs === workerWs) {
        const bioengineWorker = await server.getService(serviceId, { mode: 'random' });
        const isAdmin = await bioengineWorker.check_access();
        if (isAdmin) {
          perm = { mode: 'admin' };
        } else {
          const token = await generateWorkspaceToken(targetWs);
          perm = { mode: 'token', workspace: targetWs, token };
        }
      } else {
        const token = await generateWorkspaceToken(targetWs);
        perm = { mode: 'token', workspace: targetWs, token };
      }

      const filesToUpload = Object.entries(createFiles).map(([name, content]) => ({
        name, content, type: 'text' as const,
      }));

      await uploadApp(filesToUpload, perm);
      onArtifactUpdated?.();
      handleCloseDialog();
    } catch (err) {
      if (!error) {
        setError(`Failed to create app: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      setCreateChecking(false);
    }
  }, [createWorkspace, createFiles, getArtifactManager, getWorkerWorkspace, serviceId, server, generateWorkspaceToken, uploadApp, onArtifactUpdated, error]);

  // ─── Delete app ───────────────────────────────────────────────────────────

  const handleDeleteApp = useCallback(async () => {
    if (!artifact) return;
    setDeleteLoading(true);
    try {
      const am = await getArtifactManager();
      await am.delete({ artifact_id: artifact.id, delete_files: true, _rkwargs: true });
      setDeleteOpen(false);
      onArtifactUpdated?.();
      handleCloseDialog();
    } catch (err) {
      setError(`Failed to delete: ${err instanceof Error ? err.message : String(err)}`);
      setDeleteOpen(false);
    } finally {
      setDeleteLoading(false);
    }
  }, [artifact, getArtifactManager, onArtifactUpdated]);

  // ─── New file / folder ────────────────────────────────────────────────────

  const handleAddEntry = useCallback(() => {
    const raw = newEntryName.trim();
    if (!raw) return;
    const fullPath = newEntryKind === 'folder'
      ? currentDir + raw + '/'
      : currentDir + raw;

    if (newEntryKind === 'folder') {
      // Add a placeholder file so the folder appears in rawFiles
      const placeholder = fullPath + '.gitkeep';
      setRawFiles(prev => [...prev, { name: placeholder, type: 'file', size: 0 }]);
      setNewFiles(prev => ({ ...prev, [placeholder]: '' }));
    } else {
      setRawFiles(prev => [...prev, { name: fullPath, type: 'file', size: 0 }]);
      setNewFiles(prev => ({ ...prev, [fullPath]: '' }));
      setLoadedFiles(prev => ({
        ...prev,
        [fullPath]: { content: '', language: getFileLanguage(fullPath), isEditable: true },
      }));
      setSelectedFile(fullPath);
    }
    setNewEntryName('');
  }, [newEntryName, newEntryKind, currentDir]);

  // ─── Close dialog ─────────────────────────────────────────────────────────

  const handleCloseDialog = useCallback(() => {
    setMode('closed');
    setArtifact(null);
    setRawFiles([]);
    setLoadedFiles({});
    setCurrentDir('');
    setSelectedFile(null);
    setEditedContents({});
    setNewFiles({});
    setDeletedFiles(new Set());
    setPermission(null);
    setPermError(null);
    setError(null);
    setNewEntryName('');
  }, []);

  // ─── Expose imperative handle ─────────────────────────────────────────────

  React.useImperativeHandle(ref, () => ({
    openCreateDialog: handleOpenCreateDialog,
    openEditDialog: handleOpenViewDialog,
  }), [handleOpenCreateDialog, handleOpenViewDialog]);

  // ─── Derived data ─────────────────────────────────────────────────────────

  const dirEntries = getEntriesAtDir(rawFiles, currentDir);
  const isUserOwned = artifact ? artifact.id.startsWith(server.config?.workspace || '\0') : false;
  const isBioimageIo = artifact?.id.startsWith('bioimage-io/') ?? false;
  const userWs = server.config?.workspace || '';
  const userIsAdmin = adminUsers.includes(currentUserEmail || '') || adminUsers.includes('*');

  const selectedFileData: LoadedFile | undefined = selectedFile
    ? (loadedFiles[selectedFile] ?? (newFiles[selectedFile] !== undefined
        ? { content: newFiles[selectedFile], language: getFileLanguage(selectedFile), isEditable: true }
        : undefined))
    : undefined;

  const currentContent = selectedFile
    ? (editedContents[selectedFile] ?? selectedFileData?.content ?? '')
    : '';

  // ─── Sub-render: file browser ────────────────────────────────────────────

  const renderFileBrowser = (editable: boolean) => (
    <div className="w-56 flex-shrink-0 border-r border-gray-200 flex flex-col bg-gray-50">
      {/* Breadcrumb / back */}
      <div className="px-3 py-2 border-b border-gray-200 flex items-center gap-1 min-h-[38px]">
        {currentDir ? (
          <button
            onClick={() => { setCurrentDir(getParentDir(currentDir)); setSelectedFile(null); }}
            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
        ) : (
          <span className="text-xs text-gray-400 font-medium">Files</span>
        )}
        {currentDir && (
          <span className="text-xs text-gray-500 truncate ml-1">{currentDir}</span>
        )}
      </div>

      {/* Entries */}
      <div className="flex-1 overflow-y-auto py-1">
        {dirEntries.length === 0 && !initialLoading && (
          <p className="text-xs text-gray-400 px-3 py-2">Empty directory</p>
        )}
        {dirEntries.map(entry => (
          <button
            key={entry.fullPath}
            onClick={() => {
              if (entry.kind === 'dir') {
                setCurrentDir(entry.fullPath);
                setSelectedFile(null);
              } else {
                if (artifact) loadFileContent(artifact, entry.fullPath);
              }
            }}
            className={`w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-100 transition-colors ${
              selectedFile === entry.fullPath ? 'bg-blue-50 text-blue-700' : 'text-gray-700'
            } ${deletedFiles.has(entry.fullPath) ? 'line-through text-gray-400' : ''}`}
          >
            {entry.kind === 'dir' ? (
              <svg className="w-4 h-4 text-yellow-500 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                <path d="M10 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2h-8l-2-2z"/>
              </svg>
            ) : (
              <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            )}
            <span className="truncate flex-1">{entry.displayName}</span>
            {newFiles[entry.fullPath] !== undefined && entry.kind === 'file' && (
              <span className="text-[10px] bg-green-100 text-green-700 rounded px-1">new</span>
            )}
            {editable && entry.kind === 'file' && entry.fullPath !== 'manifest.yaml' && (
              <button
                onClick={e => {
                  e.stopPropagation();
                  setDeletedFiles(prev => {
                    const next = new Set(prev);
                    if (next.has(entry.fullPath)) next.delete(entry.fullPath);
                    else next.add(entry.fullPath);
                    return next;
                  });
                }}
                className="opacity-0 group-hover:opacity-100 hover:opacity-100 p-0.5 rounded hover:text-red-500 text-gray-400 flex-shrink-0"
                title={deletedFiles.has(entry.fullPath) ? 'Restore file' : 'Mark for deletion'}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </button>
        ))}
      </div>

      {/* New file/folder input (edit mode only) */}
      {editable && (
        <div className="border-t border-gray-200 p-2 space-y-1">
          <div className="flex gap-1">
            <button
              onClick={() => setNewEntryKind('file')}
              className={`flex-1 text-xs py-1 rounded border transition-colors ${newEntryKind === 'file' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-100'}`}
            >File</button>
            <button
              onClick={() => setNewEntryKind('folder')}
              className={`flex-1 text-xs py-1 rounded border transition-colors ${newEntryKind === 'folder' ? 'bg-yellow-50 border-yellow-300 text-yellow-700' : 'border-gray-200 text-gray-600 hover:bg-gray-100'}`}
            >Folder</button>
          </div>
          <div className="flex gap-1">
            <input
              value={newEntryName}
              onChange={e => setNewEntryName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAddEntry(); }}
              placeholder={newEntryKind === 'folder' ? 'folder-name' : 'file.py'}
              className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
            />
            <button
              onClick={handleAddEntry}
              disabled={!newEntryName.trim()}
              className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-40"
              title="Add"
            >+</button>
          </div>
        </div>
      )}
    </div>
  );

  // ─── View/Edit dialog ─────────────────────────────────────────────────────

  const renderViewEditDialog = () => {
    const isEdit = mode === 'edit';
    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
        <div className="bg-white rounded-2xl shadow-lg w-full max-w-6xl mx-4 h-5/6 flex flex-col border border-gray-200">

          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-r from-violet-500 to-purple-600 rounded-xl flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-semibold text-gray-900 truncate">
                {artifact?.manifest?.name || artifact?.alias}
              </h3>
              <p className="text-xs text-gray-500 truncate">{artifact?.id}</p>
            </div>
            {isEdit && (
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300">
                Edit Mode
              </span>
            )}
            {!isEdit && !permChecking && (
              <button
                onClick={handleEnterEditMode}
                disabled={permChecking}
                className="px-3 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Edit
              </button>
            )}
            {permChecking && (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
                Checking permissions...
              </div>
            )}
            <button onClick={isEdit ? handleDiscardChanges : handleCloseDialog}
              className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
              title={isEdit ? 'Discard changes and return to view mode' : 'Close'}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Permission error banner */}
          {permError && (
            <div className="px-6 py-3 bg-red-50 border-b border-red-200 text-sm text-red-700 flex items-center gap-2">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {permError}
            </div>
          )}

          {/* Error banner */}
          {error && (
            <div className="px-6 py-3 bg-red-50 border-b border-red-200 text-sm text-red-700 flex items-center gap-2">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {error}
              <button onClick={() => setError(null)} className="ml-auto text-red-500 hover:text-red-700">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          {/* Body */}
          <div className="flex-1 flex min-h-0">
            {initialLoading ? (
              <div className="flex-1 flex items-center justify-center text-gray-500 text-sm gap-2">
                <div className="w-5 h-5 border-2 border-gray-200 border-t-blue-600 rounded-full animate-spin" />
                Loading files...
              </div>
            ) : (
              <>
                {renderFileBrowser(isEdit)}
                {/* Editor / preview */}
                <div className="flex-1 min-w-0 flex flex-col">
                  {!selectedFile && (
                    <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
                      Select a file to {isEdit ? 'edit' : 'preview'}
                    </div>
                  )}
                  {selectedFile && (
                    <>
                      {!selectedFileData?.isEditable && (
                        <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-800">
                          Binary / non-text file — read only
                        </div>
                      )}
                      {fileLoading ? (
                        <div className="flex-1 flex items-center justify-center text-gray-400 text-sm gap-2">
                          <div className="w-4 h-4 border-2 border-gray-200 border-t-blue-600 rounded-full animate-spin" />
                          Loading {selectedFile}…
                        </div>
                      ) : (
                        <div className="flex-1">
                          <Editor
                            height="100%"
                            language={selectedFileData?.language || getFileLanguage(selectedFile)}
                            value={currentContent}
                            onChange={value => {
                              if (isEdit && selectedFileData?.isEditable) {
                                const v = value ?? '';
                                setEditedContents(prev => ({ ...prev, [selectedFile]: v }));
                                if (newFiles[selectedFile] !== undefined) {
                                  setNewFiles(prev => ({ ...prev, [selectedFile]: v }));
                                }
                              }
                            }}
                            options={{
                              readOnly: !isEdit || !selectedFileData?.isEditable,
                              minimap: { enabled: false },
                              scrollBeyondLastLine: false,
                              fontSize: 13,
                              lineNumbers: 'on',
                              wordWrap: 'on',
                              automaticLayout: true,
                              tabSize: 2,
                            }}
                            theme="light"
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center gap-3">
            {isEdit ? (
              <>
                <button
                  onClick={handleDiscardChanges}
                  className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-100"
                >
                  Discard Changes
                </button>
                {isUserOwned && (
                  <button
                    onClick={() => setDeleteOpen(true)}
                    className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Delete App
                  </button>
                )}
                <div className="ml-auto flex gap-3">
                  {isBioimageIo && userWs !== 'bioimage-io' && (
                    <button
                      onClick={handleOpenCopyDialog}
                      className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Create Copy
                    </button>
                  )}
                  <button
                    onClick={handleUpdateApp}
                    disabled={saving}
                    className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                  >
                    {saving ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Saving…</> : 'Update App'}
                  </button>
                </div>
              </>
            ) : (
              <button onClick={handleCloseDialog} className="ml-auto px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
                Close
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ─── Create App dialog ────────────────────────────────────────────────────

  const renderCreateDialog = () => {
    const wsOptions = [...new Set([
      userWs,
      ...availableWorkspaces.filter(w => w !== 'bioimage-io'),
      getWorkerWorkspace(),
    ])].filter(Boolean);

    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
        <div className="bg-white rounded-2xl shadow-lg w-full max-w-6xl mx-4 h-5/6 flex flex-col border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-r from-blue-500 to-blue-600 rounded-xl flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-gray-900 flex-1">Create New App</h3>

            {/* Workspace selector */}
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-gray-600">Workspace:</label>
              <input
                list="create-ws-list"
                value={createWorkspace}
                onChange={e => setCreateWorkspace(e.target.value)}
                placeholder="workspace name"
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg w-52 focus:ring-2 focus:ring-blue-500"
              />
              <datalist id="create-ws-list">
                {wsOptions.map(w => <option key={w} value={w} />)}
              </datalist>
            </div>

            <button onClick={handleCloseDialog} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {error && (
            <div className="px-6 py-3 bg-red-50 border-b border-red-200 text-sm text-red-700 flex items-center gap-2">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {error}
              <button onClick={() => setError(null)} className="ml-auto"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
            </div>
          )}

          <div className="flex-1 flex min-h-0">
            {/* File tabs sidebar */}
            <div className="w-48 flex-shrink-0 border-r border-gray-200 flex flex-col bg-gray-50">
              <div className="px-3 py-2 border-b border-gray-200 text-xs font-medium text-gray-500">Files</div>
              <div className="flex-1 overflow-y-auto py-1">
                {Object.keys(createFiles).map(fname => (
                  <button
                    key={fname}
                    onClick={() => setCreateSelectedFile(fname)}
                    className={`w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-100 ${createSelectedFile === fname ? 'bg-blue-50 text-blue-700' : 'text-gray-700'}`}
                  >
                    <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span className="truncate flex-1">{fname}</span>
                    {fname !== 'manifest.yaml' && (
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          setCreateFiles(prev => {
                            const next = { ...prev };
                            delete next[fname];
                            return next;
                          });
                          if (createSelectedFile === fname) setCreateSelectedFile('manifest.yaml');
                        }}
                        className="hover:text-red-500 text-gray-400"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    )}
                  </button>
                ))}
              </div>
              <div className="border-t border-gray-200 p-2">
                <div className="flex gap-1">
                  <input
                    value={newEntryName}
                    onChange={e => setNewEntryName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && newEntryName.trim()) {
                        const name = newEntryName.trim();
                        if (!createFiles[name]) {
                          setCreateFiles(prev => ({ ...prev, [name]: '' }));
                          setCreateSelectedFile(name);
                        }
                        setNewEntryName('');
                      }
                    }}
                    placeholder="new-file.py"
                    className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded"
                  />
                  <button
                    onClick={() => {
                      const name = newEntryName.trim();
                      if (name && !createFiles[name]) {
                        setCreateFiles(prev => ({ ...prev, [name]: '' }));
                        setCreateSelectedFile(name);
                        setNewEntryName('');
                      }
                    }}
                    disabled={!newEntryName.trim()}
                    className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-40"
                  >+</button>
                </div>
              </div>
            </div>

            {/* Editor */}
            <div className="flex-1">
              <Editor
                height="100%"
                language={getFileLanguage(createSelectedFile)}
                value={createFiles[createSelectedFile] ?? ''}
                onChange={v => setCreateFiles(prev => ({ ...prev, [createSelectedFile]: v ?? '' }))}
                options={{ minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 13, lineNumbers: 'on', wordWrap: 'on', automaticLayout: true, tabSize: 2 }}
                theme="light"
              />
            </div>
          </div>

          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end gap-3">
            <button onClick={handleCloseDialog} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
            <button
              onClick={handleCreateApp}
              disabled={createChecking || !createWorkspace.trim()}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              {createChecking ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Creating…</> : 'Create App'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ─── Create Copy dialog ───────────────────────────────────────────────────

  const renderCopyDialog = () => {
    const wsOptions = [...new Set([
      userWs,
      ...availableWorkspaces.filter(w => w !== 'bioimage-io'),
    ])].filter(Boolean);

    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
        <div className="bg-white rounded-xl shadow-lg w-full max-w-md mx-4 p-6">
          <h3 className="text-base font-semibold text-gray-900 mb-4">Create Copy in Another Workspace</h3>
          <p className="text-sm text-gray-600 mb-4">
            Copies all loaded files from <span className="font-mono text-xs bg-gray-100 px-1 rounded">{artifact?.id}</span> to the selected workspace.
          </p>

          <label className="block text-sm font-medium text-gray-700 mb-1">Target Workspace</label>
          <input
            list="copy-ws-list"
            value={copyWorkspace}
            onChange={e => setCopyWorkspace(e.target.value)}
            placeholder="workspace name"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 mb-1"
          />
          <datalist id="copy-ws-list">
            {wsOptions.map(w => <option key={w} value={w} />)}
          </datalist>
          <p className="text-xs text-gray-500 mb-4">You must have write access to this workspace.</p>

          {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

          <div className="flex justify-end gap-3">
            <button onClick={() => { setMode('edit'); setError(null); }} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
            <button
              onClick={handleCreateCopy}
              disabled={copySaving || !copyWorkspace.trim()}
              className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
            >
              {copySaving ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Creating…</> : 'Create Copy'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ─── Delete confirm dialog ────────────────────────────────────────────────

  const renderDeleteDialog = () => (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-md mx-4 p-6">
        <div className="flex items-center gap-3 mb-4">
          <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h3 className="text-base font-semibold text-gray-900">Delete App</h3>
        </div>
        <p className="text-sm text-gray-600 mb-3">This will permanently delete the app and all its files.</p>
        <p className="text-xs text-gray-500 mb-2">
          Type the artifact ID to confirm: <code className="bg-gray-100 px-1 rounded">{artifact?.id}</code>
        </p>
        <input
          value={deleteText}
          onChange={e => setDeleteText(e.target.value)}
          placeholder="Enter artifact ID"
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 mb-4"
        />
        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
        <div className="flex justify-end gap-3">
          <button onClick={() => { setDeleteOpen(false); setDeleteText(''); }} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
          <button
            onClick={handleDeleteApp}
            disabled={deleteLoading || deleteText !== artifact?.id}
            className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
          >
            {deleteLoading ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Deleting…</> : 'Delete App'}
          </button>
        </div>
      </div>
    </div>
  );

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      {(mode === 'view' || mode === 'edit') && renderViewEditDialog()}
      {mode === 'create' && renderCreateDialog()}
      {mode === 'copy' && renderCopyDialog()}
      {deleteOpen && renderDeleteDialog()}
    </>
  );
});

export default BioEngineAppManager;
