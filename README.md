# Hackmud Script Manager
Command made for [hackmud-environment](https://github.com/samualtnorman/hackmud-environment), which is a scripting environment for hackmud with minification, autocompletes / intellisense, and TypeScript support.

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/R6R0XN5CX)

You can read about how HSM works [in my blog post](https://samual.uk/blog/js-code-transformation-niche-environment/).

## Install
1. [Install Node.js](https://nodejs.org/en/download)
2. Run `npm install -g hackmud-script-manager`

## Usage
1. Run `#dir` in game, then `cd` to that folder
2. Name your source script file to `<name>.src.js`
3. Run `hsm golf <name>.src.js` and it will create a minified script file called `<name>.js`

> **NOTE:** If you get an error message that looks like this:
> ```
> [...]\AppData\Local\pnpm\hsm.ps1 cannot be loaded because running scripts is disabled on this system. [...]
> ```
> You will need to run `Set-ExecutionPolicy -ExecutionPolicy Unrestricted -Scope CurrentUser` in PowerShell as an administrator. For more information, see [Microsoft's page about Execution Policies](https://learn.microsoft.com/en-gb/powershell/module/microsoft.powershell.core/about/about_execution_policies?view=powershell-7.4).

## Features
- Minification
    - This includes auto quine cheating.
        - Supported types are null, numbers, strings, and JSON compatible objects and arrays.
        - Non JSON compatible object keys are quine cheated.
        - Member expressions are converted to index notation so the index string can be quine cheated.
        - And template literals are converted to string concatenation so the strings can be quine cheated.
    - Global variable aliasing.
    - Convert function declarations to arrow function assigned to variable hoisted to the top of the block (`function foo() { ... }` -> `let foo = () => ...`).
    - Convert `_START` and `_TIMEOUT` to `_ST` and `_TO`.
    - Remove unused parameters from the main function expression.
- Modern Javascript Syntax and Features
    - [Exponentiation Operator](https://babeljs.io/docs/en/babel-plugin-transform-exponentiation-operator), [Object Rest Spread](https://babeljs.io/docs/en/babel-plugin-proposal-object-rest-spread), [Optional Catch Binding](https://babeljs.io/docs/en/babel-plugin-proposal-optional-catch-binding), [JSON strings](https://babeljs.io/docs/en/babel-plugin-proposal-json-strings), [Nullish Coalescing Operator](https://babeljs.io/docs/en/babel-plugin-proposal-nullish-coalescing-operator), [Optional Chaining](https://babeljs.io/docs/en/babel-plugin-proposal-optional-chaining), [Logical Assignment Operators](https://babeljs.io/docs/en/babel-plugin-proposal-logical-assignment-operators), [Numeric Seperators](https://babeljs.io/docs/en/babel-plugin-proposal-numeric-separator), [Class Properties](https://babeljs.io/docs/en/babel-plugin-proposal-class-properties), [Class Static Block](https://babeljs.io/docs/en/babel-plugin-proposal-class-static-block), [Private Property `in` Object](https://babeljs.io/docs/en/babel-plugin-proposal-private-property-in-object).
    - Bigint literals are converted to `BigInt()` calls.
    - Hackmud already supports all modern regular expression features.
- Future JavaScript Syntax and Features
    - Warning: TypeScript doesn't support any of these features and these features may change or not actually make it into JavaScript.
    - [Decorators](https://babeljs.io/docs/en/babel-plugin-proposal-decorators), [Do Expressions](https://babeljs.io/docs/en/babel-plugin-proposal-do-expressions), [Function Bind](https://babeljs.io/docs/en/babel-plugin-proposal-function-bind), [Function Sent](https://babeljs.io/docs/en/babel-plugin-proposal-function-sent), [Partial Application](https://babeljs.io/docs/en/babel-plugin-proposal-partial-application), [Pipeline Operator](https://babeljs.io/docs/en/babel-plugin-proposal-pipeline-operator) (using the hack proposal and `%` as the topic token), [Throw Expression](https://babeljs.io/docs/en/babel-plugin-proposal-throw-expressions), [Record and Tuple](https://babeljs.io/docs/en/babel-plugin-proposal-record-and-tuple) (hash `#` syntax type).
- TypeScript Support
    - This command/module does **not** do type checking, it simply removes type annotations so you'll need to rely on your IDE or run `tsc` seperatly with `noEmit`.
- And “Cool” Unnecessary Features.
    - Variables declared outside the main function expression automatically become `#G` global variables.
    - Any code outside the function expression will only run once per top level script execution (`#FMCL`).
    - Basic seclevel verification.
        - Declaring `// @seclevel HIGHSEC` or any other seclevel before all of your code stops you from accidentally using `#ls.` or `#ns.`.
    - Import `node_modules` modules into your script using `import { foo } from "bar"` syntax.
    - `_SOURCE` is replaced with a string of the source code of the script it's in.
    - `_BUILD_DATE` is replaced with a unix timestamp (`Date.now()`) of the build date of the script.
    - `_SCRIPT_USER` is replaced with a string of the user the script was pushed to.
        - This saves characters compared to `context.this_script.split(".")[0]`.
    - `_SCRIPT_NAME` is like `_SCRIPT_USER` but for the name of the script.
        - Saves characters compared to `context.this_script.split(".")[1]`.
    - `_FULL_SCRIPT_NAME` is replaced with what would be `context.this_script`.
    - `#s.` can be used and it'll automatically have the seclevel inserted.
    - Subscript and `#db` methods names are verified.
    - All references to preprocessor syntax functions not being called are turned into arrow function wrappers e.g. `let debug = #D;` -> `let debug = v => #D(v);`.
    - `_SECLEVEL` is replaced with a number (`0` to `4`) representing the seclevel of the script.
    - When `export`s are present in the script, it becomes a script that returns an object of the `export`ed values.
        - `_EXPORTS` becomes an array of the names of the exported values.
- And Neat Weird Fixes
    - Like `.__proto__` and `.prototype` being converted to `["__proto__"]` and `["prototype"]`.
    - Illegal and unsafe strings.
        - Appearences of `_SC` and friends are either renamed or have an escape inserted so that script is legal.
        - Preprocessor syntax in strings are escaped so hackmud doesn't recognise them as preprocessor syntax.
        - And appearences of `//` in strings and regexes have a backslash inserted between to stop hackmud's overagressive comment remover from removing half the line of code.
    - Classes are actually usable now, this module replaces instances of `this` with a variable referencing what would be `this`.
    - `Function.prototype` can be referenced (but only the `.prototype` property, nothing else).
    - `Object.getPrototypeOf` and `Object.setPrototypeOf` are replaced with equivalent functions.
