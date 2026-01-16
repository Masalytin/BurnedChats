import './Avatar.css';

type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';

interface AvatarProps {
  src?: string | null;
  name: string;
  size?: AvatarSize;
  className?: string;
}

/**
 * User avatar component with fallback to initials
 */
export function Avatar({ src, name, size = 'md', className = '' }: AvatarProps) {
  const initials = getInitials(name);
  const backgroundColor = getColorFromName(name);

  return (
    <div 
      className={`avatar avatar--${size} ${className}`}
      style={{ backgroundColor: src ? undefined : backgroundColor }}
    >
      {src ? (
        <img 
          src={src} 
          alt={name} 
          className="avatar-image" 
          loading="lazy"
        />
      ) : (
        <span className="avatar-initials">{initials}</span>
      )}
    </div>
  );
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function getColorFromName(name: string): string {
  const colors = [
    '#ff6b35', '#ff9f1c', '#2ec4b6', '#5eaaff',
    '#9b5de5', '#f15bb5', '#00bbf9', '#00f5d4',
    '#fee440', '#8ac926',
  ];
  
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  return colors[Math.abs(hash) % colors.length];
}


