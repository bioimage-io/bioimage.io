import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

// The benign "ResizeObserver loop completed with undelivered notifications"
// error is eliminated at the source by an inline patch in public/index.html
// (it must run before the app bundle so libraries that capture ResizeObserver
// at import time also get the wrapped version). This capture-phase handler is a
// belt-and-suspenders backstop in case the message still reaches the window
// error handler — it runs before the dev overlays' listeners.
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
