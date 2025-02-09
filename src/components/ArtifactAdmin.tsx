import React, { useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import yaml from 'js-yaml';
import { useHyphaStore } from '../store/hyphaStore';
import { ArtifactInfo } from '../types/artifact';

interface ArtifactAdminProps {
  artifactId: string;
  artifactInfo: ArtifactInfo;
  onUpdate?: () => void;
}

const ArtifactAdmin: React.FC<ArtifactAdminProps> = ({ artifactId, artifactInfo, onUpdate }) => {
  const { artifactManager } = useHyphaStore();
  const [yamlContent, setYamlContent] = useState('');
  const [unsavedChanges, setUnsavedChanges] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [status, setStatus] = useState<{
    message: string;
    severity: 'info' | 'success' | 'error';
  } | null>(null);

  useEffect(() => {
    if (artifactInfo) {
      try {
        // Convert artifact info to YAML
        const content = yaml.dump(artifactInfo, {
          indent: 2,
          lineWidth: -1,
          noRefs: true,
        });
        setYamlContent(content);
      } catch (err) {
        console.error('Error converting artifact to YAML:', err);
        setError('Failed to convert artifact data to YAML');
      }
    }
  }, [artifactInfo]);

  const handleEditorChange = (value: string | undefined) => {
    if (!value) return;
    setYamlContent(value);
    setUnsavedChanges(true);
    setError(null);
  };

  const handleSave = async () => {
    if (!artifactManager) return;

    try {
      setStatus({
        message: 'Saving changes...',
        severity: 'info'
      });

      // Parse YAML content back to object
      const updatedArtifact = yaml.load(yamlContent) as ArtifactInfo;

      // Call artifactManager.edit with the updated data
      await artifactManager.edit({
        artifact_id: artifactId,
        version: "stage",
        manifest: updatedArtifact.manifest,
        config: updatedArtifact.config,
        type: updatedArtifact.type,
        _rkwargs: true
      });

      setUnsavedChanges(false);
      setStatus({
        message: 'Changes saved successfully',
        severity: 'success'
      });

      // Just notify parent to refresh the artifact data
      if (onUpdate) {
        onUpdate();
      }
    } catch (err) {
      console.error('Error saving changes:', err);
      setStatus({
        message: 'Error saving changes',
        severity: 'error'
      });
      setError(err instanceof Error ? err.message : 'Failed to save changes');
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div 
        className="flex justify-between items-center mb-4 cursor-pointer" 
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <div>
            <h3 className="text-lg font-medium text-gray-900">Advanced Artifact Editor</h3>
            <p className="text-sm text-gray-500">
              {isExpanded ? 'Click to collapse' : 'Click to expand'}
            </p>
          </div>
        </div>
        <button
          className="text-gray-400 hover:text-gray-600"
          aria-label={isExpanded ? 'Collapse' : 'Expand'}
        >
          {isExpanded ? '▼' : '▶'}
        </button>
      </div>

      {isExpanded && (
        <>
          <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-md">
            <div className="flex items-start">
              <svg className="w-5 h-5 text-amber-400 mt-0.5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <h4 className="font-medium text-amber-800">Warning: Advanced Configuration</h4>
                <p className="text-sm text-amber-700 mt-1">
                  This editor allows direct modification of the artifact's internal structure. 
                  Changes to permissions, configurations, or manifest data may affect the artifact's 
                  functionality. Please proceed with caution.
                </p>
              </div>
            </div>
          </div>

          <div className="flex justify-end mb-4">
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleSave();
              }}
              disabled={!unsavedChanges}
              className={`px-4 py-2 rounded-md font-medium transition-colors
                ${!unsavedChanges
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'}`}
            >
              Save Changes
            </button>
          </div>

          {status && (
            <div className={`mb-4 p-3 rounded-md ${
              status.severity === 'error' ? 'bg-red-50 text-red-700' :
              status.severity === 'success' ? 'bg-green-50 text-green-700' :
              'bg-blue-50 text-blue-700'
            }`}>
              {status.message}
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-md">
              {error}
            </div>
          )}

          <Editor
            height="50vh"
            language="yaml"
            value={yamlContent}
            onChange={handleEditorChange}
            options={{
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              lineNumbers: 'on',
              renderWhitespace: 'selection',
              folding: true
            }}
          />
        </>
      )}
    </div>
  );
};

export default ArtifactAdmin; 