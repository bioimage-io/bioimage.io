import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { 
  MagnifyingGlassIcon, 
  FunnelIcon, 
  DocumentTextIcon, 
  CloudArrowUpIcon,
  UserCircleIcon,
  TagIcon,
  CodeBracketIcon,
  BookOpenIcon,
  ShieldCheckIcon
} from '@heroicons/react/24/outline';

const Docs: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'browsing' | 'uploading'>('browsing');

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 min-h-[calc(100vh-64px)]">
      <div className="mb-10 text-center sm:text-left">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">Documentation</h1>
        <p className="text-gray-600 text-lg max-w-3xl">
          Welcome to the RI-SCALE Model Hub user guide. Learn how to discover standardized AI models 
          or contribute your own to the community.
        </p>
      </div>

      {/* Tabs Navigation */}
      <div className="flex justify-center sm:justify-start mb-8 border-b border-gray-200">
        <nav className="-mb-px flex space-x-8" aria-label="Tabs">
          <button
            onClick={() => setActiveTab('browsing')}
            className={`
              whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors
              ${activeTab === 'browsing'
                ? 'border-ri-orange text-ri-orange'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}
            `}
          >
            <MagnifyingGlassIcon className="h-5 w-5" />
            Browsing Models
          </button>
          <button
            onClick={() => setActiveTab('uploading')}
            className={`
              whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors
              ${activeTab === 'uploading'
                ? 'border-ri-orange text-ri-orange'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}
            `}
          >
            <CloudArrowUpIcon className="h-5 w-5" />
            Uploading & Sharing
          </button>
        </nav>
      </div>

      {/* Content Area */}
      <div className="grid gap-8">
        {activeTab === 'browsing' ? (
          <div className="space-y-8 fade-in">
             <section className="bg-white border border-gray-200 rounded-xl p-6 sm:p-8 shadow-sm">
                <div className="flex items-start gap-4">
                   <div className="hidden sm:flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-orange-50 text-ri-orange">
                      <MagnifyingGlassIcon className="h-6 w-6" />
                   </div>
                   <div>
                      <h2 className="text-xl font-semibold text-gray-900 mb-2">Search and Discovery</h2>
                      <p className="text-gray-600 mb-6">
                         The Model Hub provides a powerful search interface to help you find the right model for your research.
                      </p>
                      <ul className="space-y-4">
                         <li className="flex gap-3">
                            <div className="flex-none pt-1">
                               <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-xs font-medium text-gray-600">1</span>
                            </div>
                            <div>
                               <strong className="font-medium text-gray-900">Smart Search</strong>
                               <p className="text-gray-500 text-sm mt-0.5">
                                  Use the search bar on the home page to find models by name, description, or keywords.
                               </p>
                            </div>
                         </li>
                         <li className="flex gap-3">
                            <div className="flex-none pt-1">
                               <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-xs font-medium text-gray-600">2</span>
                            </div>
                            <div>
                               <strong className="font-medium text-gray-900">Tag Filtering</strong>
                               <p className="text-gray-500 text-sm mt-0.5">
                                  Filter models by specific tasks (e.g., <span className="bg-gray-100 px-1.5 py-0.5 rounded text-xs text-gray-700">segmentation</span>, <span className="bg-gray-100 px-1.5 py-0.5 rounded text-xs text-gray-700">restoration</span>) or modalities.
                               </p>
                            </div>
                         </li>
                      </ul>
                   </div>
                </div>
             </section>

             <section className="bg-white border border-gray-200 rounded-xl p-6 sm:p-8 shadow-sm">
                <div className="flex items-start gap-4">
                   <div className="hidden sm:flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-orange-50 text-ri-orange">
                      <DocumentTextIcon className="h-6 w-6" />
                   </div>
                   <div>
                      <h2 className="text-xl font-semibold text-gray-900 mb-2">Model Details</h2>
                      <p className="text-gray-600 mb-4">
                         Clicking on a model card opens its detailed view, where you can access:
                      </p>
                      <div className="grid sm:grid-cols-2 gap-4">
                         <div className="p-4 bg-gray-50 rounded-lg border border-gray-100">
                             <h4 className="font-medium text-gray-900 mb-1">Metadata</h4>
                             <p className="text-sm text-gray-500">Full description, authors, license, and citations.</p>
                         </div>
                         <div className="p-4 bg-gray-50 rounded-lg border border-gray-100">
                             <h4 className="font-medium text-gray-900 mb-1">Files</h4>
                             <p className="text-sm text-gray-500">Direct download links for model weights and configuration.</p>
                         </div>
                         <div className="p-4 bg-gray-50 rounded-lg border border-gray-100">
                             <h4 className="font-medium text-gray-900 mb-1">Versioning</h4>
                             <p className="text-sm text-gray-500">Access to previous versions of the model.</p>
                         </div>
                      </div>
                   </div>
                </div>
             </section>
          </div>
        ) : (
          <div className="space-y-8 fade-in">
             <section className="bg-gray-900 text-white rounded-xl p-8 shadow-md">
                 <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
                     <div>
                        <h2 className="text-2xl font-bold mb-2">Contribute to the Hub</h2>
                        <p className="text-gray-300">
                           Share your AI models with the research community. It only takes a few steps.
                        </p>
                     </div>
                     <Link to="/upload" className="px-6 py-3 bg-ri-orange hover:bg-white hover:text-ri-orange text-white font-semibold rounded-lg transition-colors whitespace-nowrap">
                        Start Uploading
                     </Link>
                 </div>
             </section>

             <div className="grid sm:grid-cols-3 gap-6">
                <div className="border border-gray-200 rounded-xl p-6 hover:border-ri-orange/50 transition-colors">
                   <div className="h-10 w-10 bg-gray-100 text-gray-600 rounded-lg flex items-center justify-center mb-4">
                      <UserCircleIcon className="h-6 w-6" />
                   </div>
                   <h3 className="font-semibold text-gray-900 mb-2">1. Authenticate</h3>
                   <p className="text-gray-600 text-sm">
                      Log in using your RI-SCALE credentials via Hypha to access upload features.
                   </p>
                </div>
                <div className="border border-gray-200 rounded-xl p-6 hover:border-ri-orange/50 transition-colors">
                   <div className="h-10 w-10 bg-gray-100 text-gray-600 rounded-lg flex items-center justify-center mb-4">
                      <TagIcon className="h-6 w-6" />
                   </div>
                   <h3 className="font-semibold text-gray-900 mb-2">2. Add Metadata</h3>
                   <p className="text-gray-600 text-sm">
                      Provide a name, description, and relevant tags to help others discover your model.
                   </p>
                </div>
                <div className="border border-gray-200 rounded-xl p-6 hover:border-ri-orange/50 transition-colors">
                   <div className="h-10 w-10 bg-gray-100 text-gray-600 rounded-lg flex items-center justify-center mb-4">
                      <CloudArrowUpIcon className="h-6 w-6" />
                   </div>
                   <h3 className="font-semibold text-gray-900 mb-2">3. Upload Files</h3>
                   <p className="text-gray-600 text-sm">
                      Upload your model weights, configuration files, and sample data.
                   </p>
                </div>
             </div>

             <section className="bg-orange-50 border border-orange-100 rounded-xl p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
                   <ShieldCheckIcon className="h-5 w-5 text-ri-orange" />
                   Quality & Standards
                </h3>
                <p className="text-gray-700 text-sm leading-relaxed">
                   All uploaded models undergo a validation process to ensure they contain necessary metadata and file structures. 
                   We encourage providing comprehensive descriptions to foster trust and reproducibility.
                </p>
             </section>
          </div>
        )}
      </div>

      {/* Footer / Additional Resources (Visible on both tabs) */}
      <div className="mt-16 pt-10 border-t border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900 mb-6">Additional Resources</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
           <Link to="/api" className="group p-4 border border-gray-200 rounded-lg hover:border-ri-orange hover:shadow-sm transition-all">
              <div className="flex items-center justify-between mb-2">
                 <CodeBracketIcon className="h-6 w-6 text-gray-400 group-hover:text-ri-orange transition-colors" />
                 <span className="text-ri-orange text-sm opacity-0 group-hover:opacity-100 transition-opacity">View &rarr;</span>
              </div>
              <h3 className="font-medium text-gray-900">API Documentation</h3>
              <p className="text-sm text-gray-500 mt-1">Programmatic access guide.</p>
           </Link>

           <Link to="/about" className="group p-4 border border-gray-200 rounded-lg hover:border-ri-orange hover:shadow-sm transition-all">
              <div className="flex items-center justify-between mb-2">
                 <BookOpenIcon className="h-6 w-6 text-gray-400 group-hover:text-ri-orange transition-colors" />
                 <span className="text-ri-orange text-sm opacity-0 group-hover:opacity-100 transition-opacity">Read &rarr;</span>
              </div>
              <h3 className="font-medium text-gray-900">About Project</h3>
              <p className="text-sm text-gray-500 mt-1">Background and partners.</p>
           </Link>

           <Link to="/toc" className="group p-4 border border-gray-200 rounded-lg hover:border-ri-orange hover:shadow-sm transition-all">
              <div className="flex items-center justify-between mb-2">
                 <ShieldCheckIcon className="h-6 w-6 text-gray-400 group-hover:text-ri-orange transition-colors" />
                 <span className="text-ri-orange text-sm opacity-0 group-hover:opacity-100 transition-opacity">Review &rarr;</span>
              </div>
              <h3 className="font-medium text-gray-900">Terms of Service</h3>
              <p className="text-sm text-gray-500 mt-1">Usage guidelines and policies.</p>
           </Link>
        </div>
      </div>
    </div>
  );
};

export default Docs;