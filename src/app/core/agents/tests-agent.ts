function capitalize(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function first(str: string): string {
  return str.split(' ')[0];
}

/**
 * TestAgent - Agent in charge of generating, running, and reporting tests.
 * Integrates with the project's Vitest setup and can scaffold test files,
 * execute suites, and produce coverage reports.
 */
export class TestAgent {
  /** Scaffold a basic Vitest test file for a given component or service. */
  scaffoldTestFile(name: string, type: 'component' | 'service' | 'pipe' = 'service'): string {
    const lower = name.toLowerCase();
    if (type === 'component') {
      return `import { describe, it, expect } from 'vitest'\nimport { ${capitalize(first(lower))} } from './${lower}';

describe('${capitalize(first(lower))} component', () => {
  it('should run basic sanity check', () => {
    expect(true).toBe(true);
  });
});
`;
    }
    // service or pipe
    return `import { describe, it, expect } from 'vitest'\nimport { ${capitalize(first(lower))} } from './${lower}';

describe('${capitalize(first(lower))}', () => {
  it('should execute without errors', () => {
    expect(true).toBe(true);
  });
});
`;
  }

  /** Run the project's test suite via vitest. */
  async runSuite(): Promise<{passed: number; failed: number; output: string}> {
    // In a real implementation this would invoke `npm run test` or `npx vitest run`
    // and parse the results. For now we return a placeholder.
    return {
      passed: 0,
      failed: 0,
      output: 'Test suite execution placeholder',
    };
  }

  /** Generate a coverage report (placeholder). */
  generateCoverageReport(): string {
    return 'Coverage report generation placeholder';
  }
}