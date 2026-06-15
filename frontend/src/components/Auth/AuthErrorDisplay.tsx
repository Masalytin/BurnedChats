import './AuthErrorDisplay.css';

interface AuthErrorDisplayProps {
  message: string | null;
}

/** Non-technical authentication error messaging for standalone wallet login */
export function AuthErrorDisplay({ message }: AuthErrorDisplayProps) {
  if (!message) {
    return null;
  }

  return (
    <div className="auth-error-display" role="alert">
      {message}
    </div>
  );
}
