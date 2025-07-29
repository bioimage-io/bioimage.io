import { useState, useEffect, useCallback } from 'react';
import { useHyphaStore } from '../store/hyphaStore';
import { UserCircleIcon } from '@heroicons/react/24/outline';
import { RiLoginBoxLine } from 'react-icons/ri';
import { Link, useLocation } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { Spinner } from './Spinner';

interface User {
  email: string;
  roles?: string[];
}

interface LoginButtonProps {
  className?: string;
}

interface LoginConfig {
  server_url: string;
  login_callback: (context: { login_url: string }) => void;
}

const serverUrl = "https://hypha.aicell.io";

// Define key for sessionStorage
const REDIRECT_PATH_KEY = 'redirectPath';

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
  const { client, user, connect, setUser, server, isConnecting, isConnected, logout } = useHyphaStore();
  const navigate = useNavigate();
  const location = useLocation(); // Get location

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
  const handleLogout = async () => {
    try {
      // Clear any auth tokens or user data from localStorage and sessionStorage
      localStorage.removeItem('token');
      localStorage.removeItem('tokenExpiry'); // Ensure expiry is also removed
      localStorage.removeItem('user'); // Keep if used elsewhere, otherwise remove
      sessionStorage.removeItem(REDIRECT_PATH_KEY); // Clear redirect path on logout
      
      // Perform logout logic - this will clear all connection state
      logout();
      setIsDropdownOpen(false);
      
      // Optionally redirect to home page
      navigate('/');
    } catch (error) {
      console.error('Error during logout:', error);
    }
  };

  const loginCallback = (context: { login_url: string }) => {
    window.open(context.login_url);
  };

  const login = async () => {
    const config: LoginConfig = {
      server_url: serverUrl,
      login_callback: loginCallback,
    };

    try {
      // Add check for client nullability (fixes linter error)
      if (!client) {
        throw new Error('Hypha client is not initialized');
      }
      const token = await client.login(config);
      localStorage.setItem("token", token);
      localStorage.setItem("tokenExpiry", new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString());
      return token;
    } catch (error) {
      console.error('Login failed:', error);
      return null;
    }
  };

  const handleLogin = useCallback(async () => {
    // Store the intended path BEFORE initiating login
    // Use location.pathname for BrowserRouter or location.hash for HashRouter
    // Assuming HashRouter based on snippet's use of location.hash
    const currentPath = location.pathname !== '/' ? location.pathname + location.search + location.hash : null;
    if (currentPath) {
      sessionStorage.setItem(REDIRECT_PATH_KEY, currentPath);
      console.log(`[LoginButton] Stored redirect path: ${currentPath}`);
    }

    setIsLoggingIn(true);

    try {
      let token = getSavedToken();

      if (!token) {
        token = await login();
        if (!token) {
          throw new Error('Failed to obtain token');
        }
      }
      // Remove method_timeout, let store handle defaults or configuration
      await connect({
        server_url: serverUrl,
        token: token,
        method_timeout: 300
      });

      // Redirect after successful connect (check server/user state from store)
      // The useEffect hook below handles redirection based on `server` state change.

    } catch (error) {
      console.error("Error during login:", error);
      localStorage.removeItem("token");
      localStorage.removeItem("tokenExpiry");
      sessionStorage.removeItem(REDIRECT_PATH_KEY); // Clear on error too
    } finally {
      setIsLoggingIn(false);
    }
    // Update dependencies: include location and connect
  }, [connect, location.pathname, location.search, location.hash, navigate, login]);


  // Auto-login on component mount if token exists and not connected/connecting
  useEffect(() => {
    const autoLogin = async () => {
      const token = getSavedToken();
      // Only attempt auto-login if we have a token and are not already connected or connecting
      if (token && !isConnected && !isConnecting) {
        setIsLoggingIn(true); // Show visual feedback
        try {
          await connect({
            server_url: serverUrl,
            token: token,
            method_timeout: 300
          });
          // Redirection is handled by the effect watching `server` state below.
        } catch (error) {
          console.error("Auto-login failed:", error);
          // Clear invalid token
          localStorage.removeItem("token");
          localStorage.removeItem("tokenExpiry");
          sessionStorage.removeItem(REDIRECT_PATH_KEY); // Clear redirect path on error
        } finally {
          setIsLoggingIn(false);
        }
      }
    };

    autoLogin();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connect, isConnected, isConnecting]); // Dependencies for auto-login trigger

  // Effect to set user when server connection is established and handle redirection
  useEffect(() => {
    if (server && server.config.user) {
      setUser(server.config.user);
      console.log("Logged in as:", server.config.user);

      // Redirect after successful login/connect (both manual and auto)
      const redirectPath = sessionStorage.getItem(REDIRECT_PATH_KEY);
      if (redirectPath) {
        console.log(`[LoginButton] Redirecting to stored path: ${redirectPath}`);
        sessionStorage.removeItem(REDIRECT_PATH_KEY);
        navigate(redirectPath); // Use the stored full path
      }
    }
  }, [server, setUser, navigate]); // Dependencies: server determines user state and triggers redirection check


  return (
    <div className={className}>
      {user?.email ? (
        <div className="relative">
          <button
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="text-gray-700 hover:text-gray-900 focus:outline-none"
            aria-label="User profile menu" // Add aria-label (fixes linter error)
          >
            <UserCircleIcon className="h-6 w-6" />
          </button>
          
          {/* Dropdown Menu */}
          {isDropdownOpen && (
            <div id="user-dropdown" className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg py-1 z-999 border border-gray-200">
              <div className="px-4 py-2 text-sm text-gray-700 border-b border-gray-200">
                {user.email}
              </div>
              {user.roles?.includes('admin') && (
                <Link
                  to="/admin"
                  className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  onClick={() => setIsDropdownOpen(false)}
                >
                  Admin Dashboard
                </Link>
              )}
              <Link
                to="/my-artifacts"
                className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                onClick={() => setIsDropdownOpen(false)}
              >
                My Artifacts
              </Link>
              
              <Link
                to="/bioengine"
                className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                onClick={() => setIsDropdownOpen(false)}
              >
                BioEngine
              </Link>
              
              {/* Add API Documentation link */}
              <Link
                to="/api"
                className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                onClick={() => setIsDropdownOpen(false)}
              >
                API Documentation
              </Link>
              
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
          onClick={handleLogin} 
          disabled={isLoggingIn}
          className="text-gray-700 hover:text-gray-900 px-4 py-2 rounded-md hover:bg-gray-50 flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoggingIn ? (
            <>
              <Spinner className="w-4 h-4 mr-2" />
              Logging in...
            </>
          ) : (
            <>
              <RiLoginBoxLine className="mr-2" size={18} />
              Login
            </>
          )}
        </button>
      )}
    </div>
  );
}