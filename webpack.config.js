const path = require('path')
const nodeExternals = require('webpack-node-externals')
const AutoExport = require('./index')
module.exports = {
  entry: './index.js',
  target: 'node',
  externals: [nodeExternals()],
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'index.js',
    libraryTarget: 'commonjs2'
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
    new AutoExport({dir: ['constant', 'src']})
  ]
}

