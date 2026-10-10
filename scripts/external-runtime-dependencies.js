const { isBuiltin } = require('node:module')

// 扫描构建产物中的外部依赖，包括按需加载的 ESM 和 createRequire 调用。
exports.findExternalRuntimeDependencies = function (source) {
  const names = new Set()
  for (const match of source.matchAll(/\b(?:require|dynamicRequire|import)\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    const request = match[1]
    if (request.startsWith('.') || isBuiltin(request) || request === 'electron') continue
    const name = request.startsWith('@') ? request.split('/').slice(0, 2).join('/') : request.split('/')[0]
    names.add(name)
  }
  return [...names]
}
