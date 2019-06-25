
const chokidar = require('chokidar');

const {
  parse
} = require('@babel/parser');

const fs = require('fs');

const path = require('path');

const traverse = require("@babel/traverse").default;

const generator = require('@babel/generator').default;

const t = require('babel-types');

const _ = require('lodash');

const getVariableDeclarationName = declarations => {
  return declarations.reduce((prev, cur) => {
    return cur.type === "VariableDeclarator" ? { ...prev,
      [cur.id.name]: cur.id.name
    } : prev;
  }, {});
};

const getFileName = filePath => {
  const ext = path.extname(filePath);
  const fileName = path.basename(filePath, ext);
  return fileName;
};

const getDirName = dirPath => {
  return dirPath.split(path.sep).slice(-1)[0];
};

const existIndex = dirPath => {
  const files = fs.readdirSync(dirPath, {
    encoding: 'utf8'
  });
  return files.includes('index.js');
};

class AutoExport {
  constructor(options = {}) {
    if (!_.isObject(options)) {
      console.log("\x1b[31m Warning: \x1b[0m  \x1b[35m Auto-Export-Plugin's options should be a object \x1b[0m ");
      options = {};
    } else if (options.dir && !(_.isArray(options.dir) || _.isString(options.dir))) {
      options.dir = '.';
      console.log("\x1b[31m Warning: \x1b[0m  \x1b[35m Auto-Export-Plugin's dir options should be a array or string  \x1b[0m ");
    } else if (options.ignored && !_.isRegExp(options.ignored)) {
      options.ignored = null;
      console.log("\x1b[31m Warning: \x1b[0m  \x1b[35m Auto-Export-Plugin's ignored options should be a regexp  \x1b[0m ");
    }

    this.options = options;
    this.isWatching = false; // 是否watch模式

    this.watcher = null;
    this.cacheExportNameMap = {};
    this.compileHasError = false;
  }

  init(stats) {
    this.compileHasError = stats.hasErrors();

    if (this.isWatching && !this.watcher && !this.compileHasError) {
      
      this.watcher = chokidar.watch(this.options.dir || 'src', {
        usePolling: true, 
        ignored: this.options.ignored
      });
      this.watcher.on('change', _.debounce(this.handleChange.bind(this)(), 0))
        .on('unlink', _.debounce(this.handleChange.bind(this)(true), 0));
    }
  }

  handleChange(isDelete = false) {
    return (pathname, stats) => {
      if (!this.compileHasError) {
        // 运行环境目录下
        console.log('\x1b[34m auto export compiling ... \x1b[0m');
        const absolutePath = path.resolve(pathname);
        if (getFileName(pathname) === 'index') {
          this.handleIndexChange(absolutePath, isDelete);
        } else {
          this.handleWriteIndex(absolutePath, isDelete);
        }
      }
    };
  }

  handleIndexChange(changedFilePath, isDelete) {
    const dirName = getDirName(path.dirname(changedFilePath));
    const watchDirs = _.isArray(this.options.dir) ? this.options.dir : [this.options.dir];
    if (watchDirs.includes(dirName)) {
      // 如果watchDirs包含当前变化文件的目录名，则不继续向上层写入。
      // 比如this.options.dir = ['constant', 'src'], 变化的文件为constant/index.js， 则不再向constant的上级目录写入
      console.log('\x1b[32m auto export compiled \x1b[0m');
      return false;
    } else {
      this.handleWriteIndex(changedFilePath, isDelete, true);
    }
  }

  handleWriteIndex(changedFilePath, isDelete, writeToParentDir) {
    let changedFileName = getFileName(changedFilePath);
    if (writeToParentDir) {
      // 向上级写入时， index的export default用其dirName
      const dirName = getDirName(path.dirname(changedFilePath))
      changedFileName = dirName
    }
    const exportNameMap = isDelete ? {} : this.getExportNames(changedFilePath, changedFileName);

    let dirPath = path.dirname(changedFilePath);
    if (writeToParentDir) {
      dirPath = path.dirname(dirPath);
    }

    if (this.isRewritable(changedFilePath, exportNameMap)) {
      this.autoWriteFile(`${dirPath}/index.js`, changedFileName, exportNameMap, existIndex(dirPath));
    }

    if (isDelete) {
      delete this.cacheExportNameMap[changedFilePath];
    }
  }

