const {
  parse,
} = require('@babel/parser')
const fs = require('fs')
const path = require('path')
const traverse = require("@babel/traverse").default;
const generator = require('@babel/generator').default;
const t = require('babel-types')
const beautify = require('js-beautify')
const { getVariableDeclarationName } = require('./utils')


const getAst = (path) => {
  const content = fs.readFileSync(path, 'utf8')
  const ast = parse(content, {
    sourceType: 'module',
  })
  return ast
}

const getExportNames = (path) => {
  const ast = getAst(path)
  let exportNameMap = {}
  traverse(ast, {
    ExportNamedDeclaration: {
      enter(path) {
        if (t.isVariableDeclaration(path.node.declaration)) {
          const nameMap = getVariableDeclarationName(path.node.declaration.declarations)
          exportNameMap = {
            ...exportNameMap,
            ...nameMap
          }
        }
      }
    },
    FunctionDeclaration: {
      enter(path) {
        if (t.isExportNamedDeclaration(path.parent)) {
          const name = path.node.id.name
          exportNameMap[name] = name
        }
      }
    },
    ExportSpecifier(path) {
      const name = path.node.exported.name
      exportNameMap[name] = name
    }
  })
  return exportNameMap
}

const autoWriteIndex = (filepath, nameMap = {}) => {
  const dirName = path.dirname(filepath)
  const fileName = path.basename(filepath, '.js')
  fs.readdir(dirName, {encoding: 'utf8', withFileTypes: true}, (err, files) => {
    let existIndex = false
    if (!err) {
      files.forEach(file => {
        if (file.name === 'index.js') {
          existIndex = true
        }
      })
      if (!existIndex) {
        const names = Object.keys(nameMap)
        const data = `
          import { ${names.join(', ')} } from './${fileName}'\n
          export default {
            ${names.join(', \n')}
          }
        `
        fs.writeFileSync(`${dirName}/index.js`, beautify(data, { indent_size: 2, space_in_empty_paren: true }))
      } else {
        replaceContent(`${dirName}/index.js`, {fileName, nameMap})
      }
    }
  })
}

const createImportSpecifiers = (keyMap) => {
  return Object.keys(keyMap).reduce((prev, cur) => {
    const identifier = t.identifier(cur)
    return [...prev, t.importSpecifier(identifier, identifier)]
  }, [])
}

const createImportDeclaration = (specifiers) => {
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

function replaceContent(pathname, { fileName, nameMap }) {
  
  const ast = getAst(pathname)
  let importSetted = false
  let exportSetted = false
  let oldExportNames = []
  let firstImportKey = null 
  const relPath = `./${fileName}`
  traverse(ast, {
    ImportDeclaration: {
      enter(path) {
        if (!firstImportKey) {
          firstImportKey = path.key
        }
        if (path.node.source.value === relPath && !importSetted) {
          oldExportNames = path.node.specifiers.reduce((prev, cur) => {
            if (t.isImportSpecifier(cur)) {
              return [...prev, cur.imported.name]
            }
            return prev
          }, [])
          const specifiers = createImportSpecifiers(nameMap)
          path.replaceWith(
            createImportDeclaration(specifiers)(relPath)
          )
          importSetted = true
        }
      },
      exit(path) {
        if (path.key === firstImportKey && !importSetted) {
          const specifiers = createImportSpecifiers(nameMap)
          path.insertAfter(createImportDeclaration(specifiers)(relPath))
          importSetted = true
        }
      }
    },
    ExportDefaultDeclaration(path){
      if (importSetted && t.isObjectExpression(path.node.declaration) && !exportSetted) {
        const filtedProperties = path.node.declaration.properties.reduce((prev, cur) => {
          if (oldExportNames.includes(cur.key.name)) {
            return prev
          }
          return [...prev, cur.key.name]
        }, [])
        const allProperties = filtedProperties.concat(Object.keys(nameMap))
        const properties = allProperties.map(item => {
          const identifier = t.identifier(item)
          return t.objectProperty(identifier, identifier, false, true)
        })
        exportSetted = true
        path.replaceWith(t.exportDefaultDeclaration(t.objectExpression(properties)))
      }
    }
  })
  const output = generator(ast)
  fs.writeFileSync(pathname, output.code)
}


module.exports = {
  getExportNames,
  autoWriteIndex
}