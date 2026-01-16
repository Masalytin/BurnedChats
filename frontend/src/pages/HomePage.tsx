import type { TelegramUser } from '../hooks/useTelegram';
import { Avatar, Button, Card, CardContent, StatusBadge, Input } from '../components';
import { FlameIcon, SearchIcon, ShieldIcon } from '../icons';
import './HomePage.css';

interface HomePageProps {
  user: TelegramUser | null;
  isConnected: boolean;
  isConnecting?: boolean;
  reconnectAttempt?: number;
}

/**
 * Main home page component
 */
export function HomePage({ 
  user, 
  isConnected, 
  isConnecting = false,
  reconnectAttempt = 0,
}: HomePageProps) {
  const displayName = user 
    ? `${user.first_name}${user.last_name ? ` ${user.last_name}` : ''}`
    : 'Anonymous';

  // Determine connection status
  const connectionStatus = isConnected 
    ? 'online' 
    : isConnecting 
      ? 'connecting' 
      : 'offline';

  return (
    <div className="home-page">
      {/* Header */}
      <header className="home-header">
        <div className="home-header-content">
          <div className="home-brand">
            <FlameIcon className="home-brand-icon" />
            <h1 className="home-title">BurnedChats</h1>
          </div>
          <div className="home-status">
            <StatusBadge 
              status={connectionStatus} 
              size="sm"
            />
            {isConnecting && reconnectAttempt > 0 && (
              <span className="reconnect-indicator">
                Retry {reconnectAttempt}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* User Profile Card */}
      <Card className="home-profile-card animate-slide-up">
        <CardContent>
          <div className="home-profile">
            <Avatar 
              src={user?.photo_url} 
              name={displayName} 
              size="lg"
            />
            <div className="home-profile-info">
              <h2 className="home-profile-name">{displayName}</h2>
              {user?.username && (
                <p className="home-profile-username">@{user.username}</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Search Section */}
      <section className="home-section animate-slide-up" style={{ animationDelay: '100ms' }}>
        <h3 className="home-section-title">Start a Secure Chat</h3>
        <div className="home-search">
          <Input 
            placeholder="Search by @username"
            leftIcon={<SearchIcon />}
          />
          <Button fullWidth>
            Search User
          </Button>
        </div>
      </section>

      {/* Features Section */}
      <section className="home-features animate-slide-up" style={{ animationDelay: '200ms' }}>
        <FeatureItem 
          icon={<ShieldIcon />}
          title="End-to-End Encrypted"
          description="Messages are encrypted on your device. Even we can't read them."
        />
        <FeatureItem 
          icon={<FlameIcon />}
          title="Burn After Reading"
          description="Destroy all traces of your conversation with one tap."
        />
      </section>

      {/* Coming Soon - Sessions List */}
      <section className="home-section animate-slide-up" style={{ animationDelay: '300ms' }}>
        <h3 className="home-section-title">Active Sessions</h3>
        <div className="home-empty-state">
          <p>No active sessions</p>
          <span>Start a chat to see your sessions here</span>
        </div>
      </section>
    </div>
  );
}

interface FeatureItemProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}

function FeatureItem({ icon, title, description }: FeatureItemProps) {
  return (
    <div className="feature-item">
      <div className="feature-icon">{icon}</div>
      <div className="feature-content">
        <h4 className="feature-title">{title}</h4>
        <p className="feature-description">{description}</p>
      </div>
    </div>
  );
}


