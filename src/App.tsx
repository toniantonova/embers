import { Canvas } from './components/Canvas';
import { ReportPage } from './components/ReportPage';

function App() {
  const isReportPage = window.location.pathname === '/about';
  return isReportPage ? <ReportPage /> : <Canvas />;
}

export default App;

