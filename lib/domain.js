const Path    = require('path');
const Context = require('liquid-node/lib/liquid/context');
const Drop    = require('liquid-node/lib/liquid/drop');

const { readHTML, writeFile, lookup } = require('./support');
const MapList = require('./map-list');

const HTMLExt = '.html';
const MarkdownExt = '.md';

const Mode = require('./runmode');

/**
 * Heckle specific Drop implementation.
 */
class HeckleDrop extends Drop {

    /**
     * The default Drop implementation of this method delegates directly to
     * invokeDrop, which is very restrictive about what properties and methods
     * it resolves on the drop instance, and ends up routing all requests
     * through its beforeMethod function. The following provides a more lenient
     * version of the method that attempts to resolve all properties on the drop 
     * before delegating to beforeMethod().
     * This also provides a convenient point at which to trace dependencies.
     */
    get( key, context ) {
        this.$build.engine.dependencies.trace( this._path, context );
        let value = this[key];
        switch( typeof value ) {
            case 'function':
                return value.apply( this, [ context ]);
                break;
            case 'undefined':
                return this.beforeMethod( key, context );
            default:
                return value;
        }
    }

    /**
     * Resolve a dotted path reference on this drop.
     */
    async resolve( path, context ) {
        let value;
        let keys = path.split('.');
        if( keys.length > 0 ) {
            value = await this.get( keys[0], context );
            for( let i = 1; i < keys.length; i++ ) {
                value = value[keys[i]];
            }
        }
        return value;
    }

}

/**
 * A site object.
 */
class Site extends HeckleDrop {

    constructor( source, target, config, collections, configPath ) {
        super();
        // The time the site is generated at.
        this._time = new Date().toISOString();
        this._data = Object.assign( {}, config );
        this._collections = collections;
        this._categories = {};
        this._tags = [];
        this._url = config.url
        // Note that config path is stored relative to source path.
        this._path = Path.relative( source, configPath );
        this.config = config;
        this.source = source;
        this.target = target;
    }

    beforeMethod( key ) {
        if( !(key instanceof String) ) {
            key = key.toString();
        }
        let collection = this._collections.getCollection( key );
        if( collection ) {
            return collection.documents;
        }
        return this.config[key];
    }

    get time() {
        return this._time;
    }

    get pages() {
        return this._collections.getCollection('pages').documents;
    }

    get posts() {
        return this._collections.getCollection('posts').documents;
    }

    get html_pages() {
        return this.pages.filter( page => {
            return Path.extname( page.path ) == HTMLExt;
        });
    }

    // Returns a list of all *custom* collections in the site.
    get collections() {
        return this._collections.custom;
    }

    get allDocuments() {
        return this._collections.allDocuments;
    }

    get data() {
        return this._data;
    }

    get documents() {
        return this._collections.documents;
    }

    get static_files() {
        return this._collections.static_files;
    }

    get categories() {
        return this._categories;
    }

    get tags() {
        return this._tags;
    }

    get url() {
        return this._url;
    }

    getCollection( name ) {
        return this._collections.getCollection( name );
    }

    addDocument( doc ) {
        let cname = doc.collectionName;
        if( !cname ) {
            throw new Error(`No collection name specified on document: ${doc.title}`);
        }
        let collection = this._collections.getCollection( cname );
        if( collection ) {
            collection.addDocument( doc );
        }
        else throw new Error(`Can't add document, collection ${cname} not found`);
    }

}

class Collections {

    constructor( config ) {
        this._collections = {
            layouts:    new Collection('layouts',  { _outputable: false }),
            includes:   new Collection('includes', { _outputable: false }),
            pages:      new Collection('pages',    { _outputable: true }),
            posts:      new Collection('posts',    { _outputable: true }),
            // SASS imports - don't output directly.
            sass:       new Collection('sass',     { _outputable: false })
        };
        let collections = config.collections;
        if( collections ) {
            Object.keys( collections ).forEach( k => {
                this._collections[k] = new Collection( k, collections[k] );
            });
        }
    }

    getCollectionForPath( path ) {
        // 'pages' is the default collection.
        let collection = this._collections['pages'];
        // Check for a collection folder, e.g. _xxx/file.html
        if( path[0] == '_' ) {
            let idx = path.indexOf('/');
            let name = idx > -1
                ? path.substring( 1, idx )
                : path.substring( 1 );
            // Lookup collection by name.
            collection = this._collections[name];
            if( !collection ) {
                // If no collection in place then auto-create one.
                collection = new Collection( name, { _outputable: true });
                this._collections[name] = collection;
            }
        }
        return collection;
    }

    getCollection( name ) {
        return this._collections[name];
    }

    // Return the total number of outputable documents.
    get documentCount() {
        return Object.values( this._collections ).reduce( ( t, c ) => {
            if( c.outputable ) {
                t += c.documents.length;
            }
            return t;
        }, 0 );
    }

