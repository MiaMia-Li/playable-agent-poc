// 必须在加载 Playwright 前指定包内缓存，保持安装阶段与 Agent 执行阶段的浏览器查找路径一致。
process.env.PLAYWRIGHT_BROWSERS_PATH = '0'
// 相对入口绑定到预装包，调用方无需在自己的任务目录安装 playwright。
module.exports = require('./node_modules/playwright')
