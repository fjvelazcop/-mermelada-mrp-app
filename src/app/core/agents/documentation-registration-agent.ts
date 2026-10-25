/**
 * DocumentationRegistrationAgent - Agent responsible for registering,
 * generating, and updating application documentation.
 *
 * Capabilities:
 * - Scaffold a MARKDOWN documentation file for a given feature or module.
 * - Register (write) the documentation file to the project's docs directory.
 * - Generate a Table of Contents or index based on existing docs.
 * - Update a summary README section with the latest doc markers.
 *
 * In practice this agent can be invoked by the planner when the user
 * requests "document the API" or "register new feature docs". It works
 * alongside the file system (Node.js) or the Angular CLI workspace.
 */
import * as fs from 'fs';
import * as path from 'path';

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
 * Register (write) a markdown document to the project's docs folder.
 * @param markdown The markdown content.
 * @param targetFile Relative path from the project root where the file should be created/written.
 */
export function registerDoc(markdown: string, targetFile: string): void {
  const projectRoot = path.resolve(__dirname, '../../../..');
  const fullPath = path.join(projectRoot, targetFile);
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(fullPath, markdown, 'utf-8');
  console.log(`[DocumentationRegistrationAgent] Documentation registered at ${fullPath}`);
}

/**
 * Generate a simple Table of Contents for all markdown files under a folder.
 * @param docsFolder Relative path from the project root.
 * @returns A markdown TOC string.
 */
export function generateTableOfContents(docsFolder: string): string {
  const projectRoot = path.resolve(__dirname, '../../../..');
  const fullFolder = path.join(projectRoot, docsFolder);
  if (!fs.existsSync(fullFolder)) {
    return '# Documentation\n*(No documentation folder found.)*\n';
  }
  const files = fs
    .readdirSync(fullFolder)
    .filter((f) => f.endsWith('.md'))
    .sort();
  const tocLines = files.map((f) => `- [${f.replace('.md', '')}](${docsFolder}/${f})`);
  return '# Documentation\n\n' + tocLines.join('\n');
}

/** Export a ready‑to‑use agent instance (state‑less functions). */
export const DocumentationRegistrationAgent = {
  scaffoldDoc,
  registerDoc,
  generateTableOfContents,
};