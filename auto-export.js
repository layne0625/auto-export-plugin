const chokidar = require('chokidar')
const { getExportNames, autoWriteIndex } = require('./traverse')
const path = require('path')

class AutoExport {
  constructor(options) {
    this.watcher = chokidar.watch('constant', { usePolling: true, ignored: /dist|index/})
    this.watcher.on('change', (pathname, stats) => {
      const relPath = path.resolve(__dirname, pathname)
      const exportNames = getExportNames(relPath)
      autoWriteIndex(relPath, exportNames)
    })
    
  }

  apply(compiler) {
  }
}

module.exports = AutoExport