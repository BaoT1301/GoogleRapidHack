/**
 * Root application component.
 *
 * Sets up React Router with HashRouter (for nginx SPA compatibility),
 * React Query provider, and the layout shell with 5 tabbed pages.
 */
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { Layout } from "./components/Layout";
import OverviewPage from "./pages/OverviewPage";
import SetupPage from "./pages/SetupPage";
import ApiReferencePage from "./pages/ApiReferencePage";
import AgentsPage from "./pages/AgentsPage";
import GraphPage from "./pages/GraphPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Toaster position="bottom-right" />
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<OverviewPage />} />
            <Route path="setup" element={<SetupPage />} />
            <Route path="api" element={<ApiReferencePage />} />
            <Route path="agents" element={<AgentsPage />} />
            <Route path="graph" element={<GraphPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </QueryClientProvider>
  );
}

export default App;