    // Return the total number of outputable static files.
    get staticFileCount() {
        return Object.values( this._collections ).reduce( ( t, c ) => {
            if( c.outputable ) {
                t += c.static_files.length;
            }
            return t;
        }, 0 );
    }

    // Return the list of outputable documents.
    get documents() {
        return Object.values( this._collections )
            .reduce( ( ds, c ) => {
                if( c.outputable ) {
                    ds = ds.concat( c.documents );
                }
                return ds;
            }, []);
    }

    // Return the list of outputable static files.
    get static_files() {
        return Object.values( this._collections ).reduce( ( ds, c ) => {
            if( c.outputable ) {
                ds = ds.concat( c.static_files );
            }
            return ds;
        }, []);
    }

    // Return a list of all documents (outputable and non-outputable).
    get allDocuments() {
        return Object.values( this._collections )
            .reduce( ( ds, c ) => ds.concat( c.documents ), [] );
    }

    // Return a list of all user defined collections.
    get custom() {
        let builtin = lookup(['layouts','includes','posts','pages','sass']);
        return Object.values( this._collections )
            .filter( c => !builtin( c.name ) );
    }
}

class Collection {

    constructor( name, values = {} ) {
        this._name = name;
        // Move permalink to collection.
        this._permalink = values['permalink'];
        delete values['permalink'];
        // Make collection outputable by default, unless overridden.
        if( values._outputable === undefined ) {
            values._outputable = true;
        }
        this._values = values;
        this._documents = new MapList('path');
        this._static_files = new MapList('path');
    }

    getDocumentData( path, frontmatter ) {
        let data = Object.assign( {}, this._values, frontmatter );
        if( !frontmatter.permalink && this._permalink ) {
            data['permalink'] = this.makePermalink( path, frontmatter );
        }
        return data;
    }

    makePermalink( path ) {
        let basename = Path.basename( path, Path.extname( path ) );
        let ctx = {
            ':collection':  this._name,
            ':path':        path,
            ':name':        basename,
            ':title':       frontmatter['slug'] || basename,
            ':output_ext':  Path.extname( path )
        };
        let permalink = Object.keys( ctx ).reduce( ( p, k ) => {
            return p.replace( k, ctx[k] );
        }, this._permalink );
    }

    addDocument( doc ) {
        this._documents.push( doc );
        doc.collection = this;
    }

    addStaticFile( path ) {
        let basename = Path.basename( path );
        let extname  = Path.extname( path );
        let name = Path.basename( path, extname );
        let target_path = path;
        if( target_path[0] == '_' ) {
            target_path = target_path.substring( 1 );
        }
        this._static_files.push({ path, basename, extname, name, target_path });
    }

    get documents() {
        return this._documents;
    }

    get static_files() {
        return this._static_files;
    }

    get name() {
        return this._name;
    }

    get title() {
        return this._values['title'] || this.label;
    }

    get label() {
        return this._name;
    }

    get docs() {
        return this.documents;
    }

    get files() {
        return this._static_files;
    }

    get relative_directory() {
        return '_'+this._name;
    }

    get directory() {
        return Path.join( source, this.relative_directory );
    }

    get outputable() {
        return !!this._values['_outputable'];
    }

    toString() {
        return this._name;
    }

}

// Convert a value to a list (array).
function list( value ) {
    if( value === undefined ) {
        return [];
    }
    if( Array.isArray( value ) ) {
        return value;
    }
    if( typeof value === 'string' ) {
        return value.split(/\s+/g);
    }
    return [ value ];
}

/**
 * A document (page / post or other) within the site.
 */
class Document extends HeckleDrop {

    constructor( path, data, html ) {
        super();
        this._path = path;
        this._data = data;
        this._html = html;
        // Categories and tags.
        this._categories = list( data.categories ).concat( list( data.category ) );
        this._tags = list( data.tags );
        // Generate URL.
        let url = this._data['permalink'] || this._path;
        let filename = 'index.html';
        let extname = Path.extname( url );
        // Loose file extension if not HTML.
        if( extname.length > 0 ) {
            if( extname == HTMLExt ) {
                // Use filename in url.
                filename = Path.basename( url );
            }
            else if( extname == MarkdownExt ) {
                // Use filename in url with extension converted to .html
                filename = Path.basename( url )
                            .slice( 0, MarkdownExt.length * -1 )
                            + HTMLExt;
                url = Path.join( Path.dirname( url ), filename );
            }
            else url = url.slice( 0, extname.length * -1 );
        }
        // If the URL filename is index.html then use just the dir path in the url.
        if( Path.basename( url ) == 'index.html' ) {
            let dirname = Path.dirname( url );
            if( dirname == '.' ) {
                dirname = '';
            }
            url = dirname+'/';
        }
        // Loose any leading underscore.
        if( url[0] == '_' ) {
            url = url.substring( 1 );
        }
        // Ensure a leading slash.
        if( url[0] != '/' ) {
            url = '/'+url;
        }
        this._url = url;
        this.filename = filename;
        this._cacheTemplate = false;
    }

