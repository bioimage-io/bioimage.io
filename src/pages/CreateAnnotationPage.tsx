import React, { useEffect } from 'react';
import Upload from '../components/Upload';
import { useLocation, useNavigate } from 'react-router-dom';

const CreateAnnotationPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { files } = location.state || {};

  useEffect(() => {
    // If no files were passed, redirect back to annotations page
    if (!files) {
      navigate('/annotations');
    }
  }, [files, navigate]);

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="py-6">
          <h1 className="text-2xl font-semibold text-gray-900">
            New Annotation Project
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Set up your annotation project and configure settings
          </p>
        </div>
        <Upload 
          type="annotation" 
          initialFiles={files}
        />
      </div>
    </div>
  );
};

export default CreateAnnotationPage; 