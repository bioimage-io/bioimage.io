import React, { useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { Switch, TextField, FormControl, FormHelperText } from '@mui/material';
import yaml from 'js-yaml';

interface Author {
  name: string;
  affiliation?: string;
  orcid?: string;
}

interface Maintainer {
  name: string;
  github_user?: string;
  email?: string;
}

interface Citation {
  text?: string;
  doi?: string;
  url?: string;
}

interface RDFContent {
  type?: 'model' | 'application' | 'dataset';
  name?: string;
  description?: string;
  authors?: Author[];
  maintainers?: Maintainer[];
  version?: string;
  license?: string;
  git_repo?: string;
  tags?: string[];
  cite?: Citation[];
  source?: string;
  links?: string[];
  id?: string;
  id_emoji?: string;
  uploader?: {
    email: string;
    name?: string | null;
  };
}

interface RDFEditorProps {
  content: string;
  onChange: (content: string) => void;
  readOnly?: boolean;
  showModeSwitch?: boolean;
}

const RDFEditor: React.FC<RDFEditorProps> = ({ 
  content, 
  onChange,
  readOnly = false,
  showModeSwitch = true
}) => {
  const [isFormMode, setIsFormMode] = useState(true);
  const [formData, setFormData] = useState<RDFContent>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [editorContent, setEditorContent] = useState(content);

  // Parse YAML content when component mounts or content changes
  useEffect(() => {
    try {
      setEditorContent(content);
      const parsed = yaml.load(content) as RDFContent;
      setFormData(parsed || {});
      setErrors({});
    } catch (error) {
      console.error('Error parsing YAML:', error);
      setErrors({ yaml: 'Invalid YAML format' });
    }
  }, [content]);

  // Handle editor content changes
  const handleEditorChange = (value: string | undefined) => {
    if (!value) return;
    setEditorContent(value);
    try {
      const parsed = yaml.load(value) as RDFContent;
      setFormData(parsed || {});
      setErrors({});
      onChange(value);
    } catch (error) {
      console.error('Error parsing YAML:', error);
      setErrors({ yaml: 'Invalid YAML format' });
    }
  };

  // Update form and YAML when form fields change
  const handleFormChange = (
    field: keyof RDFContent,
    value: any,
    index?: number,
    subfield?: string
  ) => {
    const newFormData = { ...formData };

    if (index !== undefined && subfield && Array.isArray(newFormData[field])) {
      const arrayField = [...(newFormData[field] as any[])];
      arrayField[index] = {
        ...arrayField[index],
        [subfield]: value
      };
      newFormData[field] = arrayField as any;
    } else {
      newFormData[field] = value;
    }

    setFormData(newFormData);
    try {
      const newContent = yaml.dump(newFormData, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
      });
      setEditorContent(newContent);
      onChange(newContent);
    } catch (error) {
      console.error('Error generating YAML:', error);
    }
  };

  const addArrayItem = (field: keyof RDFContent) => {
    const newFormData = { ...formData };
    const arrayField = [...(newFormData[field] as any[] || [])];
    
    // Add empty item based on field type
    switch (field) {
      case 'authors':
        arrayField.push({ name: '', affiliation: '', orcid: '' });
        break;
      case 'maintainers':
        arrayField.push({ name: '', github_user: '', email: '' });
        break;
      case 'cite':
        arrayField.push({ text: '', doi: '', url: '' });
        break;
      default:
        arrayField.push('');
    }
    
    newFormData[field] = arrayField;
    setFormData(newFormData);
    try {
      const newContent = yaml.dump(newFormData, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
      });
      setEditorContent(newContent);
      onChange(newContent);
    } catch (error) {
      console.error('Error generating YAML:', error);
    }
  };

  const removeArrayItem = (field: keyof RDFContent, index: number) => {
    const newFormData = { ...formData };
    const arrayField = [...(newFormData[field] as any[] || [])];
    arrayField.splice(index, 1);
    newFormData[field] = arrayField;
    setFormData(newFormData);
    try {
      const newContent = yaml.dump(newFormData, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
      });
      setEditorContent(newContent);
      onChange(newContent);
    } catch (error) {
      console.error('Error generating YAML:', error);
    }
  };

  // Add more fields to the form based on the reference implementation
  const renderForm = () => (
    <div className="space-y-4 p-4 text-sm">
      {/* Basic Information */}
      <div className="space-y-3">
        <h3 className="text-base font-medium text-gray-900">Basic Information</h3>
        
        <FormControl fullWidth size="small">
          <TextField
            label="Type"
            select
            value={formData.type || ''}
            onChange={(e) => handleFormChange('type', e.target.value)}
            SelectProps={{
              native: true,
            }}
            disabled={readOnly}
            size="small"
          >
            <option value="">Select type</option>
            <option value="model">Model</option>
            <option value="application">Application</option>
            <option value="dataset">Dataset</option>
          </TextField>
        </FormControl>

        <TextField
          fullWidth
          size="small"
          label="Name"
          value={formData.name || ''}
          onChange={(e) => handleFormChange('name', e.target.value)}
          required
          error={!!errors.name}
          helperText={errors.name || "The name of your deposit (note: / is not allowed in the name)"}
          disabled={readOnly}
        />

        <TextField
          fullWidth
          size="small"
          label="Description"
          value={formData.description || ''}
          onChange={(e) => handleFormChange('description', e.target.value)}
          multiline
          rows={3}
          required
          disabled={readOnly}
        />

        <TextField
          fullWidth
          size="small"
          label="Version"
          value={formData.version || ''}
          onChange={(e) => handleFormChange('version', e.target.value)}
          helperText="Version in MAJOR.MINOR.PATCH format (e.g. 0.1.0)"
          disabled={readOnly}
        />

        <TextField
          fullWidth
          size="small"
          label="License"
          value={formData.license || ''}
          onChange={(e) => handleFormChange('license', e.target.value)}
          helperText={
            <span>
              Choose the license that fits you most, we recommend to use{' '}
              <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                CC-BY-4.0
              </a>
            </span>
          }
          disabled={readOnly}
        />

        <TextField
          fullWidth
          size="small"
          label="Git Repository"
          value={formData.git_repo || ''}
          onChange={(e) => handleFormChange('git_repo', e.target.value)}
          helperText="Git repository URL"
          disabled={readOnly}
        />
      </div>

      {/* Add Uploader section after Basic Information */}
      <div className="space-y-3">
        <h3 className="text-base font-medium text-gray-900">Uploader Information</h3>
        
        <div className="flex gap-2">
          <TextField
            fullWidth
            size="small"
            label="Email"
            value={formData.uploader?.email || ''}
            disabled={true} // Always readonly
            required
            helperText="Email of the uploader (automatically set)"
          />
          
          <TextField
            fullWidth
            size="small"
            label="Name"
            value={formData.uploader?.name || ''}
            onChange={(e) => handleFormChange('uploader', {
              ...formData.uploader,
              name: e.target.value || null
            })}
            disabled={readOnly}
            helperText="Optional name of the uploader"
          />
        </div>
      </div>

      {/* Authors */}
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <h3 className="text-base font-medium text-gray-900">Authors</h3>
          {!readOnly && (
            <button
              onClick={() => addArrayItem('authors')}
              className="text-xs text-blue-600 hover:text-blue-700"
            >
              + Add Author
            </button>
          )}
        </div>
        
        {formData.authors?.map((author, index) => (
          <div key={index} className="flex gap-2 items-start bg-gray-50 p-3 rounded">
            <div className="flex-1 space-y-2">
              <TextField
                fullWidth
                size="small"
                label="Name"
                value={author.name || ''}
                onChange={(e) => handleFormChange('authors', e.target.value, index, 'name')}
                required
                disabled={readOnly}
              />
              <TextField
                fullWidth
                size="small"
                label="Affiliation"
                value={author.affiliation || ''}
                onChange={(e) => handleFormChange('authors', e.target.value, index, 'affiliation')}
                disabled={readOnly}
              />
              <TextField
                fullWidth
                size="small"
                label="ORCID"
                value={author.orcid || ''}
                onChange={(e) => handleFormChange('authors', e.target.value, index, 'orcid')}
                disabled={readOnly}
              />
            </div>
            {!readOnly && (
              <button
                onClick={() => removeArrayItem('authors', index)}
                className="text-red-600 hover:text-red-700 p-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Maintainers */}
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <h3 className="text-base font-medium text-gray-900">Maintainers</h3>
          {!readOnly && (
            <button
              onClick={() => addArrayItem('maintainers')}
              className="text-xs text-blue-600 hover:text-blue-700"
            >
              + Add Maintainer
            </button>
          )}
        </div>
        
        {formData.maintainers?.map((maintainer, index) => (
          <div key={index} className="flex gap-2 items-start bg-gray-50 p-3 rounded">
            <div className="flex-1 space-y-2">
              <TextField
                fullWidth
                size="small"
                label="Name"
                value={maintainer.name || ''}
                onChange={(e) => handleFormChange('maintainers', e.target.value, index, 'name')}
                required
                disabled={readOnly}
              />
              <TextField
                fullWidth
                size="small"
                label="Github Username"
                value={maintainer.github_user || ''}
                onChange={(e) => handleFormChange('maintainers', e.target.value, index, 'github_user')}
                disabled={readOnly}
              />
              <TextField
                fullWidth
                size="small"
                label="Email"
                value={maintainer.email || ''}
                onChange={(e) => handleFormChange('maintainers', e.target.value, index, 'email')}
                type="email"
                disabled={readOnly}
              />
            </div>
            {!readOnly && (
              <button
                onClick={() => removeArrayItem('maintainers', index)}
                className="text-red-600 hover:text-red-700 p-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Citations */}
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <h3 className="text-base font-medium text-gray-900">Citations</h3>
          {!readOnly && (
            <button
              onClick={() => addArrayItem('cite')}
              className="text-xs text-blue-600 hover:text-blue-700"
            >
              + Add Citation
            </button>
          )}
        </div>
        
        {formData.cite?.map((citation, index) => (
          <div key={index} className="flex gap-2 items-start bg-gray-50 p-3 rounded">
            <div className="flex-1 space-y-2">
              <TextField
                fullWidth
                size="small"
                label="Citation Text"
                value={citation.text || ''}
                onChange={(e) => handleFormChange('cite', e.target.value, index, 'text')}
                multiline
                rows={2}
                disabled={readOnly}
              />
              <TextField
                fullWidth
                size="small"
                label="DOI"
                value={citation.doi || ''}
                onChange={(e) => handleFormChange('cite', e.target.value, index, 'doi')}
                disabled={readOnly}
              />
              <TextField
                fullWidth
                size="small"
                label="URL"
                value={citation.url || ''}
                onChange={(e) => handleFormChange('cite', e.target.value, index, 'url')}
                disabled={readOnly}
              />
            </div>
            {!readOnly && (
              <button
                onClick={() => removeArrayItem('cite', index)}
                className="text-red-600 hover:text-red-700 p-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Source */}
      <div className="space-y-3">
        <h3 className="text-base font-medium text-gray-900">Additional Information</h3>
        <TextField
          fullWidth
          size="small"
          label="Source URL"
          value={formData.source || ''}
          onChange={(e) => handleFormChange('source', e.target.value)}
          helperText="The source URL of your deposit"
          disabled={readOnly}
        />
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      {showModeSwitch && (
        <div className="flex items-center justify-end gap-3 px-4 py-2 border-b bg-gray-50">
          <button
            onClick={() => setIsFormMode(false)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-sm transition-colors ${
              !isFormMode 
                ? 'bg-blue-100 text-blue-700 font-medium'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
            disabled={readOnly}
            data-testid="yaml-mode-button"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
            Code
          </button>
          <button
            onClick={() => setIsFormMode(true)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-sm transition-colors ${
              isFormMode 
                ? 'bg-blue-100 text-blue-700 font-medium'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
            disabled={readOnly}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5h16a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1zm0 6h16a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2a1 1 0 011-1zm0 6h16a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2a1 1 0 011-1z" />
            </svg>
            Form
          </button>
        </div>
      )}
      
      {isFormMode ? (
        <div className="flex-1 overflow-auto">
          {renderForm()}
        </div>
      ) : (
        <Editor
          height="100%"
          language="yaml"
          value={editorContent}
          onChange={handleEditorChange}
          options={{
            minimap: { enabled: false },
            scrollBeyondLastLine: true,
            wordWrap: 'on',
            lineNumbers: 'on',
            renderWhitespace: 'selection',
            readOnly
          }}
        />
      )}
    </div>
  );
};

export default RDFEditor; 