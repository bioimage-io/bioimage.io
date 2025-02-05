import { useEffect } from 'react';

interface SnackbarProps {
  message: string;
  isOpen: boolean;
  onClose: () => void;
  type?: 'error' | 'success' | 'info';
  duration?: number;
}

const Snackbar: React.FC<SnackbarProps> = ({
  message, 
  isOpen, 
  onClose, 
  type = 'error',
  duration = 3000 
}: SnackbarProps) => {
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        onClose();
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [isOpen, duration, onClose]);

  if (!isOpen) return null;

  const bgColor = {
    error: 'bg-red-500',
    success: 'bg-green-500',
    info: 'bg-blue-500'
  }[type];

  return (
    <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 z-50">
      <div className={`${bgColor} text-white px-6 py-3 rounded-lg shadow-lg 
        flex items-center transition-opacity duration-300 ease-in-out`}>
        <span>{message}</span>
      </div>
    </div>
  );
}; 

export default Snackbar;