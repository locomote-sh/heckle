const Liquid      = require('liquid-node');
const parseMarkup = require('./parse-markup');

/**
 * Make a skeleton tag class which provides a liquid tag container
 * for a bare render function. In addition, the skeleton tag will
 * parse the markup of a tag instance and extract tag arguments, which
 * are then assigned to the tag instance's _args property, which can
 * be consumed by the render() function via the this keyword.
 */
function makeSkeletonTag( render ) {

    class SkeletonTag extends Liquid.Tag {

        constructor( template, tagName, markup, tokens ) {
            super();
            let { args } = parseMarkup( markup, [] );
            this._args = args;
            this.render = render;
            // Make Liquid global properties available to the tag.
            this.Liquid = Liquid;
        }

    }

    return SkeletonTag;

}

exports.makeSkeletonTag = makeSkeletonTag;

