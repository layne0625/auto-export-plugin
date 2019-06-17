const {
  parse,
  parseExpression
} = require('@babel/parser')
const generator = require('@babel/generator').default;
const fs = require('fs')
const path = require('path')
const utils = require('./utils')


const getAstBody = (ast, onlyBody) => {
  if (onlyBody) {
    return ast.body
  }
  return (ast.program && ast.program.body && Array.isArray(ast.program.body)) ? ast.program.body : []
}

const getAst = (code, custom = {}, options = {}) => {
  const {
    onlyBody = true, isExpression = false
  } = custom
  let ast
  if (isExpression) {
    ast = parseExpression(code, {
      sourceType: 'module',
      plugins: ['dynamicImport'],
      ...options
    })
  } else {
    ast = parse(code, {
      sourceType: 'module',
      ...options
    })
  }
  console.log(JSON.stringify(ast))
  return onlyBody ? getAstBody(ast, onlyBody) : ast
}


const getFileAst = (pathname, onlyBody = true) => {
  const filePath = utils.getRealFilePath(pathname)
  const content = fs.readFileSync(filePath, 'utf8')
  return getAst(content, {
    onlyBody
  }, {
    sourceType: 'module'
  })
}


const getCommonDeclaratorName = (declaration) => {
  return declaration.id ? declaration.id.name : ''
}

const getVariableDeclaration = (declarations) => {
  if (!Array.isArray(declarations)) {
    return ''
  }
  const declarator = declarations.filter(item => item.type === 'VariableDeclarator')
  return declarator[0] ? getCommonDeclaratorName(declarator[0]) : ''
}

const getExportSpecifierName = (exportSpecifier) => {
  return exportSpecifier.exported ? exportSpecifier.exported.name : ''
}

const getDeclarationExpressName = (prev, cur) => {
  let name
  if (cur.type === 'ExportNamedDeclaration') {
    if (cur.declaration) {
      if (cur.declaration.type === 'FunctionDeclaration') {
        // export function a () {}
        name = getCommonDeclaratorName(cur.declaration)
      } else if (cur.declaration.type === 'VariableDeclaration') {
        // export const a = 1
        name = getVariableDeclaration(cur.declaration.declarations)
      }
    } else if (cur.specifiers && cur.specifiers.length > 0) {
      // export { a }
      name = cur.specifiers.reduce((prevItemNames, item) => {
        if (item.type === "ExportSpecifier") {
          const _name = getExportSpecifierName(item)
          return [...prevItemNames, _name]
        }
        return prevItemNames
      }, [])
    }


  }
  return !name ? prev : Array.isArray(name) ? [...prev, ...name] : [...prev, name]
}

const getExportDeclaration = (path) => {
  const ast = getFileAst(path)
  return ast.reduce(getDeclarationExpressName, [])
}


const getEntryConfig = (pathname) => {
  const ast = getFileAst(pathname, false)
  const astBody = getAstBody(ast)
  const exportNames = astBody.reduce((prev, cur, index) => {
    if (cur.type === "ExportAllDeclaration") {
      const filePath = cur.source && cur.source.value || ''
      const names = getExportDeclaration(utils.getPath(pathname, filePath))
      return [...prev, {
        [filePath]: names,
        index,
        filePath
      }]
    } else {
      return prev
    }
  }, [])

  return {
    ast,
    exportNames
  }
}

console.log(getEntryConfig('./constant').exportNames)

const convert = (path) => {
  const {
    exportNames,
    ast
  } = getEntryConfig(path)
  exportNames.forEach(item => {
    const {
      index,
      filePath
    } = item
    const exportsArr = item[filePath]
    const expression = `import {${exportsArr.join(',')}} from '${filePath}' `
    const tempAst = getAst(expression, {
      isExpression: true,
    }, {
      // plugins: ['dynamicImport']
    })
    console.log(tempAst)
    ast.program && ast.program.body && ast.program.body.splice(index, 1, tempAst)
  })

  // console.log('ast', JSON.stringify(ast))
  // console.log(generator(ast, {}))
}

// convert('./constant')