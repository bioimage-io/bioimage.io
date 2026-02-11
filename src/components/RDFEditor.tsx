import React, { useState, useEffect, useCallback, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { TextField, FormControl, Autocomplete, Chip } from '@mui/material';
import yaml from 'js-yaml';
import TagSelection from './TagSelection';
import { tagCategories } from './TagSelection';

// Add debounce function at the top of the file, before interfaces
function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;

  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };

    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

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

interface SPDXLicense {
  licenseId: string;
  name: string;
  reference: string;
}

interface RDFContent {
  type?: 'model' | 'application' | 'dataset';
  name?: string;
  description?: string;
  version?: string;
  license?: string;
  git_repo?: string;
  tags?: string[];
  authors?: Author[];
  maintainers?: Maintainer[];
  cite?: Citation[];
  links?: string[];
  source?: string;
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

// Add the getCompletion function
async function getCompletion(text: string): Promise<string[]> {
  const url = `https://www.ebi.ac.uk/ols4/api/suggest?q=${text}`;
  let response = await fetch(url);
  if (response.ok) {
    const ret = await response.json();
    let results: string[] = [];
    if (ret.response.numFound > 0) {
      results = ret.response.docs.map((d: any) => d.autosuggest);
    }
    const selectUrl = `https://www.ebi.ac.uk/ols4/api/select?q=${text}`;
    response = await fetch(selectUrl);
    if (response.ok) {
      const ret = await response.json();
      if (ret.response.numFound > 0) {
        results = results.concat(ret.response.docs.map((d: any) => d.label));
      }
    }
    results = results.filter((item, pos) => results.indexOf(item) === pos);
    return results;
  } else {
    console.error(`Failed to fetch completion from EBI OLS: ${url}`, response);
    return [];
  }
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
  const [licenses, setLicenses] = useState<SPDXLicense[]>([]);
  const [isLoadingLicenses, setIsLoadingLicenses] = useState(false);
  const isLoadingLicensesRef = useRef(false);
  const hasFetchedLicensesRef = useRef(false);
  const [remoteSuggestions, setRemoteSuggestions] = useState<string[]>([]);
  const [isLoadingTags, setIsLoadingTags] = useState(false);
  const [isInternalChange, setIsInternalChange] = useState(false);
  const [tempLicenseValue, setTempLicenseValue] = useState<string | null>(null);
  const [isLicenseOpen, setIsLicenseOpen] = useState(false);

  // Combine local and remote suggestions and remove duplicates
  const tagSuggestions = Array.from(new Set([...Object.values(tagCategories).flat(), ...remoteSuggestions]));

  const sanitizeTag = (tag: string) => {
    // Convert to lowercase
    let sanitized = tag.toLowerCase();
    // Replace spaces and multiple consecutive dashes with a single dash
    sanitized = sanitized.replace(/\s+/g, '-').replace(/-+/g, '-');
    // Remove any characters that are not lowercase letters, numbers, or allowed special characters
    sanitized = sanitized.replace(/[^a-z0-9+*#;./%@-]/g, '');
    // Remove leading and trailing dashes
    sanitized = sanitized.replace(/^-+|-+$/g, '');
    return sanitized;
  };

  const fetchLicenses = useCallback(async () => {
    // Use refs to avoid stale closure and prevent multiple fetches
    if (isLoadingLicensesRef.current || hasFetchedLicensesRef.current) {
      return;
    }
    
    isLoadingLicensesRef.current = true;
    setIsLoadingLicenses(true);
    
    try {
      const response = await fetch('https://raw.githubusercontent.com/spdx/license-list-data/master/json/licenses.json');
      const data = await response.json();
      const formattedLicenses = data.licenses.map((license: any) => ({
        licenseId: license.licenseId,
        name: license.name,
        reference: license.reference
      }));
      setLicenses(formattedLicenses);
      hasFetchedLicensesRef.current = true;
    } catch (error) {
      console.error('Error fetching licenses:', error);
    } finally {
      isLoadingLicensesRef.current = false;
      setIsLoadingLicenses(false);
    }
  }, []); // No dependencies to prevent infinite loop

  // Update the debounced fetch function to use setRemoteSuggestions
  const debouncedFetchTags = useCallback(
    debounce(async (inputValue: string) => {
      if (!inputValue) {
        setRemoteSuggestions([]);
        return;
      }
      setIsLoadingTags(true);
      try {
        const suggestions = await getCompletion(inputValue);
        // Sanitize suggestions and remove duplicates
        const sanitizedSuggestions = Array.from(new Set(
          suggestions.map(tag => sanitizeTag(tag)).filter(tag => tag)
        ));
        setRemoteSuggestions(sanitizedSuggestions);
      } catch (error) {
        console.error('Error fetching tag suggestions:', error);
      } finally {
        setIsLoadingTags(false);
      }
    }, 300),
    []
  );

  // Parse YAML content when component mounts or content changes from parent
  useEffect(() => {
    // Skip if the change was internal
    if (isInternalChange) {
      setIsInternalChange(false);
      return;
    }

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

  // Fetch licenses on component mount
  useEffect(() => {
    fetchLicenses();
  }, [fetchLicenses]);

  // Handle editor content changes
  const handleEditorChange = (value: string | undefined) => {
    if (!value) return;
    
    setIsInternalChange(true);
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

  // Update form and YAML when form fields changes
  const handleFormChange = (
    field: keyof RDFContent,
    value: any,
    index?: number,
    subfield?: string
  ) => {
    setIsInternalChange(true);
    const newFormData = { ...formData };

    if (index !== undefined && subfield && (field === 'authors' || field === 'maintainers' || field === 'cite')) {
      // Create a properly typed array based on the field
      let arrayField: any[] = [...(newFormData[field] as any[] || [])];
      
      arrayField[index] = {
        ...arrayField[index],
        [subfield]: value
      };
      
      if (field === 'authors') {
        newFormData[field] = arrayField as Author[];
      } else if (field === 'maintainers') {
        newFormData[field] = arrayField as Maintainer[];
      } else if (field === 'cite') {
        newFormData[field] = arrayField as Citation[];
      }
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
    
    if (field === 'authors' || field === 'maintainers' || field === 'cite' || field === 'tags' || field === 'links') {
      const arrayField = [...(newFormData[field] as any[] || [])];
      
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
      
      if (field === 'authors') {
        newFormData[field] = arrayField as Author[];
      } else if (field === 'maintainers') {
        newFormData[field] = arrayField as Maintainer[];
      } else if (field === 'cite') {
        newFormData[field] = arrayField as Citation[];
      } else if (field === 'tags' || field === 'links') {
        newFormData[field] = arrayField as string[];
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
    }
  };

  const removeArrayItem = (field: keyof RDFContent, index: number) => {
    const newFormData = { ...formData };
    
    if (field === 'authors' || field === 'maintainers' || field === 'cite' || field === 'tags' || field === 'links') {
      const arrayField = [...(newFormData[field] as any[] || [])];
      arrayField.splice(index, 1);
      
      if (field === 'authors') {
        newFormData[field] = arrayField as Author[];
      } else if (field === 'maintainers') {
        newFormData[field] = arrayField as Maintainer[];
      } else if (field === 'cite') {
        newFormData[field] = arrayField as Citation[];
      } else if (field === 'tags' || field === 'links') {
        newFormData[field] = arrayField as string[];
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
    }
  };

  // Add more fields to the form based on the reference implementation
  const renderForm = () => (
    <div className="space-y-8 px-8 py-6 text-sm">
      {/* Add note about form limitations */}
      <div className="bg-orange-50/50 border border-[#f39200]/20 rounded-md p-4">
        <div className="flex">
          <div className="flex-shrink-0">
             <span className="text-[#f39200] font-bold">ℹ</span>
          </div>
          <div className="ml-3 space-y-2">
            <p className="text-sm text-gray-800">
              This form contains common fields. To edit additional fields, please use the{' '}
              <button 
                onClick={() => setIsFormMode(false)}
                className="font-medium underline hover:text-[#f39200] text-[#f39200]"
              >
                Advanced RDF Editor
              </button>
            </p>
            <p className="text-sm text-gray-800">
              It's recommended to provide comprehensive documentation for your model. We provide a{' '}
              <a 
                href="/#/docs"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline hover:text-[#f39200] text-[#f39200]"
              >
                Model Card Template
              </a>
              {' '}to help you create thorough documentation that meets RI-SCALE Model Hub standards.
            </p>
          </div>
        </div>
      </div>

      {/* Section styling */}
      <div className="space-y-6">
        {/* Section Header */}
        <div className="border-b border-gray-200 pb-4">
          <h2 className="text-base font-semibold text-gray-900">Basic Information</h2>
          <p className="mt-1 text-sm text-gray-500">
            Basic details about your artifact
          </p>
        </div>

        {/* Form Fields with consistent spacing */}
        <div className="grid gap-6">
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
              helperText="Select the type of artifact: model, application, or dataset"
              className="bg-white rounded-md"
              InputProps={{
                className: "rounded-md",
              }}
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
            helperText="The name of your artifact (note: / is not allowed in the name)"
            disabled={readOnly}
            className="bg-white rounded-md"
            InputProps={{
              className: "rounded-md",
            }}
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
            helperText="A detailed description of your artifact"
            className="bg-white rounded-md"
            InputProps={{
              className: "rounded-md",
            }}
          />

          <TextField
            fullWidth
            size="small"
            label="Version"
            value={formData.version || ''}
            onChange={(e) => handleFormChange('version', e.target.value)}
            helperText="Version in MAJOR.MINOR.PATCH format (e.g. 0.1.0)"
            disabled={readOnly}
            className="bg-white rounded-md"
            InputProps={{
              className: "rounded-md",
            }}
          />

          <Autocomplete
            fullWidth
            size="small"
            options={licenses}
            loading={isLoadingLicenses}
            open={isLicenseOpen}
            value={isLicenseOpen ? null : (formData.license ? licenses.find(l => l.licenseId === formData.license) || null : null)}
            onChange={(_, newValue) => {
              handleFormChange('license', newValue?.licenseId || '');
              setTempLicenseValue(null); // Clear temp value on selection
            }}
            onOpen={() => {
              setIsLicenseOpen(true);
              setTempLicenseValue(formData.license || null); // Handle undefined case
              fetchLicenses();
            }}
            onClose={() => {
              setIsLicenseOpen(false);
              // Only restore previous value if no selection was made and we have a temp value
              if (tempLicenseValue && !formData.license) {
                handleFormChange('license', tempLicenseValue);
              }
            }}
            getOptionLabel={(option) => `${option.licenseId} - ${option.name}`}
            isOptionEqualToValue={(option, value) => {
              if (!option || !value) return false;
              const valueId = typeof value === 'string' ? value : value.licenseId;
              return option.licenseId === valueId;
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="License"
                disabled={readOnly}
                helperText={
                  <span>
                    Choose the license that fits you most, we recommend to use{' '}
                    <a 
                      href="https://creativecommons.org/licenses/by/4.0/" 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="text-[#f39200] hover:underline"
                    >
                      CC-BY-4.0
                    </a>
                    {' '}(free to share and adapt under the condition of attribution). 
                    For other license options, see{' '}
                    <a 
                      href="https://spdx.org/licenses" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-[#f39200] hover:underline"
                    >
                      SPDX License List
                    </a>
                  </span>
                }
                className="bg-white rounded-md"
                InputProps={{
                  ...params.InputProps,
                  className: "rounded-md",
                }}
              />
            )}
          />

          <TextField
            fullWidth
            size="small"
            label="Git Repository"
            value={formData.git_repo || ''}
            onChange={(e) => handleFormChange('git_repo', e.target.value)}
            helperText="Git repository URL"
            disabled={readOnly}
            className="bg-white rounded-md"
            InputProps={{
              className: "rounded-md",
            }}
          />

          {/* Add Tags field */}
          <div>
            <div className="flex gap-2 items-start">
              <Autocomplete
                multiple
                freeSolo
                size="small"
                options={tagSuggestions}
                value={formData.tags || []}
                onChange={(_, newValue) => {
                  // Sanitize tags, remove duplicates, and filter out empty strings
                  const uniqueSanitizedTags = Array.from(new Set(
                    newValue
                      .map(tag => typeof tag === 'string' ? sanitizeTag(tag) : '')
                      .filter(tag => tag)
                  ));
                  handleFormChange('tags', uniqueSanitizedTags);
                }}
                onInputChange={(_, value) => {
                  if (value) {
                    debouncedFetchTags(value);
                  }
                }}
                loading={isLoadingTags}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Tags"
                    placeholder="Add tags..."
                    helperText="Tags should contain only lowercase letters, numbers, dashes (-), or the following characters: +*#;./%@ (no spaces). As you type, suggestions from the EBI Ontology Lookup Service will appear. Press Enter, Tab, or Space after each tag."
                    error={!!errors.tags}
                    className="bg-white rounded-md"
                    InputProps={{
                      ...params.InputProps,
                      className: "rounded-md",
                    }}
                  />
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip
                      {...getTagProps({ index })}
                      key={index}
                      label={option}
                      size="small"
                      disabled={readOnly}
                    />
                  ))
                }
              />
              <div>
                <TagSelection 
                  onTagSelect={(tag) => {
                    const currentTags = formData.tags || [];
                    const sanitizedTag = sanitizeTag(tag);
                    if (!currentTags.includes(sanitizedTag)) {
                      handleFormChange('tags', [...currentTags, sanitizedTag]);
                    }
                  }} 
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Uploader Section */}
      <div className="space-y-6">
        <div className="border-b border-gray-200 pb-4">
          <h2 className="text-base font-semibold text-gray-900">Uploader Information</h2>
          <p className="mt-1 text-sm text-gray-500">
            Details about who is uploading this artifact
          </p>
        </div>

        <div className="grid gap-6">
          <div className="flex gap-2">
            <TextField
              fullWidth
              size="small"
              label="Email"
              value={formData.uploader?.email || ''}
              required
              helperText="Email of the uploader (automatically set)"
              className="bg-white rounded-md"
              InputProps={{
                className: "rounded-md",
              }}
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
              className="bg-white rounded-md"
              InputProps={{
                className: "rounded-md",
              }}
            />
          </div>
        </div>
      </div>

      {/* Authors Section */}
      <div className="space-y-6">
        <div className="border-b border-gray-200 pb-4 flex justify-between items-center">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Authors</h2>
            <p className="mt-1 text-sm text-gray-500">
              The authors who contributed to this artifact
            </p>
          </div>
          {!readOnly && (
            <button
              onClick={() => addArrayItem('authors')}
              className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Author
            </button>
          )}
        </div>

        <div className="grid gap-4">
          {formData.authors?.map((author, index) => (
            <div key={index} className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <div className="flex justify-between items-start">
                <div className="flex-1 space-y-4">
                  <TextField
                    fullWidth
                    size="small"
                    label="Name"
                    value={author.name || ''}
                    onChange={(e) => handleFormChange('authors', e.target.value, index, 'name')}
                    required
                    disabled={readOnly}
                    className="bg-white rounded-md"
                    InputProps={{
                      className: "rounded-md",
                    }}
                  />
                  <TextField
                    fullWidth
                    size="small"
                    label="Affiliation"
                    value={author.affiliation || ''}
                    onChange={(e) => handleFormChange('authors', e.target.value, index, 'affiliation')}
                    disabled={readOnly}
                    className="bg-white rounded-md"
                    InputProps={{
                      className: "rounded-md",
                    }}
                  />
                  <TextField
                    fullWidth
                    size="small"
                    label="ORCID"
                    value={author.orcid || ''}
                    onChange={(e) => handleFormChange('authors', e.target.value, index, 'orcid')}
                    disabled={readOnly}
                    className="bg-white rounded-md"
                    InputProps={{
                      className: "rounded-md",
                    }}
                  />
                </div>
                {!readOnly && (
                  <button
                    onClick={() => removeArrayItem('authors', index)}
                    className="ml-2 p-2 text-gray-400 hover:text-red-500 rounded-full hover:bg-gray-100"
                    title="Remove Author"
                    aria-label="Remove Author"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Maintainers Section */}
      <div className="space-y-6">
        <div className="border-b border-gray-200 pb-4 flex justify-between items-center">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Maintainers</h2>
            <p className="mt-1 text-sm text-gray-500">
              The maintainers who maintain this artifact. The first maintainer will be contacted for approval.
            </p>
          </div>
          {!readOnly && (
            <button
              onClick={() => addArrayItem('maintainers')}
              className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Maintainer
            </button>
          )}
        </div>
        {formData.maintainers?.map((maintainer, index) => (
          <div key={index} className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="flex justify-between items-start">
              <div className="flex-1 space-y-4">
                <TextField
                  fullWidth
                  size="small"
                  label="Name"
                  value={maintainer.name || ''}
                  onChange={(e) => handleFormChange('maintainers', e.target.value, index, 'name')}
                  required
                  disabled={readOnly}
                  className="bg-white rounded-md"
                  InputProps={{
                    className: "rounded-md",
                  }}
                />
                <TextField
                  fullWidth
                  size="small"
                  label="Github Username"
                  value={maintainer.github_user || ''}
                  onChange={(e) => handleFormChange('maintainers', e.target.value, index, 'github_user')}
                  disabled={readOnly}
                  className="bg-white rounded-md"
                  InputProps={{
                    className: "rounded-md",
                  }}
                />
                <TextField
                  fullWidth
                  size="small"
                  label="Email"
                  value={maintainer.email || ''}
                  onChange={(e) => handleFormChange('maintainers', e.target.value, index, 'email')}
                  type="email"
                  disabled={readOnly}
                  className="bg-white rounded-md"
                  InputProps={{
                    className: "rounded-md",
                  }}
                />
              </div>
              {!readOnly && (
                <button
                  onClick={() => removeArrayItem('maintainers', index)}
                  className="ml-2 p-2 text-gray-400 hover:text-red-500 rounded-full hover:bg-gray-100"
                  title="Remove Maintainer"
                  aria-label="Remove Maintainer"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Citations Section */}
      <div className="space-y-6">
        <div className="border-b border-gray-200 pb-4 flex justify-between items-center">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Citations</h2>
            <p className="mt-1 text-sm text-gray-500">
              How this artifact should be cited
            </p>
          </div>
          {!readOnly && (
            <button
              onClick={() => addArrayItem('cite')}
              className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Citation
            </button>
          )}
        </div>
        {formData.cite?.map((citation, index) => (
          <div key={index} className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="flex justify-between items-start">
              <div className="flex-1 space-y-4">
                <TextField
                  fullWidth
                  size="small"
                  label="Citation Text"
                  value={citation.text || ''}
                  onChange={(e) => handleFormChange('cite', e.target.value, index, 'text')}
                  multiline
                  rows={2}
                  disabled={readOnly}
                  className="bg-white rounded-md"
                  InputProps={{
                    className: "rounded-md",
                  }}
                />
                <TextField
                  fullWidth
                  size="small"
                  label="DOI"
                  value={citation.doi || ''}
                  onChange={(e) => handleFormChange('cite', e.target.value, index, 'doi')}
                  disabled={readOnly}
                  className="bg-white rounded-md"
                  InputProps={{
                    className: "rounded-md",
                  }}
                />
                <TextField
                  fullWidth
                  size="small"
                  label="URL"
                  value={citation.url || ''}
                  onChange={(e) => handleFormChange('cite', e.target.value, index, 'url')}
                  disabled={readOnly}
                  className="bg-white rounded-md"
                  InputProps={{
                    className: "rounded-md",
                  }}
                />
              </div>
              {!readOnly && (
                <button
                  onClick={() => removeArrayItem('cite', index)}
                  className="ml-2 p-2 text-gray-400 hover:text-red-500 rounded-full hover:bg-gray-100"
                  title="Remove Citation"
                  aria-label="Remove Citation"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      {showModeSwitch && (
        <div className="flex items-center justify-end gap-3 px-4 py-2 border-b bg-gray-50/50">
          <button
            onClick={() => setIsFormMode(true)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-sm transition-colors ${
              isFormMode 
                ? 'bg-orange-50 text-[#f39200] font-medium border border-orange-200'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 border border-transparent'
            }`}
            disabled={readOnly}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5h16a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1zm0 6h16a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2a1 1 0 011-1zm0 6h16a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2a1 1 0 011-1z" />
            </svg>
            Simple RDF Form
          </button>
          <button
            onClick={() => setIsFormMode(false)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-sm transition-colors ${
              !isFormMode 
                ? 'bg-orange-50 text-[#f39200] font-medium border border-orange-200'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 border border-transparent'
            }`}
            disabled={readOnly}
            data-testid="yaml-mode-button"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
            Advanced RDF Editor
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