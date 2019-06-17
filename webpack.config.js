const path = require('path')
const AutoExport = require('./auto-export')

module.exports = {
  mode: 'development',
  entry: './index.js',
  devtool: '',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.js'
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        use: 'babel-loader'
      }
    ]
  },
  plugins: [
    new AutoExport()
  ]
}

