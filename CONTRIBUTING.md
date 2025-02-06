# Contributing Guide
If you get stuck, message me on discord `@samualn`.

## Requirements
- [Git](https://git-scm.com/)
  - **Windows:** Make sure you install Git Bash with it
- [Clone this repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/cloning-a-repository)
- [PNPM](https://pnpm.io/)
- **Optional:** [`direnv`](https://direnv.net/)

## Linux Users
1. Open this cloned repository in a terminal
2. Run `pnpm install`
3. Modify your `PATH`
   - If you have `direnv`, run `direnv allow` if you havn't already
   - Otherwise run `export PATH=$PWD/node_modules/.bin:$PATH`
4. Run `scripts/package.sh` to compile everything and build the NPM package in `dist`

## Windows Users
1. Open this cloned repository in Git Bash
2. Run `pnpm install`
3. Run `export PATH=$PWD/node_modules/.bin:$PATH`
4. Run `scripts/package.sh` to compile everything and build the NPM package in `dist`

## Tips and Tricks
Run `./rollup.config.js` to only recompile.

### Run the Development Version of HSM
You can run the development version of HSM by running `node dist/bin/hsm.js`. You can pass it arguments just like you normally would e.g. `node dist/bin/hsm.js --version`.

### Install the Development Version of the NPM Package in Another Project
In the other project (e.g. testing with Hackmud Scripting Environment) run `pnpm add ~/path/to/hackmud-script-manager/dist`.

## Tests
Tests can be run by running `vitest run` (assuming you have followed above setup instructions).

There is currently not enforcement on writing unit tests but if you are going to, the test you write MUST be failing.
You CANNOT add passing tests. If you are also writing a fix for a new test, ensure that the fix is in a seperate commit
AFTER the commit the test is added in. This ensures that someone else can checkout the commit with the newly added test
and verify that it is failing, checkout the commit where the fix is implemented, and verify that the test is now
passing.

The files in the `game-scripts-test/` folder are the input for testing `processScript()`. They are read by the vitest
block at the bottom of `src/processScript/index.ts` where they are transformed and evaluated. Support for testing
subscripts and other preprocessor-related stuff is not yet implemented. If one of these tests is failing, you will see
the path outputed like so:

```
 ❯ src/processScript/index.ts (1 test | 1 failed) 6ms
   × game-scripts-tests/this_function_array.ts 6ms
     → expected undefined to be [ [Function] ] // Object.is equality
```

Notice `game-scripts-tests/this_function_array.ts`.

The naming convention uses underscores instead of dashes as if it was the name of a real hackmud script (which cannot
contain dashes).

If you need to know what the test scripts look like after being transformed, look for a symbol named
`DEBUG_LOG_PROCESSED_SCRIPTS` in this project and set it to `true`.
