import "./globals.css";
import { NavLink } from "./nav-link";

export const metadata = {
  title: "Ottodot — trial booking",
  description: "Book a trial class",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <div className="topbar-inner">
            <span className="brand">
              <span className="brand-mark">O</span> Ottodot
            </span>
            <nav className="topnav">
              <NavLink href="/">Book a trial</NavLink>
              <NavLink href="/roster">Rosters</NavLink>
              <NavLink href="/testing">Testing console</NavLink>
            </nav>
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
