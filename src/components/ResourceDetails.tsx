import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Badge } from './Badge';
import ReactMarkdown from 'react-markdown';
import { Resource } from '../types/resource';

export const ResourceDetails = () => {
  const [searchParams] = useSearchParams();
  const [resource, setResource] = useState<Resource | null>(null);
  const [documentation, setDocumentation] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchResource = async () => {
      const id = searchParams.get('id');
      if (!id) return;

      try {
        setLoading(true);
        const [workspace, name] = id.split('/');
        const url = `https://hypha.aicell.io/${workspace}/artifacts/${name}`;
        
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to fetch resource: ${response.statusText}`);
        }
        const data = await response.json();
        setResource(data);
        // Fetch documentation if available
        if (data.manifest.documentation) {
          const docUrl = `https://hypha.aicell.io/${workspace}/artifacts/${name}/files/${data.manifest.documentation}`;
          const docResponse = await fetch(docUrl);
          if (docResponse.ok) {
            const docText = await docResponse.text();
            setDocumentation(docText);
          }
        }
      } catch (err) {
        console.error('Error fetching resource:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchResource();
  }, [searchParams]);

  if (loading) return <div>Loading...</div>;
  if (!resource) return <div>Resource not found</div>;

  const { manifest } = resource;

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center gap-4 mb-6">
        {manifest.icon && (
          <img src={manifest.icon} alt="" className="w-16 h-16 object-contain" />
        )}
        <div>
          <h1 className="text-3xl font-bold mb-2">{manifest.name}</h1>
          <div className="flex flex-wrap gap-2">
            {manifest.tags?.map((tag, i) => (
              <Badge key={i} text={tag} />
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-gray-50 p-4 rounded">
          <h3 className="font-medium mb-2">Downloads</h3>
          <p>{resource.download_count || 0}</p>
        </div>
        <div className="bg-gray-50 p-4 rounded">
          <h3 className="font-medium mb-2">Views</h3>
          <p>{resource.view_count || 0}</p>
        </div>
        <div className="bg-gray-50 p-4 rounded">
          <h3 className="font-medium mb-2">Last Updated</h3>
          <p>{new Date(resource.last_modified * 1000).toLocaleDateString()}</p>
        </div>
      </div>

      <div className="prose max-w-none">
        <ReactMarkdown>
          {documentation || manifest.description || ''}
        </ReactMarkdown>
      </div>

      {manifest.links && (
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
    </div>
  );
}; 