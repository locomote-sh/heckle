const Liquid      = require('liquid-node');
const parseMarkup = require('./parse-markup');

/**
 * Make a skeleton tag class which provides a liquid tag container
 * for a bare render function.
 * The tag supports both positional arguments and named parameters.
 * Names of positional arguments can be specified as an array of
 * names, provided as the second argument to the factory function,
 * and accessed via this.args in the render() function; named
 * parameters can be accessed via this.params.
 */
function makeSkeletonTag( render, ...argNames ) {

    class SkeletonTag extends Liquid.Tag {

        constructor( template, tagName, markup, tokens ) {
            super();
            Object.assign( this, parseMarkup( markup, argNames ) );
            // Backwards compatibility.
            this._args = this.args;
            this._params = this.params;
            // ---
            this.render = render;
            // Make Liquid global properties available to the tag.
            this.Liquid = Liquid;
        }

    }

    return SkeletonTag;

}

exports.makeSkeletonTag = makeSkeletonTag;

