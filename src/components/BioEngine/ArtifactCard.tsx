import React from 'react';

interface ArtifactCardProps {
  artifact: {
    id: string;
    name: string;
    alias: string;
    manifest?: {
      id_emoji?: string;
      name?: string;
      description?: string;
      documentation?: string | { url?: string; text?: string };
      tutorial?: string | { url?: string; text?: string };
      links?: { url: string; icon?: string; label: string }[];
      deployment_config?: {
        modes?: { cpu?: any; gpu?: any };
      };
      ray_actor_options?: { num_gpus?: number };
    };
    supportedModes?: { cpu: boolean; gpu: boolean };
    defaultMode?: string;
  };
  artifactMode?: string;
  onEdit: () => void;
  onDeploy: (artifactId: string, mode?: string | null) => void;
  onModeChange?: (checked: boolean) => void;
  server?: any;
  onDeployFeedback?: (message: string, type: 'success' | 'error' | 'info') => void;
}

const ArtifactCard: React.FC<ArtifactCardProps> = ({
  artifact,
  artifactMode,
  onEdit,
  onDeploy,
  onModeChange,
  server,
  onDeployFeedback
}) => {
  const [isDeploying, setIsDeploying] = React.useState(false);

  const handleDeploy = () => {
    setIsDeploying(true);
    const modeToUse = artifactMode || artifact.defaultMode || 'cpu';
    onDeploy(artifact.id, modeToUse);
    if (onDeployFeedback) {
      onDeployFeedback('Deployment started', 'info');
    }

    // Reset loading state after 5 seconds
    setTimeout(() => {
      setIsDeploying(false);
    }, 5000);
  };

  // Helper function to transform documentation URLs
  const transformDocumentationUrl = (docPath: string, artifactId: string) => {
    if (docPath.startsWith('http://') || docPath.startsWith('https://')) {
      return docPath;
    }

    const parts = artifactId.split('/');
    if (parts.length >= 2) {
      const workspace = parts[0];
      const alias = parts[1];
      const baseUrl = server?.config?.server_url || 'https://hypha.aicell.io';
      return `${baseUrl}/${workspace}/artifacts/${alias}/files/${docPath}`;
    }

    return docPath;
  };

  // Helper function to format bytes to GB
  const formatMemoryToGB = (bytes: number): string => {
    const gb = bytes / (1024 * 1024 * 1024);
    return gb < 1 ? `${Math.round(gb * 1024)} MB` : `${gb.toFixed(1)} GB`;
  };

  // Helper function to get computational resources for a mode
  const getComputationalResources = (manifest?: any, mode?: string) => {
    if (!manifest?.deployment_config?.modes) return null;

    const modeConfig = manifest.deployment_config.modes[mode || 'cpu'];
    if (!modeConfig?.ray_actor_options) return null;

    const options = modeConfig.ray_actor_options;
    return {
      cpus: options.num_cpus || 0,
      gpus: options.num_gpus || 0,
      memory: options.memory || 0
    };
  };

  // Helper function to extract documentation and tutorial links from manifest
  const getDocumentationLinks = (manifest?: any, artifactId?: string) => {
    const links: Array<{ url: string; label: string; icon?: string; type: 'documentation' | 'tutorial' | 'link' }> = [];

    if (manifest?.documentation) {
      let docUrl = '';
      if (typeof manifest.documentation === 'string') {
        docUrl = artifactId ? transformDocumentationUrl(manifest.documentation, artifactId) : manifest.documentation;
      } else if (manifest.documentation.url) {
        docUrl = artifactId ? transformDocumentationUrl(manifest.documentation.url, artifactId) : manifest.documentation.url;
      }

      if (docUrl) {
        links.push({
          url: docUrl,
          label: 'Documentation',
          icon: '📚',
          type: 'documentation'
        });
      }
    }

    if (manifest?.tutorial) {
      let tutorialUrl = '';
      if (typeof manifest.tutorial === 'string') {
        tutorialUrl = artifactId ? transformDocumentationUrl(manifest.tutorial, artifactId) : manifest.tutorial;
      } else if (manifest.tutorial.url) {
        tutorialUrl = artifactId ? transformDocumentationUrl(manifest.tutorial.url, artifactId) : manifest.tutorial.url;
      }

      if (tutorialUrl) {
        links.push({
          url: tutorialUrl,
          label: 'Tutorial',
          icon: '🎓',
          type: 'tutorial'
        });
      }
    }

    if (manifest?.links && Array.isArray(manifest.links)) {
      manifest.links.forEach((link: any) => {
        if (link.url && link.label) {
          const isTutorial = link.label.toLowerCase().includes('tutorial') ||
            link.label.toLowerCase().includes('guide') ||
            link.label.toLowerCase().includes('example');

          links.push({
            url: link.url,
            label: link.label,
            icon: link.icon || (isTutorial ? '🎓' : '🔗'),
            type: isTutorial ? 'tutorial' : 'link'
          });
        }
      });
    }

    return links;
  };

  const DocumentationLinks: React.FC<{ className?: string }> = ({ className = "" }) => {
    const links = getDocumentationLinks(artifact.manifest, artifact.id);

    if (links.length === 0) return null;

    return (
      <div className={className}>
        <div className="flex items-center mb-2">
          <svg className="w-4 h-4 text-gray-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          <span className="text-sm font-medium text-gray-700">Documentation</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {links.map((link, index) => (
            <a
              key={index}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg border transition-all duration-200 hover:shadow-sm hover:scale-105 ${link.type === 'documentation'
                  ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 hover:border-blue-300'
                  : link.type === 'tutorial'
                    ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100 hover:border-green-300'
                    : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100 hover:border-gray-300'
                }`}
              title={`Open ${link.label}`}
            >
              <span className="mr-1.5">{link.icon}</span>
              {link.label}
              <svg className="w-3 h-3 ml-1.5 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          ))}
        </div>
      </div>
    );
  };

  const ResourceInfo: React.FC<{ className?: string }> = ({ className = "" }) => {
    const currentMode = artifactMode || artifact.defaultMode || 'cpu';
    const resources = getComputationalResources(artifact.manifest, currentMode);

    if (!resources) return null;

    return (
      <div className={className}>
        <div className="flex items-center mb-2">
          <svg className="w-4 h-4 text-gray-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
          </svg>
          <span className="text-sm font-medium text-gray-700">Required Resources ({currentMode.toUpperCase()})</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {resources.cpus > 0 && (
            <div className="inline-flex items-center px-2.5 py-1 text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 rounded-md">
              <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              {resources.cpus} CPU{resources.cpus > 1 ? 's' : ''}
            </div>
          )}
          {resources.gpus > 0 && (
            <div className="inline-flex items-center px-2.5 py-1 text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200 rounded-md">
              <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              {resources.gpus} GPU{resources.gpus > 1 ? 's' : ''}
            </div>
          )}
          {resources.memory > 0 && (
            <div className="inline-flex items-center px-2.5 py-1 text-xs font-medium bg-green-50 text-green-700 border border-green-200 rounded-md">
              <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
              </svg>
              {formatMemoryToGB(resources.memory)}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <article className="p-6 bg-gradient-to-r from-white to-blue-50 border border-blue-100 rounded-2xl shadow-sm hover:shadow-md transition-all duration-200 hover:border-blue-200">
      <div className="flex justify-between items-start">
        <div className="flex-1 mr-4">
          <h4 className="text-lg font-semibold mb-1">
            {artifact.manifest?.id_emoji || ""} {artifact.manifest?.name || artifact.name || artifact.alias}
          </h4>
          <p className="text-sm text-gray-500 mb-2">{artifact.id}</p>
          <p className="text-gray-600 mb-3">{artifact.manifest?.description || "No description available"}</p>
          <DocumentationLinks className="mb-3" />
          <ResourceInfo className="mb-3" />
        </div>

        <div className="flex flex-col items-end">
          {artifact.supportedModes && (artifact.supportedModes.cpu && artifact.supportedModes.gpu) && onModeChange ? (
            <div className="mb-2">
              <div className="flex items-center bg-gray-100 rounded-lg p-1" role="group" aria-label="Select compute mode">
                <button
                  type="button"
                  onClick={() => onModeChange(false)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${(artifactMode === 'cpu' || !artifactMode)
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-800'
                    }`}
                >
                  CPU
                </button>
                <button
                  type="button"
                  onClick={() => onModeChange(true)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${artifactMode === 'gpu'
                      ? 'bg-white text-purple-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-800'
                    }`}
                >
                  GPU
                </button>
              </div>
            </div>
          ) : null}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onEdit}
              className="px-4 py-2 text-sm bg-white border-2 border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 hover:border-gray-300 flex items-center shadow-sm hover:shadow-md transition-all duration-200"
            >
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Edit
            </button>

            <button
              type="button"
              onClick={handleDeploy}
              disabled={isDeploying}
              className={`px-6 py-3 rounded-xl shadow-sm hover:shadow-md transition-all duration-200 flex items-center ${isDeploying
                  ? 'bg-gradient-to-r from-gray-400 to-gray-500 text-white cursor-not-allowed'
                  : 'bg-gradient-to-r from-blue-600 to-blue-700 text-white hover:from-blue-700 hover:to-blue-800'
                }`}
            >
              {isDeploying ? 'Starting Deployment...' : 'Deploy'}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
};

export default ArtifactCard;
