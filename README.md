# locomote-heckle

A Node.js based alternative to Jeckle.

# Installation

Install using _npm_:

```
npm install "@locomote.sh/heckle"
```

You can then run the _heckle_ command using _npx_:

```
npx heckle
```

# Status

_Heckle_ is currently very much beta software;
It does work and will build a website, but there are known bugs and problems, particularly with page dependency tracking.

# Usage

## To build a site
Generate a site's HTML and copy assets and other resources by running the following command:

```
    npx heckle build <source> <target> [options module]
```
Where:
* `source` is the location containing the site source files.
* `target` is the location where the result will be written to.
* `options module` is an optional module name or path containing extensions.

## To serve a site
The following command allows a built site to be served locally by running a web server process listening on port 3000 of localhost:

```
    npx heckle serve <source> <target>
```

Where _source_ and _target_ are the same as for the build command.

# Extensions

A module containing _site extensions_ can be specified at build time. A site extension is the Heckle equivalent of a Jekyll plugin, and allows custom tags, filters and site initialization methods to be specified. The extension module can declare the following exports:

* _init_: A site initialization function. The function is passed the following arguments:
  - _content_: The build context.
  - _engine_: The Liquid templating engine used to build the site.
* _tags_: A map of custom Liquid tags.
* _filters_: A map of custom Liquid filters.

