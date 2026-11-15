// 启动页入口：只负责把字体与全局令牌样式带进 splash.html。
// 主题与版本号由页面内联脚本在首帧前从 query 读取（见 splash.html），
// 这里不跑 React，也没有 IPC——启动页是纯静态品牌面，样式全部复用
// globals.css 的令牌与现成类（.aurora / .noise / .loading-star / star-ignite）。
import '@fontsource-variable/inter'
import '@fontsource-variable/noto-sans-sc'
import '@fontsource-variable/manrope'
import '@fontsource-variable/geist-mono'
import './styles/globals.css'