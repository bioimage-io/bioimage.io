import React, { useState, useEffect, useRef } from 'react';
import { Dialog as MuiDialog, TextField } from '@mui/material';
import Comments from './Comments';
import ArtifactCard from './ArtifactCard';
import ModelTester, { TestResult } from './ModelTester';
import AdvancedOptions from './AdvancedOptions';
import { useModelRunnerConnection } from '../hooks/useModelRunnerConnection';
import { ArtifactInfo } from '../types/artifact';
import ArtifactAdmin from './ArtifactAdmin';
import { useHyphaStore } from '../store/hyphaStore';
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
  isReviewer: boolean;
  onPublish: () => void;
  isContentValid: boolean;
  hasContentChanged: boolean;
  defaultComment?: string;
  /**
   * Latest Test Model result surfaced from the Edit page. When present and
   * status !== 'passed', clicking Submit for Review opens a confirmation
   * dialog rendering the failing checks before firing handleSubmit.
   */
  lastTestResult?: TestResult | null;
  /**
   * Remote test report from the test-report collection, if any. Used as a
   * fallback when there's no in-session result so a model that already passed
   * remotely isn't re-prompted with the confirmation dialog.
   */
  storedTestReport?: TestResult | null;
  /** Whether the stored test report is stale relative to the current artifact (greys the pill). */
  isStoredReportOutdated?: boolean;
  /** Actual RDF spec filename used by this artifact ('bioimageio.yaml' or 'rdf.yaml'). */
  rdfFileName?: string;
}

