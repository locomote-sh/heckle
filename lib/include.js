const FS         = require('fs');
const Path       = require('path');
const Liquid     = require('liquid-node');
const promisify  = require('util').promisify;
const readFile   = promisify( FS.readFile );

class IncludesFileSystem extends Liquid.BlankFileSystem {

    constructor( source ) {
        super();
        this._path = Path.join( source, '_includes');
        this._cache = {};
    }

    async readTemplate( path, engine ) {
        try {
            let template = this._cache[path];
            if( !template ) {
                let fullPath = await this.fullPath( path );
                let source = await readFile( fullPath );
                if( source === null ) {
                    throw new Error(`File not found: ${path}`);
                }
                template = engine.parse( source );
                this._cache[path] = template;
            }
            return template;
        }
        catch( e ) {
            throw new Liquid.FileSystemError(`Error loading include: ${e.message}`);
        }
    }

    async fullPath( path ) {
        path = Path.join( this._path, path );
        if( Path.extname( path ) != '.html' ) {
            path += '.html';
        }
        return path;
    }
}

const parseMarkup = require('./parse-markup');

/**
 * Parse the include tag's markup.
 * The markup specifies an include template name, followed by a list of 
 * parameter names and values, e.g.:
 *
 *      template a="a" b='bbb' c=c d
 *
 * Note:
 * - Literal values can be quoted using single or double quotes.
 * - Quotes within quotes can be escaped using backslash.
 * - Variable references are specified using the variable name, without 
 *   quotes.
 * - Name-only parameters are given a boolean true value.
 *
 * The function returns { include, params } properties, where:
 * - 'include' is the name of the include template;
 * - 'params' is a map of parameter names to lambdas which resolve the
 *   parameter value from a template context; or false if no parameters
 *   are specified.
 *
 * TODO: Jekyll allows the template name to be specified with variable
 * placeholders; this currently isn't supported.
 */
function parseIncludeMarkup( markup ) {
    let { args, params } = parseMarkup( markup, ['include'] );
    let { include } = args;
    return { include, params };
}

/*
console.log(parseIncludeMarkup('xxx.html '));
console.log(parseIncludeMarkup('xxx.html aaa'));
console.log(parseIncludeMarkup('xxx.html aaa=bbb'));
console.log(parseIncludeMarkup('xxx.html aaa=bbb ccc=ddd'));
console.log(parseIncludeMarkup('xxx.html aaa="bbb ccc=ddd"'));
console.log(parseIncludeMarkup('xxx.html aaa="bbb ccc=ddd" eee=fff'));
console.log(parseIncludeMarkup('xxx.html aaa="bbb ccc\'ddd" eee=fff'));
console.log(parseIncludeMarkup('xxx.html aaa="bbb ccc\\"ddd" eee=fff'));
*/
const Context = require('liquid-node/lib/liquid/context');

class IncludeTag extends Liquid.Tag {

    constructor( template, tagName, markup, tokens ) {
        super();
        let { include, params } = parseIncludeMarkup( markup );
        this._id = Math.random();
        this._include = include;
        this._params  = params;
        this._engine  = template.engine;
    }

    async render( context ) {
        let engine  = this._engine;
        let include = this._include;
        // Check whether to initialize the include template.
        if( !this._subTemplate ) {
            this._subTemplate = await engine.fileSystem.readTemplate( include, engine );
        }
        let scope = {};
        // If the include has parameters then add to the current scope.
        // Add a new context scope.
        if( this._params ) {
            // Resolve parameter values against the context.
            let params = this._params;
            let values = {};
            for( let key in params ) {
                values[key] = await params[key]( context );
            }
            scope.include = values;
        }
        // Record dependency.
        let includePath = '_includes/'+include;
        engine.dependencies.trace( includePath, context );
        // Render the include template
        // Have to construct a new context, paying careful attention to the scope,
        // for all of this to work.
        let _context = new Context( engine, context.environments, context.scopes );
        _context.dependent = includePath;
        _context.push( scope );
        let result = this._subTemplate.render( _context );
        return result;
    }
}

module.exports = { IncludesFileSystem, IncludeTag };
