declare module "@babel/plugin-*" {
	const value: { default: (...arguments_: any[]) => any }

	export default value
}

// Taken from https://github.com/thw0rted/DefinitelyTyped/blob/542cacd0803f50d8537a94b2dfa3e3e125c837ac/types/node/perf_hooks.d.ts#L608
/**
 * `performance` is a global reference for `require('perf_hooks').performance`
 * https://nodejs.org/api/globals.html#performance
 * @since v16.0.0
 */
declare const performance: typeof globalThis extends { onmessage: any, performance: infer T } ? T : typeof import("perf_hooks").performance
