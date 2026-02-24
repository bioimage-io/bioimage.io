import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useComparison } from '../hooks/useComparison';

const ComparePage: React.FC = () => {
  const navigate = useNavigate();
  const { selectedIds, toggleSelection, clearSelection } = useComparison();

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 py-12 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center shadow-md p-1.5">
              <img src="/bioengine-icon.svg" alt="BioEngine" className="w-10 h-10" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Model Comparison</h1>
          <p className="text-gray-600 text-lg">
            Image-based model screening powered by BioEngine
          </p>
        </div>

        {/* Status banner */}
        <div className="bg-yellow-50 border-2 border-yellow-200 rounded-2xl p-4 mb-8 text-center">
          <p className="text-yellow-800 font-medium">
            🚧 Comparison interface coming soon. Stay tuned!
          </p>
        </div>

        {/* Selected models list */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">
            Selected Models{' '}
            <span className="text-sm font-normal text-gray-500">
              ({selectedIds.length} / 6)
            </span>
          </h2>

          {selectedIds.length === 0 ? (
            <p className="text-gray-500 text-sm">No models selected for comparison.</p>
          ) : (
            <ul className="space-y-2">
              {selectedIds.map((id) => (
                <li
                  key={id}
                  className="flex items-center justify-between bg-blue-50 border border-blue-100 rounded-xl px-4 py-2"
                >
                  <span className="text-blue-800 font-mono text-sm">{id.split('/').pop()}</span>
                  <button
                    onClick={() => toggleSelection(id)}
                    className="text-xs text-blue-400 hover:text-red-500 transition-colors ml-4"
                    aria-label={`Remove ${id.split('/').pop()}`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          {selectedIds.length > 0 && (
            <button
              onClick={clearSelection}
              className="mt-4 text-sm text-red-500 hover:text-red-700 transition-colors"
            >
              Deselect all
            </button>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={() => navigate('/models')}
            className="px-6 py-3 border-2 border-blue-300 text-blue-600 font-semibold rounded-xl hover:bg-blue-50 transition-all duration-200"
          >
            ← Back to Models
          </button>
        </div>
      </div>
    </div>
  );
};

export default ComparePage;
