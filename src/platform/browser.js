// 两个平台共用的 API 入口；不修改全局命名空间。
const browser = globalThis.browser ?? globalThis.chrome;

export default browser;
