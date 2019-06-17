const chokidar = require('chokidar')
const { parse } = require('@babel/parser')
const fs = require('fs')
const path = require('path')
const traverse = require("@babel/traverse").default;
const generator = require('@babel/generator').default;
const t = require('babel-types')
const beautify = require('js-beautify')
const { getVariableDeclarationName } = require('./utils')
const { debounce, isEmpty, isEqual } = require('lodash')

class AutoExport {
  constructor(options) {
    this.watcher = chokidar.watch('constant', { usePolling: true, ignored: /dist|index/})
    this.watcher.on('change', debounce(this.handleChange.bind(this), 1000))
    this.cacheExportNameMap = {}
  }

  handleChange(pathname, stats) {
    const relPath = path.resolve(__dirname, pathname)
    this.autoWriteIndex(relPath)
  }

  getExportNames(filename) {
    const ast = this.getAst(filename)
    let exportNameMap = {}
    traverse(ast, {
      ExportNamedDeclaration(path){
        if (t.isVariableDeclaration(path.node.declaration)) {
          const nameMap = getVariableDeclarationName(path.node.declaration.declarations)
          exportNameMap = {
            ...exportNameMap,
            ...nameMap
          }
        }
      },
      FunctionDeclaration(path) {
        if (t.isExportNamedDeclaration(path.parent)) {
          const name = path.node.id.name
          exportNameMap[name] = name
        }
      },
      ExportSpecifier(path) {
        const name = path.node.exported.name
        exportNameMap[name] = name
      },
      ExportDefaultDeclaration() {
        const ext = path.extname(filename)
        const basename = path.basename(filename, ext)
        exportNameMap.default = basename
      }
    })
    return exportNameMap
  }

  autoWriteIndex(filepath) {
    const nameMap = this.getExportNames(filepath)
    // 清除对应记录的export
    if (isEmpty(nameMap)) {
      delete this.cacheExportNameMap[filepath]
    }
    const dirName = path.dirname(filepath)
    const ext = path.extname(filepath)
    const fileName = path.basename(filepath, ext)
    fs.readdir(dirName, {encoding: 'utf8', withFileTypes: true}, (err, files) => {
      let existIndex = false
      if (!err) {
        files.forEach(file => {
          if (file.name === 'index.js') {
            existIndex = true
          }
        })
        if (!existIndex) {
          if (isEmpty(nameMap)) {
            return false
          }
          const defaultImport = nameMap.default
          const exportNames = Object.keys(nameMap).reduce((prev, cur) => {
            return cur === 'default' ? prev : [...prev, cur]
          }, [])
          let importExpression = `import { ${exportNames.join(', ')} } from './${fileName}'`
          if (defaultImport) {
            importExpression = `import ${defaultImport}, { ${exportNames.join(', ')} } from './${fileName}'`
          }
          const values = Object.values(nameMap)
          this.cacheExportNameMap[filepath] = values
          const data = `
            ${importExpression}\n
            export default {
              ${values.join(', \n')}
            }
          `
          fs.writeFileSync(`${dirName}/index.js`, beautify(data, { indent_size: 2, space_in_empty_paren: true }))
        } else {
          this.replaceContent(`${dirName}/index.js`, filepath, nameMap)
        }
      }
    })
  }

  replaceContent(indexpath, filePath, nameMap) {
    let importSetted = false
    let exportSetted = false
    let oldExportNames = []
    let firstImportKey = null 
    const ext = path.extname(filePath)
    const fileName = path.basename(filePath, ext)
    const relPath = `./${fileName}`
    const indexAst = this.getAst(indexpath)
    const self = this
    const values = Object.values(nameMap).sort()
    let changed = false
    traverse(indexAst, {
      ImportDeclaration: {
        enter(path) {
          if (!firstImportKey) {
            firstImportKey = path.key
          }
          if (path.node.source.value === relPath && !importSetted) {
            oldExportNames = path.node.specifiers.reduce((prev, cur) => {
              if (t.isImportSpecifier(cur) || t.isImportDefaultSpecifier(cur)) {
                return [...prev, cur.local.name]
              }
              return prev
            }, [])
            importSetted = true
            self.cacheExportNameMap[filePath] = values
            // 说明没有新增或删除的export语句
            if (isEqual(oldExportNames.sort(), values)) {
              return false
            }
            changed = true
            const specifiers = self.createImportSpecifiers(nameMap)
            if (isEmpty(nameMap)) {
              path.remove()
            } else {
              path.replaceWith(
                self.createImportDeclaration(specifiers)(relPath)
              )
            }
          }
        },
        exit(path) {
          // 原文件中不存在， 新增import语句
          const pathKey = path.key
          const nextNode = path.getSibling(pathKey + 1)
          if (!importSetted && !isEmpty(nameMap) && nextNode && !t.isImportDeclaration(nextNode)) {
            const specifiers = self.createImportSpecifiers(nameMap)
            path.insertAfter(self.createImportDeclaration(specifiers)(relPath))
            importSetted = true
            changed = true
            self.cacheExportNameMap[filePath] = values
          }
        }
      },
      ExportDefaultDeclaration(path){
        if (changed && importSetted && !exportSetted && t.isObjectExpression(path.node.declaration)) {
          const filtedProperties = path.node.declaration.properties.reduce((prev, cur) => {
            if (oldExportNames.includes(cur.key.name)) {
              return prev
            }
            return [...prev, cur.key.name]
          }, [])
          const allProperties = filtedProperties.concat(Object.values(nameMap))
          const properties = allProperties.map(item => {
            const identifier = t.identifier(item)
            return t.objectProperty(identifier, identifier, false, true)
          })
          exportSetted = true
          path.replaceWith(t.exportDefaultDeclaration(t.objectExpression(properties)))
        }
      }
    })
    if (changed) {
      console.log('setttttttt')
      const output = generator(indexAst)
      fs.writeFileSync(indexpath, output.code)
    }
    console.log(JSON.stringify(this.cacheExportNameMap))
  }

  createImportSpecifiers(keyMap) {
    return Object.keys(keyMap).reduce((prev, cur) => {
      const identifier = t.identifier(cur)
      if (cur === 'default') {
        const defaultId = t.identifier(keyMap.default)
        prev.unshift(t.importDefaultSpecifier(defaultId))
        return prev
      }
      return [...prev, t.importSpecifier(identifier, identifier)]
    }, [])
  }

  createImportDeclaration(specifiers) {
    if (!Array.isArray(specifiers)) {
      throw new Error('specifiers must is array')
    }
    return (pathname) => {
      if (!pathname.startsWith('./')) {
        pathname = `./${pathname}`
      }
      return t.importDeclaration(specifiers, t.stringLiteral(pathname))
    }
  }

  getAst(filename) {
    const content = fs.readFileSync(filename, 'utf8')
    const ast = parse(content, {
      sourceType: 'module',
    })
    return ast
  }

  apply(compiler) {
  }
}

module.exports = AutoExport