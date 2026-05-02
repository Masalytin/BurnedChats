import { useAuthContext } from '../auth/AuthContext';

export function useAuth() {
  const { user, isAuthenticated, isLoading, authType, login, logout, getCredentials } = useAuthContext();

  return {
    user,
    isAuthenticated,
    isLoading,
    authType,
    login,
    logout,
    getCredentials,
  };
}
