import Link from "next/link";
import "./globals.css";

export const metadata = {
  title: "Ottodot — trial booking POC",
  description: "Trial booking reliability proof of concept",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header>
          <strong>Ottodot trial booking</strong>
          <nav>
            <Link href="/">Book a trial</Link>
            <Link href="/roster">Rosters</Link>
            <Link href="/testing">Testing console</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
