import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Overview from "./pages/Overview";
import OilBeta from "./pages/OilBeta";
import Pending from "./pages/Pending";

// HashRouter: GitHub Pages has no server-side rewrites, so /#/oil-beta survives a refresh.
export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Overview />} />
          <Route path="oil-beta" element={<OilBeta />} />
          <Route path="oil-beta/:ticker" element={<OilBeta />} />
          <Route path="factors" element={<Pending code="FACT" />} />
          <Route path="seasonality" element={<Pending code="SEAS" />} />
          <Route path="pairs" element={<Pending code="PAIR" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
