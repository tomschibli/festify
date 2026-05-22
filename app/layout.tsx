import type { Metadata, Viewport } from 'next'
import './globals.css'
import ServiceWorkerSetup from '@/components/ServiceWorkerSetup'

export const metadata: Metadata = {
  title: 'Festify',
  description: 'Deine Festival-Crew App',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Festify',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#F4EEDE',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" style={{ height: '100%' }}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700&family=Caveat:wght@400;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      </head>
      <body style={{ background: 'var(--paper-tint)', height: '100dvh', overflow: 'hidden' }}>
        <ServiceWorkerSetup />
        {children}
      </body>
    </html>
  )
}
