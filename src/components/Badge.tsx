interface BadgeProps {
  text: string;
  variant?: 'primary' | 'secondary';
}

export const Badge = ({ text, variant = 'primary' }: BadgeProps) => {
  const baseClasses = "px-2 py-1 rounded-full text-sm";
  const variantClasses = variant === 'primary' 
    ? "bg-blue-100 text-blue-800"
    : "bg-gray-100 text-gray-800";

  return (
    <span className={`${baseClasses} ${variantClasses}`}>
      {text}
    </span>
  );
}; 