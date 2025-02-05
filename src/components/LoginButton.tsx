import { useState, useEffect } from 'react';
import { useHyphaStore } from '../store/hyphaStore';
import type { LoginConfig } from 'hypha-rpc';
import { UserCircleIcon, ArrowRightOnRectangleIcon } from '@heroicons/react/24/outline';

interface LoginButtonProps {
  className?: string;
}

const serverUrl = "https://hypha.aicell.io";

// Move token logic outside of component
const getSavedToken = () => {
  const token = localStorage.getItem("token");
  if (token) {
    const tokenExpiry = localStorage.getItem("tokenExpiry");
    if (tokenExpiry && new Date(tokenExpiry) > new Date()) {
      return token;
    }
  }
  return null;
};

export default function LoginButton({ className = '' }: LoginButtonProps) {
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const { client, user, setUser, setServer } = useHyphaStore();

  // Add click outside handler to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const dropdown = document.getElementById('user-dropdown');
      if (dropdown && !dropdown.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Add logout handler
  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('tokenExpiry');
    setUser(null);
    setServer(null);
    setIsDropdownOpen(false);
  };

  const loginCallback = (context: { login_url: string }) => {
    window.open(context.login_url);
  };

  const login = async () => {
    if (!client) {
      console.error('Hypha client not initialized');
      return null;
    }

    const config: LoginConfig = {
      server_url: serverUrl,
      login_callback: loginCallback,
    };

    try {
      const token = await client.login(config);
      localStorage.setItem("token", token);
      localStorage.setItem("tokenExpiry", new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString());
      return token;
    } catch (error) {
      console.error('Login failed:', error);
      return null;
    }
  };

  const handleLogin = async () => {
    if (!client) {
      console.error('Hypha client not initialized');
      return;
    }
    
    setIsLoggingIn(true);
    try {
      let token = getSavedToken();
      if (token) {
        console.log("Using saved token.");
      } else {
        token = await login();
        if (!token) {
          throw new Error('Failed to obtain token');
        }
      }

      const server = await client.connectToServer({
        server_url: serverUrl,
        token: token,
      });
      setServer(server);
      setUser(server.config.user);
      console.log("Logged in as:", server.config.user);
    } catch (error) {
      console.error("Error connecting to server:", error);
      // Clear token and tokenExpiry
      localStorage.setItem("token", "");
      localStorage.setItem("tokenExpiry", "");
      // Don't retry automatically to avoid infinite loops
      setIsLoggingIn(false);
    } finally {
      setIsLoggingIn(false);
    }
  };

  useEffect(() => {
    const savedToken = getSavedToken();
    if (savedToken && client) {
      handleLogin();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]); // We're intentionally only running this on client changes

  return (
    <div className={className}>
      {user?.email ? (
        <div className="relative">
          <button
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="text-gray-700 hover:text-gray-900 focus:outline-none"
          >
            <UserCircleIcon className="h-6 w-6" />
          </button>
          
          {/* Dropdown Menu */}
          {isDropdownOpen && (
            <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg py-1 z-50 border border-gray-200">
              <div className="px-4 py-2 text-sm text-gray-700 border-b border-gray-200">
                {user.email}
              </div>
              <a
                href="/profile"
                className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
              >
                Profile
              </a>
              <button
                onClick={handleLogout}
                className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
              >
                Logout
              </button>
            </div>
          )}
        </div>
      ) : (
        <button
          className="bg-blue-500 text-white px-10 py-2 rounded-md hover:bg-blue-600 transition-colors flex items-center justify-center"
          onClick={handleLogin}
          disabled={isLoggingIn}
        >
          {isLoggingIn ? (
            <svg className="animate-spin h-5 w-5 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          ) : (
            <ArrowRightOnRectangleIcon className="h-5 w-5 mr-2" />
          )}
          {isLoggingIn ? 'Logging in...' : 'Login'}
        </button>
      )}
    </div>
  );
} 