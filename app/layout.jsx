import './globals.css';

export const metadata = {
  title: 'FORCE Arena',
  description: 'FORCE adalah Duel Arena Komunitas untuk bertumbuh lewat quiz kategori, leaderboard, dan Force Points.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/image/force-logo.png',
    apple: '/image/force-logo.png',
  },
};

export const viewport = {
  themeColor: '#9B111E',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
