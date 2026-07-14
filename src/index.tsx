import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

// Silence the benign "ResizeObserver loop" warnings some browsers emit when a
// resize callback triggers layout that doesn't settle within one frame (e.g.
// the Monaco editor / MUI re-measuring when a panel opens). Delivery is simply
// deferred to the next frame — nothing is broken — but CRA's dev error overlay
// treats every window error as fatal. Handle it in the capture phase so this
// runs before the overlay's listener and can stop it from surfacing.
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
