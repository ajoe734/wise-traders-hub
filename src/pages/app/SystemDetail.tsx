import { Navigate } from 'react-router-dom';

// SystemDetail removed - no trading_systems table exists yet
// Redirects to app home
const SystemDetail = () => {
  return <Navigate to="/app" replace />;
};

export default SystemDetail;
