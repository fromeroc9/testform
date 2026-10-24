import { useMDXComponents as getDocsMDXComponents } from 'nextra-theme-docs';
import { Callout, Cards, FileTree, Steps, Tabs, Table, Bleed } from 'nextra/components';
import { CodeShowcase } from './app/components/CodeShowcase';

const docsComponents = getDocsMDXComponents();

export function useMDXComponents(components) {
  return {
    ...docsComponents,
    ...components,
    Callout,
    Cards,
    FileTree,
    Steps,
    Tabs,
    Table,
    Bleed,
    CodeShowcase,
  };
}
