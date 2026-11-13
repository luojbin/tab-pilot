/**
 * web-ext 配置
 *
 * sourceDir / artifactsDir / ignoreFiles 是全局选项，放顶层；
 * overwriteDest 属于 build 子命令，放 build 下。
 * 打包只收扩展运行需要的文件：manifest、LICENSE、src/、icons/。
 */
export default {
  sourceDir: '.',
  artifactsDir: 'output',
  ignoreFiles: [
    '.git',
    '.git/**',
    'node_modules',
    'node_modules/**',
    'test',
    'test/**',
    'docs',
    'docs/**',
    'output',
    'output/**',
    'package.json',
    'package-lock.json',
    'README.md',
    '.gitignore',
    'web-ext-config.mjs'
  ],
  build: {
    overwriteDest: true
  },
  lint: {
    warningsAsErrors: false
  }
};
