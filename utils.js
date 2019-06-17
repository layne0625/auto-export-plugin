const fs = require('fs')
const path = require('path')
const isExist = (path) => {
  return fs.existsSync(path)
}

const isFile = (path) => {
  return isExist(path) && fs.statSync(path).isFile()
}

const isDir = (path) => {
  return isExist(path) && fs.statSync(path).isDirectory()
}

const getPath = (basePath, relPath) => {
  if (isDir(basePath))  {
    return path.resolve(basePath, relPath)
  }
  return path.resolve(path.dirname(basePath), relPath)
}

const getRealFilePath = (basePath) => {
  let filePath
  if (isFile(basePath)) {
    filePath = basePath    
  } else if (isDir(basePath) && isFile(path.join(basePath, './index.js'))) {
    filePath = path.join(basePath, './index.js')
  }

  if (!filePath) {
    throw new Error("cant't find file")
  }
  return filePath
}

const getVariableDeclarationName  = (declarations) => {
  return declarations.reduce((prev, cur) => {
    return cur.type === "VariableDeclarator" ?  {...prev, [cur.id.name]: cur.id.name} : prev
  }, {})
}


module.exports = {
  isExist,
  isFile,
  isDir,
  getPath,
  getRealFilePath,
  getVariableDeclarationName
}