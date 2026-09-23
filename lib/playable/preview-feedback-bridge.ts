import { readFile } from 'node:fs/promises'
import path from 'node:path'

let renderer: Promise<string> | undefined

// 仅在不透明来源的编辑预览 iframe 内执行，不需要访问父页面 DOM 或放开网络权限。
// postMessage 必须使用 *；接收端通过窗口引用与请求 ID 校验，下载产物不包含此脚本。
const bridge = `
(() => {
  const render = window.htmlToImage.toCanvas;
  let busy = false;
  window.addEventListener('message', async (event) => {
    const data = event.data;
    if (event.source !== parent || !data || data.type !== 'playable:capture' ||
        typeof data.id !== 'string' || data.id.length > 100 || busy) return;
    busy = true;
    try {
      const canvas = await render(document.documentElement, {
        pixelRatio: Math.min(2, 1200 / Math.max(innerWidth, innerHeight)),
        width: innerWidth, height: innerHeight, skipFonts: true,
        filter: (node) => !/^(SCRIPT|HEAD|IFRAME)$/.test(node.nodeName)
      });
      parent.postMessage({type: 'playable:capture-result', id: data.id,
        image: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height}, '*');
    } catch {
      parent.postMessage({type: 'playable:capture-result', id: data.id, error: true}, '*');
    } finally { busy = false; }
  });
})();`

// WebGL 默认可能在截图前清空绘图缓冲；仅在编辑预览中保留缓冲，避免截图中的画布变黑。
const preserveDrawingBuffer = `
(() => {
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(type, options) {
    return getContext.call(this, type, /^webgl2?$|^experimental-webgl$/.test(type)
      ? Object.assign({}, options, {preserveDrawingBuffer: true}) : options);
  };
})();`

export async function withPreviewFeedbackBridge(html: string): Promise<string> {
  // 缓存浏览器版渲染器的读取；失败时清空 Promise，让后续请求可以重试。
  renderer ??= readFile(path.join(process.cwd(), 'node_modules/html-to-image/dist/html-to-image.js'), 'utf8').catch(
    (error) => {
      renderer = undefined
      throw error
    },
  )
  // 内联第三方脚本前转义结束标签，避免其中的文本提前关闭外层 script 元素。
  const script = `<script>${preserveDrawingBuffer}\n${(await renderer).replace(/<\/script/gi, '<\\/script')}\n${bridge}</script>`
  // 必须先于游戏脚本执行 getContext 补丁；无显式 head 的 HTML 也在文档开头注入。
  const head = /<head(?:\s[^>]*)?>/i
  if (head.test(html)) return html.replace(head, (tag) => `${tag}${script}`)
  return html.replace(/^(\s*<!doctype[^>]*>)?/i, (prefix) => `${prefix}${script}`)
}
