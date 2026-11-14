import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import CampaignDetail from './CampaignDetail';
import CampaignList from './CampaignList';
import CampaignProgress from './CampaignProgress';

/**
 * Route shell for the campaigns section, mounted at `/campaigns/*`.
 * Same shape as ColabPage, which owns `/colab/*`.
 */
const CampaignsPage: React.FC = () => (
  <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50/30 to-purple-50/30">
    <Routes>
      <Route index element={<CampaignList />} />
      <Route path=":campaignId" element={<CampaignDetail />} />
      <Route path=":campaignId/progress" element={<CampaignProgress />} />
      <Route path="*" element={<Navigate to="/campaigns" replace />} />
    </Routes>
  </div>
);

export default CampaignsPage;
