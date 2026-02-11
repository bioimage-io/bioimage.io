import React, { useEffect, useState } from 'react';
import { partnerService, Partner } from '../services/partnerService';

const PartnersPage = () => {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPartners = async () => {
      try {
        const data = await partnerService.fetchPartners();
        setPartners(data);
      } catch (error) {
        console.error('Failed to fetch partners:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchPartners();
  }, []);

  const getPartnerById = (id: string) => partners.find(p => p.id === id);

  const coordinatorId = 'egi';
  const researchInfraIds = ['is_enes', 'eiscat_3d', 'bbmri_eric', 'euro_bioimaging_eric'];
  const digitalInfraIds = ['slices_ri', 't_bi_tak', 'tu_wien'];
  
  const coordinator = getPartnerById(coordinatorId);
  const researchInfras = researchInfraIds.map(id => getPartnerById(id)).filter((p): p is Partner => !!p);
  const digitalInfras = digitalInfraIds.map(id => getPartnerById(id)).filter((p): p is Partner => !!p);
  
  if (loading) {
     return (
        <div className="flex justify-center items-center h-screen bg-white">
          <div className="animate-spin rounded-full h-12 w-12 border-2 border-gray-100 border-t-ri-orange"></div>
        </div>
      );
  }

  const PartnerCard = ({ partner }: { partner: Partner }) => (
    <a 
      href={partner.link} 
      target="_blank" 
      rel="noopener noreferrer"
      className="flex flex-col items-center p-6 bg-white rounded-lg shadow-sm hover:shadow-md transition-all duration-200 border border-gray-100 hover:border-ri-orange group h-full"
    >
      <div className="h-24 w-full flex items-center justify-center mb-4">
        <img 
            src={partner.icon} 
            alt={partner.name} 
            className="max-h-full max-w-full object-contain filter grayscale group-hover:grayscale-0 transition-all duration-300"
            onError={(e) => {
                const img = e.target as HTMLImageElement;
                if (img.src !== window.location.origin + '/static/img/ri-scale-alt-logo.png') {
                    img.src = window.location.origin + '/static/img/ri-scale-alt-logo.png';
                }
            }}
        />
      </div>
      <h3 className="text-sm font-semibold text-gray-800 text-center mt-auto group-hover:text-ri-orange transition-colors">{partner.name}</h3>
    </a>
  );

  return (
    <div className="min-h-screen bg-white py-12">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h1 className="text-4xl font-extrabold text-ri-black sm:text-5xl md:text-6xl mb-6">
            Partners
          </h1>
          <div className="w-24 h-1.5 bg-ri-orange mx-auto mb-8"></div>
          <p className="mt-4 max-w-2xl mx-auto text-xl text-gray-500">
            RI-SCALE brings together a powerful and multidisciplinary consortium of Research Infrastructures, digital infrastructure providers, academic institutions, and industry innovators.
          </p>
        </div>

        {/* Coordinator Section */}
        {coordinator && (
          <div className="mb-20">
            <h2 className="text-2xl font-bold text-ri-black mb-8 border-b border-gray-100 pb-4">Coordinator</h2>
            <div className="flex justify-start">
                <div className="w-full max-w-xs">
                    <PartnerCard partner={coordinator} />
                </div>
            </div>
          </div>
        )}

        {/* Research Infrastructures Section */}
        {researchInfras.length > 0 && (
          <div className="mb-20">
            <h2 className="text-2xl font-bold text-ri-black mb-8 border-b border-gray-100 pb-4">Research Infrastructures</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
              {researchInfras.map(partner => (
                <PartnerCard key={partner.id} partner={partner} />
              ))}
            </div>
          </div>
        )}

        {/* Digital and Compute Infrastructures Section */}
        {digitalInfras.length > 0 && (
          <div className="mb-20">
            <h2 className="text-2xl font-bold text-ri-black mb-8 border-b border-gray-100 pb-4">Digital and Compute Infrastructures</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
              {digitalInfras.map(partner => (
                <PartnerCard key={partner.id} partner={partner} />
              ))}
            </div>
          </div>
        )}

        {/* All Partners Section */}
        <div className="mb-16">
          <h2 className="text-2xl font-bold text-ri-black mb-8 border-b border-gray-100 pb-4">All Partners</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
            {partners.map(partner => (
              <PartnerCard key={`all-${partner.id}`} partner={partner} />
            ))}
          </div>
        </div>

      </div>
    </div>
  );
};

export default PartnersPage;
