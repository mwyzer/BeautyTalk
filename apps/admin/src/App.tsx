import { useEffect, useState, type ReactElement } from "react";
import { AdminLayout, LoginForm, useAuthState } from "./components/Layout";
import { setToken } from "./lib/api";
import { ProductsView } from "./views/ProductsView";
import { OrdersView } from "./views/OrdersView";
import { CustomersView } from "./views/CustomersView";
import { ContentView } from "./views/ContentView";
import { SEOView } from "./views/SEOView";
import { AnalyticsView } from "./views/AnalyticsView";
import { RecommendationsView } from "./views/RecommendationsView";
import { FraudView } from "./views/FraudView";

type View = "products" | "orders" | "customers" | "content" | "seo" | "analytics" | "recommendations" | "fraud";

function readView(): View {
  const h = window.location.hash.replace(/^#\/?/, "");
  if (h === "orders" || h === "customers" || h === "content" || h === "seo" || h === "analytics" || h === "recommendations" || h === "fraud") return h;
  return "products";
}

export function App(): ReactElement {
  const { authed } = useAuthState();
  const [view, setView] = useState<View>(readView);
  const [, force] = useState(0);

  useEffect(() => {
    const onHash = (): void => setView(readView());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (authed) force((n) => n + 1);
  }, [authed]);

  if (!authed) {
    return <LoginForm onLogin={readView} />;
  }

  const navigate = (v: string): void => {
    window.location.hash = `/${v}`;
    setView(v as View);
  };

  const logout = (): void => {
    setToken(null);
    window.location.hash = "";
  };

  return (
    <AdminLayout view={view} onNavigate={navigate} onLogout={logout}>
      {view === "products" && <ProductsView />}
      {view === "orders" && <OrdersView />}
      {view === "customers" && <CustomersView />}
      {view === "content" && <ContentView />}
      {view === "seo" && <SEOView />}
      {view === "analytics" && <AnalyticsView />}
      {view === "recommendations" && <RecommendationsView />}
      {view === "fraud" && <FraudView />}
    </AdminLayout>
  );
}