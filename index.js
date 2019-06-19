const chokidar = require('chokidar');

const {
  parse
} = require('@babel/parser');

const fs = require('fs');

const path = require('path');

const traverse = require("@babel/traverse").default;

const generator = require('@babel/generator').default;

const t = require('babel-types');

const beautify = require('js-beautify');

const _ = require('lodash');

const getVariableDeclarationName = declarations => {
  return declarations.reduce((prev, cur) => {
    return cur.type === "VariableDeclarator" ? {
      ...prev,
      [cur.id.name]: cur.id.name
    } : prev;
  }, {});
};

const getFileName = filePath => {
  const ext = path.extname(filePath);
  const fileName = path.basename(filePath, ext);
  return fileName;
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
    this.isWatching = false // 是否watch模式
    this.watcher = null
    this.cacheExportNameMap = {};
    this.compileHasError = false
  }

  handleChange(pathname, stats) {
    if (!this.compileHasError) {
      // 运行环境目录下
      console.log('\x1b[34m auto export compiling ... \x1b[0m');
      const absolutePath = path.resolve(pathname);
      this.autoWriteIndex(absolutePath);
    }
  }

  handleDeleteFile(pathname) {
    if (!this.compileHasError) {
      console.log('\x1b[34m auto export compiling ... \x1b[0m');
      const absolutePath = path.resolve(pathname);
      this.autoWriteIndex(absolutePath, true);
    }
  }

  init(stats) {
    this.compileHasError = stats.hasErrors()
    if (this.isWatching && !this.watcher && !this.compileHasError) {
      const optionIgnoredRegStr = this.options.ignored ? this.options.ignored.toString().slice(1, -1) : '';
      const ignoredStr = optionIgnoredRegStr ? `${optionIgnoredRegStr}|index` : 'index';
      this.watcher = chokidar.watch(this.options.dir || 'src', {
        usePolling: true,
        ignored: new RegExp(ignoredStr)
      });

      this.watcher.on('change', _.debounce(this.handleChange.bind(this), 1000))
        .on('unlink', _.debounce(this.handleDeleteFile.bind(this), 1000));
    }
  }

  getExportNames(filename) {
    const ast = this.getAst(filename);
    let exportNameMap = {};
    try {
      traverse(ast, {
        ExportNamedDeclaration(path) {
          if (t.isVariableDeclaration(path.node.declaration)) {
            const nameMap = getVariableDeclarationName(path.node.declaration.declarations);
            exportNameMap = {
              ...exportNameMap,
              ...nameMap
            };
          }
        },
  
        FunctionDeclaration(path) {
          if (t.isExportNamedDeclaration(path.parent)) {
            const name = path.node.id.name;
            exportNameMap[name] = name;
          }
        },
  
        ExportSpecifier(path) {
          const name = path.node.exported.name;
          exportNameMap[name] = name;
        },
  
        ExportDefaultDeclaration() {
          const ext = path.extname(filename);
          const basename = path.basename(filename, ext);
          exportNameMap.default = basename;
        }
  
      });
      return exportNameMap;
    } catch (error) {
      throw error
    }
    
  }

  autoWriteIndex(filepath, isDelete = false) {
    const nameMap = isDelete ? {} : this.getExportNames(filepath); // 清除对应记录的export

    if (_.isEmpty(nameMap)) {
      delete this.cacheExportNameMap[filepath];
    }

    const dirName = path.dirname(filepath);
    const fileName = getFileName(filepath);
    fs.readdir(dirName, {
      encoding: 'utf8',
    }, (err, files) => {
      let existIndex = false;

      if (!err) {
        files.forEach(file => {
          if (file === 'index.js') {
            existIndex = true;
          }
        });

        if (!existIndex) {
          if (_.isEmpty(nameMap)) {
            return false;
          }

          const defaultImport = nameMap.default;
          const exportNames = Object.keys(nameMap).reduce((prev, cur) => {
            return cur === 'default' ? prev : [...prev, cur];
          }, []);
          let importExpression = `import { ${exportNames.join(', ')} } from './${fileName}'`;

          if (defaultImport) {
            const otherImport = _.isEmpty(exportNames) ? '' : `, { ${exportNames.join(', ')} }`;
            importExpression = `import ${defaultImport}${otherImport} from './${fileName}'`;
          }

          const values = Object.values(nameMap);
          this.cacheExportNameMap[filepath] = values;
          const data = `
            ${importExpression}\n
            export default {
              ${values.join(', \n')}
            }
          `;
          fs.writeFileSync(`${dirName}/index.js`, beautify(data, {
            indent_size: 2,
            space_in_empty_paren: true
          }));
          console.log('\x1b[32m auto export compiled \x1b[0m');
        } else {
          this.replaceContent(`${dirName}/index.js`, filepath, nameMap);
        }

        
      }
    });
  }

  replaceContent(indexpath, filePath, nameMap) {
    let importSetted = false;
    let exportSetted = false;
    let oldExportNames = [];
    let firstImportKey = null;
    const fileName = getFileName(filePath);
    const relPath = `./${fileName}`;
    const indexAst = this.getAst(indexpath);
    const self = this;
    const values = Object.values(nameMap).sort();
    let changed = false;
    try {
      traverse(indexAst, {
        Program(path) {
          const first = path.get('body.0');
  
          if (!t.isImportDeclaration(first)) {
            const specifiers = self.createImportSpecifiers(nameMap);
            path.unshiftContainer('body', self.createImportDeclaration(specifiers)(relPath));
            importSetted = true;
            changed = true;
            self.cacheExportNameMap[filePath] = values;
          }
        },
  
        ImportDeclaration: {
          enter(path) {
            if (!firstImportKey) {
              firstImportKey = path.key;
            }
  
            if (path.node.source.value === relPath && !importSetted) {
              oldExportNames = path.node.specifiers.reduce((prev, cur) => {
                if (t.isImportSpecifier(cur) || t.isImportDefaultSpecifier(cur)) {
                  return [...prev, cur.local.name];
                }
  
                return prev;
              }, []);
              importSetted = true;
              self.cacheExportNameMap[filePath] = values; // 说明没有新增或删除的export语句
  
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
            // 原文件中不存在， 新增import语句
            const pathKey = path.key;
            const nextNode = path.getSibling(pathKey + 1);
  
            if (!importSetted && !_.isEmpty(nameMap) && nextNode && !t.isImportDeclaration(nextNode)) {
              const specifiers = self.createImportSpecifiers(nameMap);
              path.insertAfter(self.createImportDeclaration(specifiers)(relPath));
              importSetted = true;
              changed = true;
              self.cacheExportNameMap[filePath] = values;
            }
          }
        },
  
        ExportDefaultDeclaration(path) {
          if (changed && importSetted && !exportSetted && t.isObjectExpression(path.node.declaration)) {
            const filtedProperties = path.node.declaration.properties.reduce((prev, cur) => {
              if (oldExportNames.includes(cur.key.name)) {
                return prev;
              }
              return [...prev, cur.key.name];
            }, []);
            const allProperties = filtedProperties.concat(Object.values(nameMap));
            const properties = allProperties.map(item => {
              const identifier = t.identifier(item);
              return t.objectProperty(identifier, identifier, false, true);
            });
            exportSetted = true;
            path.replaceWith(t.exportDefaultDeclaration(t.objectExpression(properties)));
          }
        }
  
      });
    } catch (error) {
      throw error
    }

    if (changed) {
      const output = generator(indexAst);
      fs.writeFileSync(indexpath, output.code);
      console.log('\x1b[32m auto export compiled \x1b[0m');
    }
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
      console.log(error)
      return null
    }
  }

  watchClose() {
    if (this.watcher) {
      this.watcher.close()
    }
  }

  apply(compiler) {
    const init = this.init.bind(this)
    const watchClose = this.watchClose.bind(this)
    if (compiler.hooks) {
      compiler.hooks.watchRun.tap('AutoExport', () => {
        this.isWatching = true
      })
      compiler.hooks.done.tap('AutoExport', init)
      compiler.hooks.watchClose.tap('AutoExport', watchClose)
    } else {
      compiler.plugin('watchRun', () => {
        this.isWatching = true
      })
      compiler.plugin('done', init)
      compiler.plugin('watchClose', watchClose)
    }
    
  }

}

module.exports = AutoExport;