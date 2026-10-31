// dsh-workspace-resizer — browser half.
//
// 问题：侧边栏是「全局面板导航」+「工作区」共用一列垂直空间。导航是 flex:none 且
// 不滚动，工作区是 flex:1 —— 窗口不高的时候，导航那七八行把高度吃掉，工作区只剩
// 两三百像素，会话列表看不全。
//
// 方案：在导航和工作区之间挂一条可拖动分隔条。向上拖 → 导航变矮并自带滚动，工作区
// 立刻拿到省下来的高度；向下拖 → 导航变高。结果存 localStorage，下次沿用。
// 双击分隔条（或聚焦后按 Home / 0）恢复原始布局；方向键微调。
//
// 定位不依赖任何构建期 hash 的 class 名（`.wtg9ga_panelList` 这类跨版本会变），
// 只用结构特征：flex 列容器里那个带多个按钮的 <nav>，它后面紧跟一个
// overflow:hidden + flex:1 的兄弟（工作区容器）。定位不到就静默不做事。
window.__ModuleLoader__.load({
	id: "dsh-workspace-resizer",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const NS = "dsh-workspace-resizer";
		const STORE_KEY = "dsh.workspace-resizer.navHeight";
		const MIN_NAV = 34;      // 导航最少留一行（再小就完全看不见了）
		const MIN_REGION = 132;  // 工作区至少保留这么多高度
		const STEP = 16;         // 方向键微调步长
		const HANDLE_CLASS = "dsw-resizer-handle";
		const MARK_NAV = "data-dsw-resizer-nav";
		const DRAG_ATTR = "data-dsw-resizer-dragging";

		const CSS = `
.${HANDLE_CLASS}{position:fixed;z-index:12;box-sizing:border-box;display:none;height:11px;
margin:0;padding:0;border:0;background:transparent;cursor:row-resize;-webkit-app-region:no-drag;
touch-action:none;border-radius:6px;outline:none}
.${HANDLE_CLASS}::after{content:"";position:absolute;left:14px;right:14px;top:4px;height:2px;
border-radius:2px;background:var(--dsw-alias-border-l3,#e3e3ea);opacity:.8;
transition:background .12s ease,opacity .12s ease}
.${HANDLE_CLASS}:hover::after,.${HANDLE_CLASS}:focus-visible::after{background:var(--dsw-alias-state-business-primary,#4d6bfe);opacity:.5}
.${HANDLE_CLASS}[data-dragging="1"]::after{background:var(--dsw-alias-state-business-primary,#4d6bfe);opacity:.9}
.${HANDLE_CLASS}:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4d6bfe);outline-offset:-2px}
html[${DRAG_ATTR}],html[${DRAG_ATTR}] *{cursor:row-resize!important;user-select:none!important}
[${MARK_NAV}]{scrollbar-width:thin;overscroll-behavior:contain}
`;

		let styleEl = null;
		let handle = null;
		let nav = null;
		let region = null;
		let root = null;
		let observer = null;
		let resizer = null;
		let drag = null;
		let saved = 0;            // 0 = 未启用，保持原始布局
		let frame = 0;
		let positionFrame = 0;
		let dead = false;

		function px(value) {
			const n = Number.parseFloat(value);
			return Number.isFinite(n) ? n : 0;
		}

		function readSaved() {
			try {
				const raw = window.localStorage.getItem(STORE_KEY);
				const n = raw === null ? 0 : Number.parseFloat(raw);
				return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
			} catch (error) {
				return 0;
			}
		}

		function writeSaved(value) {
			try {
				if (value > 0) window.localStorage.setItem(STORE_KEY, String(value));
				else window.localStorage.removeItem(STORE_KEY);
			} catch (error) {
				/* localStorage 不可用（隐私模式）时只是不持久化 */
			}
		}

		/**
		 * 找到侧边栏导航：带多个按钮的 <nav>，父级是 flex 列容器，
		 * 紧邻的兄弟是 overflow:hidden + flex:1 的工作区容器。
		 */
		function findNav() {
			const candidates = [];
			const navs = document.querySelectorAll("nav");
			for (const el of navs) {
				const parent = el.parentElement;
				if (parent === null || parent === document.body) continue;
				if (el.querySelectorAll("button").length < 2) continue;
				const next = el.nextElementSibling;
				if (next === null) continue;
				const parentStyle = window.getComputedStyle(parent);
				if (parentStyle.display !== "flex" || parentStyle.flexDirection !== "column") continue;
				const nextStyle = window.getComputedStyle(next);
				if (nextStyle.overflowY !== "hidden" && nextStyle.overflow !== "hidden") continue;
				if (px(nextStyle.flexGrow) < 1) continue;
				const box = parent.getBoundingClientRect();
				if (box.height < 240 || box.width < 120) continue;
				candidates.push({ nav: el, region: next, root: parent, area: box.height * box.width });
			}
			if (candidates.length === 0) return null;
			candidates.sort((a, b) => b.area - a.area);
			return candidates[0];
		}

		function detachObservers() {
			if (resizer !== null) resizer.disconnect();
			resizer = null;
		}

		function watchSize() {
			detachObservers();
			if (typeof window.ResizeObserver !== "function") return;
			resizer = new window.ResizeObserver(() => { position(); });
			if (root !== null) resizer.observe(root);
			if (nav !== null) resizer.observe(nav);
		}

		function attach(found) {
			nav = found.nav;
			region = found.region;
			root = found.root;
			nav.setAttribute(MARK_NAV, "1");
			watchSize();
		}

		/** 把导航高度定在 height 像素（0 = 恢复原始布局）。 */
		function applyHeight(height) {
			if (nav === null) return;
			if (height > 0) {
				nav.style.maxHeight = height + "px";
				nav.style.overflowY = "auto";
				nav.style.overflowX = "hidden";
				nav.style.flex = "0 1 auto";
			} else if (nav.style.maxHeight !== "") {
				nav.style.maxHeight = "";
				nav.style.overflowY = "";
				nav.style.overflowX = "";
				nav.style.flex = "";
			}
		}

		/** 当前布局下导航允许的最大高度：总可用高度减去工作区的最低下限。 */
		function maxAllowed() {
			if (nav === null || region === null) return 0;
			const navBox = nav.getBoundingClientRect();
			const regionBox = region.getBoundingClientRect();
			return Math.max(MIN_NAV, navBox.height + regionBox.height - MIN_REGION);
		}

		function commit(height, persist) {
			if (nav === null) return;
			const limit = maxAllowed();
			const next = height <= 0 ? 0 : Math.round(Math.max(MIN_NAV, Math.min(height, limit)));
			saved = next;
			applyHeight(next);
			if (persist) writeSaved(next);
			position();
		}

		function position() {
			if (dead || handle === null || nav === null || !nav.isConnected) {
				if (handle !== null) handle.style.display = "none";
				return;
			}
			const box = nav.getBoundingClientRect();
			// 侧边栏收起成图标条时导航是 display:none，宽度为 0 —— 跟着隐藏。
			if (box.width < 24 || box.height < 1) {
				handle.style.display = "none";
				return;
			}
			handle.style.display = "block";
			handle.style.left = Math.round(box.left) + "px";
			handle.style.width = Math.round(box.width) + "px";
			handle.style.top = Math.round(box.bottom - 2) + "px";
			handle.setAttribute("aria-valuenow", String(Math.round(box.height)));
			handle.setAttribute("aria-valuemax", String(Math.round(maxAllowed())));
		}

		function sync() {
			if (dead) return;
			if (nav !== null && nav.isConnected && root !== null && root.isConnected) {
				commit(saved, false);
				return;
			}
			const found = findNav();
			if (found === null) {
				nav = null;
				region = null;
				root = null;
				detachObservers();
				if (handle !== null) handle.style.display = "none";
				return;
			}
			attach(found);
			commit(saved, false);
		}

		function schedule() {
			if (dead || frame !== 0) return;
			frame = window.requestAnimationFrame(() => {
				frame = 0;
				sync();
			});
		}

		/** 滚动等高频事件只排队一次定位，别让每次滚动都强制排版。 */
		function schedulePosition() {
			if (dead || positionFrame !== 0) return;
			positionFrame = window.requestAnimationFrame(() => {
				positionFrame = 0;
				position();
			});
		}

		function onPointerDown(event) {
			if (event.button !== 0 || nav === null || region === null) return;
			const navBox = nav.getBoundingClientRect();
			const regionBox = region.getBoundingClientRect();
			drag = { y: event.clientY, height: navBox.height, total: navBox.height + regionBox.height };
			document.documentElement.setAttribute(DRAG_ATTR, "1");
			handle.setAttribute("data-dragging", "1");
			try {
				handle.setPointerCapture(event.pointerId);
			} catch (error) {
				/* 指针捕获失败也能靠 document 上的监听继续拖 */
			}
			event.preventDefault();
		}

		function onPointerMove(event) {
			if (drag === null) return;
			const target = drag.height + (event.clientY - drag.y);
			const limit = Math.max(MIN_NAV, drag.total - MIN_REGION);
			saved = Math.round(Math.max(MIN_NAV, Math.min(target, limit)));
			applyHeight(saved);
			position();
			event.preventDefault();
		}

		function onPointerUp(event) {
			if (drag === null) return;
			drag = null;
			document.documentElement.removeAttribute(DRAG_ATTR);
			handle.removeAttribute("data-dragging");
			try {
				handle.releasePointerCapture(event.pointerId);
			} catch (error) {
				/* 同上 */
			}
			writeSaved(saved);
		}

		function onKeyDown(event) {
			if (nav === null) return;
			const key = event.key;
			if (key === "ArrowUp" || key === "ArrowDown") {
				event.preventDefault();
				const delta = (key === "ArrowUp" ? -1 : 1) * (event.shiftKey ? STEP * 4 : STEP);
				commit(Math.max(MIN_NAV, nav.getBoundingClientRect().height + delta), true);
				return;
			}
			if (key === "Home" || key === "0") {
				event.preventDefault();
				commit(0, true);
			}
		}

		function buildHandle() {
			const el = document.createElement("div");
			el.className = HANDLE_CLASS;
			el.setAttribute("role", "separator");
			el.setAttribute("aria-orientation", "horizontal");
			el.setAttribute("aria-label", "拖动调整工作区高度（双击恢复）");
			el.tabIndex = 0;
			el.title = "拖动调整工作区高度 · 双击恢复（方向键微调）";
			el.addEventListener("pointerdown", onPointerDown);
			el.addEventListener("dblclick", () => { commit(0, true); });
			el.addEventListener("keydown", onKeyDown);
			window.addEventListener("pointermove", onPointerMove, { passive: false });
			window.addEventListener("pointerup", onPointerUp);
			window.addEventListener("pointercancel", onPointerUp);
			return el;
		}

		function start() {
			try {
				dead = false;
				saved = readSaved();
				styleEl = document.createElement("style");
				styleEl.dataset.plugin = NS;
				styleEl.textContent = CSS;
				document.head.appendChild(styleEl);
				handle = buildHandle();
				document.body.appendChild(handle);
				observer = new MutationObserver(() => {
					// 每次 DOM 变化只做一次廉价的连通性检查；真正重新定位交给
					// ResizeObserver / resize，避免聊天流式输出时每帧强制排版。
					if (nav !== null && nav.isConnected && root !== null && root.isConnected) return;
					schedule();
				});
				observer.observe(document.documentElement, { childList: true, subtree: true });
				window.addEventListener("resize", position);
				document.addEventListener("scroll", schedulePosition, { capture: true, passive: true });
				sync();
			} catch (error) {
				console.warn("[dsh-workspace-resizer] 启动失败:", error);
			}
		}

		function stop() {
			dead = true;
			detachObservers();
			if (observer !== null) observer.disconnect();
			if (frame !== 0) window.cancelAnimationFrame(frame);
			if (positionFrame !== 0) window.cancelAnimationFrame(positionFrame);
			window.removeEventListener("resize", position);
			document.removeEventListener("scroll", schedulePosition, { capture: true });
			if (handle !== null) handle.remove();
			if (styleEl !== null) styleEl.remove();
			document.documentElement.removeAttribute(DRAG_ATTR);
			if (nav !== null) {
				nav.removeAttribute(MARK_NAV);
				nav.style.maxHeight = "";
				nav.style.overflowY = "";
				nav.style.overflowX = "";
				nav.style.flex = "";
			}
			observer = null;
			handle = null;
			styleEl = null;
			nav = null;
			region = null;
			root = null;
			drag = null;
			frame = 0;
			positionFrame = 0;
		}

		const inject = [];

		function apply(ctx) {
			ctx.effect(() => {
				start();
				return () => stop();
			}, "dsh-workspace-resizer: draggable workspace splitter");
		}

		exports.name = NS;
		exports.inject = inject;
		exports.apply = apply;
		return module.exports;
	}
});
