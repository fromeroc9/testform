import { generateStaticParamsFor, importPage } from 'nextra/pages'
import { useMDXComponents } from '../../../mdx-components'

export const generateStaticParams = generateStaticParamsFor('mdxPath', 'lang')

export async function generateMetadata(props: {
  params: Promise<{ lang: string; mdxPath?: string[] }>
}) {
  const { lang, mdxPath } = await props.params
  const { metadata } = await importPage(mdxPath, lang)
  return metadata
}

const Wrapper = useMDXComponents({}).wrapper

export default async function Page(props: {
  params: Promise<{ lang: string; mdxPath?: string[] }>
}) {
  const { lang, mdxPath } = await props.params
  const { default: MDXContent, toc, metadata, sourceCode } = await importPage(mdxPath, lang)

  return (
    <Wrapper toc={toc} metadata={metadata} sourceCode={sourceCode}>
      <MDXContent {...props} params={{ lang, mdxPath }} />
    </Wrapper>
  )
}
