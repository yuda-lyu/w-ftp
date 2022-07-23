import rollupFiles from 'w-package-tools/src/rollupFiles.mjs'
import getFiles from 'w-package-tools/src/getFiles.mjs'


let fdSrc = './src'
let fdTar = './dist'


rollupFiles({
    fns: 'WFtp.mjs',
    fdSrc,
    fdTar,
    nameDistType: 'kebabCase',
    globals: {
        'path': 'path',
        'fs': 'fs',
        'net': 'net',
        'events': 'events',
        'util': 'util',
        'stream': 'stream',
        'stream-combiner': 'stream-combiner',
        'ftp-response-parser': 'ftp-response-parser',
        'parse-listing': 'parse-listing',
        'once': 'once',
        'unorm': 'unorm',
        'debug': 'debug',
    },
    external: [
        'path',
        'fs',
        'net',
        'events',
        'util',
        'stream',
        'stream-combiner',
        'ftp-response-parser',
        'parse-listing',
        'once',
        'unorm',
        'debug',
    ],
})

