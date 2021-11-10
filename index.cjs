module.exports = null
import("./index.js").then(esModule => module.exports = esModule)
require("deasync").loopWhile(() => !module.exports)
