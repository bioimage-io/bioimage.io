import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useHyphaStore } from '../store/hyphaStore';
import { Badge } from './Badge';
import ReactMarkdown from 'react-markdown';
import { Resource } from '../types/resource';

const ResourceDetails = () => {
  const { id } = useParams();
  const { selectedResource, fetchResource, isLoading, error } = useHyphaStore();
  const [documentation, setDocumentation] = useState<string | null>(null);

  useEffect(() => {
    if (id) {
      fetchResource(`bioimage-io/${id}`);
    }
  }, [id, fetchResource]);

  useEffect(() => {
    const fetchDocumentation = async () => {
      if (selectedResource?.manifest.documentation) {
        const id = selectedResource.id.split('/').pop();
        const docUrl = `https://hypha.aicell.io/bioimage-io/artifacts/${id}/files/${selectedResource.manifest.documentation}`;
        try {
          const response = await fetch(docUrl);
          const text = await response.text();
          setDocumentation(text);
        } catch (error) {
          console.error('Failed to fetch documentation:', error);
        }
      }
    };

    fetchDocumentation();
  }, [selectedResource?.id, selectedResource?.manifest.documentation]);

  if (isLoading) {
    return <div className="loading">Loading...</div>;
  }

  if (error) {
    return <div className="error">Error: {error}</div>;
  }

  if (!selectedResource) {
    return <div>Resource not found</div>;
  }

  const { manifest } = selectedResource as Resource;

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center gap-4 mb-6">
        {manifest.icon && (
          <img src={manifest.icon} alt="" className="w-16 h-16 object-contain" />
        )}
        <div>
          <h1 className="text-3xl font-bold mb-2">{manifest.name}</h1>
          <div className="flex flex-wrap gap-2">
            {manifest.tags?.map((tag: string, i: number) => (
              <Badge key={i} text={tag} />
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-gray-50 p-4 rounded">
          <h3 className="font-medium mb-2">Downloads</h3>
          <p>{(selectedResource as Resource).download_count || 0}</p>
        </div>
        <div className="bg-gray-50 p-4 rounded">
          <h3 className="font-medium mb-2">Views</h3>
          <p>{(selectedResource as Resource).view_count || 0}</p>
        </div>
        <div className="bg-gray-50 p-4 rounded">
          <h3 className="font-medium mb-2">Last Updated</h3>
          <p>{new Date((selectedResource as Resource).last_modified * 1000).toLocaleDateString()}</p>
        </div>
      </div>

      <div className="prose max-w-none">
        <ReactMarkdown>
          {manifest.description || ''}
        </ReactMarkdown>
      </div>

      {manifest.links && manifest.links.length > 0 && (
        <div className="resource-links">
          <h3>Related Links</h3>
          {manifest.links.map((link: {url: string, icon?: string, label: string}, index: number) => (
            <a 
              key={index} 
              href={link.url} 
              className="resource-link"
              target="_blank" 
              rel="noopener noreferrer"
            >
              <span className="link-icon">{link.icon}</span>
              <span className="link-label">{link.label}</span>
            </a>
          ))}
        </div>
      )}

      {documentation && (
        <div className="mt-8">
          <h2 className="text-xl font-semibold mb-4">Documentation</h2>
          <div className="prose max-w-none">
            <ReactMarkdown>{documentation}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
};

export default ResourceDetails; 