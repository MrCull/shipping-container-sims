/** Types for vitest-projects.mjs (imported by vitest.config.ts). */
export const SHARED_PROJECT: 'shared'
export function projectsOf(testFiles: string[]): { sims: string[]; shared: boolean }
export function listTestFiles(root: string): string[]
export function simIdsWithTests(root: string): string[]
