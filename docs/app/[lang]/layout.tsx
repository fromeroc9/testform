import { Footer, Layout, Navbar } from 'nextra-theme-docs';
import { getPageMap } from 'nextra/page-map';
import { TestformLogo } from '../components/Logo';

const navbar = (
  <Navbar
    logo={<TestformLogo />}
    projectLink="https://github.com/fromeroc9/testform"
  />
);
const footer = <Footer>MIT {new Date().getFullYear()} © Testform. Built for modern quality engineering.</Footer>;

export async function generateStaticParams() {
  return [{ lang: 'es' }, { lang: 'en' }];
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  const pageMap = await getPageMap(`/${lang}`);

  return (
    <Layout
      navbar={navbar}
      pageMap={pageMap}
      footer={null}
      copyPageButton={false}
      i18n={[
        { locale: 'en', name: 'English' },
        { locale: 'es', name: 'Español' },
      ]}
      docsRepositoryBase="https://github.com/fromeroc9/testform/tree/main/docs/content"
      editLink={lang === 'es' ? 'Editar esta página en GitHub' : 'Edit this page on GitHub'}
    >
      {children}
    </Layout>
  );
}
