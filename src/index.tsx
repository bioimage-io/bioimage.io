import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

// Browsers emit "ResizeObserver loop completed with undelivered notifications"
// (and the older "loop limit exceeded" variant) when a resize callback triggers
// layout that doesn't settle within one frame — e.g. the Monaco editor / MUI /
// OpenLayers re-measuring on load. Delivery is simply deferred to the next
// frame; nothing is broken. CRA ships two dev overlays (react-error-overlay and
// webpack-dev-server-client-overlay) that surface it as a fatal error.
//
// Fix it at the source: defer every ResizeObserver callback into a
// requestAnimationFrame so it no longer runs inside the browser's observation
// step, which is what makes the loop "undeliverable". This prevents the error
// from ever being thrown, so neither overlay can catch it. The captured
// `entries` (with their contentRect) stay valid across the one-frame defer.
if (typeof window !== 'undefined' && typeof window.ResizeObserver !== 'undefined') {
  const NativeResizeObserver = window.ResizeObserver;
  window.ResizeObserver = class extends NativeResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      super((entries, observer) => {
        window.requestAnimationFrame(() => callback(entries, observer));
      });
    }
  };
}

// Belt-and-suspenders: also swallow the message if it still reaches the window
// error handler (capture phase, so it runs before the overlays' listeners).
const IGNORED_RESIZE_OBSERVER_ERRORS = [
  'ResizeObserver loop limit exceeded',
  'ResizeObserver loop completed with undelivered notifications',
];
window.addEventListener(
  'error',
  (event) => {
    if (event.message && IGNORED_RESIZE_OBSERVER_ERRORS.some((m) => event.message.includes(m))) {
      event.stopImmediatePropagation();
      event.preventDefault();
    }
  },
  true,
);

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
