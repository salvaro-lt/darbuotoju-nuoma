// Module map for convex-test: every Convex function file plus _generated.
export const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"])
