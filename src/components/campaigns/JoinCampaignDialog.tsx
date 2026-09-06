import React, { useEffect, useRef, useState } from 'react';
import { campaignService } from '../../services/campaignService';
import { CampaignRecord, JoinRequestReceipt } from '../../types/campaign';
import { formatBytes } from './format';

/**
 * The request to participate.
 *
 * This is deliberately a request, not a registration. A steward reads it and
 * decides, and nothing is deployed to the requesting site before that. The
 * copy says so plainly: the human step is real and describing it accurately is
 * the whole value of this screen.
 *
 * The transport contract is rendered from the campaign record, so a site is
 * shown the payload this campaign actually exchanges rather than a generic
 * promise written once and never revisited.
 */

interface JoinCampaignDialogProps {
  campaign: CampaignRecord;
  onClose: () => void;
}

const JoinCampaignDialog: React.FC<JoinCampaignDialogProps> = ({ campaign, onClose }) => {
  const [deploymentId, setDeploymentId] = useState('');
  const [datasetName, setDatasetName] = useState('');
  const [nImages, setNImages] = useState('');
  const [licence, setLicence] = useState(campaign.licence_policy.accepted_data_licences[0] ?? '');
  const [attested, setAttested] = useState(false);
  const [contact, setContact] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<JoinRequestReceipt | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const perRound = formatBytes(campaign.payload?.bytes_per_site_per_round);
  const payloadLabel = campaign.payload?.label;

  const canSubmit =
    deploymentId.trim().length > 0 &&
    datasetName.trim().length > 0 &&
    licence.length > 0 &&
    attested &&
    contact.trim().length > 0 &&
    !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const parsed = Number.parseInt(nImages, 10);
      const result = await campaignService.submitJoinRequest({
        campaign_id: campaign.campaign_id,
        deployment_id: deploymentId.trim(),
        dataset: {
          name: datasetName.trim(),
          n_images: Number.isFinite(parsed) ? parsed : null,
          licence,
        },
        licence_attested: attested,
        contact: contact.trim(),
      });
      setReceipt(result);
    } catch (e: any) {
      console.error('Join request failed:', e);
      setError(e?.message || 'The request could not be sent.');
    } finally {
      setSubmitting(false);
    }
  };

  const fieldClasses =
    'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm transition-colors duration-200 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Request to join ${campaign.title}`}
      >
        <div className="border-b border-gray-200 px-6 py-5">
          <h2 className="text-xl font-semibold text-gray-900">Request to join this campaign</h2>
          <p className="mt-1 text-sm text-gray-600">{campaign.title}</p>
        </div>

        {receipt ? (
          <div className="px-6 py-8">
            <h3 className="text-lg font-semibold text-gray-900">Request sent</h3>
            <p className="mt-2 text-sm text-gray-600">
              A campaign steward will review it. Nothing is deployed to your BioEngine instance
              until someone accepts, and you can withdraw the request at any point before that.
            </p>
            {receipt.message && (
              <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">
                {receipt.message}
              </p>
            )}
            <button
              type="button"
              onClick={onClose}
              className="mt-6 inline-flex items-center rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all duration-200 ease-out hover:bg-gray-800 active:scale-[0.97]"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            <div className="border-b border-gray-200 bg-gray-50/70 px-6 py-5">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-700">
                What crosses your network
              </h3>
              {payloadLabel ? (
                <p className="mt-2 text-sm text-gray-700">
                  {payloadLabel}
                  {perRound ? `, about ${perRound} in each direction per round.` : '.'} Your images
                  and labels stay on your storage. Nothing else is read from your deployment.
                </p>
              ) : (
                <p className="mt-2 text-sm text-gray-600">
                  This campaign has not published its transport contract yet. Ask a steward what
                  the payload is before joining.
                </p>
              )}
              <p className="mt-2 text-sm text-gray-600">
                Accepted data licences:{' '}
                {campaign.licence_policy.accepted_data_licences.join(', ') || 'not specified'}.
                {campaign.licence_policy.model_licence
                  ? ` The merged model is published under ${campaign.licence_policy.model_licence}.`
                  : ''}
              </p>
            </div>

            <div className="space-y-4 px-6 py-5">
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Your BioEngine deployment</span>
                <input
                  ref={firstFieldRef}
                  type="text"
                  value={deploymentId}
                  onChange={(e) => setDeploymentId(e.target.value)}
                  placeholder="workspace/bioengine-worker-..."
                  className={fieldClasses}
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Dataset you contribute</span>
                  <input
                    type="text"
                    value={datasetName}
                    onChange={(e) => setDatasetName(e.target.value)}
                    placeholder="Name of the dataset"
                    className={fieldClasses}
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">
                    Number of images (optional)
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={nImages}
                    onChange={(e) => setNImages(e.target.value)}
                    className={fieldClasses}
                  />
                </label>
              </div>

              <label className="block">
                <span className="text-sm font-medium text-gray-700">Data licence</span>
                <select
                  value={licence}
                  onChange={(e) => setLicence(e.target.value)}
                  className={fieldClasses}
                >
                  {campaign.licence_policy.accepted_data_licences.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-sm font-medium text-gray-700">Contact</span>
                <input
                  type="text"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  placeholder="Email address a steward can reply to"
                  className={fieldClasses}
                />
              </label>

              <label className="flex items-start gap-3 rounded-lg bg-gray-50 px-3 py-3">
                <input
                  type="checkbox"
                  checked={attested}
                  onChange={(e) => setAttested(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">
                  I confirm this dataset may be used for training under the licence selected above,
                  and that I am authorised to make that commitment for my institution.
                </span>
              </label>

              {error && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-gray-200 px-6 py-4">
              <p className="text-xs text-gray-500">
                A steward reviews every request. Accepting is a human decision.
              </p>
              <div className="flex flex-shrink-0 gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-all duration-200 ease-out hover:bg-gray-50 active:scale-[0.97]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all duration-200 ease-out hover:bg-blue-700 active:scale-[0.97] disabled:cursor-not-allowed disabled:bg-gray-300 disabled:active:scale-100"
                >
                  {submitting ? 'Sending' : 'Send request'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default JoinCampaignDialog;
