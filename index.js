
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

      const defaultImport = nameMap.default;
      const exportNames = Object.keys(nameMap).reduce((prev, cur) => {
        return cur === 'default' ? prev : [...prev, cur];
      }, []);
      let importExpression = `import { ${exportNames.join(', ')} } from './${changedFileName}'`;

      if (defaultImport) {
        const otherImport = _.isEmpty(exportNames) ? '' : `, { ${exportNames.join(', ')} }`;
        importExpression = `import ${defaultImport}${otherImport} from './${changedFileName}'`;
      }

      const values = Object.values(nameMap);
      const data = `${importExpression}\nexport default {\n  ${values.join(', \n  ')}\n}`;
      fs.writeFileSync(writeFilePath, data);
      console.log('\x1b[32m auto export compiled \x1b[0m');
    } else {
      this.replaceContent(writeFilePath, changedFileName, nameMap);
    }
  } 

  replaceContent(indexpath, changedFileName, nameMap) {
    let importEnter = false; // 用于标示当前文件是否存在改动文件的import语句

    let exportSetted = false; // 防止写入index文件中export default语句时再次触发ExportDefaultDeclaration造成死循环

    let changed = false; // 当前改动文件的是否新增或删除了某些export语句

    let oldExportNames = [];
    let firstImportKey = null;
    // const fileName = getFileName(filePath);
    const relPath = `./${changedFileName}`;
    const indexAst = this.getAst(indexpath);
    const self = this;
    const values = Object.values(nameMap).sort();

    try {
      traverse(indexAst, {
        Program(path) {
          const first = path.get('body.0'); // 因为js要求import语句必须写在文件最顶部，
          // 所以如果index.js文件的第一个语句不是import语句，说明当前文件不存在import
          // 需要创建import语句并插入文件第一个语句中

          if (!t.isImportDeclaration(first)) {
            const specifiers = self.createImportSpecifiers(nameMap);
            path.unshiftContainer('body', self.createImportDeclaration(specifiers)(relPath));
            importEnter = true;
            changed = true;
            // self.cacheExportNameMap[filePath] = values;
          }

          const bodys = path.get('body');

          if (!bodys.some(item => t.isExportDefaultDeclaration(item))) {
            exportSetted = true;
            changed = true;
            path.pushContainer('body', self.createExportDefaultDeclaration(Object.values(nameMap)));
          }
        },

        ImportDeclaration: {
          enter(path) {
            if (!firstImportKey) {
              firstImportKey = path.key;
            } // 如果存在改动文件的import语句, 比如改动的是test文件， index中原来存在`import { xx } from './test'`这样的语句，需要将原来import的变量名替换掉


            if (path.node.source.value === relPath && !importEnter) {
              // 记录旧的export变量名。这里记录有两个作用, 
              // 1.拿旧的exportNames去和新的exportNames做对比， 如果相同，则无需修改index.js文件。 
              // 2.在后面的处理ExportDefaultDeclaration语句时，需要将旧的exportNames中的变量全部删除掉(因为可能某些export语句再原文件中已经删除或者重命名了)， 并且把新的exportName加到export default中去。
              oldExportNames = path.node.specifiers.reduce((prev, cur) => {
                if (t.isImportSpecifier(cur) || t.isImportDefaultSpecifier(cur)) {
                  return [...prev, cur.local.name];
                }

                return prev;
              }, []);
              importEnter = true;
              // 正确情况下，在isRewriteable函数中判断即可；但是文件第一次更新时, this.cacheExportNameMap有可能不存在对应的值，所以多加一次。
              if (_.isEqual(oldExportNames.sort(), values)) {
                return false;
              }

              changed = true;
              const specifiers = self.createImportSpecifiers(nameMap);

              if (_.isEmpty(nameMap)) {
                path.remove();
              } else {
                path.replaceWith(self.createImportDeclaration(specifiers)(relPath));
              }
            }
          },
          exit(path) {
            // index.js文件中不存在变动文件的导入语句， 需要新增import语句
            const pathKey = path.key;
            const nextNode = path.getSibling(pathKey + 1); // 当每个ImportDeclaration执行完enter之后， 如果没有进入enter内部逻辑说明，说明当前node不是改动文件的import语句, 所以判断下一条node是不是import语句， 如果是，继续进入下一条import语句的enter，继续进行；
            // 如果下一条node不是import语句，则说明当前index.js文件中不存在变动文件的导入语句， 在其后面插入import语句

            if (!importEnter && !_.isEmpty(nameMap) && nextNode && !t.isImportDeclaration(nextNode)) {
              const specifiers = self.createImportSpecifiers(nameMap);
              path.insertAfter(self.createImportDeclaration(specifiers)(relPath));
              importEnter = true;
              changed = true;
              // self.cacheExportNameMap[filePath] = values;
            }
          }
        },

        ExportDefaultDeclaration(path) {
          // 写入export default时会再次访问ExportDefaultDeclaration, 加exportSetted判断防止造成死循环
          if (changed && !exportSetted && t.isObjectExpression(path.node.declaration)) {
            exportSetted = true;
            const filtedProperties = path.node.declaration.properties.reduce((prev, cur) => {
              if (oldExportNames.includes(cur.key.name)) {
                return prev;
              }

              return [...prev, cur.key.name];
            }, []);
            const allProperties = filtedProperties.concat(Object.values(nameMap));
            if (_.isEmpty(allProperties)) {
              path.remove()
            } else {
              path.replaceWith(self.createExportDefaultDeclaration(allProperties));
            }
          }
        }

      });
    } catch (error) {
      throw error;
    }

    if (changed) {
      const output = generator(indexAst);
      fs.writeFileSync(indexpath, output.code);
      console.log('\x1b[32m auto export compiled \x1b[0m');
    }
  }

  createExportDefaultDeclaration(exportsArr) {
    const properties = exportsArr.map(item => {
      const identifier = t.identifier(item);
      return t.objectProperty(identifier, identifier, false, true);
    });
    return t.exportDefaultDeclaration(t.objectExpression(properties));
  }

  createImportSpecifiers(keyMap) {
    return Object.keys(keyMap).reduce((prev, cur) => {
      const identifier = t.identifier(cur);

      if (cur === 'default') {
        const defaultId = t.identifier(keyMap.default);
        prev.unshift(t.importDefaultSpecifier(defaultId));
        return prev;
      }

      return [...prev, t.importSpecifier(identifier, identifier)];
    }, []);
  }

  createImportDeclaration(specifiers) {
    if (!Array.isArray(specifiers)) {
      throw new Error('specifiers must is array');
    }

    return pathname => {
      if (!pathname.startsWith('./')) {
        pathname = `./${pathname}`;
      }

      return t.importDeclaration(specifiers, t.stringLiteral(pathname));
    };
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