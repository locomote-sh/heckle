const MM   = require('minimatch');
const Path = require('path');
const YAML = require('js-yaml');

const {
    findFiles,
    ensureDir,
    copyFile,
    readFile,
    rmRF,
    setupLiquid,
    lookup,
    isHTMLFile,
    isNotHiddenFile,
    parseHTMLSource,
    asyncBatch
} = require('./support');

const {
    Site,
    Collections,
    Collection,
    Document
} = require('./domain');

const Sass = require('./sass');

// Maximum allowable size of each cached HTML source.
const CacheDocumentHTMLSize = (1024 * 100);

const Mode = require('./runmode');

/**
 * Build a site.
 * @param source    Where to read source files from.
 * @param target    Where to write the result to.
 * @param opts      Build options; an object with the following
 *                  optional properties:
 *                  - config:       A previously loaded configuration; used in
 *                                  preference to the default configuration.
 *                  - configPath:   The path to an alternative site
 *                    configuration file.
 *                  - noDependencyTracking: A boolean flag for disabling
 *                    dependency tracking.
 * @param exts      Build extensions; an object with the following
 *                  optional properties:
 *                  - init: A site initialization function. Called
 *                    with the build environment and liquid engine.
 *                  - tags: A map of custom Liquid tags.
 *                  - filters: A map of custom Liquid filters.
 * @param files     An optional list of files to build.
 */
