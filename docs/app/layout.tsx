import { Head } from 'nextra/components';
import 'nextra-theme-docs/style.css';
import './globals.css';

export const metadata = {
  title: 'Testform - Test-as-Code Framework',
  description: 'Declarative Test-as-Code Framework for Git & Testing Platforms',
  icons: {
    icon: '/icon.svg',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" dir="ltr" suppressHydrationWarning>
      <Head />
      <body>{children}</body>
    </html>
  );
}
