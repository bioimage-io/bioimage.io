import React from 'react';

const Navbar = () => {
  return (
    <nav className="bg-white shadow-sm">
      <div className="container mx-auto px-4">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center">
            <img 
              src="/logo.svg" 
              alt="BioImage Model Zoo" 
              className="h-8 w-8 mr-3"
            />
            <span className="font-semibold text-xl">BioImage Model Zoo</span>
          </div>
          <div className="hidden md:flex space-x-8">
            <NavLink>Models</NavLink>
            <NavLink>Applications</NavLink>
            <NavLink>Datasets</NavLink>
          </div>
        </div>
      </div>
    </nav>
  );
};

const NavLink = ({ children }: { children: React.ReactNode }) => (
  <a
    href="#"
    className="text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium"
  >
    {children}
  </a>
);

export default Navbar; 