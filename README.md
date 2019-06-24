![](https://github.com/layne0625/auto-export-plugin/blob/master/screenshot/pic.gif)
## Introduction
文件改动或删除时，自动收集文件中的export语句， 并在index.js文件中导出

- 如果是非index.js文件改动会自动写入同级目录index.js文件中
- 如果是index.js文件改动会自动写入上层目录的index.js文件中(*如果不需要此特性，可以在ignored中写入/index/忽略*)


## Install
```
npm i auto-export-plugin -D
```


## Usage
```javascript
// webpack.config.js
...
const AutoExport = require('auto-export')

module.exports = {
  ...
  plugins: [
    ...
    new AutoExport({
      dir: ['src', 'constant'],
      ignored: /someFileName|someDirName/
    })
  ]
}

```

## Options
- dir (string/array):  需要监听的目录名,  默认为src目录
- ignored (regexp): 过滤掉的文件名、目录名