    isInvokable( key ) {
        return super.isInvokable( key );
    }

    beforeMethod( key ) {
        return this._data[key];
    }

    set filename( filename ) {
        let basename = Path.basename( this._url );
        if( basename == filename ) {
            this._targetPath = this._url;
        }
        else {
            this._targetPath = Path.join( this._url, filename );
        }
    }

    get buildable() {
        return this._data['_outputable'] === true;
    }

    get collectionName() {
        return this._collection.name;
    }

    set collection( collection ) {
        this._collection = collection;
        let isLayout = collection.name == 'layouts';
        this._cacheTemplate = isLayout;
        // Add the collection name to the page's frontmatter.
        this._data.collection = collection.name;
    }

    get collection() {
        return this._collection;
    }

    get data() {
        return this._data;
    }

    get title() {
        return this._data['title'];
    }

    get url() {
        return this._url;
    }

    get path() {
        return this._path;
    }

    get categories() {
        return this._categories;
    }

    get tags() {
        return this._tags;
    }

    get html() {
        if( this._html ) {
            return this._html;
        }
        let path = Path.join( this.$build.source, this._path );
        return readHTML( path );
    }

    get layout() {
        return this._data['layout'];
    }

    get site() {
        return this.$build.site;
    }

    get page() {
        // Return a mirrored page property if present, otherwise return this
        // document as the current page.
        // Page property mirroring is necessary when rendering layouts, to
        // ensure that they return the page being generated as the page
        // property - this is vital in order for things like page.title to
        // work.
        return this._page || this;
    }

    targetPath( outDir = '' ) {
        return Path.join( outDir, this._targetPath );
    }

    content( context ) {
        // If the document has __content then we are
        // within a document.output() call,
        if( this.__content !== undefined ) {
            return this.__content;
        }
        // If no __content then the document content
        // is being requested randomly from within a
        // template; evaluate the page template against
        // itself.
        let { engine, env } = this.$build;
        return this.render( context );
    }

    async render( context ) {
        try {
            let template = this._template;
            if( !template ) {
                let html = await this.html;
                template = await this.$build.engine.parse( html );
                template.filename = this._path;
                if( this._cacheTemplate ) {
                    this._template = template;
                }
            }
            let content = await template.render( context );
            // Apply the HTML processor to the contents. This is done to
            // e.g. convert markdown to HTML; note that it is done after
            // liquid template evaluation in case that the processor doesn't
            // play well with liquid tags.
            content = await this.$build.htmlproc( this._path, content );
            return content;
        }
        catch( e ) {
            console.log('Error rendering %s', this.path, e );
            return '';
        }
    }

    async output( context ) {
        if( Mode == 'serial' ) {
            // Evaluate page content here, using context.page
            // Note that this assumes serial site rendering.
            this.__content = await this.render( context );
            // Resolve the layout.
            let { engine, layouts } = this.$build;
            engine.dependencies.trace( this._path, context );
            let layout = layouts[this.layout];
            if( !layout ) {
                layout = layouts.__default;
            }
            // Check whether to mirror the page property.
            if( this._isLayout ) {
                this._page = await context.get('page');
            }
            // Create a new context with this page as the environment.
            let _context = new Context( engine, this, context.scopes );
            _context.dependent = this._path;
            let output = await layout.output( _context );
            // Clear the content.
            delete this.__content;
            // Return the result.
            return output;
        }
        if( Mode == 'parallel' ) {
            // Create a local copy of the current document.
            let local = Object.create( this );
            // Populate the local document with its content.
            local.__content = await this.render( context );
            // Check whether to mirror the page property.
            if( this._isLayout ) {
                local._page = await context.get('page');
            }
            // Resolve the layout.
            let { engine, layouts } = this.$build;
            engine.dependencies.trace( this._path, context );
            let layout = layouts[this.layout];
            if( !layout ) {
                layout = layouts.__default;
            }
            // Create a new context with the local page as the environment.
            let _context = new Context( engine, local, context.scopes );
            _context.dependent = this._path;
            let output = await layout.output( _context );
            // Return the result.
            return output;
        }
    }

    async write( env ) {
        let { engine, target } = this.$build;
        let targetPath = this.targetPath( target );
        try {
            let context = new Context( engine, this, env );
            context.dependent = [ this.path ];
            let output  = await this.output( context );
            await writeFile( targetPath, output );
        }
        catch( e ) {
            console.log('Error writing %s', targetPath, e );
        }
    }
}

module.exports = { HeckleDrop, Site, Collections, Collection, Document };

