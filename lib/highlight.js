const Liquid      = require('liquid-node');
const HLJS        = require('highlight.js');
const parseMarkup = require('./parse-markup');

//HLJS.configure({ useBR: true });

class HighlightTag extends Liquid.Block {

    constructor( template, tagName, markup ) {
        super( template, tagName, markup );
        let { args } = parseMarkup( markup, ['lang'] );
        let { lang } = args;
        this._lang = lang;
    }

    async render( context ) {
        let chunks = await super.render( context );
        // Get tag contents.
        let contents = Liquid.Helpers.toFlatString( chunks );
        // Remove HTML escaping.
        contents = contents
            .replace(/&lt;/g,   '<')
            .replace(/&gt;/g,   '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&amp;/g,  '&');
        // Apply syntax highlighting.
        let result = HLJS.highlight( this._lang, contents, true );
        let markup = result.value; 
        return markup;
    }

}

exports.HighlightTag = HighlightTag;
