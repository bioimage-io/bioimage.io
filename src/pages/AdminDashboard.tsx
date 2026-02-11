import React, { useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import yaml from 'js-yaml';
import { useHyphaStore } from '../store/hyphaStore';
import { ArtifactInfo } from '../types/artifact';
import { FiSettings, FiSave, FiChevronDown, FiBox, FiFileText } from 'react-icons/fi';

const EditorSection = React.memo(({ 
  title, 
  value, 
  onChange, 
  isExpanded, 
  onToggle 
}: { 
  title: string; 
  value: string; 
  onChange: (value: string) => void; 
  isExpanded: boolean; 
  onToggle: () => void;
}) => {
  // Use useCallback for the editor's onChange to keep it stable
  const handleEditorChange = React.useCallback((value: string | undefined) => {
    onChange(value || '');
  }, [onChange]);

  return (
    <div className="mb-6">
      <div 
        className="flex justify-between items-center p-3 bg-gray-50 rounded-t-lg cursor-pointer hover:bg-gray-100"
        onClick={onToggle}
      >
        <h3 className="text-lg font-medium text-gray-900">{title}</h3>
        <span className="text-gray-500">{isExpanded ? '▼' : '▶'}</span>
      </div>
      {isExpanded && (
        <div className="border border-t-0 border-gray-200 rounded-b-lg">
          <Editor
            key={title}
            height="300px"
            language="yaml"
            value={value}
            onChange={handleEditorChange}
            options={{
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              lineNumbers: 'on'
            }}
          />
        </div>
      )}
    </div>
  );
});

const DashboardCard: React.FC<{
  title: string;
  value: string | number;
  icon: React.ReactNode;
  description: string;
}> = ({ title, value, icon, description }) => (
  <div className="bg-white rounded-lg shadow-md p-6">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm text-gray-500 mb-1">{title}</p>
        <h3 className="text-2xl font-bold text-gray-900">{value}</h3>
        <p className="text-xs text-gray-500 mt-2">{description}</p>
      </div>
      <div className="text-blue-500 text-2xl">
        {icon}
      </div>
    </div>
  </div>
);

const CollectionSettings: React.FC<{ artifactInfo: ArtifactInfo | null }> = ({ artifactInfo }) => {
  const { artifactManager } = useHyphaStore();
  const [manifestYaml, setManifestYaml] = useState('');
  const [configYaml, setConfigYaml] = useState('');
  const [isInitialized, setIsInitialized] = useState(false);
  const [status, setStatus] = useState<{
    message: string;
    severity: 'info' | 'success' | 'error';
  } | null>(null);
  const [expandedSection, setExpandedSection] = useState<'manifest' | 'config' | null>(null);
  
  // Add state to track original values
  const [originalManifest, setOriginalManifest] = useState('');
  const [originalConfig, setOriginalConfig] = useState('');

  // Only initialize the editors once when artifactInfo is first available
  useEffect(() => {
    if (artifactInfo && !isInitialized) {
      try {
        const manifestStr = yaml.dump(artifactInfo.manifest || {}, { indent: 2, noRefs: true });
        const configStr = yaml.dump(artifactInfo.config || {}, { indent: 2, noRefs: true });
        
        setManifestYaml(manifestStr);
        setConfigYaml(configStr);
        setOriginalManifest(manifestStr);
        setOriginalConfig(configStr);
        setIsInitialized(true);
      } catch (err) {
        console.error('Error converting to YAML:', err);
        setStatus({
          message: 'Failed to load collection data',
          severity: 'error'
        });
      }
    }
  }, [artifactInfo, isInitialized]);

  // Function to check if there are unsaved changes
  const hasChanges = React.useMemo(() => {
    return manifestYaml !== originalManifest || configYaml !== originalConfig;
  }, [manifestYaml, configYaml, originalManifest, originalConfig]);

  // Use useCallback for the onChange handlers to keep them stable
  const handleManifestChange = React.useCallback((value: string) => {
    setManifestYaml(value);
  }, []);

  const handleConfigChange = React.useCallback((value: string) => {
    setConfigYaml(value);
  }, []);

  const handleSectionToggle = React.useCallback((section: 'manifest' | 'config') => {
    setExpandedSection(current => current === section ? null : section);
  }, []);

  const handleSave = async () => {
    if (!artifactManager || !hasChanges) return;

    try {
      setStatus({
        message: 'Saving changes...',
        severity: 'info'
      });

      const manifest = yaml.load(manifestYaml);
      const config = yaml.load(configYaml);

      await artifactManager.edit({
        artifact_id: 'ri-scale/ai-model-hub',
        manifest,
        config,
        _rkwargs: true
      });

      // Update original values after successful save
      setOriginalManifest(manifestYaml);
      setOriginalConfig(configYaml);

      setStatus({
        message: 'Changes saved successfully',
        severity: 'success'
      });
    } catch (err) {
      console.error('Error saving changes:', err);
      setStatus({
        message: 'Error saving changes: ' + (err instanceof Error ? err.message : String(err)),
        severity: 'error'
      });
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-lg">
      <div className="border-b border-gray-200 p-6">
        <div className="flex justify-between items-center">
          <div className="flex items-center space-x-3">
            <FiSettings className="text-2xl text-gray-600" />
            <h2 className="text-2xl font-bold text-gray-900">Collection Settings</h2>
          </div>
          <button
            onClick={handleSave}
            disabled={!hasChanges}
            className={`flex items-center px-4 py-2 rounded-md transition-colors ${
              hasChanges 
                ? 'bg-blue-600 text-white hover:bg-blue-700' 
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
          >
            <FiSave className="mr-2" />
            Save Changes
          </button>
        </div>
      </div>

      {status && (
        <div className={`mx-6 mt-6 p-4 rounded-md ${
          status.severity === 'error' ? 'bg-red-50 text-red-700 border border-red-200' :
          status.severity === 'success' ? 'bg-green-50 text-green-700 border border-green-200' :
          'bg-blue-50 text-blue-700 border border-blue-200'
        }`}>
          {status.message}
        </div>
      )}

      <div className="p-6">
        <EditorSection
          title="Manifest"
          value={manifestYaml}
          onChange={handleManifestChange}
          isExpanded={expandedSection === 'manifest'}
          onToggle={() => handleSectionToggle('manifest')}
        />

        <EditorSection
          title="Config"
          value={configYaml}
          onChange={handleConfigChange}
          isExpanded={expandedSection === 'config'}
          onToggle={() => handleSectionToggle('config')}
        />
      </div>
    </div>
  );
};

const AdminDashboard: React.FC = () => {
  const { artifactManager } = useHyphaStore();
  const [collectionInfo, setCollectionInfo] = useState<ArtifactInfo | null>(null);
  const [stats, setStats] = useState({
    totalResources: 0,
    totalViews: 0,
    lastUpdated: ''
  });

  useEffect(() => {
    const fetchCollection = async () => {
      if (!artifactManager) return;
      
      try {
        // Fetch collection info
        const collection = await artifactManager.read({
          artifact_id: 'ri-scale/ai-model-hub',
          _rkwargs: true
        });
        setCollectionInfo(collection);
        
        // Fetch total resources count using list_children with pagination
        const resourcesResponse = await artifactManager.list({
          parent_id: 'ri-scale/ai-model-hub',
          pagination: true,
          limit: 1,
          _rkwargs: true
        });
        
        const lastUpdate = new Date().toLocaleDateString();
        
        setStats({
          totalResources: resourcesResponse.total,
          totalViews: collection.view_count || 0,
          lastUpdated: lastUpdate
        });
      } catch (err) {
        console.error('Error fetching collection:', err);
      }
    };

    fetchCollection();
  }, [artifactManager]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-[1400px] mx-auto px-4 py-8">
        <div className="flex items-center space-x-4 mb-8">
          <h1 className="text-3xl font-bold text-gray-900">RI-SCALE Model Hub Admin Dashboard</h1>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <DashboardCard
            title="Total Resources"
            value={stats.totalResources}
            icon={<FiBox />}
            description="Total number of resources in the collection"
          />
          <DashboardCard
            title="Total Views"
            value={stats.totalViews}
            icon={<FiFileText />}
            description="Cumulative views across all resources"
          />
          <DashboardCard
            title="Last Updated"
            value={stats.lastUpdated}
            icon={<FiChevronDown />}
            description="Last collection update timestamp"
          />
        </div>

        <CollectionSettings artifactInfo={collectionInfo} />
      </div>
    </div>
  );
};

export default AdminDashboard; 