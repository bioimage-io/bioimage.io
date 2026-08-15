import React, { useState } from 'react';
import { BrokerRole, BrokerUserRef, DatasetWithRole } from './brokerApi';

export interface PendingAdd {
  user: BrokerUserRef;
  role: 'manager' | 'annotator';
}

export const userKey = (u: BrokerUserRef) => (u.email || u.id || '').toLowerCase();

const memberLabel = (u: BrokerUserRef) => u.email || u.id || 'Unknown user';

export interface SharingPanelProps {
  role: BrokerRole;
  dataset: DatasetWithRole;
  pendingAdds: PendingAdd[];
  pendingRemoves: BrokerUserRef[];
  pendingPublic: boolean | null;
  applying: boolean;
  applyError: string | null;
  onStageAdd: (user: BrokerUserRef, role: 'manager' | 'annotator') => void;
  onToggleRemove: (user: BrokerUserRef) => void;
  onUndoAdd: (user: BrokerUserRef) => void;
  onSetPendingPublic: (value: boolean) => void;
  onApply: () => void;
}

// §14 (colab-rework-plan.md): role/public changes are staged locally here and
// committed in one batched broker.update_sharing call from the parent
// ShareModal's Apply button, instead of firing setRole/removeUser/setPublic
// one action at a time. Only the owner can grant/revoke the manager role.
const SharingPanel: React.FC<SharingPanelProps> = ({
  role,
  dataset,
  pendingAdds,
  pendingRemoves,
  pendingPublic,
  applying,
  applyError,
  onStageAdd,
  onToggleRemove,
  onUndoAdd,
  onSetPendingPublic,
  onApply,
}) => {
  const isOwner = role === 'owner';
  const [addValue, setAddValue] = useState('');
  const [addRole, setAddRole] = useState<'manager' | 'annotator'>('annotator');

  const hasPendingChanges = pendingAdds.length > 0 || pendingRemoves.length > 0 || pendingPublic !== null;
  const isStagedForRemoval = (u: BrokerUserRef) => pendingRemoves.some((r) => userKey(r) === userKey(u));

  const handleAdd = () => {
    const value = addValue.trim();
    if (!value) return;
    const user: BrokerUserRef = value.includes('@') ? { email: value } : { id: value };
    onStageAdd(user, addRole);
    setAddValue('');
  };

  const renderMemberRow = (u: BrokerUserRef) => {
    const removed = isStagedForRemoval(u);
    return (
      <li
        key={userKey(u)}
        className={`flex items-center justify-between text-sm ${removed ? 'text-gray-400 line-through' : 'text-gray-700'}`}
      >
        <span className="truncate">{memberLabel(u)}</span>
        <button
          onClick={() => onToggleRemove(u)}
          disabled={applying}
          className="text-xs text-gray-400 hover:text-red-600 transition-colors shrink-0"
        >
          {removed ? 'Undo' : 'Remove'}
        </button>
      </li>
    );
  };

  const renderPendingAddRow = (p: PendingAdd) => (
    <li key={`pending-${userKey(p.user)}`} className="flex items-center justify-between text-sm text-purple-700">
      <span className="truncate">{memberLabel(p.user)} (pending)</span>
      <button
        onClick={() => onUndoAdd(p.user)}
        disabled={applying}
        className="text-xs text-gray-400 hover:text-red-600 transition-colors shrink-0"
      >
        Undo
      </button>
    </li>
  );

  const pendingManagerAdds = pendingAdds.filter((p) => p.role === 'manager');
  const pendingAnnotatorAdds = pendingAdds.filter((p) => p.role === 'annotator');

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">Sharing</h3>

      {applyError && (
        <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">{applyError}</div>
      )}

      <div className="mb-3">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Owner</p>
        <p className="text-sm text-gray-800">{memberLabel(dataset.owner)}</p>
      </div>

      {isOwner && (
        <div className="mb-3">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Managers</p>
          {dataset.managers.length === 0 && pendingManagerAdds.length === 0 ? (
            <p className="text-xs text-gray-400">None yet.</p>
          ) : (
            <ul className="space-y-1">
              {dataset.managers.map(renderMemberRow)}
              {pendingManagerAdds.map(renderPendingAddRow)}
            </ul>
          )}
        </div>
      )}

      <div className="mb-3">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Annotators</p>
        {dataset.annotators.length === 0 && pendingAnnotatorAdds.length === 0 ? (
          <p className="text-xs text-gray-400">None yet.</p>
        ) : (
          <ul className="space-y-1">
            {dataset.annotators.map(renderMemberRow)}
            {pendingAnnotatorAdds.map(renderPendingAddRow)}
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
          disabled={applying || !addValue.trim()}
          className="px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-300 text-sm font-medium transition-colors shrink-0"
        >
          Add
        </button>
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer mb-4">
        <input
          type="checkbox"
          checked={pendingPublic ?? dataset.public}
          disabled={applying}
          onChange={(e) => onSetPendingPublic(e.target.checked)}
          className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
        />
        Make publicly readable
      </label>

      <button
        onClick={onApply}
        disabled={applying || !hasPendingChanges}
        className="w-full px-3 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-300 text-sm font-medium transition-colors flex items-center justify-center gap-2"
      >
        {applying && (
          <svg className="w-3.5 h-3.5 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        )}
        {applying ? 'Applying, this takes a few seconds' : 'Apply'}
      </button>
    </div>
  );
};

export default SharingPanel;
