import React, { useState } from 'react';
import { BrokerRole, BrokerUserRef, DatasetWithRole, removeUser, setPublic, setRole } from './brokerApi';

export interface SharingPanelProps {
  server: any;
  artifactId: string;
  role: BrokerRole;
  dataset: DatasetWithRole;
  onChanged: () => void;
}

const memberLabel = (u: BrokerUserRef) => u.email || u.id || 'Unknown user';

// F4 (colab-rework-plan.md): role/public mutations all go through the
// broker (setRole/removeUser/setPublic), which is the source of truth for
// roles and mirrors the ACL server-side; the busy note reflects that this
// commits and re-stages the artifact under the hood, so it isn't instant.
// Only the owner can grant/revoke the manager role.
const SharingPanel: React.FC<SharingPanelProps> = ({ server, artifactId, role, dataset, onChanged }) => {
  const isOwner = role === 'owner';
  const [addValue, setAddValue] = useState('');
  const [addRole, setAddRole] = useState<'manager' | 'annotator'>('annotator');
  const [busy, setBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  const runBusy = async (message: string, fn: () => Promise<void>) => {
    setBusy(true);
    setBusyMessage(message);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError((err as Error).message || 'Failed to update sharing settings.');
    } finally {
      setBusy(false);
      setBusyMessage('');
    }
  };

  const handleAdd = () => {
    const value = addValue.trim();
    if (!value) return;
    const user: BrokerUserRef = value.includes('@') ? { email: value } : { id: value };
    runBusy('Applying permissions, this takes a few seconds', async () => {
      await setRole(server, artifactId, user, addRole);
      setAddValue('');
    });
  };

  const handleRemove = (user: BrokerUserRef) => {
    runBusy('Applying permissions, this takes a few seconds', async () => {
      await removeUser(server, artifactId, user);
    });
  };

  const handleTogglePublic = (checked: boolean) => {
    runBusy('Applying permissions, this takes a few seconds', async () => {
      await setPublic(server, artifactId, checked);
    });
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">Sharing</h3>

      {busy && (
        <div className="mb-3 flex items-center gap-2 text-xs text-purple-600 bg-purple-50 rounded-lg px-3 py-2">
          <svg className="w-3.5 h-3.5 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          {busyMessage}
        </div>
      )}

      {error && (
        <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">{error}</div>
      )}

      <div className="mb-3">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Owner</p>
        <p className="text-sm text-gray-800">{memberLabel(dataset.owner)}</p>
      </div>

      {isOwner && (
        <div className="mb-3">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Managers</p>
          {dataset.managers.length === 0 ? (
            <p className="text-xs text-gray-400">None yet.</p>
          ) : (
            <ul className="space-y-1">
              {dataset.managers.map((m) => (
                <li key={memberLabel(m)} className="flex items-center justify-between text-sm text-gray-700">
                  <span className="truncate">{memberLabel(m)}</span>
                  <button
                    onClick={() => handleRemove(m)}
                    disabled={busy}
                    className="text-xs text-gray-400 hover:text-red-600 transition-colors shrink-0"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mb-3">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Annotators</p>
        {dataset.annotators.length === 0 ? (
          <p className="text-xs text-gray-400">None yet.</p>
        ) : (
          <ul className="space-y-1">
            {dataset.annotators.map((a) => (
              <li key={memberLabel(a)} className="flex items-center justify-between text-sm text-gray-700">
                <span className="truncate">{memberLabel(a)}</span>
                <button
                  onClick={() => handleRemove(a)}
                  disabled={busy}
                  className="text-xs text-gray-400 hover:text-red-600 transition-colors shrink-0"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-2 mb-3">
        <input
          type="text"
          placeholder="User id or email"
          value={addValue}
          onChange={(e) => setAddValue(e.target.value)}
          className="flex-1 min-w-0 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
        />
        <select
          value={addRole}
          onChange={(e) => setAddRole(e.target.value as 'manager' | 'annotator')}
          className="px-2 py-1.5 text-sm border border-gray-300 rounded-lg"
        >
          <option value="annotator">Annotator</option>
          {isOwner && <option value="manager">Manager</option>}
        </select>
        <button
          onClick={handleAdd}
          disabled={busy || !addValue.trim()}
          className="px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-300 text-sm font-medium transition-colors shrink-0"
        >
          Add
        </button>
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
        <input
          type="checkbox"
          checked={dataset.public}
          disabled={busy}
          onChange={(e) => handleTogglePublic(e.target.checked)}
          className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
        />
        Make publicly readable
      </label>
    </div>
  );
};

export default SharingPanel;
