import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DatasetSummary, getAnnotatedStems, listMyDatasets, pLimit, toAlias } from './datasetApi';
import { SharedDatasetSummary, listMyDatasets as listSharedDatasets } from './brokerApi';
import DatasetCard from './DatasetCard';
import CreateDatasetModal from './CreateDatasetModal';
import LabelSelectDialog from './LabelSelectDialog';

export interface DatasetListProps {
  user: any;
  server: any;
  artifactManager: any;
  onRequireLogin: () => void;
}

// F2 (colab-rework-plan.md): the /colab landing state once no dataset is
// selected. Own datasets read directly (owner already holds `*`); shared
// datasets come from the broker's index, which is the only place role
// (manager/annotator/public) and the "shared with you" membership live.
const DatasetList: React.FC<DatasetListProps> = ({ user, server, artifactManager, onRequireLogin }) => {
  const navigate = useNavigate();

  const [ownDatasets, setOwnDatasets] = useState<DatasetSummary[] | null>(null);
  const [sharedDatasets, setSharedDatasets] = useState<SharedDatasetSummary[] | null>(null);
  const [labelCounts, setLabelCounts] = useState<Record<string, Record<string, number>>>({});
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [labelDialogFor, setLabelDialogFor] = useState<SharedDatasetSummary | null>(null);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const [own, shared] = await Promise.all([
          listMyDatasets(artifactManager, user),
          server ? listSharedDatasets(server).catch(() => ({ shared: [] })) : Promise.resolve({ shared: [] }),
        ]);
        if (!active) return;
        setOwnDatasets(own);
        setSharedDatasets(shared.shared || []);

        const limit = pLimit(4);
        const jobs: Array<Promise<void>> = [];
        const collect = (artifactId: string, labels: Array<{ name: string }>) => {
          for (const label of labels) {
            jobs.push(
              limit(async () => {
                try {
                  const stems = await getAnnotatedStems(artifactManager, artifactId, label.name);
                  if (active) {
                    setLabelCounts((prev) => ({
                      ...prev,
                      [artifactId]: { ...prev[artifactId], [label.name]: stems.size },
                    }));
                  }
                } catch {
                  // best-effort count
                }
              }),
            );
          }
        };
        own.forEach((d) => collect(d.artifact_id, d.labels));
        (shared.shared || []).forEach((d) => collect(d.artifact_id, d.labels));
        await Promise.all(jobs);
      } catch (err) {
        if (active) setError((err as Error).message || 'Failed to load datasets.');
      }
    })();

    return () => {
      active = false;
    };
  }, [artifactManager, server, user]);

  const handleCreateClick = () => {
    if (!user?.email) {
      onRequireLogin();
      return;
    }
    setShowCreateModal(true);
  };

  const openOwnDataset = (artifactId: string) => {
    navigate(`/colab/${toAlias(artifactId)}`);
  };

  const openSharedDataset = (dataset: SharedDatasetSummary) => {
    if (dataset.role === 'manager') {
      navigate(`/colab/${toAlias(dataset.artifact_id)}`);
    } else {
      setLabelDialogFor(dataset);
    }
  };

  const loading = ownDatasets === null && sharedDatasets === null;

  return (
    <div className="w-full max-w-5xl mx-auto px-4 py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Your annotation datasets</h1>
          <p className="text-sm text-gray-500 mt-1">Create a dataset, or open one shared with you.</p>
        </div>
        <button
          onClick={handleCreateClick}
          className="px-5 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl hover:from-purple-700 hover:to-pink-700 font-medium shadow-sm hover:shadow-md active:scale-[0.98] transition-all"
        >
          Create dataset
        </button>
      </div>

      {error && (
        <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <svg className="w-8 h-8 animate-spin text-purple-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Your datasets</h2>
            {ownDatasets && ownDatasets.length > 0 ? (
              <div className="grid grid-cols-1 gap-4">
                {ownDatasets.map((dataset) => (
                  <DatasetCard
                    key={dataset.artifact_id}
                    name={dataset.name}
                    description={dataset.description}
                    role="owner"
                    labels={dataset.labels}
                    labelCounts={labelCounts[dataset.artifact_id]}
                    onOpen={() => openOwnDataset(dataset.artifact_id)}
                  />
                ))}
              </div>
            ) : (
              <div className="text-sm text-gray-400 border border-dashed border-gray-200 rounded-xl p-6 text-center">
                No datasets yet. Create one to get started.
              </div>
            )}
          </section>

          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Shared with you</h2>
            {sharedDatasets && sharedDatasets.length > 0 ? (
              <div className="grid grid-cols-1 gap-4">
                {sharedDatasets.map((dataset) => (
                  <DatasetCard
                    key={dataset.artifact_id}
                    name={dataset.name}
                    role={dataset.role}
                    labels={dataset.labels}
                    labelCounts={labelCounts[dataset.artifact_id]}
                    onOpen={() => openSharedDataset(dataset)}
                  />
                ))}
              </div>
            ) : (
              <div className="text-sm text-gray-400 border border-dashed border-gray-200 rounded-xl p-6 text-center">
                No datasets have been shared with you yet.
              </div>
            )}
          </section>
        </div>
      )}

      {showCreateModal && (
        <CreateDatasetModal
          server={server}
          user={user}
          artifactManager={artifactManager}
          onClose={() => setShowCreateModal(false)}
          onCreated={(artifactId) => navigate(`/colab/${toAlias(artifactId)}`)}
        />
      )}

      {labelDialogFor && (
        <LabelSelectDialog
          artifactManager={artifactManager}
          artifactId={labelDialogFor.artifact_id}
          role={labelDialogFor.role}
          onClose={() => setLabelDialogFor(null)}
          onSelect={(label) => {
            const artifactId = labelDialogFor.artifact_id;
            setLabelDialogFor(null);
            navigate(`/colab/annotate?session_id=${encodeURIComponent(artifactId)}&label=${encodeURIComponent(label)}`);
          }}
        />
      )}
    </div>
  );
};

export default DatasetList;
