const Liquid = require('liquid-node');

/**
 * Parse a tag's markup.
 * The markup may be composed of a list of fixed-position arguments,
 * followed by a list of parameter names and values, e.g.:
 *
 *      arg0 arg1 ... argn a="a" b='bbb' c=c d
 *
 * Note:
 * - Fixed position arguments are optional.
 * - Literal values can be quoted using single or double quotes.
 * - Quotes within quotes can be escaped using backslash.
 * - Variable references are specified using the variable name, without 
 *   quotes.
 * - Name-only parameters are given a boolean true value.
 *
 * The function returns { args, params } properties, where:
 * - 'args' is the map of named positional arguments read from the markup;
 * - 'params' is the map of parameter names to lambdas which resolve the
 *   parameter value from a template context.
 */
function parseMarkup( markup = '', argNames = [] ) {
    let args = {}, params = {};
    while( true ) {
        markup = markup.trim();
        if( markup.length == 0 ) {
            break;
        }
        let r = /^([\w/_.-]+)(=)?(.*)/.exec( markup );
        if( r ) {
            let name = r[1];
            if( r[2] ) {
                // Parse parameter with assigned value.
                let val = r[3];
                let q = val[0];
                if( q == '"' || q == "'" ) {
                    // Parse quoted literal.
                    for( let i = 1, escape = false; i < val.length; i++ ) {
                        if( escape ) {
                            escape = false;
                        }
                        else if( val[i] == '\\' ) {
                            escape = true;
                        }
                        else if( val[i] == q ) {
                            markup = val.substring( i + 1 ).trimLeft();
                            val = val.substring( 1, i );
                            // Add lambda returning the literal value.
                            params[name] = () => val;
                            break;
                        }
                    }
                }
                else {
                    // Parse variable reference or numeric literal.
                    idx = val.indexOf(' ');
                    if( idx > -1 ) {
                        markup = val.substring( idx + 1 );
                        val = val.substring( 0, idx );
                    }
                    else {
                        markup = '';
                    }
                    if( /^\d+$/.test( val ) ) {
                        // Numeric literal.
                        params[name] = () => val;
                    }
                    else {
                        // Add lambda fetching the named value from the context.
                        params[name] = ctx => ctx.get( val );
                    }
                }
            }
            else {
                // Argument or name-only parameter.
                if( argNames.length > 0 ) {
                    // Assign current name to next available argument.
                    let arg = argNames.shift();
                    args[arg] = name;
                }
                else {
                    // Add lambda returning true value.
                    params[name] = () => true;
                }
                markup = markup.slice( name.length );
            }
        }
        else throw new Liquid.ArgumentError(`Bad markup format: ${markup}`);
    }
    return { args, params };
}

module.exports = parseMarkup;
