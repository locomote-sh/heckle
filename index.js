const { build, loadSiteConfig } = require('./lib/build');
exports.build = build;
exports.loadSiteConfig = loadSiteConfig;

exports.serve = require('./lib/serve').serve;
exports.extensions = require('./lib/extensions');
