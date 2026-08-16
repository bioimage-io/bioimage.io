import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DatasetLabelRef,
  DatasetSummaryBasic,
  discoverLabels,
  getAnnotatedStems,
  listMyDatasetsBasic,
  pLimit,
  toAlias,
} from './datasetApi';
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
//
// §23.4 item 5: cards render as soon as name + description are known (phase
// 1), then each card hydrates its own labels and per-label annotation-file
// counts independently (phase 2) behind a skeleton, never blocking on the
// slowest dataset in the list. Own datasets need a per-artifact label-
// discovery call (`ownLabels` starts undefined = loading); the broker
// already bundles labels into its single "shared with you" call, so that
// column only has counts left to hydrate.
const DatasetList: React.FC<DatasetListProps> = ({ user, server, artifactManager, onRequireLogin }) => {
  const navigate = useNavigate();

  const [ownDatasets, setOwnDatasets] = useState<DatasetSummaryBasic[] | null>(null);
  const [ownLabels, setOwnLabels] = useState<Record<string, DatasetLabelRef[]>>({});
  const [sharedDatasets, setSharedDatasets] = useState<SharedDatasetSummary[] | null>(null);
  const [labelCounts, setLabelCounts] = useState<Record<string, Record<string, number>>>({});
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [labelDialogFor, setLabelDialogFor] = useState<SharedDatasetSummary | null>(null);

  useEffect(() => {
    let active = true;
    const limit = pLimit(4);
    const collectLabelCounts = (artifactId: string, labels: Array<{ name: string }>) =>
      Promise.all(
        labels.map((label) =>
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
        ),
      );

    // Each column resolves independently so "Your datasets" and "Shared with
    // you" each show their own spinner only while that column's own fetch is
    // in flight, instead of a single joint spinner gating both
    // (colab-rework-plan.md §21 item 3).
    (async () => {
      try {
        const own = await listMyDatasetsBasic(artifactManager, user);
        if (!active) return;
        setOwnDatasets(own);
        // Phase 2: each dataset's labels (and, once known, its label
        // counts) hydrate independently — one slow `discoverLabels` call
        // never holds up the rest of the column.
        own.forEach((d) => {
          limit(async () => {
            let labels: DatasetLabelRef[] = [];
            try {
              labels = await discoverLabels(artifactManager, d.artifact_id);
            } catch {
              // best-effort
            }
            if (!active) return;
            setOwnLabels((prev) => ({ ...prev, [d.artifact_id]: labels }));
            await collectLabelCounts(d.artifact_id, labels);
          });
        });
      } catch (err) {
        if (active) setError((err as Error).message || 'Failed to load your datasets.');
      }
    })();

    (async () => {
      try {
        const shared = server ? await listSharedDatasets(server).catch(() => ({ shared: [] })) : { shared: [] };
        if (!active) return;
        const sharedList = shared.shared || [];
        setSharedDatasets(sharedList);
        sharedList.forEach((d) => {
          limit(() => collectLabelCounts(d.artifact_id, d.labels));
        });
      } catch (err) {
        if (active) setError((err as Error).message || 'Failed to load shared datasets.');
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

  const ownLoading = ownDatasets === null;
  const sharedLoading = sharedDatasets === null;

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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Your datasets</h2>
          {ownLoading ? (
            <div className="flex items-center justify-center py-16">
              <svg className="w-8 h-8 animate-spin text-purple-600" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          ) : ownDatasets && ownDatasets.length > 0 ? (
            <div className="grid grid-cols-1 gap-4">
              {ownDatasets.map((dataset) => (
                <DatasetCard
                  key={dataset.artifact_id}
                  name={dataset.name}
                  description={dataset.description}
                  role="owner"
                  labels={ownLabels[dataset.artifact_id] ?? []}
                  labelsLoading={ownLabels[dataset.artifact_id] === undefined}
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
          {sharedLoading ? (
            <div className="flex items-center justify-center py-16">
              <svg className="w-8 h-8 animate-spin text-purple-600" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          ) : sharedDatasets && sharedDatasets.length > 0 ? (
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

      {showCreateModal && (
        <CreateDatasetModal
          server={server}
          user={user}
          artifactManager={artifactManager}
          onClose={() => setShowCreateModal(false)}
          onCreated={(artifactId, folderHandle) =>
            navigate(`/colab/${toAlias(artifactId)}`, { state: { folderHandle } })
          }
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
