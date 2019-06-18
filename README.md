## Introduction
监听文件改动或文件删除时，自动收集被改动文件中的export语句， 在文件同级目录的index.js文件中自动引入， 同时写入index文件的export default语句中。
*注：无需手动创建index.js*
## Install
```
npm i auto-export-plugin -D
```
```
yarn add auto-export-plugin -D
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
      ignored: /tableComponent|service/
    })
  ]
}

```

## Options
- dir(String/Array):  需要监听的目录名,  默认为src目录
- ignored(RegExp): 过滤掉的文件名、目录名