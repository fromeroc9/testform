import { Head } from 'nextra/components'
import 'nextra-theme-docs/style.css'

export const metadata = {
  title: 'Testform Documentation',
  description: 'Test-as-Code Framework for Git & Testing Platforms',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" dir="ltr" suppressHydrationWarning>
      <Head />
      <body>{children}</body>
    </html>
  )
}