  getExportNames(filename, defaultName) {
    const ast = this.getAst(filename);
    let exportNameMap = {};

    try {
      traverse(ast, {
        // 主要处理export const a = 1这种写法
        ExportNamedDeclaration(path) {
          // 考虑到一个文件中可能变量声明语法较多但不一定是export，所以对于`export const a = 1`这种写法，没有采用像其他3种方式一样单独对类型做处理，而是在ExportNamedDeclaration中进一步做判断并处理
          if (t.isVariableDeclaration(path.node.declaration)) {
            const nameMap = getVariableDeclarationName(path.node.declaration.declarations);
            exportNameMap = { ...exportNameMap,
              ...nameMap
            };
          }
        },

        // 处理 export function getOne(){}写法
        FunctionDeclaration(path) {
          if (t.isExportNamedDeclaration(path.parent)) {
            const name = path.node.id.name;
            exportNameMap[name] = name;
          }
        },

        // 处理const A = 1; export { A }这种写法
        ExportSpecifier(path) {
          const name = path.node.exported.name;
          exportNameMap[name] = name;
        },

        // 处理export default写法， 如果是export default会用文件名作为变量名
        ExportDefaultDeclaration() {
          const ext = path.extname(filename);
          const basename = path.basename(filename, ext);
          exportNameMap.default = defaultName || basename;
        }

      });
      return exportNameMap;
    } catch (error) {
      throw error;
    }
  }
  /**
   * 通过对比缓存的exportName判断是否需要复写
   * @param {*} changedFilePath 
   * @param {*} nameMap 
   */
  isRewritable(changedFilePath, nameMap) {
    const exportNames = Object.values(nameMap).sort();
    const oldExportNames = this.cacheExportNameMap[changedFilePath];

    if (oldExportNames && _.isEqual(oldExportNames, exportNames)) {
      console.log('no export change');
      return false;
    }

    this.cacheExportNameMap[changedFilePath] = exportNames;
    return true;
  }
  /**
   * 
   * @param {需要写入的文件绝对路径} writeFilePath 
   * @param {改动文件名，如: 'test'} changedFileName 
   * @param {改动文件导出的变量名} nameMap 
   * @param {直接写入文件还是AST操作} isReplace 
   */
  autoWriteFile(writeFilePath, changedFileName, nameMap, isReplace) {
    if (!isReplace) {
      // index.js不存在时， nameMap为空说明没有导出任何内容。 
      // 但是如果index.js存在时， nameMap为空就可能有两种情况， 
      //1.删除了文件、
      // 2.文件没有导出任何内容， 但是还是要去index.js文件中去遍历一下，看是否之前已经写入了该文件的导出语句， 如果有应该删除掉
      if (_.isEmpty(nameMap)) {
        console.log('no export change');
        return false;
      }

      const defaultExport = nameMap.default;
      const noDefaultExportNames = Object.keys(nameMap).reduce((prev, cur) => {
        return cur === 'default' ? prev : [...prev, cur];
      }, []);
      let exportExpression = `export { ${noDefaultExportNames.join(', ')} } from './${changedFileName}'`;

      if (defaultExport) {
        const others = _.isEmpty(noDefaultExportNames) ? '' : `, ${noDefaultExportNames.join(', ')}`
        exportExpression = `export { default as ${defaultExport}${others}} from './${changedFileName}'`;
      }
      fs.writeFileSync(writeFilePath, `${exportExpression}\n`);
      console.log('\x1b[32m auto export compiled \x1b[0m');
    } else {
      this.replaceContent(writeFilePath, changedFileName, nameMap);
    }
  } 

