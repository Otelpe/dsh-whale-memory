# 发布到 npm —— 卡在这里，续做从这里接

状态（2026-11-28 00:24）：**registry 正常，卡在拿不到 token。**

## 已核实

- `npm ping` → PONG（1215ms），registry.npmjs.org 可直连，不需要代理。
- `npm view dsh-whale-memory version` → 404，**包名仍然空着**。
- `www.npmjs.com` 从本机出去一律 403（HEAD、GET、带浏览器 UA 都试过）。
  Cloudflare 拦了这个代理出口 IP，所以网页「访问暂时受限」，生不了 token。

## 续做步骤

1. 换一个干净的出口：手机热点，或换代理节点；清掉 npmjs.com 的 Cookie。
2. 登录后在 `https://www.npmjs.com/settings/~/tokens` 生成 **Automation** token。
3. 写进 `C:\Users\MR\.npmrc`（一行，不要提交到任何仓库）：

   ```
   //registry.npmjs.org/:_authToken=<token>
   ```

4. 发：

   ```
   cd "E:\Plugin Development"
   npm pack --dry-run        # 应只有 lib/ bin/ cordis.patch.yml README.md LICENSE package.json
   npm publish --access public
   ```

   本机 npm 默认缓存可能被沙箱拒写，失败就加 `--cache E:\work\npm-cache`。

5. 验：

   ```
   npm view dsh-whale-memory version
   dsh plugin --profile desktop add dsh-whale-memory
   ```

   第二条会把 profile 里的 `link:` 换成正版包，装完重启 DSH。

## 如果包名被抢了

改成 scoped：`@otelpe/dsh-whale-memory`。要同步改 `package.json` 的 `name`、README 的两行装法、
`bin` 字段不用动。`cordis.patch.yml` 里的 `name` 也要跟着改。

## 不要做的事

- 不要把 token 贴进对话、提交进仓库、写进插件配置。
- 不要用脚本反复探 npmjs.com，Cloudflare 对脚本比对人更狠，越探越凉。
