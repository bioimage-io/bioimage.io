import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const TermsOfService: React.FC = () => {
  const [content, setContent] = useState<string>('Loading...');

  useEffect(() => {
    fetch('https://raw.githubusercontent.com/ri-scale/model-hub/refs/heads/main/docs/terms_of_service.md')
      .then(response => response.text())
      .then(text => setContent(text))
      .catch(error => {
        console.error('Error fetching terms of service:', error);
        setContent('Error loading terms of service. Please try again later.');
      });
  }, []);

  return (
    <div className="max-w-4xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
      <h1 className="text-4xl font-bold mb-8 text-center text-gray-900">Terms of Service</h1>
      <div className="prose prose-blue max-w-none bg-white rounded-lg shadow-sm p-8">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    </div>
  );
};

export default TermsOfService; 