  replaceContent(replaceFilePath, changedFileName, nameMap) {
    const ast = this.getAst(replaceFilePath);
    let existedExport = false
    let changed = false
    const relPath = `./${changedFileName}`
    let oldImportNames = []
    const exportExpression = t.exportNamedDeclaration(null, this.createExportDeclatationSpecifiers(nameMap), t.stringLiteral(relPath))
    traverse(ast, {
      Program: {
        exit(path) {
          if (!existedExport) {
            changed = true
            path.pushContainer('body', exportExpression)
          }
        }
      },
      ImportDeclaration(path) {
        if (path.node.source.value === relPath) {
          // 如果存在import xxx, { xxx } from relPath, 把旧的变量收集起来并且检测export语句把这些变量删除。 同时新增export { xx } from relPath
          oldImportNames = path.node.specifiers.reduce((prev, cur) => {
            if (t.isImportSpecifier(cur) || t.isImportDefaultSpecifier(cur)) {
              return [...prev, cur.local.name];
            }
            return prev;
          }, []);
          changed = true
          path.remove()
        }
      },
      ExportNamedDeclaration(path) {
        if (!existedExport && path.node.source && path.node.source.value === relPath) {
          existedExport = true
          changed = true
          if (_.isEmpty(nameMap)) {
            // 说明没有变量导出或者文件删除， 所以删除该条语句
            path.remove()
          } else {
            path.replaceWith(exportExpression)
          }
        }
      },
      // 移除oldImportNames
      ExportSpecifier(path) {
        if (!_.isEmpty(oldImportNames) && oldImportNames.includes(path.node.exported.name)) {
          oldImportNames = oldImportNames.filter(item => item !== path.node.exported.name)
          path.remove()
          //进一步判断是否还有其他语句导出， 如果没有移除该条语句， 防止export {}导出空对象
          if (_.isEmpty(path.parent.specifiers)) {
            path.parentPath.remove()
          }
        }
      },
      //  针对export defalut { A, B }的写法，移除oldImportNames
      ExportDefaultDeclaration(path) {
        if (!_.isEmpty(oldImportNames) && t.isObjectExpression(path.node.declaration)) {
          const properties = []
          let isChange = false
          path.node.declaration.properties.forEach(item => {
            const index = oldImportNames.indexOf(item.key.name)
            if (index > -1) {
              oldImportNames.splice(index, 1)
              isChange = true
            } else {
              properties.push(item)
            }
          })
          // 进一步判断export default语句是否还有其他导出变量， 如果没有把export default语句删除，防止造成export default {}
          if (isChange) {
            if (_.isEmpty(properties)) {
              path.remove()
            } else {
              path.replaceWith(t.exportDefaultDeclaration(t.objectExpression(properties)))
            }
          }
        }
      }
    })
    if (changed) {
      const output = generator(ast);
      fs.writeFileSync(replaceFilePath, output.code);
      console.log('\x1b[32m auto export compiled \x1b[0m');
    }
  }

  createExportDeclatationSpecifiers(nameMap) {
    return Object.keys(nameMap).map(key => {
      return t.exportSpecifier(t.identifier(key), t.identifier(nameMap[key]))
    })
  }

  getAst(filename) {
    const content = fs.readFileSync(filename, 'utf8');

    try {
      const ast = parse(content, {
        sourceType: 'module'
      });
      return ast;
    } catch (error) {
      console.log(error);
      return null;
    }
  }

  watchClose() {
    if (this.watcher) {
      this.watcher.close();
    }
  }

  apply(compiler) {
    const init = this.init.bind(this);
    const watchClose = this.watchClose.bind(this);

    if (compiler.hooks) {
      compiler.hooks.watchRun.tap('AutoExport', () => {
        this.isWatching = true;
      });
      compiler.hooks.done.tap('AutoExport', init);
      compiler.hooks.watchClose.tap('AutoExport', watchClose);
    } else {
      compiler.plugin('watchRun', () => {
        this.isWatching = true;
      });
      compiler.plugin('done', init);
      compiler.plugin('watchClose', watchClose);
    }
  }

}

module.exports = AutoExport;