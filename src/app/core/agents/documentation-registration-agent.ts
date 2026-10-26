/**
 * DocumentationRegistrationAgent - Agent responsible for registering,
 * generating, and updating application documentation.
 *
 * Capabilities:
 * - Scaffold a MARKDOWN documentation file for a given feature or module.
 * - Register (store/download) documentation files.
 * - Generate a Table of Contents or index based on existing docs.
 * - Browser and client-bundle compatible.
 */

export interface DocMetadata {
  title: string;
  description: string;
  category: 'feature' | 'api' | 'guide' | 'reference';
  tags: string[];
}

/**
 * Scaffold a markdown document for a given feature/module.
 * @param meta Metadata describing the document.
 * @returns The markdown content as a string.
 */
export function scaffoldDoc(meta: DocMetadata): string {
  const { title, description, category, tags } = meta;
  const tagString = tags.map((t) => `- ${t}`).join('\n');
  return `# ${title}\n\n**Category:** ${category}\n\n${description}\n\n## Tags\n${tagString}\n`;
}

/**
 * In-memory store for generated docs in client mode
 */
const inMemoryDocsRegistry = new Map<string, string>();

/**
 * Register (write/store) a markdown document.
 * @param markdown The markdown content.
 * @param targetFile Relative path for document key.
 */
export function registerDoc(markdown: string, targetFile: string): void {
  inMemoryDocsRegistry.set(targetFile, markdown);
  console.log(`[DocumentationRegistrationAgent] Documentation registered: ${targetFile}`);
}

/**
 * Generate a simple Table of Contents for all registered markdown files.
 * @param docsFolder Relative path prefix.
 * @returns A markdown TOC string.
 */
export function generateTableOfContents(docsFolder: string): string {
  const matchingKeys = Array.from(inMemoryDocsRegistry.keys())
    .filter((k) => k.startsWith(docsFolder) || docsFolder === '')
    .sort();

  if (matchingKeys.length === 0) {
    return '# Documentation\n*(Documentation index ready. No external files loaded in client session.)*\n';
  }

  const tocLines = matchingKeys.map((f) => `- [${f}](${f})`);
  return '# Documentation\n\n' + tocLines.join('\n');
}

/** Class-based Documentation Agent for Dependency Injection */
export class DocumentationRegistrationAgent {
  scaffoldDoc(meta: DocMetadata): string {
    return scaffoldDoc(meta);
  }

  registerDoc(markdown: string, targetFile: string): void {
    registerDoc(markdown, targetFile);
  }

  generateTableOfContents(docsFolder: string): string {
    return generateTableOfContents(docsFolder);
  }
}