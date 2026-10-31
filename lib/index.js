/**
 * dsh-workspace-resizer — host half.
 *
 * 纯客户端插件：布局调整全部在浏览器侧完成（见 lib/client.js），宿主侧不注册任何
 * 服务、路由或工具，只提供一个空插件让 loader 有位可挂。
 */
const name = "dsh-workspace-resizer";
const inject = [];

function apply() {
	/* 无宿主侧行为 */
}

export { name, inject, apply };
