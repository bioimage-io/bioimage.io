import React from 'react';
import Navbar from 'components/Navbar';
import ModelGrid from 'components/ModelGrid';

function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="container mx-auto px-4 py-8">
        <header className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900">BioImage Model Zoo</h1>
          <p className="mt-2 text-xl text-gray-600">
            Discover, share, and use bioimage analysis models
          </p>
        </header>
        <ModelGrid />
      </main>
    </div>
  );
}

export default App;
