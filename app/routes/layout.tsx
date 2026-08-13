import { AppProvider } from "@shopify/polaris";
import frTranslations from "@shopify/polaris/locales/fr.json";
import { Outlet, NavLink } from "react-router";

export default function AppLayout() {
  return (
    <AppProvider i18n={frTranslations}>
      <div style={{ display: "flex", minHeight: "100vh" }}>
        <nav
          style={{
            width: 220,
            background: "#1a1a2e",
            color: "#fff",
            padding: "1.5rem 0",
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ padding: "0 1.25rem 2rem" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#e2e8f0" }}>
              FMCShip
            </div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
              Gestion logistique
            </div>
          </div>

          <SidebarLink to="/" label="Tableau de bord" icon="📊" />
          <SidebarLink to="/orders" label="Commandes" icon="📦" />
          <SidebarLink to="/products" label="Produits" icon="🏷️" />
          <SidebarLink to="/settings" label="Paramètres" icon="⚙️" />
        </nav>

        <main style={{ flex: 1, overflow: "auto", background: "#f6f6f7" }}>
          <Outlet />
        </main>
      </div>
    </AppProvider>
  );
}

function SidebarLink({
  to,
  label,
  icon,
}: {
  to: string;
  label: string;
  icon: string;
}) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      style={({ isActive }) => ({
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0.65rem 1.25rem",
        color: isActive ? "#fff" : "#94a3b8",
        background: isActive ? "rgba(255,255,255,0.1)" : "transparent",
        textDecoration: "none",
        borderLeft: isActive ? "3px solid #6366f1" : "3px solid transparent",
        fontSize: 14,
        fontWeight: isActive ? 600 : 400,
        transition: "all 0.15s",
      })}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </NavLink>
  );
}
