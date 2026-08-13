import { AppProvider } from "@shopify/polaris";
import frTranslations from "@shopify/polaris/locales/fr.json";
import { Outlet, NavLink } from "react-router";
import { useState } from "react";

// Sidebar fixe de 220px inutilisable sur mobile (bouffe la moitié de l'écran) — devient un
// tiroir coulissant sous 768px, piloté par une classe CSS (media query) + un état d'ouverture
// React. Le boolean par défaut (false) est identique serveur/client, donc pas de mismatch
// d'hydratation malgré le rendu conditionnel basé sur le viewport.
const RESPONSIVE_CSS = `
  .fmcship-topbar { display: none; }
  .fmcship-backdrop { display: none; }
  @media (max-width: 768px) {
    .fmcship-topbar {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 0.75rem 1rem;
      background: #1a1a2e;
      color: #fff;
      position: sticky;
      top: 0;
      z-index: 30;
    }
    .fmcship-shell { flex-direction: column !important; }
    .fmcship-nav {
      position: fixed;
      top: 0;
      left: 0;
      bottom: 0;
      z-index: 40;
      transform: translateX(-100%);
      transition: transform 0.2s ease;
      box-shadow: 2px 0 12px rgba(0,0,0,0.25);
    }
    .fmcship-nav.is-open { transform: translateX(0); }
    .fmcship-backdrop.is-open {
      display: block;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.4);
      z-index: 35;
    }
    .fmcship-main { width: 100%; }
  }
`;

export default function AppLayout() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <AppProvider i18n={frTranslations}>
      <style>{RESPONSIVE_CSS}</style>
      <div className="fmcship-shell" style={{ display: "flex", minHeight: "100vh" }}>
        <div className="fmcship-topbar">
          <button
            onClick={() => setMobileNavOpen(true)}
            aria-label="Ouvrir le menu"
            style={{
              background: "none",
              border: "none",
              color: "#fff",
              fontSize: 22,
              cursor: "pointer",
              padding: 0,
              lineHeight: 1,
            }}
          >
            ☰
          </button>
          <div style={{ fontSize: 16, fontWeight: 700 }}>FMCShip</div>
        </div>

        <div
          className={`fmcship-backdrop${mobileNavOpen ? " is-open" : ""}`}
          onClick={() => setMobileNavOpen(false)}
        />

        <nav
          className={`fmcship-nav${mobileNavOpen ? " is-open" : ""}`}
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

          <SidebarLink to="/" label="Tableau de bord" icon="📊" onNavigate={() => setMobileNavOpen(false)} />
          <SidebarLink to="/orders" label="Commandes" icon="📦" onNavigate={() => setMobileNavOpen(false)} />
          <SidebarLink to="/products" label="Produits" icon="🏷️" onNavigate={() => setMobileNavOpen(false)} />
          <SidebarLink to="/settings" label="Paramètres" icon="⚙️" onNavigate={() => setMobileNavOpen(false)} />
        </nav>

        <main className="fmcship-main" style={{ flex: 1, overflow: "auto", background: "#f6f6f7", minWidth: 0 }}>
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
  onNavigate,
}: {
  to: string;
  label: string;
  icon: string;
  onNavigate: () => void;
}) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      onClick={onNavigate}
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