const ReviewPublishArtifact: React.FC<ReviewPublishArtifactProps> = ({
  artifactInfo,
  artifactId,
  isStaged,
  isReviewer,
  onPublish,
  isContentValid,
  lastTestResult,
  storedTestReport,
  isStoredReportOutdated,
  hasContentChanged,
  defaultComment,
  rdfFileName = 'bioimageio.yaml',
}) => {
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [showReviewDialog, setShowReviewDialog] = useState(false);

  const [status, setStatus] = useState<string>('');
  const [modelVersion, setModelVersion] = useState<string>('');

  // Shared runner connection + Advanced Options, identical to the Edit page.
  // ModelTester owns the Test Model options dialog internally.
  const conn = useModelRunnerConnection();

  const shouldDisableActions = !isContentValid || hasContentChanged;

  const navigate = useNavigate();

  useEffect(() => {
    if (artifactInfo?.manifest?.status) {
      setStatus(artifactInfo.manifest.status);
    } else {
      setStatus("");
    }
  }, [artifactInfo?.manifest?.status]);

  useEffect(() => {
    setModelVersion(isStaged ? 'stage' : artifactInfo?.current_version || '');
  }, [isStaged, artifactInfo?.current_version]);


  const handlePublish = () => {
    onPublish();
    setShowPublishDialog(false);
  };

  const { artifactManager, isLoggedIn } = useHyphaStore();
  // Surface Hypha errors (e.g. the PermissionError non-workspace-admin users
  // hit when the request-review edit path lands on `bioimage-io/bioimage.io`
  // without stage=True) so they aren't swallowed by console.error only.
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Extra confirmation when the last Test Model run didn't pass — the user
  // sees the failing checks and has to explicitly opt in before we call
  // handleSubmit. See the failing-test dialog rendered near the bottom of
  // this component.
  const [showFailingTestConfirm, setShowFailingTestConfirm] = useState<boolean>(false);
  // Prefer the fresh in-session result; fall back to the remote report so a
  // model that already passed remotely isn't re-prompted. Drives both the
  // dialog skip and what the dialog renders.
  const effectiveTestResult = lastTestResult ?? storedTestReport ?? null;
  const isTestPassing = effectiveTestResult?.status === 'passed';

  const attemptSubmit = () => {
    if (!isTestPassing) {
      setShowFailingTestConfirm(true);
      return;
    }
    void handleSubmit();
  };

  const handleSubmit = async () => {
    if (!artifactInfo?.manifest) return;
    setSubmitError(null);
    try {
      await artifactManager.edit({
        artifact_id: artifactId,
        stage: true,
        manifest: {
          ...artifactInfo.manifest,
          status: 'request-review'
        },
        _rkwargs: true
      });
      setStatus('request-review');
      setShowReviewDialog(false);
    } catch (error: any) {
      console.error('Error submitting for review:', error);
      const message = error?.message || String(error);
      setSubmitError(message.includes('permission')
        ? 'You do not currently have permission to submit this model for review. If this looks wrong, share the message below with a reviewer.\n\n' + message
        : message);
    }
  };

  const handleWithdraw = async () => {
    if (!artifactInfo?.manifest) return;
    try {
      const manifestCopy = { ...artifactInfo.manifest };
      if ('status' in manifestCopy) {
        delete manifestCopy.status;
      }

      await artifactManager.edit({
        artifact_id: artifactId,
        stage: true,
        manifest: manifestCopy,
        _rkwargs: true
      });
      setStatus('draft');
    } catch (error) {
      console.error('Error withdrawing from review:', error);
    }
  };

  const handleGoBackToEdit = () => {
    navigate(`?tab=%40${rdfFileName}`);
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
              <li>Verify that the model meets BioImage.IO technical specifications</li>
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
            className={`px-4 py-2 text-sm font-medium text-white border border-transparent rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 bg-blue-600 hover:bg-blue-700`}
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
            
              <>
                <button
                  onClick={handleGoBackToEdit}
                  className="inline-flex items-center px-4 py-2 h-10 rounded-md text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  <svg className="w-5 h-5 sm:mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  <span className="hidden sm:inline">Back to Edit</span>
                </button>
                {artifactInfo?.manifest && artifactInfo.manifest.type === 'model' && (
                  <>
                    <AdvancedOptions
                      serverUrl={conn.serverUrl}
                      onServerUrlChange={conn.setServerUrl}
                      serviceIdOverride={conn.serviceIdOverride}
                      onServiceIdOverrideChange={conn.setServiceIdOverride}
                      serviceIdPlaceholder={conn.baseRunners.activeServiceId ?? ''}
                      toggleSelected={conn.toggleSelected}
                      onSelectSite={conn.selectSite}
                      siteAvailable={{ kth: conn.baseRunners.kth.available, denbi: conn.baseRunners.denbi.available }}
                      siteLoading={conn.baseRunners.loading}
                      showToggle={isLoggedIn}
                      onReset={conn.reset}
                      isResetting={conn.isReconnecting || conn.isConnecting}
                    />
                    <ModelTester
                      artifactId={artifactId}
                      isStaged={isStaged}
                      isDisabled={shouldDisableActions}
                      modelRunners={conn.modelRunners}
                      storedTestReport={storedTestReport}
                      isStoredReportOutdated={isStoredReportOutdated}
                    />
                  </>
                )}
              </>
        
          
            {artifactId && isStaged && (
              <>
                {status !== 'request-review' ? (
                  <button
                    onClick={() => setShowReviewDialog(true)}
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

          
        <div className="max-w-sm mx-auto mb-4">
          {artifactInfo && <ArtifactCard artifact={artifactInfo} />}
        </div>
        

        {/* Status Badge - Centered and more prominent */}
        {isStaged && status && (
          <div className="flex flex-col items-center gap-4 mb-8">
            <div className="inline-block transform hover:scale-105 transition-transform">
              <StatusBadge status={status} size="large" />
            </div>
            
            {/* Info box for models under review */}
            {status === 'request-review' && (
              <div className="w-full max-w-2xl bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <svg className="w-6 h-6 text-blue-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <h4 className="text-sm font-medium text-blue-900 mb-1">Under Review</h4>
                    <p className="text-sm text-blue-800">
                      Your artifact is being reviewed by our admin team. During this process:
                    </p>
                    <ul className="list-disc pl-5 mt-2 text-sm text-blue-800 space-y-1">
                      <li>Admins may make changes to improve compatibility and documentation</li>
                      <li>Use the comment box below to communicate with the review team</li>
                      <li>Check back regularly for updates or questions from reviewers</li>
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

      </div>

      {/* Comments */}
      <div className="bg-white rounded-lg shadow p-6">
        <Comments artifactId={artifactId} />
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


      {/* Admin Review Area */}
      {isReviewer && (
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

      {/* Non-reviewers cannot self-publish. Models go live only when a reviewer
          accepts them, so guide the uploader to submit for review instead. */}
      {!isReviewer && (
        <div className="bg-blue-50 border-l-4 border-blue-400 rounded-lg shadow p-4">
          <div className="flex items-start gap-3">
            <svg className="w-6 h-6 text-blue-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <h4 className="text-sm font-medium text-blue-900 mb-1">Publication happens through review</h4>
              <p className="text-sm text-blue-800">
                Submit your model for review using the button above. A reviewer will check it and
                publish it to the Model Zoo once accepted — models cannot be self-published.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Review Request Dialog */}
      <MuiDialog
        open={showReviewDialog}
        onClose={() => setShowReviewDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <div className="p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">
            Submit for Review
          </h3>
          <div className="space-y-6">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
              <h4 className="font-medium mb-2">Review Process Information</h4>
              <p className="mb-3">
                By submitting this artifact for review, you acknowledge that:
              </p>
              <ul className="list-disc pl-4 space-y-2">
                <li>Our admin team will be notified and will review your submission</li>
                <li>Reviewers may make changes to your artifact to ensure it meets BioImage.IO standards</li>
                <li>Changes may include:
                  <ul className="list-disc pl-4 mt-1 text-blue-700">
                    <li>Metadata formatting and organization</li>
                    <li>Documentation improvements</li>
                    <li>Technical compatibility adjustments</li>
                    <li>File structure optimization</li>
                  </ul>
                </li>
                <li>You can communicate with reviewers through the comment section</li>
                <li>You can withdraw your submission at any time during the review process</li>
              </ul>
            </div>
          </div>
          {submitError && (
            <div className="mt-4 px-4 py-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700 whitespace-pre-wrap break-words">
              {submitError}
            </div>
          )}
          <div className="mt-6 flex gap-3 justify-end">
            <button
              onClick={() => { setSubmitError(null); setShowReviewDialog(false); }}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Cancel
            </button>
            <button
              onClick={attemptSubmit}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Submit for Review
            </button>
          </div>
        </div>
      </MuiDialog>

      {/* Publish Dialog */}
      {renderPublishDialog()}

      {/* Failing-test confirmation. Renders the failing checks (same
          TestResult shape ModelTester produces) and requires an explicit
          "Publish anyway" click before firing handleSubmit. */}
      <MuiDialog
        open={showFailingTestConfirm}
        onClose={() => setShowFailingTestConfirm(false)}
        maxWidth="sm"
        fullWidth
      >
        <div className="p-6">
          <div className="flex items-start gap-3 mb-4">
            <svg className="w-6 h-6 text-amber-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.84-2.75L13.74 4a2 2 0 00-3.48 0L3.16 16.25A2 2 0 005 19z" />
            </svg>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                {effectiveTestResult ? 'Test did not pass. Submit anyway?' : 'Model not tested. Submit anyway?'}
              </h3>
              <p className="text-sm text-gray-600 mt-1">
                {effectiveTestResult
                  ? 'Reviewers will see this failing report. You can also cancel, fix the issue in the editor, and re-run Test Model before submitting.'
                  : 'This model has no completed test report to attach. You can also cancel and run Test Model first.'}
              </p>
            </div>
          </div>

          {effectiveTestResult && (
            <div className="border border-gray-200 rounded-md overflow-hidden max-h-72 overflow-y-auto">
              <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 flex items-center gap-2 text-sm">
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border
                  ${effectiveTestResult.status === 'passed'
                    ? 'bg-green-50 text-green-700 border-green-200'
                    : 'bg-red-50 text-red-700 border-red-200'}`}>
                  {effectiveTestResult.status}
                </span>
                <span className="font-medium text-gray-800">{effectiveTestResult.name}</span>
              </div>
              <ul className="divide-y divide-gray-100">
                {effectiveTestResult.details?.map((detail, idx) => (
                  <li key={idx} className="px-4 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border
                        ${detail.status === 'passed'
                          ? 'bg-green-50 text-green-700 border-green-200'
                          : 'bg-red-50 text-red-700 border-red-200'}`}>
                        {detail.status}
                      </span>
                      <span className="font-medium text-gray-800">{detail.name}</span>
                    </div>
                    {detail.errors?.length > 0 && (
                      <ul className="mt-1 ml-2 list-disc list-inside text-xs text-red-700 space-y-0.5">
                        {detail.errors.map((err, ei) => (
                          <li key={ei}>{err.msg}{err.loc?.length ? ` (${err.loc.join('.')})` : ''}</li>
                        ))}
                      </ul>
                    )}
                    {detail.warnings?.length > 0 && (
                      <ul className="mt-1 ml-2 list-disc list-inside text-xs text-amber-700 space-y-0.5">
                        {detail.warnings.map((w, wi) => (
                          <li key={wi}>{w.msg}{w.loc?.length ? ` (${w.loc.join('.')})` : ''}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-6 flex gap-3 justify-end">
            <button
              onClick={() => setShowFailingTestConfirm(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Cancel
            </button>
            <button
              onClick={() => { setShowFailingTestConfirm(false); void handleSubmit(); }}
              className="px-4 py-2 text-sm font-medium text-white bg-amber-600 border border-transparent rounded-md hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500"
            >
              Publish anyway
            </button>
          </div>
        </div>
      </MuiDialog>
    </div>
  );
};

export default ReviewPublishArtifact; 