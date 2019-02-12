
/**
 * A class for tracking document dependencies.
 * Null implementation, does nothing.
 */
class NullDependencies {

    constructor( opts ) {}

    startTrace( incremental ) {}

    /**
     * Record a dependency of the current file being built.
     */
    trace( path, context ) {}

    endTrace() {}

    /**
     * Return a list of the file paths that a file path is dependent on.
     */
    async getDependencies( path ) {
        return [];
    }

    /**
     * Return a list of paths of all top-level dependents.
     * @deprecated
     */
    async getDependentPaths() {
        return [];
    }

    /**
     * Return a list of files to build based on the dependencies of a list
     * of provided files.
     */
    async getBuildList( paths, opts ) {
        return [];
    }

    /**
     * Save the set of dependencies to a file.
     */
    async save( path ) {}

    /**
     * Load previously saved dependencies from a file.
     */
    async load( path ) {
        return false;
    }

    toJSON() {
        return {};
    }
}

exports.NullDependencies = NullDependencies;
