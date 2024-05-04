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

### Run the Devepment Version of HSM
You can run the devepment version of HSM by running `node dist/bin/hsm.js`. You can pass it arguments just like you normally would e.g. `node dist/bin/hsm.js --version`.

### Install the Development Version of the NPM Package in Another Project
In the other project (e.g. testing with Hackmud Scripting Environment) run `pnpm add ~/path/to/hackmud-script-manager/dist`.
