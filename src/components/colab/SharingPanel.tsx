import React, { useState } from 'react';
import { AccessRequest, BrokerRole, BrokerUserRef, DatasetWithRole, dismissAccessRequest } from './brokerApi';

export interface PendingAdd {
  user: BrokerUserRef;
  role: 'manager' | 'annotator';
}

export const userKey = (u: BrokerUserRef) => (u.email || u.id || '').toLowerCase();

const memberLabel = (u: BrokerUserRef) => u.email || u.id || 'Unknown user';

/**
 * One pending access request: pre-filled email, a role picker, and
 * Add/Dismiss actions. Add stages the grant into the shared `pendingAdds`
 * batch (§14 item 2) so it lands in the same `update_sharing` call as any
 * other Sharing-box edit. Dismiss stays an immediate call: it only clears
 * the request and isn't part of the ACL batch.
 */
const AccessRequestRow: React.FC<{
  server: any;
  artifactId: string;
  request: AccessRequest;
  isOwner: boolean;
  pendingAdds: PendingAdd[];
  onStageAdd: (user: BrokerUserRef, role: 'manager' | 'annotator') => void;
  onUndoAdd: (user: BrokerUserRef) => void;
  onDismissed: () => void;
}> = ({ server, artifactId, request, isOwner, pendingAdds, onStageAdd, onUndoAdd, onDismissed }) => {
  const defaultRole = request.requested_role === 'manager' && isOwner ? 'manager' : 'annotator';
  const [selectedRole, setSelectedRole] = useState<'manager' | 'annotator'>(defaultRole);
  const [dismissing, setDismissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const staged = pendingAdds.find((p) => userKey(p.user) === request.email.toLowerCase());

  const handleAdd = () => {
    onStageAdd({ email: request.email }, selectedRole);
  };

  const handleUndo = () => {
    onUndoAdd({ email: request.email });
  };

  const handleDismiss = async () => {
    setDismissing(true);
    setError(null);
    try {
      await dismissAccessRequest(server, artifactId, { email: request.email });
      onDismissed();
    } catch (err) {
      setError((err as Error).message || 'Failed to dismiss request.');
      setDismissing(false);
    }
  };

  if (staged) {
    return (
      <li className="py-2">
        <div className="flex items-center gap-2">
          <span className="flex-1 min-w-0 truncate text-sm text-purple-700">
            {request.email} will be added as {staged.role}
          </span>
          <button onClick={handleUndo} className="text-xs text-gray-400 hover:text-red-600 transition-colors shrink-0">
            Undo
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="py-2">
      <div className="flex items-center gap-2">
        <span className="flex-1 min-w-0 truncate text-sm text-gray-800">{request.email}</span>
        <select
          value={selectedRole}
          onChange={(e) => setSelectedRole(e.target.value as 'manager' | 'annotator')}
          disabled={dismissing}
          className="px-2 py-1.5 text-sm border border-gray-300 rounded-lg"
        >
          <option value="annotator">Annotator</option>
          {isOwner && <option value="manager">Manager</option>}
        </select>
        <button
          onClick={handleAdd}
          disabled={dismissing}
          className="px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-300 text-sm font-medium transition-colors shrink-0"
        >
          Add
        </button>
        <button
          onClick={handleDismiss}
          disabled={dismissing}
          className="text-xs text-gray-400 hover:text-red-600 transition-colors shrink-0"
        >
          {dismissing ? 'Dismissing...' : 'Dismiss'}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </li>
  );
};

const AccessRequestsSection: React.FC<{
  server: any;
  artifactId: string;
  role: BrokerRole;
  requests: AccessRequest[];
  pendingAdds: PendingAdd[];
  onStageAdd: (user: BrokerUserRef, role: 'manager' | 'annotator') => void;
  onUndoAdd: (user: BrokerUserRef) => void;
  onDismissed: () => void;
}> = ({ server, artifactId, role, requests, pendingAdds, onStageAdd, onUndoAdd, onDismissed }) => {
  if (requests.length === 0) return null;
  const isOwner = role === 'owner';
  return (
    <div className="mb-3 border-t border-gray-100 pt-3">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Pending access requests</p>
      <p className="text-xs text-gray-500 mb-2">
        Add stages the selected role for the next Apply. Dismiss clears the request immediately without granting
        access.
      </p>
      <ul className="divide-y divide-gray-100">
        {requests.map((req) => (
          <AccessRequestRow
            key={req.id || req.email}
            server={server}
            artifactId={artifactId}
            request={req}
            isOwner={isOwner}
            pendingAdds={pendingAdds}
            onStageAdd={onStageAdd}
            onUndoAdd={onUndoAdd}
            onDismissed={onDismissed}
          />
        ))}
      </ul>
    </div>
  );
};

export interface SharingPanelProps {
  server: any;
  artifactId: string;
  role: BrokerRole;
  dataset: DatasetWithRole;
  accessRequests: AccessRequest[];
  pendingAdds: PendingAdd[];
  pendingRemoves: BrokerUserRef[];
  pendingPublic: boolean | null;
  applying: boolean;
  onStageAdd: (user: BrokerUserRef, role: 'manager' | 'annotator') => void;
  onToggleRemove: (user: BrokerUserRef) => void;
  onUndoAdd: (user: BrokerUserRef) => void;
  onSetPendingPublic: (value: boolean) => void;
  onAccessRequestDismissed: () => void;
}

// §14 (colab-rework-plan.md): role/public changes are staged locally here and
// committed in one batched broker.update_sharing call from the parent
// ShareModal's Apply button (moved to the modal footer, §22 item 5), instead
// of firing setRole/removeUser/setPublic one action at a time. Only the
// owner can grant/revoke the manager role. Pending access requests live in
// this same box (§22 item 4), directly below the member lists.
const SharingPanel: React.FC<SharingPanelProps> = ({
  server,
  artifactId,
  role,
  dataset,
  accessRequests,
  pendingAdds,
  pendingRemoves,
  pendingPublic,
  applying,
  onStageAdd,
  onToggleRemove,
  onUndoAdd,
  onSetPendingPublic,
  onAccessRequestDismissed,
}) => {
  const isOwner = role === 'owner';
  const [addValue, setAddValue] = useState('');
  const [addRole, setAddRole] = useState<'manager' | 'annotator'>('annotator');

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

      <AccessRequestsSection
        server={server}
        artifactId={artifactId}
        role={role}
        requests={accessRequests}
        pendingAdds={pendingAdds}
        onStageAdd={onStageAdd}
        onUndoAdd={onUndoAdd}
        onDismissed={onAccessRequestDismissed}
      />

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

      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
        <input
          type="checkbox"
          checked={pendingPublic ?? dataset.public}
          disabled={applying}
          onChange={(e) => onSetPendingPublic(e.target.checked)}
          className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
        />
        Make publicly readable
      </label>
    </div>
  );
};

export default SharingPanel;
