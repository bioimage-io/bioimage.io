import React, { useState, useEffect } from 'react';
import { Dialog as MuiDialog, TextField } from '@mui/material';
import Comments from './Comments';
import ResourceCard from './ResourceCard';
import ModelTester from './ModelTester';
import { ArtifactInfo } from '../types/artifact';
import ArtifactAdmin from './ArtifactAdmin';
import { useHyphaStore } from '../store/hyphaStore';
import { Disclosure, Transition } from '@headlessui/react';
import StatusBadge from './StatusBadge';
import { useNavigate } from 'react-router-dom';

interface Version {
  version: string;
  current_version?: boolean;
}

interface ReviewPublishArtifactProps {
  artifactInfo: ArtifactInfo | null;
  artifactId: string;
  isStaged: boolean;
  isCollectionAdmin: boolean;
  onPublish: (publishData: { version: string; comment: string }) => void;
  isContentValid: boolean;
  hasContentChanged: boolean;
}

const ReviewPublishArtifact: React.FC<ReviewPublishArtifactProps> = ({
  artifactInfo,
  artifactId,
  isStaged,
  isCollectionAdmin,
  onPublish,
  isContentValid,
  hasContentChanged
}) => {
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [publishData, setPublishData] = useState<{ version: string; comment: string }>({
    version: '',
    comment: ''
  });
  const [status, setStatus] = useState<string>(null);

  const shouldDisableActions = !isContentValid || hasContentChanged;

  const navigate = useNavigate();

  useEffect(() => {
    if (artifactInfo?.manifest?.status) {
      setStatus(artifactInfo.manifest.status);
    } else {
      setStatus(null);
    }
  }, [artifactInfo?.manifest?.status]);

  const handlePublish = () => {
    onPublish(publishData);
    setShowPublishDialog(false);
  };

  const { artifactManager } = useHyphaStore();

  const handleSubmit = async () => {
    if (!artifactInfo?.manifest) return;
    try {
      await artifactManager.edit({
        artifact_id: artifactId,
        version: "stage",
        manifest: {
          ...artifactInfo.manifest,
          status: 'request-review'
        },
        _rkwargs: true
      });
      setStatus('request-review');
    } catch (error) {
      console.error('Error submitting for review:', error);
    }
  };

  const handleWithdraw = async () => {
    if (!artifactInfo?.manifest) return;
    try {
      const { status: _, ...manifestWithoutStatus } = artifactInfo.manifest;
      await artifactManager.edit({
        artifact_id: artifactId,
        version: "stage",
        manifest: manifestWithoutStatus,
        _rkwargs: true
      });
      setStatus('draft');
    } catch (error) {
      console.error('Error withdrawing from review:', error);
    }
  };

  const handleGoBackToEdit = () => {
    navigate(`?tab=%40rdf.yaml`);
  };

  const renderPublishDialog = () => (
    <MuiDialog 
      open={showPublishDialog} 
      onClose={() => setShowPublishDialog(false)}
      maxWidth="sm"
      fullWidth
    >
      <div className="p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">
          Confirm Publication
        </h3>
        <div className="space-y-6">
          {/* Add reviewer responsibility section */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
            <h4 className="font-medium mb-2">Reviewer's Responsibility</h4>
            <ul className="list-disc pl-4 space-y-1">
              <li>Verify that the model meets BioImage.io technical specifications</li>
              <li>Check that documentation is clear and complete</li>
              <li>Ensure all required files are present and valid</li>
              <li>Test model functionality with provided sample data</li>
            </ul>
          </div>

          <div className="text-sm text-gray-500 space-y-4">
            <p>
              You are about to publish this artifact to:
            </p>
            <ul className="list-disc pl-5 space-y-2">
              <li>The BioImage Model Zoo website</li>
              <li>Zenodo (with DOI assignment)</li>
            </ul>
            <p className="text-red-600 font-medium">
              ⚠️ Warning: This action cannot be undone. Once published, the artifact cannot be withdrawn from either platform.
            </p>
          </div>

          {/* Version and Comment fields */}
          <div className="space-y-4">
            <div>
              <TextField
                label="Version (optional)"
                value={publishData.version}
                onChange={(e) => setPublishData(prev => ({ ...prev, version: e.target.value }))}
                fullWidth
                size="small"
                helperText="Leave empty to auto-increment the latest version"
              />
              <div className="mt-2">
                <span className="text-xs text-gray-500">Existing versions: </span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {artifactInfo?.versions && artifactInfo.versions.length > 0 ? (
                    artifactInfo.versions.map((v: Version) => (
                      <span key={v.version} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs">
                        {v.version}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-gray-500 italic">No versions published yet</span>
                  )}
                </div>
              </div>
            </div>
            <TextField
              label="Comment"
              value={publishData.comment}
              onChange={(e) => setPublishData(prev => ({ ...prev, comment: e.target.value }))}
              required
              fullWidth
              multiline
              rows={3}
              size="small"
              helperText="Describe the changes in this publication"
              error={!publishData.comment.trim()}
            />
          </div>
        </div>
        <div className="mt-6 flex gap-3 justify-end">
          <button
            onClick={() => setShowPublishDialog(false)}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Cancel
          </button>
          <button
            onClick={handlePublish}
            disabled={!publishData.comment.trim()}
            className={`px-4 py-2 text-sm font-medium text-white border border-transparent rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500
              ${!publishData.comment.trim() 
                ? 'bg-gray-300 cursor-not-allowed' 
                : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            Confirm & Publish
          </button>
        </div>
      </div>
    </MuiDialog>
  );

  return (
    <div className="h-full px-6 py-4 space-y-6">
      {/* Preview Section */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
            </svg>
            <h3 className="text-lg font-medium text-gray-900">Review & Actions</h3>
          </div>
          
          <div className="flex items-center gap-4">
            {artifactInfo?.manifest?.type === 'model' && (
              <>
                <button
                  onClick={handleGoBackToEdit}
                  className="inline-flex items-center px-4 py-2 h-10 rounded-md text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Back to Edit
                </button>
                <ModelTester
                  artifactId={artifactId}
                  version={isStaged ? 'stage' : artifactInfo?.current_version}
                  isDisabled={shouldDisableActions}
                />
              </>
            )}
            
            {!isCollectionAdmin && artifactId && isStaged && (
              <>
                {status !== 'request-review' ? (
                  <button
                    onClick={handleSubmit}
                    disabled={shouldDisableActions}
                    className={`inline-flex items-center px-4 py-2 h-10 rounded-md text-sm font-medium shadow-sm
                      ${shouldDisableActions 
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                        : 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-2 focus:ring-offset-2 focus:ring-blue-500'}`}
                  >
                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    Submit for Review
                  </button>
                ) : (
                  <button
                    onClick={handleWithdraw}
                    className="inline-flex items-center px-4 py-2 h-10 rounded-md text-sm font-medium shadow-sm bg-red-600 text-white hover:bg-red-700 focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                  >
                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    Withdraw from Review
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Status Badge - Centered and more prominent */}
        {isStaged && status && (
          <div className="flex justify-center mb-8">
            <div className="inline-block transform hover:scale-105 transition-transform">
              <StatusBadge status={status} size="large" />
            </div>
          </div>
        )}

        <div className="max-w-sm mx-auto">
          {artifactInfo && <ResourceCard resource={artifactInfo} />}
        </div>
      </div>

      {/* Version History Card */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center gap-2 mb-4">
          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h3 className="text-lg font-medium text-gray-900">Version History</h3>
        </div>
        
        <div className="bg-gray-50 p-4 rounded-lg">
          {artifactInfo?.versions && artifactInfo.versions.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {artifactInfo.versions.map((v: Version) => (
                <div key={v.version} className="flex items-center gap-2 px-3 py-1.5 bg-white rounded-lg border border-gray-200">
                  <span className="text-sm font-medium text-gray-900">{v.version}</span>
                  {v.version === artifactInfo.current_version && (
                    <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
                      current
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-gray-500 italic">
              No versions have been published yet. Publishing this artifact will create the first version.
            </div>
          )}
        </div>
      </div>

      {/* Comments */}
      <div className="bg-white rounded-lg shadow p-6">
        <Comments artifactId={artifactId} />
      </div>

      {/* Admin Review Area */}
      {isCollectionAdmin && (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg shadow p-6 border border-blue-100">
          <div className="flex items-center gap-2 mb-4">
            <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <h3 className="text-lg font-medium text-blue-900">Admin Review Area</h3>
          </div>

          {/* Add Review Privilege Info Box */}
          <div className="mb-6 bg-white rounded-lg p-4 border border-blue-200">
            <div className="flex items-start gap-3">
              <svg className="w-6 h-6 text-blue-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <h4 className="text-sm font-medium text-gray-900 mb-1">Review Privileges</h4>
                <p className="text-sm text-gray-600">
                  As a collection administrator, you have the authority to review and publish this artifact. 
                  Please ensure all requirements are met before proceeding with publication.
                </p>
              </div>
            </div>
          </div>
          
          {/* Advanced Artifact Editor */}
          {artifactInfo && (
            <div className="bg-white rounded-lg p-4 mb-6">
              <ArtifactAdmin 
                artifactId={artifactId} 
                artifactInfo={artifactInfo}
                onUpdate={() => {/* Add refresh handler if needed */}}
              />
            </div>
          )}

          {/* Move Publish Button to end and make it more prominent */}
          <div className="flex justify-end mt-6">
            <button 
              className={`flex items-center px-6 py-3 rounded-md shadow-sm text-base font-medium transition-colors
                ${shouldDisableActions 
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                  : 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-2 focus:ring-offset-2 focus:ring-blue-500'}`}
              onClick={() => setShowPublishDialog(true)}
              disabled={shouldDisableActions}
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Publish Artifact
            </button>
          </div>
        </div>
      )}

      {/* Advanced Zone for non-admins */}
      {!isCollectionAdmin && (
        <Disclosure>
          {({ open }) => (
            <div className="bg-gray-50 rounded-lg shadow">
              <Disclosure.Button className="w-full px-6 py-4 text-left focus:outline-none">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                    </svg>
                    <span className="text-lg font-medium text-gray-900">Advanced Zone</span>
                  </div>
                  <svg
                    className={`w-5 h-5 text-gray-500 transform ${open ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </Disclosure.Button>

              <Transition
                show={open}
                enter="transition duration-100 ease-out"
                enterFrom="transform scale-95 opacity-0"
                enterTo="transform scale-100 opacity-100"
                leave="transition duration-75 ease-out"
                leaveFrom="transform scale-100 opacity-100"
                leaveTo="transform scale-95 opacity-0"
              >
                <Disclosure.Panel className="px-6 py-4">
                  <div className="bg-red-50 border-l-4 border-red-400 p-4 mb-4">
                    <div className="flex items-start">
                      <div className="flex-shrink-0">
                        <svg className="h-5 w-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                      </div>
                      <div className="ml-3">
                        <h3 className="text-sm font-medium text-red-800">
                          Warning: Direct Publication Not Recommended
                        </h3>
                        <div className="mt-2 text-sm text-red-700">
                          <p>
                            We strongly recommend going through the standard review process to ensure:
                          </p>
                          <ul className="list-disc ml-5 mt-1 space-y-1">
                            <li>Quality assurance of your model</li>
                            <li>Compliance with BioImage.io standards</li>
                            <li>Proper documentation and metadata</li>
                            <li>Community feedback and improvements</li>
                          </ul>
                          <p className="mt-2 font-medium">
                            Only proceed with direct publication if absolutely necessary and you're confident in your model's quality.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <button
                      onClick={() => setShowPublishDialog(true)}
                      disabled={shouldDisableActions}
                      className={`flex items-center px-4 py-2 rounded-md text-sm font-medium shadow-sm
                        ${shouldDisableActions 
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                          : 'bg-red-600 text-white hover:bg-red-700 focus:ring-2 focus:ring-offset-2 focus:ring-red-500'}`}
                    >
                      <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      Publish Without Review
                    </button>
                  </div>
                </Disclosure.Panel>
              </Transition>
            </div>
          )}
        </Disclosure>
      )}

      {/* Publish Dialog */}
      {renderPublishDialog()}
    </div>
  );
};

export default ReviewPublishArtifact; 