async function build( source, target, opts = {}, exts, files ) {

    console.log('Source:', source );
    console.log('Target:', target );

    // Load the site configuration.
    let { config, configPath } = await loadSiteConfig( source, opts );
    // Load build extensions (if not provided on command line).
    if( !exts ) {
        if( config.extensions ) {
            let extPath = Path.resolve( Path.join( source, config.extensions ) );
            try {
                exts = require( extPath );
            }
            catch( e ) {
                console.log('Unable to load extensions from %s', extPath );
                console.log( e );
                process.exit( 1 );
            }
        }
        else exts = {};
    }

    let depFile = Path.basename( source )+'.dependencies';
    // Hack to avoid ugly filename when running in site mode.
    if( depFile == '..dependencies' ) {
        depFile = '_site.dependencies';
    }

    // Source dependencies.
    let dependencies = (function() {
        if( opts.noDependencyTracking ) {
            console.log('Dependency tracking disabled');
            let { NullDependencies } = require('./null-dependencies');
            return new NullDependencies( exts );
        }
        let { Dependencies } = require('./dependencies');
        return new Dependencies( depFile, exts );
    })();

    // Initialize SASS processor.
    let sass = Sass( source, target, config, dependencies );
    // Incremental build mode.
    let incremental = opts.incremental || (files && files.length > 0);
    // Metrics.
    let peakHeapTotal = 0;

    async function run() {
        let engine, layouts, site, env;
        let error;
        let startTime = Date.now();
        try {
            console.log('Loading cached dependency graph...');
            // Attempt to load previously cached dependencies.
            await dependencies.load();
            // List source files.
            console.log('Listing sources...');
            let collections = await listSources( config, files );
            // Extract list of layouts from sources.
            console.log('Mapping layouts...');
            layouts = mapLayouts( collections, exts );
            console.log('> Found %d documents, %d static files',
                collections.documentCount,
                collections.staticFileCount );
            // Build the site object.
            site = new Site(
                source,
                target,
                config,
                collections,
                configPath );
            // Initialize the template engine.
            console.log('Initialize template engine...');
            engine = setupLiquid( source, exts );
            // This is necessary so that include tags can record dependencies.
            engine.dependencies = dependencies;
            // Initialize the build environment.
            console.log('Initializing environment...');
            env = Object.assign({ site }, config );
            if( typeof exts.init == 'function' ) {
                await exts.init( env, engine );
            }
            // Clean down the target directory.
            console.log('Preparing target location...');
            await prepareTarget();
            // Start dependency trace.
            dependencies.startTrace( incremental );
            // Build documents & copy files to target.
            console.log('Building...');
            // Get processor for HTML file contents (markdown conversion).
            let htmlproc = getHTMLProcessor( config );
            await buildDocuments( site, env, source, target, layouts, engine, htmlproc );
            console.log('Processing static files...');
            await processStatics( site );
            // End dependency trace.
            dependencies.endTrace();
            // Write dependencies.
            console.log('Saving dependency graph...');
            await dependencies.save();
        }
        catch( e ) {
            error = e;
        }
        let elapsedTime = Date.now() - startTime;
        return { error, elapsedTime, peakHeapTotal };
    }

    /**
     * Map layout documents to their names.
     */
    function mapLayouts( collections, exts ) {
        let layouts = collections.getCollection('layouts').documents;
        // Map of layouts.
        let map = {
            // Standard 'compress' layout.
            'compress': {
                output: context => {
                    // TODO Use a proper minifier - for now, sites can
                    // override this and provide their own minifier in
                    // the site extensions.
                    return context.environments[0].content( context );
                }
            },
            // Standard default layout; echos the page content.
            '__default': {
                output: context => {
                    return context.environments[0].content( context );
                }
            }
        };
        // Allow site extensions to specify programmatic layouts.
        if( exts.layouts ) {
            for( let id in exts.layouts ) {
                map[id] = { output: exts.layouts[id] };
            }
        }
        // Map files from _layouts - these take precedence over anything else.
        map = layouts.reduce( ( map, doc ) => {
            let path = doc.path;
            path = path.slice( '_layouts/'.length );
            // Mark the document as a layout - this is necessary for page
            // mirroring to work (see comment on Document.page in domain.js)
            doc._isLayout = true;
            map[path] = doc;
            // Use both the full path, and the path without the file extension,
            // as the layout name.
            let ext = Path.extname( path );
            if( ext.length > 0 ) {
                let name = path.slice( 0, ext.length * -1 );
                map[name] = doc;
            }
            return map;
        }, map );
        return map;
    }

    const ListBatchSize = 20;

    /**
     * List the site sources.
     * Returns a list of static files to be copied, and documents
     * to be built.
     */
    async function listSources( config, files ) {
        let buildable = isHTMLFile,
            copyable = isNotHiddenFile;
        // If a list of files to build is specified then expand
        // the list to include dependencies.
        if( files ) {
            // The ste of copyables is any file on the file list.
            let onFileList = lookup( files );
            copyable = path => isNotHiddenFile( path ) && onFileList( path );
        }
        let collections = new Collections( config );
        // Create a function for testing for excluded file paths.
        // Don't match files under _site, in case running in --site mode.
        let exclude = ['_site/*','_site/**/*'];
        if( Array.isArray( config.exclude ) ) {
            exclude = exclude.concat( config.exclude );
        }
        else if( typeof config.exclude == 'string' ) {
            exclude = exclude.concat( config.exclude.split(/,/g) );
        }
        let patterns = exclude.map( ex => new MM.Minimatch( ex, { dot: true }) );
        let excluded = path => {
            return patterns.reduce( ( ex, p ) => ex || p.match( path ), false );
        };
        // Find source files.
        let paths = await findFiles( source );
        await asyncBatch( paths, ListBatchSize, async path => {
            if( excluded( path ) ) {
                // Don't process excluded files.
                return;
            }
            let collection = collections.getCollectionForPath( path );
            if( collection ) {
                if( buildable( path ) ) {
                    let file = Path.join( source, path );
                    let { frontmatter, html } = await parseHTMLSource( file );
                    if( frontmatter ) {
                        // File is an HTML doc with frontmatter.
                        let data = collection.getDocumentData( path, frontmatter );
                        if( html.length > CacheDocumentHTMLSize ) {
                            html = null;
                        }
                        let doc = new Document( path, data, html );
                        collection.addDocument( doc );
                        return;
                    }
                }
                if( copyable( path ) ) {
                    // Add file as static file to be copied.
                    collection.addStaticFile( path );
                }
            }
        });
        return collections;
    }

    /**
     * Prepare the build target.
     * Remotes and recreates the target directory.
     */
    async function prepareTarget() {
        if( !incremental ) {
            await rmRF( target, ['.git','_locomote']);
        }
        await ensureDir( target );
    }

    const BuildBatchSize = 20;

    /**
     * Build the site documents.
     */
    async function buildDocuments( site, env, source, target, layouts, engine, htmlproc ) {
        // First need to assign each document a temporary build context.
        let $build = {
            env,
            site,
            source,
            target,
            layouts,
            engine,
            htmlproc 
        };
        site.$build = $build; // Site is also a Drop so needs this ref.
        // Note that this is done for all documents, including non-outputable.
        site.allDocuments.forEach( d => d.$build = $build );

        let outputable = doc => doc.buildable;
        if( incremental && files ) {
            let list = await dependencies.getBuildList( files, exts );
            if( !list ) {
                console.log('Build option changes detected, forcing full build');
            }
            else {
                let listed = lookup( list );
                outputable = doc => doc.buildable && listed( doc.path );
            }
        }
        // Build each outputable document.
        let documents = site.documents.filter( outputable );
        console.log('Building %d documents...', documents.length );

        if( Mode == 'serial' ) {
            for( let i = 0; i < documents.length; i++ ) {
                let doc = documents[i];
                console.log('> %s', doc.path );
                await doc.write( env );
                peakHeapTotal = Math.max( peakHeapTotal, process.memoryUsage().heapTotal );
            }
        }
        if( Mode == 'parallel' ) {
            await asyncBatch( documents, BuildBatchSize, async doc => {
                console.log('> %s', doc.path );
                await doc.write( env );
                peakHeapTotal = Math.max( peakHeapTotal, process.memoryUsage().heapTotal );
            });
        }
    }

    const StaticBatchSize = 20;

    // Processors for different file types, identified by file extension.
    const StaticFileProcessors = {
        // Default processor - copy file from source to target.
        '*': async ( from, to ) => {
            // Copy the file.
            await copyFile( from, to );
        },
        // SCSS files.
        '.scss': ( from, to ) => sass( from, to )
    }

    /**
     * Copy the site's static files.
     */
    async function processStatics( site ) {
        let files = site.static_files;
        // Extract a list of unique directory names.
        let dirs = files.reduce( ( dirs, file ) => {
            let dir = Path.dirname( file.target_path );
            dirs[dir] = true;
            return dirs;
        }, {});
        // Generate a minimal list of directories to create by removing
        // paths which are subpaths of longer paths.
        dirs = Object.keys( dirs )
            .sort()
            .filter( ( d, i, a ) => {
                let n = a[i + 1];
                // Filter out the item if the following item has it as a
                // whole-path prefix. (First char after path == '/' implies
                // a whole-path prefix).
                return !(n && n.indexOf( d ) == 0 && n[d.length] == '/');
            })
            .map( d => Path.join( target, d ) );
        // Create required directories.
        await asyncBatch( dirs, StaticBatchSize, dir => ensureDir( dir ) );
        // Copy files.
        console.log('Copying %d static files...', files.length );
        await asyncBatch( files, StaticBatchSize, file => {
            console.log('> %s', file.path );
            let from = Path.join( source, file.path );
            let to   = Path.join( target, file.target_path );
            let proc = StaticFileProcessors[file.extname]
                    || StaticFileProcessors['*'];
            return proc( from, to );
        });
    }

    return run();

}

