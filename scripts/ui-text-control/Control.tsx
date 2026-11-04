// A comment with an em dash — this must NOT be flagged (comments are exempt).
/** JSDoc with an em dash — also exempt. */
import React from 'react';

export function Control() {
  const [err, setErr] = React.useState('');
  const [uploadStatus, setUploadStatus] = React.useState('');
  console.log('console log with an em dash — exempt');
  const internal = 'plain variable with an em dash — not a visible surface, exempt';
  setUploadStatus('status copy with an em dash — must be FLAGGED');
  setErr('plain setter name, not matching the setter shape — exempt');
  alert('alert copy with an em dash — must be FLAGGED');
  return (
    <div data-x="attr not on the allowlist — exempt">
      <p>JSX text with an em dash — must be FLAGGED</p>
      <p>JSX text with an en dash – in prose, must be FLAGGED</p>
      <p>Compact numeric range 5–95% is allowed, must NOT be flagged</p>
      <span title="title attr with an em dash — must be FLAGGED" />
      <span aria-label="aria-label with an en dash – in prose, must be FLAGGED" />
      <span placeholder={`template placeholder with an em dash — must be FLAGGED ${internal}`} />
      <div>{'JSX child literal with an em dash — must be FLAGGED'}</div>
      <div>{'escape hatch with an em dash — must NOT be flagged'}</div> {/* ui-text-check: allow */}
      <ul>{[1].map(i => <li key="key-with-em-dash—exempt">{i}</li>)}</ul>
      <span title="allow-listed line with an em dash — exempt" /> {/* ui-text-check: allow */}
      <p>{err}</p><p>{uploadStatus}</p>
    </div>
  );
}