/**
 * Load a site's configuration. If a configPath option is specified then the
 * function attempts to load the site configuration from that path; otherwise,
 * the function will try to read from a _config.json or _config.yml file (in
 * that order), and then, if neither is found, then attempt to load a Locomote
 * manifest (i.e. locomote.json file), and then uses the manifest's "site" 
 * property as the site configuration.
 */
async function loadSiteConfig( source, opts = {} ) {
    let { config, configPath } = opts;
    // If opts specifies a config then return that instead of loading one.
    if( config ) {
        return { config, configPath };
    }
    // Check for configuration path specified in options.
    if( configPath ) {
        config = await readFile( configPath );
        // Error if explicitly requested site config not found.
        if( config === null ) {
            throw new Error(`Site configuration not found: ${configPath}`);
        }
        // Parse config file contents.
        switch( Path.extname( configPath ) ) {
            case '.json':
                config = JSON.parse( config );
                break;
            case '.yml':
                config = YAML.safeLoad( yaml )||{};
                break;
            default:
                throw new Error(`Unsupported site configuration format: ${configPath}`);
        }
    }
    // If no config then look for JSON configuration...
    if( !config ) {
        configPath = Path.join( source, '_config.json');
        let json = await readFile( configPath );
        if( json !== null ) {
            config = JSON.parse( config );
        }
    }
    // If no config then look for YAML configuration...
    if( !config ) {
        configPath = Path.join( source, '_config.yml');
        let yaml = await readFile( configPath );
        if( yaml !== null ) {
            config = YAML.safeLoad( yaml ) || {};
        }
    }
    // If still no config then look for Locomote manifest...
    if( !config ) {
        configPath = Path.join( source, 'locomote.json');
        json = await readFile( configPath );
        if( json !== null ) {
            // Read the manifest's "site" property.
            let { site } = JSON.parse( json );
            config = site;
        }
    }
    // Check what we have a config.
    if( config && configPath ) {
        console.log('Loaded site configuration from %s', configPath );
    }
    else {
        console.log('No site configuration found');
        config = {};
        configPath = source;
    }
    // Add runtime options to the config.
    config.opts = opts;
    // Return result.
    return { config, configPath };
}

/// Make the markdown processor.
function getHTMLProcessor( config ) {
    // TODO: Support for alternative markdown processors, custom MD file extensions.
    const MD = require('markdown-it')({
        html: true  // Allow HTML tags in the markdown.
    });
    return async function( path, body ) {
        if( Path.extname( path ) == '.md' ) {
            return MD.render( body );
        }
        return body;
    }
}

exports.build = build;
exports.loadSiteConfig = loadSiteConfig;
